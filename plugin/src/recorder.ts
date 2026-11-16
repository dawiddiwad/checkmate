import type { Reply, Status, Store } from './store.ts'
import type { ChildContext, ClaudeCall, Env } from './sessions.ts'
import { all, one, write } from './store.ts'
import { Refusal, requireIdentifier, requireWellFormed } from './contracts.ts'
import { recorderPrompt, repairPrompt } from './briefs.ts'
import { explorationRow, freshIds, logEntries, recordText, refusalText } from './journal.ts'
import type { Refused } from './journal.ts'
import { addEvent, explorationEvents } from './explorations.ts'
import { callClaude, childArgs, childEnv, replyArray, requireClaude } from './sessions.ts'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type RecordInput = {
	explorationId: string
	explorer: string
	session: string
	timeoutSeconds: number
	claudeArgs?: string[]
}

export const defaultRecorderTimeout = 600
const reservedExplorers = ['merge', 'verify']

export function explorerActor(explorer: string) {
	return `qa:${explorer}`
}

function lastEntry(store: Store) {
	return one<{ seq: number }>(store, 'SELECT coalesce(max(rowid), 0) AS seq FROM journal_entries')!.seq
}

function addedEntries(store: Store, explorationId: string, actor: string, after: number) {
	const rows = all<{ kind: string; count: number }>(
		store,
		'SELECT kind, count(*) AS count FROM journal_entries WHERE exploration_id = ? AND actor = ? AND rowid > ? GROUP BY kind ORDER BY min(rowid)',
		explorationId,
		actor,
		after
	)
	return Object.fromEntries(rows.map((row) => [row.kind, row.count]))
}

export function launchContext(store: Store, explorationId: string, explorer: string, session: string) {
	const launch = explorationEvents(store, explorationId)
		.filter((event) => event.step === 'launch' && event.explorer === explorer && event.detail.session === session)
		.at(-1)
	return launch ? (launch.detail.context as ChildContext) : undefined
}

function logReply(
	store: Store,
	actor: string,
	explorationId: string,
	planId: string,
	entries: unknown[],
	missing: string[],
	dropped: string[],
	cwd: string
) {
	try {
		const reply = logEntries(store, actor, {
			explorationId,
			entries: freshIds(store, planId, actor, entries),
			cwd,
			missingEvidence: missing,
			droppedReferences: dropped,
		})
		return (reply.data.refused as Refused[]).map(refusalText)
	} catch (error) {
		if (!(error instanceof Refusal)) throw error
		return [`${error.message}${error.hint ? ` ${error.hint}` : ''}`]
	}
}

function sum(calls: ClaudeCall[], key: 'costUsd' | 'durationMs') {
	const values = calls.flatMap((call) => (call[key] === undefined ? [] : [call[key]]))
	return values.length ? { [key]: values.reduce((total, value) => total + value, 0) } : {}
}

function running(pid: number) {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

function lockHolder(path: string) {
	try {
		return Number(readFileSync(path, 'utf8'))
	} catch {
		return undefined
	}
}

function takeLock(path: string, until: number) {
	mkdirSync(join(path, '..'), { recursive: true })
	for (;;) {
		try {
			writeFileSync(path, String(process.pid), { flag: 'wx' })
			return true
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
		}
		const holder = lockHolder(path)
		if (holder && !running(holder) && lockHolder(path) === holder) {
			rmSync(path, { force: true })
			continue
		}
		if (Date.now() >= until) return false
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
	}
}

function releaseLock(path: string) {
	if (lockHolder(path) === process.pid) rmSync(path, { force: true })
}

function prepare(store: Store, input: RecordInput, env: Env) {
	if (env.CHECKMATE_RECORDER)
		throw new Refusal(
			'prohibited',
			'A recorder cannot start another recorder. CHECKMATE_RECORDER is set. Nothing changed.',
			'Run checkmate record from outside the recorder session, after the test session.'
		)
	const explorer = requireIdentifier(input.explorer, 'explorer (--explorer)')
	requireWellFormed(
		!reservedExplorers.includes(explorer),
		`Explorer name ${explorer} is reserved. Use another name, for example a1.`
	)
	requireWellFormed(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.session),
		`Invalid session ID: ${input.session}. Give the session_id of the test session.`,
		'claude -p --output-format json gives it in session_id. In an interactive session, /status shows it.'
	)
	const exploration = explorationRow(store, input.explorationId)
	const claude = requireClaude(env)
	const context = launchContext(store, exploration.exploration_id, explorer, input.session) ?? {
		hiddenPlugin: null,
		claudeArgs: input.claudeArgs ?? [],
	}
	return { claude, exploration, explorer, context, recorder: randomUUID(), actor: explorerActor(explorer) }
}

