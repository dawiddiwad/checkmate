import type { Reply, Store } from './store.ts'
import type { Profile } from './types.ts'
import type { ChildContext, ChildCall, Env } from './sessions.ts'
import type { Charter, ExplorationEvent, OpenInput } from './explorations.ts'
import type { TestLevel } from './levels.ts'
import { explorationCost } from './costs.ts'
import { all, closeStore, completed, one, openStore, saveBlob, write } from './store.ts'
import { Refusal, requireChoice, requireCondition, requireWellFormed } from './contracts.ts'
import { addEvent, exploration, explorationEvents, insertExploration, workFolder } from './explorations.ts'
import type { Refused } from './journal.ts'
import { firstRevision } from './testRevision.ts'
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
import type { Harness } from './pi.ts'
import { piErrorText, piModelArgs, piOverrideModelArgs, piSavedModelEnv, piStderr, selectedHarness } from './pi.ts'
import { requireEffort, requireModel, testerEffortText, testerModelText, workspaceEnv } from './settings.ts'
import type { ModelCatalog } from './model-catalog.ts'
import { discoverModelCatalog, effortArgs, resolvedEffort } from './model-catalog.ts'
import { defaultLevel, levelNames, storedLevel, testLevels } from './levels.ts'
import { explorerActor, lastEntry, launchContext, recordSession, defaultRecorderTimeout } from './recorder.ts'
import {
	explorerBrief,
	followBrief,
	mergeAgainPrompt,
	mergerPrompt,
	repairPrompt,
	rulesPrompt,
	rulesRepairPrompt,
	verifierBrief,
	verifierRepairPrompt,
} from './briefs.ts'
import { checkedRules, ruleSources, rulesNeeded, saveRules } from './rules.ts'
import { findInstance, targetRevision, targetWebUrl } from './targets.ts'
import { dataRules, markerFor, owe, requireDataFor, runPrepare, settleCleanups } from './resets.ts'
import { isRecordedGroup, signalRecordedGroup, startOfGroup } from './processes.ts'
import { storeFindingsRun } from './findingsRun.ts'
import { changeOf, changedFiles } from './change.ts'
import {
	checkClaudeArgs,
	checkmateScript,
	childArgs,
	authenticationFailed,
	authenticationHint,
	callChild,
	childEnv,
	usageOf,
	childHook,
	exitOnSignal,
	installedPluginId,
	replyArray,
	launchChild,
	piAuthenticationHint,
	piToolNames,
	requireChild,
	running,
	storeDenyRules,
	workDenyRules,
} from './sessions.ts'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
} from 'node:fs'
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
	testerModels?: Record<string, string>
	testerEfforts?: Record<string, string>
	timeoutSeconds?: number
	session?: boolean
}
export type Launch = {
	dataRules?: string[]
	studySeconds: number
	testSeconds: number
	level: TestLevel
	explorers: number
	model: string | null
	modelFrom: 'level' | 'host' | 'agent' | 'workspace'
	effort?: string
	verifier: boolean
	context: ChildContext
	testerModels?: Record<string, string>
	testerEfforts?: Record<string, string>
	allow: string[]
	timeoutSeconds: number
	pluginHidden: boolean
	path?: 'session'
	browserFolder?: boolean
}

export { running }
export const defaultExplorerTimeout = 1800
const pollMilliseconds = 500
const activityMilliseconds = 5000
export const mergerActor = 'qa:merge'
export const verifierActor = 'qa:verify'

function hostArg(args: string[], flag: string) {
	for (const [index, arg] of args.entries()) {
		if (arg === flag) return args[index + 1]
		if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
	}
	return undefined
}

function hostModel(args: string[]) {
	return hostArg(args, '--model')
}

function contextForModel(context: ChildContext, model: string | undefined): ChildContext {
	if (!model) return context
	if (context.harness === 'pi') return { ...context, piArgs: piOverrideModelArgs(context.piArgs ?? [], model) }
	const args: string[] = []
	for (let index = 0; index < context.claudeArgs.length; index++) {
		const value = context.claudeArgs[index]
		if (value === '--model') index++
		else if (!value.startsWith('--model=')) args.push(value)
	}
	return { ...context, claudeArgs: [...args, '--model', model] }
}

function contextForEffort(context: ChildContext, catalog: ModelCatalog | undefined, choice: string): ChildContext {
	if (!catalog) return context
	const { harness = 'claude' } = context
	const args = harness === 'pi' ? (context.piArgs ?? []) : context.claudeArgs
	if (hostArg(args, harness === 'pi' ? '--thinking' : '--effort')) return context
	const effort = resolvedEffort(harness, catalog, hostModel(args) ?? '', choice, hostArg(args, '--provider'))
	if (!effort) return context
	return harness === 'pi'
		? { ...context, piArgs: [...args, ...effortArgs(harness, effort)] }
		: { ...context, claudeArgs: [...args, ...effortArgs(harness, effort)] }
}

