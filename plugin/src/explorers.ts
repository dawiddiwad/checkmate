import type { Reply, Store } from './store.ts'
import type { Profile } from './types.ts'
import type { ChildContext, ClaudeCall, Env } from './sessions.ts'
import type { Charter, ExplorationEvent, OpenInput } from './explorations.ts'
import type { TestLevel } from './levels.ts'
import { closeStore, completed, one, openStore, saveBlob, write } from './store.ts'
import { Refusal, requireChoice, requireCondition, requireWellFormed } from './contracts.ts'
import { addEvent, exploration, explorationEvents, insertExploration, workFolder } from './explorations.ts'
import type { Refused } from './journal.ts'
import {
	explorationRow,
	joinClaims,
	journal,
	logEntries,
	mergeItems,
	planClaims,
	planQuestions,
	refusalText,
	unplacedMatches,
	verifyItems,
} from './journal.ts'
import { defaultLevel, levelNames, storedLevel, testLevels } from './levels.ts'
import { explorerActor, lastEntry, recordSession, defaultRecorderTimeout } from './recorder.ts'
import {
	explorerBrief,
	followBrief,
	mergeAgainPrompt,
	mergerPrompt,
	repairPrompt,
	verifierBrief,
	verifierRepairPrompt,
} from './briefs.ts'
import { findInstance, targetRevision } from './targets.ts'
import { changeOf, changedFiles } from './change.ts'
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
	storeDenyRules,
	workDenyRules,
} from './sessions.ts'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export type StartInput = OpenInput & {
	level?: string
	explorers?: number
	minutes?: number
	since?: string
	until?: string
	repo?: string
	allow: string[]
	claudeArgs: string[]
	timeoutSeconds?: number
	session?: boolean
}
export type Launch = {
	studySeconds: number
	testSeconds: number
	level: TestLevel
	explorers: number
	model: string | null
	modelFrom: 'level' | 'host' | 'agent'
	verifier: boolean
	context: ChildContext
	allow: string[]
	timeoutSeconds: number
	pluginHidden: boolean
	path?: 'session'
	browserFolder?: boolean
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
		input.level ?? storedLevel(profile.explore?.level) ?? defaultLevel,
		levelNames,
		'test level (--level)'
	)
	const row = testLevels[level]
	const explorers = input.explorers ?? profile.explore?.explorers ?? row.explorers
	const testSeconds = input.minutes ? input.minutes * 60 : row.testSeconds
	if (input.session) {
		requireWellFormed(
			!input.claudeArgs.length && input.timeoutSeconds === undefined,
			'--claude-arg and --timeout are for testers in new processes. With --session, the host session starts the testers as agents.'
		)
		return {
			level,
			explorers,
			model: null,
			modelFrom: 'agent',
			verifier: row.verifier,
			context: { hiddenPlugin: null, claudeArgs: [] },
			allow: input.allow,
			studySeconds: row.studySeconds,
			testSeconds,
			timeoutSeconds: 0,
			pluginHidden: true,
			path: 'session',
		}
	}
	const claudeArgs = checkClaudeArgs(input.claudeArgs)
	const host = hostModel(claudeArgs)
	const hiddenPlugin = installedPluginId(env)
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

function explorerWork(store: Store, explorationId: string, explorer: string, count: number) {
	const folder = workFolder(explorationId, explorer)
	mkdirSync(join(store.workspace, folder), { recursive: true })
	const others = explorerNames(count).filter((name) => name !== explorer)
	return {
		folder,
		deny: workDenyRules(others.map((name) => workFolder(explorationId, name))),
		extraEnv: {
			PLAYWRIGHT_MCP_OUTPUT_DIR: join(store.workspace, folder),
			PLAYWRIGHT_CLI_SESSION: `qa-${explorationId}-${explorer}`,
		},
	}
}

const keptFiles = ['plan.md', 'questions.md', 'report.md', 'follow-up-report.md']