export function recordSession(
	store: Store,
	actor: string | undefined,
	input: RecordInput,
	env: Env,
	cwd: string
): Reply {
	const operation = { actor, command: 'record', subject: input.explorationId, input }
	let plan: ReturnType<typeof prepare>
	try {
		plan = prepare(store, input, env)
	} catch (error) {
		return write(store, operation, () => {
			throw error
		})
	}
	const started = Date.now()
	const lock = join(store.workspace, '.checkmate', 'tmp', `record-${plan.exploration.plan_id}-${plan.explorer}.lock`)
	if (!takeLock(lock, started + input.timeoutSeconds * 1000))
		return write(store, operation, () => ({
			reply: {
				status: 'operational_error',
				subject: input.explorationId,
				reasons: [
					`Another recorder of ${plan.explorer} runs. Checkmate waited ${input.timeoutSeconds} seconds for it. No recorder started.`,
				],
				hint: `Run the same record command again when the other recorder ends.`,
				data: { explorationId: input.explorationId, session: input.session },
			},
			subjects: [`exploration:${input.explorationId}`],
		}))
	try {
		return recordLocked(store, operation, input, plan, env, cwd, started)
	} finally {
		releaseLock(lock)
	}
}

function recordLocked(
	store: Store,
	operation: { actor: string | undefined; command: string; subject: string; input: RecordInput },
	input: RecordInput,
	plan: ReturnType<typeof prepare>,
	env: Env,
	cwd: string,
	started: number
): Reply {
	const { exploration, actor } = plan
	const childEnvironment = childEnv(env, { CHECKMATE_RECORDER: '1' })
	const left = () => input.timeoutSeconds - Math.floor((Date.now() - started) / 1000)
	const after = lastEntry(store)
	const prompt = recorderPrompt(exploration.build, recordText(store, exploration.plan_id, actor))
	const resume = ['--resume', input.session, '--fork-session', '--session-id', plan.recorder]
	const calls = [
		callClaude(plan.claude, childArgs(plan.context, resume), prompt, cwd, childEnvironment, Math.max(1, left())),
	]
	const missing: string[] = []
	const dropped: string[] = []
	const log = (entries: unknown[]) =>
		logReply(store, actor, exploration.exploration_id, exploration.plan_id, entries, missing, dropped, cwd)
	const first = replyArray(calls[0].result)
	let refusals = first ? log(first) : []
	if (!calls[0].failure && refusals.length && left() > 0) {
		calls.push(
			callClaude(
				plan.claude,
				childArgs(plan.context, ['--resume', plan.recorder]),
				repairPrompt(refusals),
				cwd,
				childEnvironment,
				left()
			)
		)
		const fix = replyArray(calls[1].result)
		if (fix) refusals = log(fix)
	}
	const added = addedEntries(store, exploration.exploration_id, actor, after)
	const saved = Object.values(added).reduce((total, count) => total + count, 0)
	const timedOut = calls.find((call) => call.failure?.[0] === 'interrupted')
	const status: Status = timedOut ? 'interrupted' : calls[0].failure || !saved ? 'operational_error' : 'completed'
	const reasons = [
		...calls.flatMap((call) => (call.failure ? [call.failure[1]] : [])),
		...(first || calls[0].failure ? [] : ['The reply of the recorder has no JSON array of entries.']),
		...(first && !saved ? [`The recorder added no entry to ${exploration.exploration_id}.`] : []),
		...refusals.map((refusal) => `Refused: ${refusal}`),
	]
	const data = {
		explorationId: exploration.exploration_id,
		explorer: plan.explorer,
		session: input.session,
		recorder: calls[0].sessionId ?? plan.recorder,
		calls: calls.length,
		saved,
		refused: refusals.length,
		added,
		evidenceMissing: missing.length,
		...(missing.length ? { missingEvidence: missing } : {}),
		referencesDropped: dropped.length,
		...(dropped.length ? { droppedReferences: dropped } : {}),
		...sum(calls, 'costUsd'),
		...sum(calls, 'durationMs'),
	}
	const reply: Reply = {
		status,
		subject: exploration.exploration_id,
		reasons,
		...(status === 'completed'
			? {}
			: {
					hint: `The entries that Checkmate logged stay. To read what the recorder did, run claude --resume ${plan.recorder}. Then run the same record command again.`,
				}),
		data,
	}
	return write(store, { ...operation, input: { ...input, recorder: plan.recorder } }, (operationId, at) => {
		addEvent(
			store,
			exploration.exploration_id,
			{ step: 'record', explorer: plan.explorer, status, detail: { ...data, reasons } },
			operationId,
			at
		)
		return { reply, subjects: [`exploration:${exploration.exploration_id}`, `plan:${exploration.plan_id}`] }
	})
}
