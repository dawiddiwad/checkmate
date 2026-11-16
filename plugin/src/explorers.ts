import type { Reply, Store } from './store.ts'
import type { Profile } from './types.ts'
import type { ChildContext, ClaudeCall, Env } from './sessions.ts'
import type { ExplorationEvent, OpenInput } from './explorations.ts'
import type { TestLevel } from './levels.ts'
import { closeStore, completed, openStore, write } from './store.ts'
import { Refusal, requireChoice, requireCondition, requireWellFormed } from './contracts.ts'
import { addEvent, evidenceFolder, exploration, explorationEvents, insertExploration } from './explorations.ts'
import type { Refused } from './journal.ts'
import {
	explorationRow,
	journal,
	logEntries,
	mergeItems,
	planClaims,
	planQuestions,
	refusalText,
	unplacedMatches,
	verifyItems,
} from './journal.ts'
import { defaultLevel, levelNames, testLevels } from './levels.ts'
import { explorerActor, recordSession, defaultRecorderTimeout } from './recorder.ts'
import { explorerBrief, mergeAgainPrompt, mergerPrompt, repairPrompt, verifierBrief } from './briefs.ts'
import { findInstance, targetRevision } from './targets.ts'
import {
	checkClaudeArgs,
	checkmateScript,
	childArgs,
	authenticationFailed,
	authenticationHint,
	callClaude,
	childEnv,
	installedPluginId,
	replyArray,
	launchClaude,
	requireClaude,
} from './sessions.ts'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'

export type StartInput = OpenInput & {
	level?: string
	explorers?: number
	minutes?: number
	allow: string[]
	claudeArgs: string[]
	timeoutSeconds?: number
}
export type Launch = {
	studySeconds: number
	testSeconds: number
	level: TestLevel
	explorers: number
	model: string
	modelFrom: 'level' | 'host'
	verifier: boolean
	context: ChildContext
	allow: string[]
	timeoutSeconds: number
	pluginHidden: boolean
}

export const defaultExplorerTimeout = 1800
const pollMilliseconds = 500
export const mergerActor = 'qa:merge'
export const verifierActor = 'qa:verify'

function hostModel(claudeArgs: string[]) {
	for (const [index, arg] of claudeArgs.entries()) {
		if (arg === '--model') return claudeArgs[index + 1]
		if (arg.startsWith('--model=')) return arg.slice('--model='.length)
	}
	return undefined
}

export function launchPlan(profile: Profile, input: StartInput, env: Env): Launch {
	const level = requireChoice(
		input.level ?? profile.explore?.level ?? defaultLevel,
		levelNames,
		'test level (--level)'
	)
	const row = testLevels[level]
	const claudeArgs = checkClaudeArgs(input.claudeArgs)
	const host = hostModel(claudeArgs)
	const hiddenPlugin = installedPluginId(env)
	const explorers = input.explorers ?? profile.explore?.explorers ?? row.explorers
	const testSeconds = input.minutes ? input.minutes * 60 : row.testSeconds
	requireWellFormed(
		input.allow.length || (explorers === 0 && !row.verifier),
		'Give the tool rules of the explorers and the verifier with --allow, for example --allow Read --allow Bash',
		'The host owns the permissions. An explorer cannot answer a permission prompt.'
	)
	return {
		level,
		explorers,
		model: host ?? row.model,
		modelFrom: host ? 'host' : 'level',
		verifier: row.verifier,
		context: { hiddenPlugin, claudeArgs: host ? claudeArgs : [...claudeArgs, '--model', row.model] },
		allow: input.allow,
		studySeconds: row.studySeconds,
		testSeconds,
		timeoutSeconds:
			input.timeoutSeconds ?? Math.max(defaultExplorerTimeout, Math.max(row.studySeconds, testSeconds) * 3),
		pluginHidden: hiddenPlugin !== null,
	}
}

export function explorerNames(count: number) {
	return Array.from({ length: count }, (_, index) => `a${index + 1}`)
}

function startSupervisor(store: Store, explorationId: string, actor: string, env: Env) {
	const folder = join(store.workspace, '.checkmate', 'tmp')
	mkdirSync(folder, { recursive: true })
	const log = openSync(join(folder, `explore-${explorationId}.log`), 'a')
	const child = spawn(
		process.execPath,
		[checkmateScript(), 'explore', 'drive', explorationId, '--workspace', store.workspace],
		{
			cwd: store.workspace,
			env: { ...env, CHECKMATE_ACTOR: actor },
			detached: true,
			stdio: ['ignore', log, log],
		}
	)
	child.unref()
}

