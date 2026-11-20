import type { Reply, Status, Store } from './store.ts'
import type { ChildContext, ChildCall, Env } from './sessions.ts'
import { all, one, write } from './store.ts'
import { Refusal, requireIdentifier, requireWellFormed } from './contracts.ts'
import { recorderPrompt, repairPrompt } from './briefs.ts'
import { bareOf, explorationRow, freshIds, journal, logEntries, recordText, refusalText } from './journal.ts'
import type { Entry, Refused } from './journal.ts'
import { addEvent, explorationEvents, workFolder } from './explorations.ts'
import { explorationRules } from './rules.ts'
import { piModelArgs, piOverrideModelArgs, selectedHarness } from './pi.ts'
import {
	authenticationFailed,
	authenticationHint,
	callChild,
	childArgs,
	childEnv,
	usageOf,
	childHook,
	replyArray,
	requireChild,
	piAuthenticationHint,
	storeDenyRules,
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
const reservedExplorers = ['rules', 'merge', 'verify']

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
	const events = explorationEvents(store, explorationId)
	const turn = events.findLastIndex(
		(event) =>
			event.step === 'follow-turn' &&
			event.status !== 'operational_error' &&
			event.explorer === explorer &&
			event.detail.session === session
	)
	const follow = turn === -1 ? undefined : events.slice(0, turn).findLast((event) => event.step === 'follow')
	const launch = events.findLast(
		(event) => event.step === 'launch' && event.explorer === explorer && event.detail.session === session
	)
	const context = (events[turn]?.detail.context ?? follow?.detail.context ?? launch?.detail.context) as
		ChildContext | undefined
	if (context?.harness !== 'pi') return context
	const used = events.findLast(
		(item) =>
			(item.step === 'end' || (item.step === 'follow-turn' && item.status !== 'operational_error')) &&
			item.explorer === explorer &&
			item.detail.session === session &&
			Array.isArray(item.detail.observedModels) &&
			item.detail.observedModels.length
	)
	const model = (used?.detail.observedModels as string[] | undefined)?.at(-1)
	if (!model) return context
	return { ...context, piArgs: piOverrideModelArgs(context.piArgs ?? [], model) }
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
	unknownRules: string[],
	cwd: string
) {
	try {
		const reply = logEntries(store, actor, {
			explorationId,
			entries: freshIds(store, planId, actor, entries),
			cwd,
			missingEvidence: missing,
			droppedReferences: dropped,
			unknownRules,
		})
		return (reply.data.refused as Refused[]).map(refusalText)
	} catch (error) {
		if (!(error instanceof Refusal)) throw error
		return [`${error.message}${error.hint ? ` ${error.hint}` : ''}`]
	}
}

function duration(calls: ChildCall[]) {
	const values = calls.flatMap((call) => (call.durationMs === undefined ? [] : [call.durationMs]))
	return values.length ? { durationMs: values.reduce((total, value) => total + value, 0) } : {}
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
	exploration: { exploration_id: string; plan_id: string; build: string },
	actor: string,
	earlier: Entry[],
	answer?: string
) {
	return recorderPrompt(
		exploration.build,
		recordText(store, exploration.plan_id, actor, exploration.build),
		earlier.map((entry) => `${bareOf(entry.id)} ${entry.kind}: ${entryTitle(entry)}`),
		answer,
		explorationRules(store, exploration.exploration_id)
	)
}

export function recordTask(store: Store, explorationId: string, explorer: string, answer: string) {
	const exploration = explorationRow(store, explorationId)
	const actor = explorerActor(explorer)
	return promptOf(store, exploration, actor, savedEntries(store, exploration.plan_id, explorationId, actor), answer)
}

