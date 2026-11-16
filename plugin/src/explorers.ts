import type { Reply, Store } from './store.ts'
import type { Profile } from './types.ts'
import type { ChildContext, ClaudeCall, Env } from './sessions.ts'
import type { ExplorationEvent, OpenInput } from './explorations.ts'
import type { TestLevel } from './levels.ts'
import { closeStore, completed, openStore, write } from './store.ts'
import { Refusal, requireChoice, requireWellFormed } from './contracts.ts'
import { addEvent, exploration, explorationEvents, insertExploration } from './explorations.ts'
import { explorationRow } from './journal.ts'
import { defaultLevel, levelNames, testLevels } from './levels.ts'
import { explorerActor, recordSession, defaultRecorderTimeout } from './recorder.ts'
import { explorerBrief } from './briefs.ts'
import { findInstance, targetRevision } from './targets.ts'
import {
	checkClaudeArgs,
	checkmateScript,
	childArgs,
	childEnv,
	installedPluginId,
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
	allow: string[]
	claudeArgs: string[]
	timeoutSeconds?: number
}
export type Launch = {
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
	requireWellFormed(
		input.allow.length,
		'Give the tool rules of the explorers with --allow, for example --allow Read --allow Bash',
		'The host owns the permissions. An explorer cannot answer a permission prompt.'
	)
	return {
		level,
		explorers: input.explorers ?? profile.explore?.explorers ?? row.explorers,
		model: host ?? row.model,
		modelFrom: host ? 'host' : 'level',
		verifier: row.verifier,
		context: { hiddenPlugin, claudeArgs: host ? claudeArgs : [...claudeArgs, '--model', row.model] },
		allow: input.allow,
		timeoutSeconds: input.timeoutSeconds ?? defaultExplorerTimeout,
		pluginHidden: hiddenPlugin !== null,
	}
}

export function explorerNames(count: number) {
	return Array.from({ length: count }, (_, index) => `a${index + 1}`)
}

export function evidenceFolder(explorationId: string, explorer: string) {
	return `qa-evidence/${explorationId}/${explorer}`
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
		const opened = insertExploration(store, input, operationId, at)
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
				pluginHidden: launch.pluginHidden,
				next: [`checkmate explore wait ${opened.explorationId}`],
			}),
			subjects: [`exploration:${opened.explorationId}`, `plan:${opened.planId}`],
		}
	})
	startSupervisor(store, reply.subject, actor!, env)
	return reply
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

function modelHint(launch: Launch, call: ClaudeCall) {
	if (!/model/i.test(call.failure?.[1] ?? '')) return undefined
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
	const runs = explorerNames(launch.explorers).map((explorer) => {
		const session = randomUUID()
		const folder = evidenceFolder(explorationId, explorer)
		mkdirSync(join(store.workspace, folder), { recursive: true })
		const brief = explorerBrief(opened.charter, entries, `qa-${explorationId}-${explorer}-`, folder)
		event(store, actor, explorationId, {
			step: 'launch',
			explorer,
			status: 'started',
			detail: { session, context: launch.context, brief },
		})
		const args = childArgs(launch.context, ['--session-id', session, ...allowed])
		return launchClaude(claude, args, brief, store.workspace, childEnv(env), launch.timeoutSeconds).then(
			(call) => ({ explorer, session, call })
		)
	})
	const ended = await Promise.all(runs)
	for (const { explorer, session, call } of ended) {
		const hint = modelHint(launch, call)
		event(store, actor, explorationId, {
			step: 'end',
			explorer,
			status: call.failure?.[0] ?? 'completed',
			detail: {
				session,
				...(call.failure ? { reason: call.failure[1] } : {}),
				...(hint ? { hint } : {}),
				...(call.costUsd === undefined ? {} : { costUsd: call.costUsd }),
				...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
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
		const ended = await launchExplorers(store, actor, explorationId, launch, env)
		const finished = ended.filter((item) => !item.call.failure)
		const recorded = recordExplorers(store, actor, explorationId, finished, env)
		const ok = recorded.filter((status) => status === 'completed').length
		event(store, actor, explorationId, {
			step: 'done',
			explorer: null,
			status: ok ? 'completed' : 'failed',
			detail: {
				recorded: ok,
				...(ok ? {} : { reason: 'No explorer session was recorded.' }),
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
		pluginHidden: launch?.pluginHidden ?? null,
		explorers,
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
			const hints = status.explorers.flatMap((item) => (item.hint ? [item.hint] : []))
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