export function keepWorkFiles(store: Store, actor: string, explorationId: string, explorer: string, phase: string) {
	const folder = join(store.workspace, workFolder(explorationId, explorer))
	const files = keptFiles.flatMap((name) => {
		const path = join(folder, name)
		return existsSync(path) ? [{ name, bytes: readFileSync(path) }] : []
	})
	if (!files.length) return
	const input = { explorer, phase, files: files.map((file) => file.name) }
	write(store, { actor, command: 'explore files', subject: explorationId, input }, (operationId, at) => {
		const saved = files.map(({ name, bytes }) => ({ name, ...saveBlob(store, bytes) }))
		addEvent(
			store,
			explorationId,
			{ step: 'files', explorer, status: 'completed', detail: { phase, files: saved } },
			operationId,
			at
		)
		return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`] }
	})
}

function removeIfEmpty(folder: string) {
	if (existsSync(folder) && !readdirSync(folder).length) rmdirSync(folder)
}

const browserFolder = '.playwright-cli'

export function keepBrowserFolder(store: Store, explorationId: string) {
	const from = join(store.workspace, browserFolder)
	if (startOf(explorationEvents(store, explorationId))?.browserFolder !== false || !existsSync(from)) return
	const to = join(store.workspace, workFolder(explorationId), browserFolder)
	mkdirSync(join(to, '..'), { recursive: true })
	rmSync(to, { recursive: true, force: true })
	renameSync(from, to)
}

export function removeWork(store: Store, explorationId: string) {
	keepBrowserFolder(store, explorationId)
	rmSync(join(store.workspace, workFolder(explorationId)), { recursive: true, force: true })
	rmSync(join(store.workspace, '.checkmate', 'tmp', `explore-${explorationId}.log`), { force: true })
	removeIfEmpty(join(store.workspace, '.checkmate', 'work'))
	removeIfEmpty(join(store.workspace, '.checkmate', 'tmp'))
}

function startSupervisor(store: Store, explorationId: string, actor: string, env: Env, extra: string[] = []) {
	const folder = join(store.workspace, '.checkmate', 'tmp')
	mkdirSync(folder, { recursive: true })
	const log = openSync(join(folder, `explore-${explorationId}.log`), 'a')
	const child = spawn(
		process.execPath,
		[checkmateScript(), 'explore', 'drive', explorationId, '--workspace', store.workspace, ...extra],
		{
			cwd: store.workspace,
			env: { ...env, CHECKMATE_ACTOR: actor },
			detached: true,
			stdio: ['ignore', log, log],
		}
	)
	child.unref()
}

export function startExploration(store: Store, actor: string | undefined, given: StartInput, env: Env) {
	const change = changeOf(store.workspace, given)
	const input = { ...given, change, scope: given.scope ?? (change ? changedFiles(store.workspace, change) : []) }
	const reply = write(store, { actor, command: 'explore start', subject: input.planId, input }, (operationId, at) => {
		if (!input.session) requireClaude(env)
		const opened = input.explorationId
			? finishable(store, input.explorationId)
			: insertExploration(store, input, operationId, at)
		const row = explorationRow(store, opened.explorationId)
		const launch = launchPlan(targetRevision(store, row.target_id, row.target_revision).profile, input, env)
		addEvent(
			store,
			opened.explorationId,
			{
				step: 'start',
				explorer: null,
				status: 'started',
				detail: { ...launch, browserFolder: existsSync(join(store.workspace, browserFolder)) },
			},
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
				path: launch.path ?? 'process',
				next: [`checkmate explore ${input.session ? 'next' : 'wait'} ${opened.explorationId}`],
			}),
			subjects: [`exploration:${opened.explorationId}`, `plan:${opened.planId}`],
		}
	})
	if (!input.session) startSupervisor(store, reply.subject, actor!, env)
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
	const launch = events.find((item) => item.step === 'start')?.detail as Launch | undefined
	return launch && { ...launch, level: storedLevel(launch.level) }
}

function failureHint(launch: Launch, call: ClaudeCall) {
	if (authenticationFailed(call)) return authenticationHint
	if (!/model/i.test([call.failure?.[1] ?? '', ...(call.stderr ?? [])].join(' '))) return undefined
	return launch.modelFrom === 'level'
		? `The host refused the model ${launch.model} of level ${launch.level}. Give another model with --claude-arg --model --claude-arg <model>, or choose another --level.`
		: `The host refused the model ${launch.model}. Give another model with --claude-arg --model --claude-arg <model>.`
}

export function entryValues(store: Store, explorationId: string) {
	const opened = exploration(store, explorationId)
	const profile = targetRevision(store, opened.target_id, opened.target_revision).profile
	const instance = findInstance(store, opened.target_id, opened.instance_id)
	return profile.entryPoints.map((entry) => ({ ...entry, value: instance.entries[entry.name] ?? '' }))
}

async function launchExplorers(store: Store, actor: string, explorationId: string, launch: Launch, env: Env) {
	const opened = exploration(store, explorationId)
	const entries = entryValues(store, explorationId)
	const claude = requireClaude(env)
	const allowed = launch.allow.flatMap((rule) => ['--allowedTools', rule])
	const runs = explorerNames(launch.explorers).map(async (explorer) => {
		const session = randomUUID()
		const { folder, deny, extraEnv } = explorerWork(store, explorationId, explorer, launch.explorers)
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
				childArgs({ ...launch.context, deny }, [...own, ...allowed]),
				prompt,
				store.workspace,
				childEnv(env, extraEnv),
				launch.timeoutSeconds
			)
		const study = await turn(['--session-id', session], brief.study)
		if (!study.failure)
			event(store, actor, explorationId, {
				step: 'turn',
				explorer,
				status: 'started',
				detail: { session, turn: 'test' },
			})
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

export function mergeInput(store: Store, explorationId: string, after = 0) {
	const opened = explorationRow(store, explorationId)
	const items = mergeItems(journal(store, opened.plan_id), opened.build, planClaims(store, opened.plan_id), after)
	const later = items.earlier.length > 0 && items.defects.length > 0
	const defects = later || (items.testers > 1 && items.defects.length > 1)
	const questions = items.questionTesters > 1 && items.questions.length > 1
	if (!defects && !questions) return null
	return {
		build: opened.build,
		count: items.defects.length,
		defects: defects ? items.defects : [],
		groups: defects ? items.groups : [],
		questions: questions ? items.questions : [],
		earlier: later ? items.earlier : [],
	}
}

export function logMerge(store: Store, explorationId: string, reply: unknown[] | undefined) {
	if (!reply?.length) return []
	const planId = explorationRow(store, explorationId).plan_id
	try {
		const entries = joinClaims(reply, planClaims(store, planId))
		return (logEntries(store, mergerActor, { explorationId, entries }).data.refused as Refused[]).map(refusalText)
	} catch (error) {
		if (!(error instanceof Refusal)) throw error
		return [`${error.message}${error.hint ? ` ${error.hint}` : ''}`]
	}
}

export function unplacedReports(store: Store, explorationId: string, after = 0) {
	const opened = explorationRow(store, explorationId)
	return unplacedMatches(journal(store, opened.plan_id), planClaims(store, opened.plan_id), opened.build, after)
}

function mergeReports(store: Store, actor: string, explorationId: string, launch: Launch, env: Env, after = 0) {
	const input = mergeInput(store, explorationId, after)
	if (!input) return
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
	const log = (reply: unknown[] | undefined) => logMerge(store, explorationId, reply)
	const calls = [
		call(
			['--session-id', session],
			mergerPrompt(input.build, input.defects, input.groups, input.questions, input.earlier)
		),
	]
	let refusals = calls[0].failure ? [] : log(replyArray(calls[0].result))
	if (refusals.length) {
		calls.push(call(['--resume', session], repairPrompt(refusals)))
		refusals = log(replyArray(calls.at(-1)!.result))
	}
	const unplaced = calls.some((item) => item.failure) ? [] : unplacedReports(store, explorationId, after)
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
			reports: input.count,
			refused: refusals.length,
			...(failure ? { reason: failure[1] } : {}),
			...(calls.some(authenticationFailed) ? { hint: authenticationHint } : {}),
			...(calls.find((item) => item.stderr)?.stderr ? { stderr: calls.find((item) => item.stderr)!.stderr } : {}),
			...costOf(calls),
		},
	})
}

export function verifiedEntries(reply: unknown[] | undefined, ids: Set<string>) {
	return (reply ?? []).flatMap((raw) => {
		const item = raw as { id?: unknown; seen?: unknown; saw?: unknown } | null
		if (!item || typeof item.id !== 'string' || !ids.has(item.id) || typeof item.seen !== 'boolean') return []
		const saw = typeof item.saw === 'string' && item.saw.trim() ? item.saw : item.seen ? 'Seen again.' : 'Not seen.'
		return [{ kind: 'observation', saw, [item.seen ? 'confirms' : 'refutes']: item.id }]
	})
}

export function verifyInput(store: Store, explorationId: string, after = 0) {
	const opened = exploration(store, explorationId)
	const fresh = after ? newDefects(store, opened.plan_id, after) : undefined
	const items = verifyItems(planClaims(store, opened.plan_id), opened.build, fresh)
	if (!items.length) return null
	return {
		items,
		entries: entryValues(store, explorationId),
		operations: opened.charter.operations,
		dataPrefix: `qa-${explorationId}-verify-`,
	}
}

async function verifyClaims(store: Store, actor: string, explorationId: string, launch: Launch, env: Env, after = 0) {
	const input = verifyInput(store, explorationId, after)
	if (!input) return
	const { items } = input
	const session = randomUUID()
	const brief = verifierBrief(items, input.entries, input.operations, input.dataPrefix)
	const allowed = launch.allow.flatMap((rule) => ['--allowedTools', rule])
	const ask = (own: string[], prompt: string) =>
		launchClaude(
			requireClaude(env),
			childArgs({ ...launch.context, deny: storeDenyRules }, [...own, ...allowed]),
			prompt,
			store.workspace,
			childEnv(env),
			launch.timeoutSeconds
		)
	const ids = new Set(items.map((item) => item.id))
	const calls = [await ask(['--session-id', session], brief)]
	let observations = calls[0].failure ? [] : verifiedEntries(replyArray(calls[0].result), ids)
	if (!calls[0].failure && !observations.length) {
		calls.push(await ask(['--resume', session], verifierRepairPrompt()))
		observations = calls[1].failure ? [] : verifiedEntries(replyArray(calls[1].result), ids)
	}
	if (observations.length) logEntries(store, verifierActor, { explorationId, entries: observations })
	const failure = calls.find((call) => call.failure)?.failure
	const stderr = calls.find((call) => call.stderr)?.stderr
	event(store, actor, explorationId, {
		step: 'verify',
		explorer: null,
		status: observations.length ? 'completed' : calls[0].failure ? calls[0].failure[0] : 'skipped',
		detail: {
			session,
			items: items.length,
			verified: observations.length,
			...(observations.length
				? {}
				: calls[0].failure
					? { reason: calls[0].failure[1] }
					: {
							reason: `The verifier gave no result, also after one repair${failure ? ` (${failure[1]})` : ''}. The claims keep their states.`,
						}),
			...(stderr ? { stderr } : {}),
			...(calls.some(authenticationFailed) ? { hint: authenticationHint } : {}),
			...costOf(calls),
		},
	})
}

function newDefects(store: Store, planId: string, after: number) {
	return new Set(
		journal(store, planId)
			.team.filter((entry) => entry.kind === 'defect' && entry.seq > after)
			.map((entry) => entry.id)
	)
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
			for (const { explorer } of ended) keepWorkFiles(store, actor, explorationId, explorer, 'test')
		}
		const ok = explorationEvents(store, explorationId).filter(
			(item) => item.step === 'record' && item.status === 'completed'
		).length
		if (ok) {
			mergeReports(store, actor, explorationId, launch, env)
			if (launch.verifier) await verifyClaims(store, actor, explorationId, launch, env)
			removeWork(store, explorationId)
		} else keepBrowserFolder(store, explorationId)
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
		keepBrowserFolder(store, explorationId)
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

export type FollowInput = { explorationId: string; allow: string[]; claudeArgs: string[]; timeoutSeconds?: number }
type FollowPlan = {
	answers: string[]
	questions: Array<{ question: string; answer: string }>
	after: number
	allow: string[]
	context: ChildContext
	timeoutSeconds: number
	seconds: number
}

function usedAnswers(events: ExplorationEvent[]) {
	const used = new Set<string>()
	let pending: string[] = []
	for (const item of events) {
		if (item.step === 'follow') pending = item.detail.answers as string[]
		if (item.step === 'followed' && item.status === 'completed') for (const id of pending) used.add(id)
	}
	return used
}

export function unusedAnswers(store: Store, explorationId: string) {
	const row = explorationRow(store, explorationId)
	const used = usedAnswers(explorationEvents(store, explorationId))
	return planQuestions(store, row.plan_id).filter(
		(question) => question.explorationId === explorationId && question.answerId && !used.has(question.answerId)
	)
}

function followable(events: ExplorationEvent[]) {
	return (
		events.find((item) => item.step === 'done')?.status === 'completed' && explorationState(events) !== 'following'
	)
}

export function followCount(store: Store, explorationId: string) {
	return followable(explorationEvents(store, explorationId)) ? unusedAnswers(store, explorationId).length : 0
}

export function startFollow(store: Store, actor: string | undefined, input: FollowInput, env: Env) {
	const id = input.explorationId
	let session = false
	const reply = write(store, { actor, command: 'explore follow', subject: id, input }, (operationId, at) => {
		const row = explorationRow(store, id)
		const events = explorationEvents(store, id)
		session = startOf(events)?.path === 'session'
		if (!session) requireClaude(env)
		const state = explorationState(events)
		requireCondition(
			followable(events),
			`Exploration ${id} is ${state}. A follow-up needs a completed exploration.`,
			['failed', 'stopped', 'open'].includes(state)
				? `Start a new test: checkmate test ${row.plan_id} --allow Read --allow Bash`
				: `Run checkmate explore wait ${id}. Then run the follow-up again.`
		)
		const answered = unusedAnswers(store, id)
		requireCondition(
			answered.length,
			`Exploration ${id} has no answer that a follow-up has not used.`,
			`Answer a question of the exploration first: checkmate gap answer ${row.plan_id} <questionId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>". Run checkmate explore show ${id} to read its questions.`
		)
		const stored = startOf(events)!
		const claudeArgs = checkClaudeArgs(input.claudeArgs)
		const plan: FollowPlan = {
			answers: answered.map((question) => question.answerId!),
			questions: answered.map((question) => ({ question: question.question, answer: question.answer! })),
			after: lastEntry(store),
			allow: input.allow.length ? input.allow : stored.allow,
			context: claudeArgs.length
				? {
						...stored.context,
						claudeArgs:
							hostModel(claudeArgs) || !stored.model
								? claudeArgs
								: [...claudeArgs, '--model', stored.model],
					}
				: stored.context,
			timeoutSeconds: input.timeoutSeconds ?? stored.timeoutSeconds,
			seconds: testLevels[stored.level].followSeconds,
		}
		requireWellFormed(
			plan.allow.length || session,
			'Give the tool rules of the explorers with --allow, for example --allow Read --allow Bash',
			'The host owns the permissions. An explorer cannot answer a permission prompt.'
		)
		addEvent(store, id, { step: 'follow', explorer: null, status: 'started', detail: plan }, operationId, at)
		return {
			reply: completed(id, {
				explorationId: id,
				planId: row.plan_id,
				build: row.build,
				answers: plan.answers.length,
				followSeconds: plan.seconds,
				next: [`checkmate explore ${session ? 'next' : 'wait'} ${id}`],
			}),
			subjects: [`exploration:${id}`, `plan:${row.plan_id}`],
		}
	})
	if (!session) startSupervisor(store, reply.subject, actor!, env, ['--follow'])
	return reply
}