export type Carried = {
	given: boolean
	repeated: number
	refusals: string[]
	missing: string[]
	dropped: string[]
	unknownRules?: string[]
}
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
	const unknownRules = [...(carried.unknownRules ?? [])]
	const work = join(store.workspace, workFolder(exploration.exploration_id, input.explorer))
	const given = input.failed ? undefined : replyArray(readText(join(store.workspace, input.answer)))
	const fresh = given && newEntries(given, earlier)
	const repeated = input.round > 1 ? carried.repeated : given && fresh ? given.length - fresh.length : 0
	const logged = fresh?.length
		? logReply(
				store,
				actor,
				exploration.exploration_id,
				exploration.plan_id,
				fresh,
				missing,
				dropped,
				unknownRules,
				work
			)
		: []
	const refusals = input.round > 1 && !given ? carried.refusals : logged
	const first = input.round > 1 ? carried.given : Boolean(given)
	if (input.round === 1 && refusals.length)
		return { repair: true, carried: { given: first, repeated, refusals, missing, dropped, unknownRules } }
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
			...(unknownRules.length ? { unknownRules } : {}),
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
		'The host can show the ID of its current session.'
	)
	const exploration = explorationRow(store, input.explorationId)
	const stored = launchContext(store, exploration.exploration_id, explorer, input.session)
	const harness = stored ? (stored.harness ?? 'claude') : selectedHarness(env)
	if (harness === 'pi') requireWellFormed(!input.claudeArgs?.length, '--claude-arg is for Claude.')
	const context = stored ?? {
		hiddenPlugin: null,
		claudeArgs: input.claudeArgs ?? [],
		...(harness === 'pi' ? { harness, piArgs: piModelArgs(env) } : {}),
	}
	return {
		executable: requireChild(env, harness),
		exploration,
		explorer,
		context,
		harness,
		recorder: randomUUID(),
		actor: explorerActor(explorer),
	}
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
	const hook = childHook(store.workspace, exploration.exploration_id, `record-${plan.explorer}`)
	const context = {
		...plan.context,
		hook,
		...(plan.harness === 'pi' ? { deny: storeDenyRules } : {}),
	}
	const allow = plan.harness === 'pi' ? ['read'] : []
	const childEnvironment = childEnv(env, { CHECKMATE_RECORDER: '1' }, hook, context, allow)
	const left = () => input.timeoutSeconds - Math.floor((Date.now() - started) / 1000)
	const after = lastEntry(store)
	const earlier = savedEntries(store, exploration.plan_id, exploration.exploration_id, actor)
	const prompt = promptOf(store, exploration, actor, earlier)
	const resume =
		plan.harness === 'pi'
			? ['--fork', input.session, '--session-id', plan.recorder]
			: ['--resume', input.session, '--fork-session', '--session-id', plan.recorder]
	const ask = (args: string[], prompt: string, seconds: number) =>
		callChild(
			plan.executable,
			childArgs(context, args, allow),
			prompt,
			cwd,
			childEnvironment,
			seconds,
			plan.harness
		)
	const calls = [ask(resume, prompt, Math.max(1, left()))]
	const missing: string[] = []
	const dropped: string[] = []
	const unknownRules: string[] = []
	const work = join(store.workspace, workFolder(exploration.exploration_id, plan.explorer))
	const evidenceCwd = existsSync(work) ? work : cwd
	const log = (entries: unknown[]) =>
		logReply(
			store,
			actor,
			exploration.exploration_id,
			exploration.plan_id,
			entries,
			missing,
			dropped,
			unknownRules,
			evidenceCwd
		)
	const given = replyArray(calls[0].result)
	const first = given && newEntries(given, earlier)
	const repeated = given && first ? given.length - first.length : 0
	let refusals = first?.length ? log(first) : []
	if (!calls[0].failure && refusals.length && left() > 0) {
		calls.push(ask(['--resume', plan.recorder], repairPrompt(refusals), left()))
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
		...(unknownRules.length ? { unknownRules } : {}),
		...usageOf(calls),
		...duration(calls),
	}
	const reply: Reply = {
		status,
		subject: exploration.exploration_id,
		reasons,
		...(status === 'completed'
			? {}
			: calls.some(authenticationFailed)
				? { hint: plan.harness === 'pi' ? piAuthenticationHint : authenticationHint }
				: {
						hint: `The entries that Checkmate logged stay. To read what the recorder did, run ${plan.harness === 'pi' ? 'pi --session' : 'claude --resume'} ${plan.recorder}. Then run the same record command again.`,
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
