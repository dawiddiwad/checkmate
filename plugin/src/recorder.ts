import type { Reply, Status, Store } from './store.ts'
import type { ChildContext, ClaudeCall, Env } from './sessions.ts'
import { all, one, write } from './store.ts'
import { Refusal, requireIdentifier, requireWellFormed } from './contracts.ts'
import { recorderPrompt, repairPrompt } from './briefs.ts'
import { bareOf, explorationRow, freshIds, journal, logEntries, recordText, refusalText } from './journal.ts'
import type { Entry, Refused } from './journal.ts'
import { addEvent, explorationEvents, workFolder } from './explorations.ts'
import {
	authenticationFailed,
	authenticationHint,
	callClaude,
	childArgs,
	childEnv,
	replyArray,
	requireClaude,
} from './sessions.ts'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

export function lastEntry(store: Store) {
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

const entryTitle = (entry: Partial<Entry>) => entry.title ?? entry.text ?? entry.question ?? entry.saw ?? ''
const entryKey = (entry: Partial<Entry>) => `${entry.kind}\n${entryTitle(entry).trim().toLowerCase()}`

function savedEntries(store: Store, planId: string, explorationId: string, actor: string) {
	return journal(store, planId, actor).team.filter(
		(entry) => entry.actor === actor && entry.explorationId === explorationId
	)
}

function newEntries(entries: unknown[], saved: Entry[]) {
	const keys = new Set(saved.map(entryKey))
	return entries.filter((raw) => {
		const entry = raw as Partial<Entry> | null
		return !entry || typeof entry !== 'object' || entry.supersedes !== undefined || !keys.has(entryKey(entry))
	})
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

function promptOf(
	store: Store,
	exploration: { plan_id: string; build: string },
	actor: string,
	earlier: Entry[],
	answer?: string
) {
	return recorderPrompt(
		exploration.build,
		recordText(store, exploration.plan_id, actor, exploration.build),
		earlier.map((entry) => `${bareOf(entry.id)} ${entry.kind}: ${entryTitle(entry)}`),
		answer
	)
}

export function recordTask(store: Store, explorationId: string, explorer: string, answer: string) {
	const exploration = explorationRow(store, explorationId)
	const actor = explorerActor(explorer)
	return promptOf(store, exploration, actor, savedEntries(store, exploration.plan_id, explorationId, actor), answer)
}

export type Carried = { given: boolean; repeated: number; refusals: string[]; missing: string[]; dropped: string[] }
export type AnswerInput = {
	explorationId: string
	explorer: string
	answer: string
	after: number
	round: number
	carried?: Carried
	failed?: string
}

function readText(path: string) {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return undefined
	}
}

export function recordAnswer(store: Store, input: AnswerInput) {
	const exploration = explorationRow(store, input.explorationId)
	const actor = explorerActor(input.explorer)
	const earlier = savedEntries(store, exploration.plan_id, exploration.exploration_id, actor)
	const carried = input.carried ?? { given: false, repeated: 0, refusals: [], missing: [], dropped: [] }
	const missing = [...carried.missing]
	const dropped = [...carried.dropped]
	const work = join(store.workspace, workFolder(exploration.exploration_id, input.explorer))
	const given = input.failed ? undefined : replyArray(readText(join(store.workspace, input.answer)))
	const fresh = given && newEntries(given, earlier)
	const repeated = input.round > 1 ? carried.repeated : given && fresh ? given.length - fresh.length : 0
	const logged = fresh?.length
		? logReply(store, actor, exploration.exploration_id, exploration.plan_id, fresh, missing, dropped, work)
		: []
	const refusals = input.round > 1 && !given ? carried.refusals : logged
	const first = input.round > 1 ? carried.given : Boolean(given)
	if (input.round === 1 && refusals.length)
		return { repair: true, carried: { given: first, repeated, refusals, missing, dropped } }
	const added = addedEntries(store, exploration.exploration_id, actor, input.after)
	const saved = Object.values(added).reduce((total, count) => total + count, 0)
	const status: Status = input.failed || (!saved && !repeated) ? 'operational_error' : 'completed'
	const reasons = [
		...(input.failed ? [input.failed] : []),
		...(first || input.failed ? [] : ['The answer file of the tester has no JSON array of entries.']),
		...(first && !saved && !repeated ? [`The tester added no entry to ${exploration.exploration_id}.`] : []),
		...refusals.map((refusal) => `Refused: ${refusal}`),
	]
	return {
		repair: false,
		status,
		detail: {
			explorationId: exploration.exploration_id,
			explorer: input.explorer,
			calls: input.round,
			saved,
			repeated,
			refused: refusals.length,
			added,
			evidenceMissing: missing.length,
			...(missing.length ? { missingEvidence: missing } : {}),
			referencesDropped: dropped.length,
			...(dropped.length ? { droppedReferences: dropped } : {}),
			reasons,
		},
	}
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
	const earlier = savedEntries(store, exploration.plan_id, exploration.exploration_id, actor)
	const prompt = promptOf(store, exploration, actor, earlier)
	const resume = ['--resume', input.session, '--fork-session', '--session-id', plan.recorder]
	const calls = [
		callClaude(plan.claude, childArgs(plan.context, resume), prompt, cwd, childEnvironment, Math.max(1, left())),
	]
	const missing: string[] = []
	const dropped: string[] = []
	const work = join(store.workspace, workFolder(exploration.exploration_id, plan.explorer))
	const evidenceCwd = existsSync(work) ? work : cwd
	const log = (entries: unknown[]) =>
		logReply(store, actor, exploration.exploration_id, exploration.plan_id, entries, missing, dropped, evidenceCwd)
	const given = replyArray(calls[0].result)
	const first = given && newEntries(given, earlier)
	const repeated = given && first ? given.length - first.length : 0
	let refusals = first?.length ? log(first) : []
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
		if (fix) refusals = log(newEntries(fix, earlier))
	}
	const added = addedEntries(store, exploration.exploration_id, actor, after)
	const saved = Object.values(added).reduce((total, count) => total + count, 0)
	const timedOut = calls.find((call) => call.failure?.[0] === 'interrupted')
	const status: Status = timedOut
		? 'interrupted'
		: calls[0].failure || (!saved && !repeated)
			? 'operational_error'
			: 'completed'
	const reasons = [
		...calls.flatMap((call) => (call.failure ? [call.failure[1]] : [])),
		...(first || calls[0].failure ? [] : ['The reply of the recorder has no JSON array of entries.']),
		...(first && !saved && !repeated ? [`The recorder added no entry to ${exploration.exploration_id}.`] : []),
		...refusals.map((refusal) => `Refused: ${refusal}`),
	]
	const data = {
		explorationId: exploration.exploration_id,
		explorer: plan.explorer,
		session: input.session,
		recorder: calls[0].sessionId ?? plan.recorder,
		calls: calls.length,
		saved,
		repeated,
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
			: calls.some(authenticationFailed)
				? { hint: authenticationHint }
				: {
						hint: `The entries that Checkmate logged stay. To read what the recorder did, run claude --resume ${plan.recorder}. Then run the same record command again.`,
					}),
		data,
	}
	return write(store, { ...operation, input: { ...input, recorder: plan.recorder } }, (operationId, at) => {
		addEvent(
			store,
			exploration.exploration_id,
			{
				step: 'record',
				explorer: plan.explorer,
				status,
				detail: { ...data, reasons, ...(reply.hint ? { hint: reply.hint } : {}) },
			},
			operationId,
			at
		)
		return { reply, subjects: [`exploration:${exploration.exploration_id}`, `plan:${exploration.plan_id}`] }
	})
}