export function startExploration(store: Store, actor: string | undefined, input: StartInput, env: Env) {
	const reply = write(store, { actor, command: 'explore start', subject: input.planId, input }, (operationId, at) => {
		requireClaude(env)
		const opened = input.explorationId
			? finishable(store, input.explorationId)
			: insertExploration(store, input, operationId, at)
		const row = explorationRow(store, opened.explorationId)
		const launch = launchPlan(targetRevision(store, row.target_id, row.target_revision).profile, input, env)
		addEvent(
			store,
			opened.explorationId,
			{ step: 'start', explorer: null, status: 'started', detail: launch },
			operationId,
			at
		)
		return {
			reply: completed(opened.explorationId, {
				...opened,
				level: launch.level,
				explorers: launch.explorers,
				model: launch.model,
				verifier: launch.verifier,
				studySeconds: launch.studySeconds,
				testSeconds: launch.testSeconds,
				pluginHidden: launch.pluginHidden,
				next: [`checkmate explore wait ${opened.explorationId}`],
			}),
			subjects: [`exploration:${opened.explorationId}`, `plan:${opened.planId}`],
		}
	})
	startSupervisor(store, reply.subject, actor!, env)
	return reply
}

function finishable(store: Store, explorationId: string) {
	const row = explorationRow(store, explorationId)
	requireCondition(
		!startOf(explorationEvents(store, explorationId)),
		`Exploration ${explorationId} has started already.`,
		`Run checkmate explore wait ${explorationId}.`
	)
	return { explorationId, planId: row.plan_id, build: row.build, mode: row.mode, instanceId: row.instance_id }
}

export function finishExploration(
	store: Store,
	actor: string | undefined,
	input: Omit<StartInput, 'planId' | 'build'> & { explorationId: string },
	env: Env
) {
	const row = explorationRow(store, input.explorationId)
	return startExploration(store, actor, { ...input, planId: row.plan_id, build: row.build, explorers: 0 }, env)
}