function followSessions(events: ExplorationEvent[]) {
	const names = [...new Set(events.flatMap((item) => (item.explorer ? [item.explorer] : [])))]
	return names.map((explorer) => {
		const own = events.filter((item) => item.explorer === explorer)
		const last = (step: string) => own.filter((item) => item.step === step).at(-1)
		const session = (last('launch')?.detail.session ?? last('record')?.detail.session) as string | undefined
		const skipped = !session
			? `${explorer} has no session.`
			: last('end')?.detail.turn === 'study'
				? `The session of ${explorer} ended in its study turn.`
				: undefined
		return { explorer, session: session ?? '', skipped }
	})
}

export async function driveFollow(workspace: string, explorationId: string, env: Env) {
	const store = openStore(workspace)
	const actor = env.CHECKMATE_ACTOR ?? 'checkmate'
	try {
		event(store, actor, explorationId, {
			step: 'supervisor',
			explorer: null,
			status: 'started',
			detail: { pid: process.pid },
		})
		const events = explorationEvents(store, explorationId)
		const plan = events.findLast((item) => item.step === 'follow')!.detail as FollowPlan
		const launch = {
			...startOf(events)!,
			allow: plan.allow,
			context: plan.context,
			timeoutSeconds: plan.timeoutSeconds,
		}
		const sessions = followSessions(events)
		const phase = `follow-${events.filter((item) => item.step === 'follow').length}`
		const count = startOf(events)!.explorers
		const claude = requireClaude(env)
		const allowed = plan.allow.flatMap((rule) => ['--allowedTools', rule])
		const ended = await Promise.all(
			sessions
				.filter((item) => !item.skipped)
				.map(async ({ explorer, session }) => {
					const { folder, deny, extraEnv } = explorerWork(store, explorationId, explorer, count)
					const call = await launchClaude(
						claude,
						childArgs({ ...plan.context, deny }, ['--resume', session, ...allowed]),
						followBrief(plan.questions, folder, plan.seconds),
						store.workspace,
						childEnv(env, extraEnv),
						plan.timeoutSeconds
					)
					return { explorer, session, call }
				})
		)
		for (const { explorer, session, call } of ended) {
			const hint = failureHint(launch, call)
			event(store, actor, explorationId, {
				step: 'follow-turn',
				explorer,
				status: call.failure?.[0] ?? 'completed',
				detail: {
					session,
					...(call.failure ? { reason: call.failure[1] } : {}),
					...(call.stderr ? { stderr: call.stderr } : {}),
					...(hint ? { hint } : {}),
					...costOf([call]),
				},
			})
		}
		const resumed = ended.filter((item) => item.call.failure?.[0] !== 'operational_error')
		const recorded = recordExplorers(store, actor, explorationId, resumed, env).filter(
			(status) => status === 'completed'
		).length
		for (const { explorer } of ended) keepWorkFiles(store, actor, explorationId, explorer, phase)
		if (recorded) {
			mergeReports(store, actor, explorationId, launch, env, plan.after)
			if (launch.verifier) await verifyClaims(store, actor, explorationId, launch, env, plan.after)
			removeWork(store, explorationId)
		} else keepBrowserFolder(store, explorationId)
		const skipped = [
			...sessions.flatMap((item) => (item.skipped ? [item.skipped] : [])),
			...ended.flatMap((item) =>
				item.call.failure?.[0] === 'operational_error'
					? [`The session of ${item.explorer} could not resume: ${item.call.failure[1]}`]
					: []
			),
		]
		event(store, actor, explorationId, {
			step: 'followed',
			explorer: null,
			status: recorded ? 'completed' : 'failed',
			detail: {
				recorded,
				answers: plan.answers,
				skipped,
				...(recorded ? {} : { reason: 'No explorer session of the follow-up was recorded.' }),
				...(ended.some((item) => authenticationFailed(item.call)) ? { hint: authenticationHint } : {}),
			},
		})
	} catch (error) {
		keepBrowserFolder(store, explorationId)
		event(store, actor, explorationId, {
			step: 'followed',
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

function followState(events: ExplorationEvent[]) {
	const follow = events.findLastIndex((item) => item.step === 'follow')
	if (follow === -1) return null
	const later = events.slice(follow + 1)
	const ended = later.find((item) => item.step === 'followed')
	if (ended) return ended.status === 'completed' ? 'completed' : 'failed'
	const supervisor = later.find((item) => item.step === 'supervisor')
	return supervisor && !running(supervisor.detail.pid) ? 'stopped' : 'running'
}

export function pauseOf(events: ExplorationEvent[]) {
	const last = events.findLast((item) => item.step === 'pause' || item.step === 'resume')
	return last?.step === 'pause' ? (last.detail.reason as string) : null
}

export function explorationState(events: ExplorationEvent[]) {
	if (followState(events) === 'running') return 'following'
	const done = events.find((item) => item.step === 'done')
	if (done) return done.status === 'completed' ? 'completed' : 'failed'
	const supervisor = events.find((item) => item.step === 'supervisor')
	if (supervisor && !running(supervisor.detail.pid)) return 'stopped'
	if (!events.some((item) => item.step === 'start')) return 'open'
	if (!supervisor && startOf(events)?.path !== 'session') return 'starting'
	if (events.some((item) => item.step === 'merge')) return 'verifying'
	if (events.some((item) => item.step === 'record')) return 'recording'
	return 'testing'
}

export function explorationStatus(store: Store, explorationId: string) {
	const row = explorationRow(store, explorationId)
	const events = explorationEvents(store, explorationId)
	const launch = startOf(events)
	const charter = JSON.parse(row.charter) as Charter
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
			session: (last('launch')?.detail.session ??
				record?.detail.session ??
				own.findLast((item) => item.detail.agent)?.detail.agent ??
				null) as string | null,
			ended: end?.status ?? null,
			recorded: record?.status ?? null,
			saved: (record?.detail.saved ?? 0) as number,
			reason: (end?.detail.reason ?? record?.detail.reasons ?? null) as unknown,
			hint: (end?.detail.hint ?? null) as string | null,
			stderr: (end?.detail.stderr ?? []) as string[],
		}
	})
	const done = events.find((item) => item.step === 'done')
	const followed = events.filter((item) => item.step === 'followed').at(-1)
	const follow = followState(events)
	return {
		explorationId: row.exploration_id,
		planId: row.plan_id,
		build: row.build,
		mode: row.mode,
		instanceId: row.instance_id,
		state,
		path: launch ? (launch.path ?? 'process') : null,
		paused: ['completed', 'failed'].includes(state) ? null : pauseOf(events),
		level: launch?.level ?? null,
		explorerCount: launch?.explorers ?? null,
		model: launch?.model ?? null,
		modelFrom: launch?.modelFrom ?? null,
		verifier: launch?.verifier ?? null,
		since: charter.change?.since ?? null,
		until: charter.change?.until ?? null,
		studySeconds: launch?.studySeconds ?? null,
		testSeconds: launch?.testSeconds ?? null,
		pluginHidden: launch?.pluginHidden ?? null,
		follow,
		followReason:
			follow === 'stopped'
				? 'The supervisor of the follow-up stopped before the end.'
				: follow === 'failed'
					? ((followed?.detail.reason ?? null) as string | null)
					: null,
		explorers,
		phases: events
			.filter((item) => ['merge', 'verify', 'follow', 'followed'].includes(item.step))
			.map((item) => ({ step: item.step, status: item.status, detail: item.detail })),
		doneHint: (done?.detail.hint ?? null) as string | null,
		workFolder:
			(['failed', 'stopped'].includes(state) || follow === 'failed' || follow === 'stopped') &&
			existsSync(join(store.workspace, workFolder(row.exploration_id)))
				? workFolder(row.exploration_id)
				: null,
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
		files: explorationEvents(store, explorationId)
			.filter((item) => item.step === 'files')
			.flatMap((item) =>
				(item.detail.files as Array<{ name: string; sha256: string; size: number }>).map((file) => ({
					explorer: item.explorer!,
					phase: item.detail.phase as string,
					...file,
					text: Buffer.from(
						one<{ bytes: Uint8Array }>(store, 'SELECT bytes FROM blobs WHERE sha256 = ?', file.sha256)!
							.bytes
					).toString('utf8'),
				}))
			),
	}
}