export function launchPlan(
	profile: Profile,
	input: StartInput,
	env: Env,
	savedModel = '',
	preferSaved = false,
	savedEffort = ''
): Launch {
	const level = requireChoice(
		input.level ?? storedLevel(profile.explore?.level) ?? defaultLevel,
		levelNames,
		'test level (--level)'
	)
	const row = testLevels[level]
	const explorers = input.explorers ?? profile.explore?.explorers ?? row.explorers
	const testSeconds = input.minutes ? input.minutes * 60 : row.testSeconds
	const testerModels = Object.entries(input.testerModels ?? {}).flatMap(([name, text]) => {
		requireWellFormed(typeof text === 'string', `Give a model ID for tester ${name}.`)
		const model = text.trim()
		return model ? [[name, model] as const] : []
	})
	const testerEfforts = Object.entries(input.testerEfforts ?? {})
	if (input.session) {
		requireWellFormed(!testerModels.length, 'Individual tester models require testers in new processes.')
		requireWellFormed(!testerEfforts.length, 'Individual tester efforts require testers in new processes.')
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
			context: { hiddenPlugin: null, claudeArgs: [], harness: 'claude' },
			allow: input.allow,
			studySeconds: row.studySeconds,
			testSeconds,
			timeoutSeconds: 0,
			pluginHidden: true,
			path: 'session',
		}
	}
	const harness = selectedHarness(env)
	const names = explorerNames(explorers)
	for (const [name, model] of testerModels) {
		requireWellFormed(names.includes(name), `Unknown tester ${name} for this exploration.`)
		requireModel(harness, model)
	}
	for (const [name, effort] of testerEfforts) {
		requireWellFormed(names.includes(name), `Unknown tester ${name} for this exploration.`)
		requireEffort(harness, effort)
	}
	if (harness === 'pi') {
		requireWellFormed(
			!input.claudeArgs.length,
			'--claude-arg is for Claude. Set CHECKMATE_PI_MODEL and CHECKMATE_PI_PROVIDER for Pi.'
		)
		piToolNames(input.allow)
	}
	const claudeArgs = checkClaudeArgs(input.claudeArgs)
	const prefersSaved = Boolean(
		savedModel && (harness === 'pi' ? preferSaved || !env.CHECKMATE_PI_MODEL?.trim() : !hostModel(claudeArgs))
	)
	const piEnv = harness === 'pi' && prefersSaved ? piSavedModelEnv(env, savedModel) : env
	const selected = prefersSaved && (harness === 'claude' || piEnv !== env)
	const piArgs = harness === 'pi' ? piModelArgs(piEnv) : []
	const host = hostModel(harness === 'pi' ? piArgs : claudeArgs)
	const model = selected ? savedModel : (host ?? (harness === 'pi' ? null : row.model))
	const hiddenPlugin = harness === 'claude' ? installedPluginId(env) : null
	requireWellFormed(
		input.allow.length || (explorers === 0 && !row.verifier),
		'Give the tool rules of the explorers and the verifier with --allow, for example --allow Read --allow Bash',
		'The host owns the permissions. Without the review UI, an explorer cannot answer a permission prompt.'
	)
	return {
		level,
		explorers,
		model,
		modelFrom: selected ? 'workspace' : host || harness === 'pi' ? 'host' : 'level',
		verifier: row.verifier,
		context:
			harness === 'pi'
				? { hiddenPlugin, claudeArgs: [], harness, piArgs }
				: {
						hiddenPlugin,
						claudeArgs: host ? claudeArgs : [...claudeArgs, '--model', selected ? savedModel : row.model],
						harness,
					},
		...(testerModels.length ? { testerModels: Object.fromEntries(testerModels) } : {}),
		...(testerEfforts.length ? { testerEfforts: Object.fromEntries(testerEfforts) } : {}),
		...(savedEffort && (selected || !host || (harness === 'pi' && preferSaved && !savedModel))
			? { effort: savedEffort }
			: {}),
		allow: input.allow,
		studySeconds: row.studySeconds,
		testSeconds,
		timeoutSeconds:
			input.timeoutSeconds ?? Math.max(defaultExplorerTimeout, Math.max(row.studySeconds, testSeconds) * 3),
		pluginHidden: harness === 'pi' || hiddenPlugin !== null,
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
		grant: [`Edit(/${folder}/**)`],
		deny: workDenyRules(others.map((name) => workFolder(explorationId, name))),
		extraEnv: {
			PLAYWRIGHT_MCP_OUTPUT_DIR: join(store.workspace, folder),
			PLAYWRIGHT_CLI_SESSION: `qa-${explorationId}-${explorer}`,
		},
	}
}

const strayIgnored = ['.checkmate', '.playwright-cli']

function topLevelNames(workspace: string) {
	const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
		cwd: workspace,
		encoding: 'utf8',
	})
	const names =
		status.status === 0
			? status.stdout
					.split('\n')
					.filter((line) => line.startsWith('?? '))
					.map((line) => line.slice(3).replace(/^"|"$/g, ''))
			: readdirSync(workspace)
	return new Set(names.filter((name) => !strayIgnored.includes(name.replace(/\/$/, ''))))
}