function event(store: Store, actor: string, explorationId: string, item: Omit<ExplorationEvent, 'at'>) {
	write(store, { actor, command: `explore ${item.step}`, subject: explorationId, input: item }, (operationId, at) => {
		addEvent(store, explorationId, item, operationId, at)
		return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`] }
	})
}

export function startOf(events: ExplorationEvent[]) {
	return events.find((item) => item.step === 'start')?.detail as Launch | undefined
}

function failureHint(launch: Launch, call: ClaudeCall) {
	if (authenticationFailed(call)) return authenticationHint
	if (!/model/i.test([call.failure?.[1] ?? '', ...(call.stderr ?? [])].join(' '))) return undefined
	return launch.modelFrom === 'level'
		? `The host refused the model ${launch.model} of level ${launch.level}. Give another model with --claude-arg --model --claude-arg <model>, or choose another --level.`
		: `The host refused the model ${launch.model}. Give another model with --claude-arg --model --claude-arg <model>.`
}

async function launchExplorers(store: Store, actor: string, explorationId: string, launch: Launch, env: Env) {
	const opened = exploration(store, explorationId)
	const profile = targetRevision(store, opened.target_id, opened.target_revision).profile
	const instance = findInstance(store, opened.target_id, opened.instance_id)
	const entries = profile.entryPoints.map((entry) => ({ ...entry, value: instance.entries[entry.name] ?? '' }))
	const claude = requireClaude(env)
	const allowed = launch.allow.flatMap((rule) => ['--allowedTools', rule])
	const runs = explorerNames(launch.explorers).map(async (explorer) => {
		const session = randomUUID()
		const folder = evidenceFolder(explorationId, explorer)
		mkdirSync(join(store.workspace, folder), { recursive: true })
		const brief = explorerBrief(opened.charter, entries, `qa-${explorationId}-${explorer}-`, folder, {
			study: launch.studySeconds,
			test: launch.testSeconds,
		})
		event(store, actor, explorationId, {
			step: 'launch',
			explorer,
			status: 'started',
			detail: { session, context: launch.context, brief },
		})
		const turn = (own: string[], prompt: string) =>
			launchClaude(
				claude,
				childArgs({ ...launch.context, denyStore: true }, [...own, ...allowed]),
				prompt,
				store.workspace,
				childEnv(env),
				launch.timeoutSeconds
			)
		const study = await turn(['--session-id', session], brief.study)
		const calls = study.failure ? [study] : [study, await turn(['--resume', session], brief.test)]
		return { explorer, session, calls }
	})
	const ended = await Promise.all(runs)
	for (const { explorer, session, calls } of ended) {
		const call = calls.find((item) => item.failure) ?? calls.at(-1)!
		const hint = failureHint(launch, call)
		const durations = calls.flatMap((item) => (item.durationMs === undefined ? [] : [item.durationMs]))
		event(store, actor, explorationId, {
			step: 'end',
			explorer,
			status: call.failure?.[0] ?? 'completed',
			detail: {
				session,
				...(call.failure ? { turn: calls.length === 1 ? 'study' : 'test', reason: call.failure[1] } : {}),
				...(call.stderr ? { stderr: call.stderr } : {}),
				...(hint ? { hint } : {}),
				...costOf(calls),
				...(durations.length ? { durationMs: durations.reduce((total, ms) => total + ms, 0) } : {}),
			},
		})
	}
	return ended
}

export function recordExplorers(
	store: Store,
	actor: string,
	explorationId: string,
	sessions: Array<{ explorer: string; session: string }>,
	env: Env
) {
	return sessions.map(
		({ explorer, session }) =>
			recordSession(
				store,
				actor,
				{ explorationId, explorer, session, timeoutSeconds: defaultRecorderTimeout },
				env,
				store.workspace
			).status
	)
}

function costOf(calls: ClaudeCall[]) {
	const costs = calls.flatMap((call) => (call.costUsd === undefined ? [] : [call.costUsd]))
	return costs.length ? { costUsd: costs.reduce((total, cost) => total + cost, 0) } : {}
}

function mergeReports(store: Store, actor: string, explorationId: string, launch: Launch, env: Env) {
	const opened = explorationRow(store, explorationId)
	const items = mergeItems(journal(store, opened.plan_id), opened.build, planClaims(store, opened.plan_id))
	const later = items.earlier.length > 0 && items.defects.length > 0
	const defects = later || (items.testers > 1 && items.defects.length > 1)
	const questions = items.questionTesters > 1 && items.questions.length > 1
	if (!defects && !questions) return
	const session = randomUUID()
	const claude = requireClaude(env)
	const call = (args: string[], prompt: string) =>
		callClaude(
			claude,
			childArgs(launch.context, args),
			prompt,
			store.workspace,
			childEnv(env),
			defaultRecorderTimeout
		)
	const log = (reply: unknown[] | undefined) => {
		if (!reply?.length) return []
		try {
			return (logEntries(store, mergerActor, { explorationId, entries: reply }).data.refused as Refused[]).map(
				refusalText
			)
		} catch (error) {
			if (!(error instanceof Refusal)) throw error
			return [`${error.message}${error.hint ? ` ${error.hint}` : ''}`]
		}
	}
	const calls = [
		call(
			['--session-id', session],
			mergerPrompt(
				opened.build,
				defects ? items.defects : [],
				defects ? items.groups : [],
				questions ? items.questions : [],
				later ? items.earlier : []
			)
		),
	]
	let refusals = calls[0].failure ? [] : log(replyArray(calls[0].result))
	if (refusals.length) {
		calls.push(call(['--resume', session], repairPrompt(refusals)))
		refusals = log(replyArray(calls.at(-1)!.result))
	}
	const unplaced = calls.some((item) => item.failure)
		? []
		: unplacedMatches(journal(store, opened.plan_id), planClaims(store, opened.plan_id), opened.build)
	if (unplaced.length) {
		calls.push(call(['--resume', session], mergeAgainPrompt(unplaced)))
		refusals = [...refusals, ...log(replyArray(calls.at(-1)!.result))]
	}
	const failure = calls.find((item) => item.failure)?.failure
	event(store, actor, explorationId, {
		step: 'merge',
		explorer: null,
		status: failure?.[0] ?? 'completed',
		detail: {
			session,
			reports: items.defects.length,
			refused: refusals.length,
			...(failure ? { reason: failure[1] } : {}),
			...(calls.some(authenticationFailed) ? { hint: authenticationHint } : {}),
			...(calls.find((item) => item.stderr)?.stderr ? { stderr: calls.find((item) => item.stderr)!.stderr } : {}),
			...costOf(calls),
		},
	})
}

function verifiedEntries(reply: unknown[] | undefined, ids: Set<string>) {
	return (reply ?? []).flatMap((raw) => {
		const item = raw as { id?: unknown; seen?: unknown; saw?: unknown } | null
		if (!item || typeof item.id !== 'string' || !ids.has(item.id) || typeof item.seen !== 'boolean') return []
		const saw = typeof item.saw === 'string' && item.saw.trim() ? item.saw : item.seen ? 'Seen again.' : 'Not seen.'
		return [{ kind: 'observation', saw, [item.seen ? 'confirms' : 'refutes']: item.id }]
	})
}

async function verifyClaims(store: Store, actor: string, explorationId: string, launch: Launch, env: Env) {
	const opened = exploration(store, explorationId)
	const items = verifyItems(planClaims(store, opened.plan_id), opened.build)
	if (!items.length) return
	const profile = targetRevision(store, opened.target_id, opened.target_revision).profile
	const instance = findInstance(store, opened.target_id, opened.instance_id)
	const entries = profile.entryPoints.map((entry) => ({ ...entry, value: instance.entries[entry.name] ?? '' }))
	const session = randomUUID()
	const brief = verifierBrief(items, entries, opened.charter.operations, `qa-${explorationId}-verify-`)
	const allowed = launch.allow.flatMap((rule) => ['--allowedTools', rule])
	const call = await launchClaude(
		requireClaude(env),
		childArgs({ ...launch.context, denyStore: true }, ['--session-id', session, ...allowed]),
		brief,
		store.workspace,
		childEnv(env),
		launch.timeoutSeconds
	)
	const observations = call.failure
		? []
		: verifiedEntries(replyArray(call.result), new Set(items.map((item) => item.id)))
	if (observations.length) logEntries(store, verifierActor, { explorationId, entries: observations })
	event(store, actor, explorationId, {
		step: 'verify',
		explorer: null,
		status: call.failure?.[0] ?? (observations.length ? 'completed' : 'operational_error'),
		detail: {
			session,
			items: items.length,
			verified: observations.length,
			...(call.failure
				? { reason: call.failure[1] }
				: observations.length
					? {}
					: { reason: 'The verifier gave no result.' }),
			...(call.stderr ? { stderr: call.stderr } : {}),
			...(authenticationFailed(call) ? { hint: authenticationHint } : {}),
			...costOf([call]),
		},
	})
}

function hostAuthentication(store: Store, explorationId: string) {
	return explorationEvents(store, explorationId).some((item) => item.detail.hint === authenticationHint)
}

export async function driveExploration(workspace: string, explorationId: string, env: Env) {
	const store = openStore(workspace)
	const actor = env.CHECKMATE_ACTOR ?? 'checkmate'
	try {
		event(store, actor, explorationId, {
			step: 'supervisor',
			explorer: null,
			status: 'started',
			detail: { pid: process.pid },
		})
		const launch = startOf(explorationEvents(store, explorationId))
		if (!launch) throw new Refusal('prohibited', `Exploration ${explorationId} has no start.`)
		if (launch.explorers) {
			const ended = await launchExplorers(store, actor, explorationId, launch, env)
			recordExplorers(
				store,
				actor,
				explorationId,
				ended.filter((item) => item.calls.length === 2 && item.calls[1].failure?.[0] !== 'operational_error'),
				env
			)
		}
		const ok = explorationEvents(store, explorationId).filter(
			(item) => item.step === 'record' && item.status === 'completed'
		).length
		if (ok) {
			mergeReports(store, actor, explorationId, launch, env)
			if (launch.verifier) await verifyClaims(store, actor, explorationId, launch, env)
		}
		event(store, actor, explorationId, {
			step: 'done',
			explorer: null,
			status: ok ? 'completed' : 'failed',
			detail: {
				recorded: ok,
				...(ok
					? {}
					: {
							reason: hostAuthentication(store, explorationId)
								? 'Host authentication: no session could log in.'
								: 'No explorer session was recorded.',
						}),
				...(!ok && hostAuthentication(store, explorationId) ? { hint: authenticationHint } : {}),
			},
		})
	} catch (error) {
		event(store, actor, explorationId, {
			step: 'done',
			explorer: null,
			status: 'failed',
			detail: { reason: error instanceof Error ? error.message : String(error) },
		})
	} finally {
		closeStore(store)
	}
}

function running(pid: unknown) {
	if (typeof pid !== 'number') return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

export function explorationState(events: ExplorationEvent[]) {
	const done = events.find((item) => item.step === 'done')
	if (done) return done.status === 'completed' ? 'completed' : 'failed'
	const supervisor = events.find((item) => item.step === 'supervisor')
	if (supervisor && !running(supervisor.detail.pid)) return 'stopped'
	if (!events.some((item) => item.step === 'start')) return 'open'
	if (!supervisor) return 'starting'
	if (events.some((item) => item.step === 'merge')) return 'verifying'
	if (events.some((item) => item.step === 'record')) return 'recording'
	return 'testing'
}

export function explorationStatus(store: Store, explorationId: string) {
	const row = explorationRow(store, explorationId)
	const events = explorationEvents(store, explorationId)
	const launch = startOf(events)
	const state = explorationState(events)
	const names = [...new Set(events.flatMap((item) => (item.explorer ? [item.explorer] : [])))]
	const explorers = names.map((explorer) => {
		const own = events.filter((item) => item.explorer === explorer)
		const last = (step: string) => own.filter((item) => item.step === step).at(-1)
		const end = last('end')
		const record = last('record')
		return {
			explorer,
			actor: explorerActor(explorer),
			session: (last('launch')?.detail.session ?? record?.detail.session ?? null) as string | null,
			ended: end?.status ?? null,
			recorded: record?.status ?? null,
			saved: (record?.detail.saved ?? 0) as number,
			reason: (end?.detail.reason ?? record?.detail.reasons ?? null) as unknown,
			hint: (end?.detail.hint ?? null) as string | null,
			stderr: (end?.detail.stderr ?? []) as string[],
		}
	})
	const done = events.find((item) => item.step === 'done')
	return {
		explorationId: row.exploration_id,
		planId: row.plan_id,
		build: row.build,
		mode: row.mode,
		instanceId: row.instance_id,
		state,
		level: launch?.level ?? null,
		explorerCount: launch?.explorers ?? null,
		model: launch?.model ?? null,
		modelFrom: launch?.modelFrom ?? null,
		verifier: launch?.verifier ?? null,
		studySeconds: launch?.studySeconds ?? null,
		testSeconds: launch?.testSeconds ?? null,
		pluginHidden: launch?.pluginHidden ?? null,
		explorers,
		phases: events
			.filter((item) => item.step === 'merge' || item.step === 'verify')
			.map((item) => ({ step: item.step, status: item.status, detail: item.detail })),
		doneHint: (done?.detail.hint ?? null) as string | null,
		reason: (done?.detail.reason ?? (state === 'stopped' ? 'The supervisor stopped before the end.' : null)) as
			string | null,
	}
}

export function waitExploration(store: Store, explorationId: string, timeoutSeconds: number): Reply {
	const until = Date.now() + timeoutSeconds * 1000
	for (;;) {
		const status = explorationStatus(store, explorationId)
		const ended = ['completed', 'failed', 'stopped', 'open'].includes(status.state)
		if (ended || Date.now() >= until) {
			const outcome = status.state === 'completed' ? 'done' : ended ? 'failed' : 'timeout'
			const hints = [
				...status.explorers.flatMap((item) => (item.hint ? [item.hint] : [])),
				...(status.doneHint ? [status.doneHint] : []),
			]
			return {
				status: outcome === 'done' ? 'completed' : outcome === 'timeout' ? 'interrupted' : 'operational_error',
				subject: explorationId,
				reasons:
					outcome === 'timeout'
						? [`Exploration ${explorationId} is ${status.state} after ${timeoutSeconds} seconds.`]
						: outcome === 'failed'
							? [status.reason ?? `Exploration ${explorationId} is ${status.state}.`]
							: [],
				...(outcome === 'timeout'
					? { hint: `Run checkmate explore wait ${explorationId} again.` }
					: hints.length
						? { hint: [...new Set(hints)].join(' ') }
						: {}),
				data: { ...status, outcome },
			}
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMilliseconds)
	}
}

export function explorationReport(store: Store, explorationId: string) {
	const opened = exploration(store, explorationId)
	const state = journal(store, opened.plan_id)
	const own = state.team.filter((entry) => entry.explorationId === explorationId)
	return {
		...explorationStatus(store, explorationId),
		charter: opened.charter,
		startedAt: opened.started_at,
		claims: planClaims(store, opened.plan_id).filter((claim) => claim.explorationId === explorationId),
		questions: planQuestions(store, opened.plan_id).filter((question) => question.explorationId === explorationId),
		criteria: own
			.filter((entry) => entry.kind === 'criterion')
			.map(({ id, text, source }) => ({ id, text: text!, source: source ?? null })),
		notes: own
			.filter((entry) => entry.kind === 'note')
			.map(({ id, text, area }) => ({ id, text: text!, area: area ?? null })),
		observations: own.filter((entry) => entry.kind === 'observation').length,
	}
}