async function watchStray<T>(
	store: Store,
	actor: string,
	explorationId: string,
	explorer: string,
	turn: string,
	run: () => Promise<T>
) {
	const before = topLevelNames(store.workspace)
	const result = await run()
	const stray = [...topLevelNames(store.workspace)].filter((name) => !before.has(name)).sort()
	if (stray.length)
		event(store, actor, explorationId, {
			step: 'stray',
			explorer,
			status: 'completed',
			detail: { turn, names: stray, basis: 'workspace_listing' },
		})
	return result
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

export function startExploration(
	store: Store,
	actor: string | undefined,
	given: StartInput,
	env: Env,
	preferSavedModel = false
) {
	if (!given.session) env = workspaceEnv(store, env)
	const change = changeOf(store.workspace, given)
	const input = { ...given, change, scope: given.scope ?? (change ? changedFiles(store.workspace, change) : []) }
	const reply = write(store, { actor, command: 'explore start', subject: input.planId, input }, (operationId, at) => {
		if (!input.session) {
			requireChild(env, selectedHarness(env))
			for (const { exploration_id: id } of all<{ exploration_id: string }>(
				store,
				'SELECT exploration_id FROM explorations WHERE plan_id = ?',
				input.planId
			))
				recoverWorkers(store, id)
		}
		const opened = input.explorationId
			? finishable(store, input.explorationId)
			: insertExploration(store, input, operationId, at)
		const row = explorationRow(store, opened.explorationId)
		const exploredProfile = targetRevision(store, row.target_id).profile
		requireDataFor(
			exploredProfile,
			exploredProfile.allowedOperations,
			`Exploration ${row.exploration_id}`,
			targetWebUrl(store, row.target_id)
		)
		const marker = markerFor(store, opened.explorationId)
		const facts = runPrepare(store.workspace, exploredProfile.reset, marker)
		owe(store, opened.explorationId, exploredProfile.reset)
		const rules = dataRules(store.workspace, exploredProfile.reset, marker, facts)
		const savedModel = input.session ? '' : testerModelText(store, selectedHarness(env))
		const savedEffort = input.session ? '' : testerEffortText(store, selectedHarness(env))
		const launch = launchPlan(
			targetRevision(store, row.target_id, row.target_revision).profile,
			input,
			env,
			savedModel,
			preferSavedModel,
			savedEffort
		)
		addEvent(
			store,
			opened.explorationId,
			{
				step: 'start',
				explorer: null,
				status: 'started',
				detail: {
					...launch,
					dataRules: rules,
					browserFolder: existsSync(join(store.workspace, browserFolder)),
				},
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
		const ending = item.step === 'done' || item.step === 'followed'
		if (!ending || !stopOf(explorationEvents(store, explorationId)))
			addEvent(store, explorationId, item, operationId, at)
		return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`] }
	})
}

export function startOf(events: ExplorationEvent[]) {
	const launch = events.find((item) => item.step === 'start')?.detail as Launch | undefined
	return launch && { ...launch, level: storedLevel(launch.level) }
}

function noteChild(store: Store, actor: string, explorationId: string, explorer: string | null) {
	return (pid: number) => {
		const born = startOfGroup(pid)
		event(store, actor, explorationId, {
			step: 'child',
			explorer,
			status: 'started',
			detail: { pid, ...(born ? { born } : {}) },
		})
		if (explorer && testerStopOf(explorationEvents(store, explorationId), explorer))
			signalRecordedGroup(pid, born, 'SIGTERM')
	}
}

function failureHint(launch: Launch, call: ChildCall, testerModel?: string) {
	if (authenticationFailed(call)) return launch.context.harness === 'pi' ? piAuthenticationHint : authenticationHint
	if (!/model/i.test([call.failure?.[1] ?? '', ...(call.stderr ?? [])].join(' '))) return undefined
	if (testerModel) return `The host refused tester model ${testerModel}. Select another model for the tester.`
	if (launch.modelFrom === 'workspace') return 'Change Model for testers in Settings.'
	if (launch.context.harness === 'pi')
		return 'Check the model configured in Pi, or set CHECKMATE_PI_MODEL and CHECKMATE_PI_PROVIDER.'
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

function workFiles(folder: string) {
	try {
		return new Map(
			readdirSync(folder, { withFileTypes: true })
				.filter((item) => item.isFile())
				.map((item) => [item.name, statSync(join(folder, item.name)).size])
		)
	} catch {
		return new Map<string, number>()
	}
}

export function activityLine(turn: string, changed: string[], count: number) {
	const named =
		changed.length > 3 ? `${changed.slice(0, 3).join(', ')} and ${changed.length - 3} more` : changed.join(', ')
	return `${turn}: wrote ${named}. ${count} ${count === 1 ? 'file' : 'files'} in the work folder.`
}

function watchWork(store: Store, actor: string, explorationId: string, explorer: string, turn: string) {
	const folder = join(store.workspace, workFolder(explorationId, explorer))
	let known = workFiles(folder)
	const check = () => {
		const now = workFiles(folder)
		const changed = [...now].filter(([name, size]) => known.get(name) !== size).map(([name]) => name)
		known = now
		if (changed.length)
			event(store, actor, explorationId, {
				step: 'activity',
				explorer,
				status: 'started',
				detail: { turn, activity: activityLine(turn, changed, now.size) },
			})
	}
	const timer = setInterval(check, activityMilliseconds)
	return {
		next: (name: string) => {
			check()
			turn = name
		},
		stop: () => {
			clearInterval(timer)
			check()
		},
	}
}

async function watchedTurns<T>(
	store: Store,
	actor: string,
	explorationId: string,
	explorer: string,
	work: ReturnType<typeof explorerWork>,
	launch: Launch,
	env: Env,
	executable: string,
	initialTurn: string,
	run: (
		turn: (context: ChildContext, own: string[], prompt: string, name: string) => Promise<ChildCall>,
		next: (name: string) => void
	) => Promise<T>
) {
	const rules = launch.context.harness === 'pi' ? launch.allow : [...launch.allow, ...work.grant]
	const watch = watchWork(store, actor, explorationId, explorer, initialTurn)
	const turn = (tester: ChildContext, own: string[], prompt: string, name: string) => {
		const hook = childHook(store.workspace, explorationId, explorer)
		const context = { ...tester, deny: work.deny, hook, work: work.folder }
		return watchStray(store, actor, explorationId, explorer, name, () =>
			launchChild(
				executable,
				childArgs(context, own, rules),
				prompt,
				store.workspace,
				childEnv(env, work.extraEnv, hook, context, rules),
				launch.timeoutSeconds,
				noteChild(store, actor, explorationId, explorer),
				context.harness
			)
		)
	}
	try {
		return await run(turn, watch.next)
	} finally {
		watch.stop()
	}
}

async function launchExplorers(
	store: Store,
	actor: string,
	explorationId: string,
	launch: Launch,
	env: Env,
	catalog?: ModelCatalog
) {
	const opened = exploration(store, explorationId)
	const entries = entryValues(store, explorationId)
	const executable = requireChild(env, launch.context.harness)
	const runs = explorerNames(launch.explorers).map(async (explorer) => {
		const session = randomUUID()
		const model = launch.testerModels?.[explorer]
		const tester = contextForEffort(
			contextForModel(launch.context, model),
			catalog,
			launch.testerEfforts?.[explorer] ?? (model ? '' : (launch.effort ?? ''))
		)
		const work = explorerWork(store, explorationId, explorer, launch.explorers)
		const { folder, grant } = work
		const brief = explorerBrief(
			{ ...opened.charter, dataRules: launch.dataRules },
			entries,
			`qa-${explorationId}-${explorer}-`,
			folder,
			{
				study: launch.studySeconds,
				test: launch.testSeconds,
			}
		)
		event(store, actor, explorationId, {
			step: 'launch',
			explorer,
			status: 'started',
			detail: {
				session,
				context: tester,
				engineRules: grant,
				brief,
			},
		})
		const calls = await watchedTurns(
			store,
			actor,
			explorationId,
			explorer,
			work,
			launch,
			env,
			executable,
			'study',
			async (turn, next) => {
				const study = await turn(tester, ['--session-id', session], brief.study, 'study')
				next('test')
				if (study.failure) return [study]
				event(store, actor, explorationId, {
					step: 'turn',
					explorer,
					status: 'started',
					detail: { session, turn: 'test' },
				})
				return [
					study,
					await turn(
						contextForModel(tester, study.observedModels?.at(-1)),
						['--resume', session],
						brief.test,
						'test'
					),
				]
			}
		)
		return { explorer, session, calls }
	})
	const ended = await Promise.all(runs)
	for (const { explorer, session, calls } of ended) {
		const call = calls.find((item) => item.failure) ?? calls.at(-1)!
		const hint = failureHint(launch, call, launch.testerModels?.[explorer])
		if (launch.context.harness === 'pi' && call.failure)
			console.error(`${explorationId}/${explorer} ${calls.length === 1 ? 'study' : 'test'}: ${call.failure[1]}`)
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
				...usageOf(calls),
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
	const executable = requireChild(env, launch.context.harness)
	const call = (args: string[], prompt: string) => {
		const hook = childHook(store.workspace, explorationId, 'merge')
		const context = { ...launch.context, hook }
		return callChild(
			executable,
			childArgs(context, args),
			prompt,
			store.workspace,
			childEnv(env, {}, hook, context),
			defaultRecorderTimeout,
			context.harness
		)
	}
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
			...(calls.some(authenticationFailed)
				? { hint: launch.context.harness === 'pi' ? piAuthenticationHint : authenticationHint }
				: {}),
			...(calls.find((item) => item.stderr)?.stderr ? { stderr: calls.find((item) => item.stderr)!.stderr } : {}),
			...usageOf(calls),
		},
	})
}

function deriveRules(store: Store, actor: string, explorationId: string, launch: Launch, env: Env) {
	const opened = exploration(store, explorationId)
	if (!rulesNeeded(store, opened.plan_id)) return
	const sources = ruleSources(store, opened.plan_id)
	const names = sources.map((source) => source.name)
	const session = randomUUID()
	const call = (args: string[], prompt: string) => {
		const hook = childHook(store.workspace, explorationId, 'rules')
		const context = { ...launch.context, hook }
		return callChild(
			requireChild(env, context.harness),
			childArgs(context, args),
			prompt,
			store.workspace,
			childEnv(env, {}, hook, context),
			defaultRecorderTimeout,
			context.harness
		)
	}
	const calls = [call(['--session-id', session], rulesPrompt(opened.charter.goal, sources))]
	const first = checkedRules(replyArray(calls[0].result), names)
	let checked = first
	if (!calls[0].failure && first.refusals.length) {
		calls.push(call(['--resume', session], rulesRepairPrompt(first.refusals)))
		const again = checkedRules(replyArray(calls[1].result), names)
		if (again.rules.length) checked = again
	}
	const failure = calls.find((item) => item.failure)?.failure
	const item = {
		step: 'rules',
		explorer: null,
		status: checked.rules.length ? 'completed' : (failure?.[0] ?? 'operational_error'),
		detail: {
			session,
			calls: calls.length,
			rules: checked.rules.length,
			refused: checked.refusals.length,
			...(checked.rules.length ? {} : { reason: failure?.[1] ?? checked.refusals.join(' ') }),
			...(calls.some(authenticationFailed)
				? { hint: launch.context.harness === 'pi' ? piAuthenticationHint : authenticationHint }
				: {}),
			...usageOf(calls),
		},
	}
	write(store, { actor, command: 'explore rules', subject: explorationId, input: item }, (operationId, at) => {
		if (checked.rules.length && rulesNeeded(store, opened.plan_id))
			saveRules(store, operationId, opened.plan_id, checked.rules, 'derived')
		addEvent(store, explorationId, item, operationId, at)
		return { reply: completed(explorationId), subjects: [`exploration:${explorationId}`, `plan:${opened.plan_id}`] }
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
		dataRules: startOf(explorationEvents(store, explorationId))?.dataRules ?? [],
		dataPrefix: `qa-${explorationId}-verify-`,
	}
}

async function verifyClaims(store: Store, actor: string, explorationId: string, launch: Launch, env: Env, after = 0) {
	const input = verifyInput(store, explorationId, after)
	if (!input) return
	const { items } = input
	const session = randomUUID()
	const brief = verifierBrief(items, input.entries, input.operations, input.dataRules, input.dataPrefix)
	const ask = (own: string[], prompt: string) => {
		const hook = childHook(store.workspace, explorationId, 'verify')
		const context = { ...launch.context, deny: storeDenyRules, hook }
		return launchChild(
			requireChild(env, context.harness),
			childArgs(context, own, launch.allow),
			prompt,
			store.workspace,
			childEnv(env, {}, hook, context, launch.allow),
			launch.timeoutSeconds,
			noteChild(store, actor, explorationId, null),
			context.harness
		)
	}
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
			...(calls.some(authenticationFailed)
				? { hint: launch.context.harness === 'pi' ? piAuthenticationHint : authenticationHint }
				: {}),
			...usageOf(calls),
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
	return explorationEvents(store, explorationId).some(
		(item) => item.detail.hint === authenticationHint || item.detail.hint === piAuthenticationHint
	)
}

function hasSavedEffort(launch: Launch) {
	return Boolean(launch.effort || Object.values(launch.testerEfforts ?? {}).some(Boolean))
}

function storeFindings(store: Store, actor: string, explorationId: string) {
	try {
		return storeFindingsRun(store, actor, explorationId)
	} catch (error) {
		return { runId: null, reason: error instanceof Error ? error.message : String(error) }
	}
}

export async function driveExploration(workspace: string, explorationId: string, env: Env) {
	exitOnSignal()
	const store = openStore(workspace)
	const actor = env.CHECKMATE_ACTOR ?? 'checkmate'
	try {
		event(store, actor, explorationId, {
			step: 'supervisor',
			explorer: null,
			status: 'started',
			detail: { pid: process.pid, born: startOfGroup(process.pid) },
		})
		const started = startOf(explorationEvents(store, explorationId))
		if (!started) throw new Refusal('prohibited', `Exploration ${explorationId} has no start.`)
		if (stopOf(explorationEvents(store, explorationId))) return
		const catalog =
			started.explorers || started.verifier
				? await discoverModelCatalog(
						started.context.harness ?? 'claude',
						workspace,
						env,
						hasSavedEffort(started)
					).catch(() => undefined)
				: undefined
		if (stopOf(explorationEvents(store, explorationId))) return
		const launch = { ...started, context: contextForEffort(started.context, catalog, started.effort ?? '') }
		if (launch.explorers) {
			deriveRules(store, actor, explorationId, launch, env)
			const ended = await launchExplorers(store, actor, explorationId, started, env, catalog)
			const stops = explorationEvents(store, explorationId).filter(
				(item) => item.step === 'stop' && item.explorer !== null
			)
			const lastStop = stops.length === ended.length ? stops.at(-1) : undefined
			if (!lastStop)
				recordExplorers(
					store,
					actor,
					explorationId,
					ended.filter(
						(item) => item.calls.length === 2 && item.calls[1].failure?.[0] !== 'operational_error'
					),
					env
				)
			for (const { explorer } of ended) keepWorkFiles(store, actor, explorationId, explorer, 'test')
			if (lastStop) {
				keepBrowserFolder(store, explorationId)
				event(store, actor, explorationId, {
					step: 'done',
					explorer: null,
					status: 'stopped',
					detail: { reason: stopText(lastStop) },
				})
				return
			}
		}
		const ok = explorationEvents(store, explorationId).filter(
			(item) => item.step === 'record' && item.status === 'completed'
		).length
		if (ok) {
			mergeReports(store, actor, explorationId, launch, env)
			if (launch.verifier) await verifyClaims(store, actor, explorationId, launch, env)
			removeWork(store, explorationId)
		} else keepBrowserFolder(store, explorationId)
		const revision = ok
			? firstRevision(store, actor, explorationRow(store, explorationId).plan_id, explorationId)
			: null
		const findings =
			ok && explorationStatus(store, explorationId).path !== 'session'
				? storeFindings(store, actor, explorationId)
				: null
		event(store, actor, explorationId, {
			step: 'done',
			explorer: null,
			status: ok ? 'completed' : 'failed',
			detail: {
				recorded: ok,
				...(findings
					? { findingsRun: findings.runId, ...(findings.reason ? { findingsReason: findings.reason } : {}) }
					: {}),
				...(revision?.reason ? { revisionReason: revision.reason } : {}),
				...(ok
					? {}
					: {
							reason: hostAuthentication(store, explorationId)
								? 'Host authentication: no session could log in.'
								: 'No explorer session was recorded.',
						}),
				...(!ok && hostAuthentication(store, explorationId)
					? { hint: launch.context.harness === 'pi' ? piAuthenticationHint : authenticationHint }
					: {}),
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
		settleCleanups(store, [explorationId])
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
	modelOverride?: string
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

function retryCommand(store: Store, id: string, launch: Launch | undefined) {
	const { plan_id, build, mode, instance_id, charter } = explorationRow(store, id)
	const { change } = JSON.parse(charter) as Charter
	const command = [
		'checkmate',
		...(launch?.path === 'session' ? ['test', plan_id, '--session'] : ['explore', 'start', plan_id]),
		'--build',
		build,
		'--mode',
		mode,
		'--instance',
		instance_id,
	]
	if (change) {
		command.push('--since', change.since, '--repo', change.repo)
		if (change.range.length === 1) command.push('--until', change.until)
	}
	if (launch) {
		command.push('--level', launch.level)
		if (launch.explorers > 0) command.push('--explorers', String(launch.explorers))
		if (launch.timeoutSeconds) command.push('--timeout', String(launch.timeoutSeconds))
		if (launch.testSeconds && launch.testSeconds !== testLevels[launch.level].testSeconds)
			command.push('--minutes', String(launch.testSeconds / 60))
		for (const rule of launch.allow ?? []) command.push('--allow', rule)
	}
	const harness = launch ? `CHECKMATE_HARNESS=${launch.context?.harness ?? 'claude'} ` : ''
	return (
		harness +
		command.map((word) => (/^[\w./:@-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`)).join(' ')
	)
}

export function followCount(store: Store, explorationId: string, knownAnswers?: ReadonlySet<string>) {
	if (!followable(explorationEvents(store, explorationId))) return 0
	const answers = unusedAnswers(store, explorationId)
	return knownAnswers?.size
		? answers.filter(({ answerId }) => !answerId || !knownAnswers.has(answerId)).length
		: answers.length
}

export function startFollow(store: Store, actor: string | undefined, input: FollowInput, env: Env) {
	const id = input.explorationId
	let session = false
	let harness: Harness = 'claude'
	const reply = write(store, { actor, command: 'explore follow', subject: id, input }, (operationId, at) => {
		const row = explorationRow(store, id)
		const events = explorationEvents(store, id)
		const stored = startOf(events)
		session = stored?.path === 'session'
		harness = stored?.context?.harness ?? 'claude'
		const state = explorationState(events)
		requireCondition(
			stored && followable(events),
			`Exploration ${id} is ${state}. A follow-up needs a completed exploration.`,
			['failed', 'stopped', 'interrupted', 'open'].includes(state)
				? `Start a new test: ${retryCommand(store, id, stored)}`
				: `Run checkmate explore wait ${id}. Then run the follow-up again.`
		)
		if (!session) requireChild(env, harness)
		const answered = unusedAnswers(store, id)
		requireCondition(
			answered.length,
			`Exploration ${id} has no answer that a follow-up has not used.`,
			`Answer a question of the exploration first: checkmate gap answer ${row.plan_id} <questionId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>". Run checkmate explore show ${id} to read its questions.`
		)
		if (!session) recoverWorkers(store, id)
		if (harness === 'pi') {
			requireWellFormed(!input.claudeArgs.length, '--claude-arg is for Claude.')
			piToolNames(input.allow)
		}
		const claudeArgs = checkClaudeArgs(input.claudeArgs)
		const modelOverride = hostModel(claudeArgs)
		const plan: FollowPlan = {
			answers: answered.map((question) => question.answerId!),
			questions: answered.map((question) => ({ question: question.question, answer: question.answer! })),
			after: lastEntry(store),
			allow: input.allow.length ? input.allow : stored.allow,
			context: claudeArgs.length
				? {
						...stored.context,
						claudeArgs:
							modelOverride || !stored.model ? claudeArgs : [...claudeArgs, '--model', stored.model],
					}
				: stored.context,
			...(modelOverride ? { modelOverride } : {}),
			timeoutSeconds: input.timeoutSeconds ?? stored.timeoutSeconds,
			seconds: testLevels[stored.level].followSeconds,
		}
		requireWellFormed(
			plan.allow.length || session,
			'Give the tool rules of the explorers with --allow, for example --allow Read --allow Bash',
			'The host owns the permissions. Without the review UI, an explorer cannot answer a permission prompt.'
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
	if (!session) startSupervisor(store, reply.subject, actor!, { ...env, CHECKMATE_HARNESS: harness }, ['--follow'])
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
	exitOnSignal()
	const store = openStore(workspace)
	const actor = env.CHECKMATE_ACTOR ?? 'checkmate'
	try {
		event(store, actor, explorationId, {
			step: 'supervisor',
			explorer: null,
			status: 'started',
			detail: { pid: process.pid, born: startOfGroup(process.pid) },
		})
		const events = explorationEvents(store, explorationId)
		if (stopOf(events)) return
		const plan = events.findLast((item) => item.step === 'follow')!.detail as FollowPlan
		const initial = startOf(events)!
		const followModel = hostModel(plan.context.claudeArgs)
		const catalog = await discoverModelCatalog(
			plan.context.harness ?? 'claude',
			workspace,
			env,
			hasSavedEffort(initial)
		).catch(() => undefined)
		if (stopOf(explorationEvents(store, explorationId))) return
		const launch: Launch = {
			...initial,
			...(followModel && followModel !== initial.model ? { model: followModel, modelFrom: 'host' } : {}),
			allow: plan.allow,
			context: plan.context,
			timeoutSeconds: plan.timeoutSeconds,
		}
		const sessions = followSessions(events)
		const phase = `follow-${events.filter((item) => item.step === 'follow').length}`
		const count = initial.explorers
		const executable = requireChild(env, launch.context.harness)
		const ended = await Promise.all(
			sessions
				.filter((item) => !item.skipped)
				.map(async ({ explorer, session }) => {
					const work = explorerWork(store, explorationId, explorer, count)
					const { folder } = work
					const model = plan.modelOverride ? undefined : initial.testerModels?.[explorer]
					const resumed =
						plan.context.harness === 'pi' && !model && !hostModel(plan.context.piArgs ?? [])
							? launchContext(store, explorationId, explorer, session)
							: undefined
					const tester =
						resumed ??
						contextForEffort(
							contextForModel(plan.context, model),
							catalog,
							plan.modelOverride
								? ''
								: (initial.testerEfforts?.[explorer] ?? (model ? '' : (initial.effort ?? '')))
						)
					const call = await watchedTurns(
						store,
						actor,
						explorationId,
						explorer,
						work,
						launch,
						env,
						executable,
						'follow-up',
						(turn) =>
							turn(
								tester,
								['--resume', session],
								followBrief(plan.questions, folder, plan.seconds),
								'follow-up'
							)
					)
					return { explorer, session, call, tester, model }
				})
		)
		for (const { explorer, session, call, tester, model } of ended) {
			const hint = failureHint(launch, call, model)
			if (launch.context.harness === 'pi' && call.failure)
				console.error(`${explorationId}/${explorer} follow-up: ${call.failure[1]}`)
			event(store, actor, explorationId, {
				step: 'follow-turn',
				explorer,
				status: call.failure?.[0] ?? 'completed',
				detail: {
					session,
					context: tester,
					...(call.failure ? { reason: call.failure[1] } : {}),
					...(call.stderr ? { stderr: call.stderr } : {}),
					...(hint ? { hint } : {}),
					...usageOf([call]),
				},
			})
		}
		const resumed = ended.filter((item) => item.call.failure?.[0] !== 'operational_error')
		const recorded = recordExplorers(store, actor, explorationId, resumed, env).filter(
			(status) => status === 'completed'
		).length
		for (const { explorer } of ended) keepWorkFiles(store, actor, explorationId, explorer, phase)
		if (recorded) {
			const review = {
				...initial,
				context: contextForEffort(
					followModel && followModel !== initial.model
						? contextForModel(plan.context, initial.model ?? undefined)
						: plan.context,
					catalog,
					initial.effort ?? ''
				),
				allow: plan.allow,
				timeoutSeconds: plan.timeoutSeconds,
			}
			mergeReports(store, actor, explorationId, review, env, plan.after)
			if (review.verifier) await verifyClaims(store, actor, explorationId, review, env, plan.after)
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
				...(ended.some((item) => authenticationFailed(item.call))
					? { hint: launch.context.harness === 'pi' ? piAuthenticationHint : authenticationHint }
					: {}),
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

export type StopInput = { explorationId: string; explorer?: string; reason?: string }

const stopWaitMilliseconds = 5000
const killWaitMilliseconds = 2000
const stopPollMilliseconds = 50

// A process this exploration started, with its start time as recorded at start. Only a verified start is signalled.
type Owned = { pid: number; born?: number }

function recordedBirth(event: ExplorationEvent): number | undefined {
	return typeof event.detail.born === 'number' ? event.detail.born : undefined
}

function waitUntil(done: () => boolean, milliseconds: number) {
	const until = Date.now() + milliseconds
	while (!done() && Date.now() < until)
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stopPollMilliseconds)
	return done()
}

function childPids(events: ExplorationEvent[], explorer?: string): Owned[] {
	const children: Owned[] = events
		.filter((item) => item.step === 'child' && (explorer === undefined || item.explorer === explorer))
		.map((item) => ({ pid: item.detail.pid as number, born: recordedBirth(item) }))
	return explorer === undefined ? [...new Map(children.map((item) => [item.pid, item])).values()] : children.slice(-1)
}

function isOwned(item: Owned) {
	return isRecordedGroup(item.pid, item.born)
}

// Ends the processes that are still the recorded ones. A process whose start cannot be verified is not signalled.
function endProcesses(all: Owned[]): Owned[] {
	const owned = all.filter(isOwned)
	for (const item of owned) signalRecordedGroup(item.pid, item.born, 'SIGTERM')
	if (!waitUntil(() => !owned.some(isOwned), stopWaitMilliseconds)) {
		for (const item of owned.filter(isOwned)) signalRecordedGroup(item.pid, item.born, 'SIGKILL')
		waitUntil(() => !owned.some(isOwned), killWaitMilliseconds)
	}
	return owned.filter(isOwned)
}

export function interruptedSupervisor(events: ExplorationEvent[]) {
	const follow = events.findLastIndex((item) => item.step === 'follow')
	const phase = events.slice(follow + 1)
	if (phase.some((item) => item.step === (follow === -1 ? 'done' : 'followed'))) return false
	const supervisor = phase.find((item) => item.step === 'supervisor')
	return typeof supervisor?.detail.pid === 'number' && !running(supervisor.detail.pid)
}

function recoverWorkers(store: Store, id: string) {
	const events = explorationEvents(store, id)
	if (!interruptedSupervisor(events) && !stopOf(events)) return
	requireCondition(!stopPending(events), `A stop of ${id} is in progress. Wait until it ends, then start the test.`)
	const phase = events.slice(events.findLastIndex((item) => item.step === 'follow') + 1)
	const workers = new Map<number, ExplorationEvent>()
	for (const child of phase) {
		const pid = child.detail.pid
		if (child.step === 'child' && typeof pid === 'number' && pid > 1) workers.set(pid, child)
	}
	const left = endProcesses([...workers].map(([pid, child]) => ({ pid, born: recordedBirth(child) })))
	requireCondition(
		!left.length,
		`Workers of ${id} are still alive: ${left.join(', ')}. No replacement started.`,
		`Run checkmate explore show ${id} to review the interrupted test. Try again when its workers have ended.`
	)
}

export type StopRecord = { background?: boolean }

export function recordStop(store: Store, actor: string | undefined, input: StopInput & StopRecord): Reply {
	const id = input.explorationId
	const reason = input.reason?.trim() ?? ''
	const explorer = input.explorer
	return write(store, { actor, command: 'explore stop', subject: id, input }, (operationId, at, who) => {
		const row = explorationRow(store, id)
		const events = explorationEvents(store, id)
		const state = explorationState(events)
		requireCondition(
			startOf(events)?.path !== 'session',
			`Exploration ${id} runs in a session. The operator session owns its testers.`,
			'Stop the testers in the session.'
		)
		requireCondition(
			['starting', 'testing', 'recording', 'verifying', 'following', 'interrupted'].includes(state),
			`Exploration ${id} is ${state}. Only a running exploration can stop.`,
			`Run checkmate explore show ${id}.`
		)
		if (explorer !== undefined) {
			const launched = events.some((item) => item.step === 'launch' && item.explorer === explorer)
			requireCondition(
				launched,
				`Exploration ${id} has no running tester named ${explorer}.`,
				`Run checkmate explore status ${id} to read the testers.`
			)
			requireCondition(
				!testerStopOf(events, explorer) &&
					!events.some((item) => item.step === 'end' && item.explorer === explorer),
				`Tester ${explorer} of exploration ${id} has ended.`,
				`Run checkmate explore status ${id}.`
			)
		}
		addEvent(
			store,
			id,
			{
				step: 'stop',
				explorer: explorer ?? null,
				status: 'completed',
				detail: { actor: who, reason, was: state, ...(input.background ? { ending: true } : {}) },
			},
			operationId,
			at
		)
		return {
			reply: completed(id, {
				explorationId: id,
				planId: row.plan_id,
				explorer: explorer ?? null,
				was: state,
				reason,
				actor: who,
			}),
			subjects: [`exploration:${id}`, `plan:${row.plan_id}`],
		}
	})
}

function stoppedProcesses(events: ExplorationEvent[], explorer?: string) {
	const found = explorer === undefined ? events.findLast((item) => item.step === 'supervisor') : undefined
	const supervisor: Owned[] =
		typeof found?.detail.pid === 'number' ? [{ pid: found.detail.pid, born: recordedBirth(found) }] : []
	return { supervisor, children: childPids(events, explorer) }
}

export function stopPending(events: ExplorationEvent[], explorer: string | null = null) {
	const stop = events.findLast((item) => item.step === 'stop' && item.explorer === explorer)
	if (!stop?.detail.ending) return false
	const end = events
		.slice(events.lastIndexOf(stop) + 1)
		.find((item) => item.step === 'stop-end' && item.explorer === explorer)
	if (end) return false
	const { supervisor, children } = stoppedProcesses(events, explorer ?? undefined)
	return [...supervisor, ...children].some((item) => running(item.pid))
}

export function endStopped(store: Store, explorationId: string, explorer?: string) {
	const events = explorationEvents(store, explorationId)
	const { supervisor, children } = stoppedProcesses(events, explorer)
	const left = [...endProcesses(supervisor), ...endProcesses(children)].map((item) => item.pid)
	if (explorer === undefined) keepBrowserFolder(store, explorationId)
	return left
}

export function endInBackground(workspace: string, explorationId: string, explorer: string | undefined, env: Env) {
	const store = openStore(workspace)
	try {
		const left = endStopped(store, explorationId, explorer)
		event(store, env.CHECKMATE_ACTOR ?? 'checkmate', explorationId, {
			step: 'stop-end',
			explorer: explorer ?? null,
			status: left.length ? 'operational_error' : 'completed',
			detail: { left },
		})
	} finally {
		closeStore(store)
	}
}

export function startEnding(
	store: Store,
	explorationId: string,
	actor: string,
	explorer: string | undefined,
	env: Env
) {
	const folder = join(store.workspace, '.checkmate', 'tmp')
	mkdirSync(folder, { recursive: true })
	const log = openSync(join(folder, `explore-${explorationId}.log`), 'a')
	const child = spawn(
		process.execPath,
		[
			checkmateScript(),
			'explore',
			'end',
			explorationId,
			'--workspace',
			store.workspace,
			...(explorer ? ['--explorer', explorer] : []),
		],
		{ cwd: store.workspace, env: { ...env, CHECKMATE_ACTOR: actor }, detached: true, stdio: ['ignore', log, log] }
	)
	child.unref()
}

export function stopExploration(store: Store, actor: string | undefined, input: StopInput): Reply {
	const id = input.explorationId
	const explorer = input.explorer
	const reply = recordStop(store, actor, input)
	const left = endStopped(store, id, explorer)
	const kept = explorer === undefined && existsSync(join(store.workspace, workFolder(id))) ? workFolder(id) : null
	return {
		...reply,
		status: left.length ? 'operational_error' : 'completed',
		reasons: left.map((pid) => `Process ${pid} is still alive.`),
		data: {
			...reply.data,
			left,
			workFolder: kept,
			...(kept ? { note: 'Reports that were not recorded stay in the work folder.' } : {}),
			next: [retryCommand(store, id, startOf(explorationEvents(store, id)))],
		},
	}
}

function followState(events: ExplorationEvent[]) {
	const follow = events.findLastIndex((item) => item.step === 'follow')
	if (follow === -1) return null
	const later = events.slice(follow + 1)
	const ended = later.find((item) => item.step === 'followed')
	if (ended) return ended.status === 'completed' ? 'completed' : 'failed'
	if (stopOf(events)) return 'stopped'
	const supervisor = later.find((item) => item.step === 'supervisor')
	return supervisor && !running(supervisor.detail.pid) ? 'interrupted' : 'running'
}

export function stopOf(events: ExplorationEvent[]) {
	const follow = events.findLastIndex((item) => item.step === 'follow')
	return events.slice(follow + 1).find((item) => item.step === 'stop' && item.explorer === null)
}

function testerStopOf(events: ExplorationEvent[], explorer: string) {
	return events.find((item) => item.step === 'stop' && item.explorer === explorer)
}

export function pauseOf(events: ExplorationEvent[]) {
	const last = events.findLast((item) => item.step === 'pause' || item.step === 'resume')
	return last?.step === 'pause' ? (last.detail.reason as string) : null
}

export function explorationState(events: ExplorationEvent[]) {
	if (followState(events) === 'running') return 'following'
	const done = events.find((item) => item.step === 'done')
	if (done?.status === 'stopped') return 'stopped'
	if (done) return done.status === 'completed' ? 'completed' : 'failed'
	const supervisor = events.find((item) => item.step === 'supervisor')
	if (stopOf(events)) return 'stopped'
	if (supervisor && !running(supervisor.detail.pid)) return 'interrupted'
	if (!events.some((item) => item.step === 'start')) return 'open'
	if (!supervisor && startOf(events)?.path !== 'session') return 'starting'
	if (events.some((item) => item.step === 'merge')) return 'verifying'
	if (events.some((item) => item.step === 'record')) return 'recording'
	return 'testing'
}

function stopText(stop: ExplorationEvent) {
	const reason = stop.detail.reason
	return `Stopped by ${stop.detail.actor}${reason ? `: ${reason}` : '.'}`
}

function stopReason(events: ExplorationEvent[]) {
	const stop = stopOf(events)
	return stop ? stopText(stop) : null
}

function piExplorationDetails(detail: Record<string, unknown>): Record<string, unknown> {
	return {
		...detail,
		...(typeof detail.reason === 'string' ? { reason: piErrorText(detail.reason) } : {}),
		...(Array.isArray(detail.reasons) ? { reasons: detail.reasons.map(piErrorText).filter(Boolean) } : {}),
		...(Array.isArray(detail.stderr) ? { stderr: piStderr(detail.stderr.join('\n')) } : {}),
		...(Array.isArray(detail.skipped) ? { skipped: detail.skipped.map(piErrorText).filter(Boolean) } : {}),
	}
}

function observedModels(events: ExplorationEvent[]) {
	return [
		...new Set(
			events.flatMap(({ detail }) =>
				Array.isArray(detail.observedModels)
					? detail.observedModels.filter((model): model is string => typeof model === 'string')
					: []
			)
		),
	]
}

export function explorationStatus(store: Store, explorationId: string) {
	const row = explorationRow(store, explorationId)
	const raw = explorationEvents(store, explorationId)
	const launch = startOf(raw)
	const pi = launch?.context?.harness === 'pi'
	const events = pi
		? raw.map((item) =>
				['failed', 'operational_error', 'interrupted'].includes(item.status)
					? { ...item, detail: piExplorationDetails(item.detail) }
					: item
			)
		: raw
	const charter = JSON.parse(row.charter) as Charter
	const state = explorationState(events)
	const names = [...new Set(events.flatMap((item) => (item.explorer ? [item.explorer] : [])))]
	const runModels = observedModels(
		events.filter(
			({ explorer, step }) =>
				['rules', 'merge', 'verify'].includes(step) ||
				(step === 'end' && explorer && !launch?.testerModels?.[explorer])
		)
	)
	const explorers = names.map((explorer) => {
		const own = events.filter((item) => item.explorer === explorer)
		const last = (step: string) => own.filter((item) => item.step === step).at(-1)
		const end = last('end')
		const record = last('record')
		const models = observedModels(own.filter(({ step }) => step === 'end' || step === 'follow-turn'))
		const selection = launch?.testerModels?.[explorer] ?? launch?.model ?? null
		const stop =
			own.find((item) => item.step === 'stop') ?? (end?.status === 'completed' ? undefined : stopOf(events))
		return {
			explorer,
			actor: explorerActor(explorer),
			model: models.length === 1 ? models[0] : selection,
			...(models.length ? { observedModels: models } : {}),
			...explorationCost(own),
			session: (last('launch')?.detail.session ??
				record?.detail.session ??
				own.findLast((item) => item.detail.agent)?.detail.agent ??
				null) as string | null,
			ended: stop ? 'stopped' : (end?.status ?? null),
			recorded: record?.status ?? null,
			saved: (record?.detail.saved ?? 0) as number,
			reason: (stop ? stopText(stop) : (end?.detail.reason ?? record?.detail.reasons ?? null)) as unknown,
			hint: (end?.detail.hint ??
				(pi &&
				typeof end?.detail.reason === 'string' &&
				authenticationFailed({ failure: ['operational_error', end.detail.reason] })
					? piAuthenticationHint
					: null)) as string | null,
			stderr: (end?.detail.stderr ?? []) as string[],
			strayBasis: 'workspace_listing',
			stray: [
				...new Set(
					own.filter((item) => item.step === 'stray').flatMap((item) => item.detail.names as string[])
				),
			],
		}
	})
	const done = events.find((item) => item.step === 'done')
	const followed = events.filter((item) => item.step === 'followed').at(-1)
	const follow = followState(events)
	return {
		...explorationCost(events),
		explorationId: row.exploration_id,
		planId: row.plan_id,
		planRevision: row.plan_revision,
		targetId: row.target_id,
		targetRevision: row.target_revision,
		build: row.build,
		mode: row.mode,
		instanceId: row.instance_id,
		state,
		path: launch ? (launch.path ?? 'process') : null,
		paused: ['completed', 'failed'].includes(state) ? null : pauseOf(events),
		level: launch?.level ?? null,
		explorerCount: launch?.explorers || explorers.length,
		model: runModels.length === 1 ? runModels[0] : (launch?.model ?? null),
		...(runModels.length ? { observedModels: runModels } : {}),
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
				? stopReason(events)
				: follow === 'interrupted'
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
			(['failed', 'stopped', 'interrupted'].includes(state) ||
				['failed', 'stopped', 'interrupted'].includes(follow ?? '')) &&
			existsSync(join(store.workspace, workFolder(row.exploration_id)))
				? workFolder(row.exploration_id)
				: null,
		reason: (done?.detail.reason ??
			(state === 'stopped'
				? stopReason(events)
				: state === 'interrupted'
					? 'The supervisor stopped before the end.'
					: null)) as string | null,
	}
}

// A paused exploration waits for the person, so waiting on it only burns the timeout.
function pausedWait(explorationId: string, status: ReturnType<typeof explorationStatus>): Reply {
	const next = status.path === 'session' ? 'next' : 'wait'
	return {
		status: 'needs_decision',
		subject: explorationId,
		reasons: [`Exploration ${explorationId} is paused: ${status.paused}`],
		hint: `Get the answer from the person. Then run checkmate explore ${next} ${explorationId}.`,
		data: { ...status, outcome: 'paused' },
	}
}

export function waitExploration(store: Store, explorationId: string, timeoutSeconds: number): Reply {
	const until = Date.now() + timeoutSeconds * 1000
	for (;;) {
		const status = explorationStatus(store, explorationId)
		const ended = ['completed', 'failed', 'stopped', 'interrupted', 'open'].includes(status.state)
		if (!ended && status.paused) return pausedWait(explorationId, status)
		if (ended || Date.now() >= until) {
			const outcome = status.state === 'completed' ? 'done' : ended ? 'failed' : 'timeout'
			const events = explorationEvents(store, explorationId)
			const done = events.find((item) => item.step === 'done')
			const retry =
				status.state === 'failed' && done?.detail.recorded === 0
					? retryCommand(store, explorationId, startOf(events))
					: undefined
			const hints = [
				...status.explorers.flatMap((item) => (item.hint ? [item.hint] : [])),
				...(status.doneHint ? [status.doneHint] : []),
				...(outcome === 'done'
					? [
							`Next: checkmate status ${status.planId}. If it says waitsOn=oracle, stop here and report its open questions with the command that answers them. Do not wait again, search files, or schedule a wakeup.`,
						]
					: []),
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
				data: { ...status, outcome, ...(retry ? { next: [retry] } : {}) },
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
		retests: own
			.filter((entry) => entry.kind === 'verdict')
			.map(({ id, actor, defect, result, saw, evidence }) => ({
				id,
				actor,
				defect: defect!,
				result: result!,
				saw: saw ?? null,
				evidence: evidence ?? [],
			})),
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
