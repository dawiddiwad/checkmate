import type { Reply, Store } from './store.ts'
import type { ExplorationEvent } from './explorations.ts'
import type { Launch } from './explorers.ts'
import type { Carried } from './recorder.ts'
import { completed, write } from './store.ts'
import { requireCondition, requireWellFormed, shellWord } from './contracts.ts'
import { addEvent, exploration, explorationEvents, workFolder } from './explorations.ts'
import { explorationRow, logEntries } from './journal.ts'
import {
	explorerBrief,
	followBrief,
	followEntriesText,
	mergeAgainPrompt,
	mergerPrompt,
	repairPrompt,
	rulesPrompt,
	rulesRepairPrompt,
	verifierBrief,
	verifierRepairPrompt,
} from './briefs.ts'
import type { Rule } from './rules.ts'
import { checkedRules, ruleSources, rulesNeeded, saveRules } from './rules.ts'
import {
	entryValues,
	explorerNames,
	keepWorkFiles,
	keepToolFolders,
	logMerge,
	mergeInput,
	pauseOf,
	removeWork,
	startOf,
	unplacedReports,
	verifiedEntries,
	verifierActor,
	verifyInput,
} from './explorers.ts'
import { lastEntry, recordAnswer, recordTask } from './recorder.ts'
import { firstRevision } from './testRevision.ts'
import { replyArray } from './sessions.ts'
import { requireValidRecipes } from './recipes.ts'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const testerAgent = 'checkmate:tester'
export const clerkAgent = 'checkmate:clerk'
export const doneSteps = ['study', 'test', 'record', 'follow', 'rules', 'merge', 'verify'] as const
const clerkNames = ['rules', 'merge', 'verify']

type FollowPlan = {
	answers: string[]
	questions: Array<{ question: string; answer: string }>
	after: number
	seconds: number
}
type Phase = { follow: FollowPlan | null; events: ExplorationEvent[]; name: string }
type Action = {
	action: 'start' | 'message'
	explorer: string | null
	name: string
	step: string
	to: string
	task: string
	answer?: string
	text: string
	extra?: Record<string, unknown>
}
export type DoneInput = {
	explorationId: string
	name: string
	step: string
	agent?: string
	failed?: string
	activity?: string
}

const isStep = (item: ExplorationEvent) => item.step !== 'bind' && item.step !== 'started'
const ownerOf = (item: ExplorationEvent) => item.explorer ?? (item.detail.name as string | undefined)

function agentOf(events: ExplorationEvent[], name: string) {
	return events.findLast((item) => ownerOf(item) === name && typeof item.detail.agent === 'string')?.detail.agent as
		string | undefined
}

function sessionLaunch(events: ExplorationEvent[], explorationId: string): Launch {
	const launch = startOf(events)
	requireCondition(
		launch?.path === 'session',
		`Exploration ${explorationId} does not run in a session. Its testers run as processes.`,
		`Run checkmate explore wait ${explorationId}.`
	)
	return launch
}

function phaseOf(events: ExplorationEvent[]): Phase | null {
	const index = events.findLastIndex((item) => item.step === 'follow')
	if (index !== -1 && !events.slice(index + 1).some((item) => item.step === 'followed'))
		return {
			follow: events[index].detail as FollowPlan,
			events: events.slice(index + 1),
			name: `follow-${events.filter((item) => item.step === 'follow').length}`,
		}
	if (events.some((item) => item.step === 'done')) return null
	return { follow: null, events, name: 'test' }
}

function followTesters(events: ExplorationEvent[], launch: Launch) {
	return explorerNames(launch.explorers).map((explorer) => {
		const own = events.filter((item) => item.explorer === explorer)
		const agent = agentOf(own, explorer)
		const skipped = !agent
			? `${explorer} has no agent.`
			: own.findLast((item) => item.step === 'end')?.detail.turn === 'study'
				? `The agent of ${explorer} ended in its study step.`
				: undefined
		return { explorer, skipped }
	})
}

function testerDue(own: ExplorationEvent[], first: 'study' | 'follow') {
	const last = own.filter(isStep).at(-1)
	if (!last) return first
	if (last.step === 'action') return 'running'
	if (last.step === 'turn') return 'test'
	if (['end', 'follow-turn'].includes(last.step) && last.status === 'completed') return 'record'
	if (last.step === 'repair') return 'repair'
	return 'settled'
}

function stageDue(own: ExplorationEvent[], round: string, needed: () => boolean) {
	const last = own.filter(isStep).at(-1)
	if (!last) return needed() ? round : 'settled'
	if (last.step === 'action') return 'running'
	if (last.step.endsWith('-round')) return last.detail.round as string
	return 'settled'
}

function testerAction(store: Store, explorationId: string, explorer: string, due: string, phase: Phase): Action {
	const folder = workFolder(explorationId, explorer)
	const own = phase.events.filter((item) => item.explorer === explorer)
	const agent = agentOf(explorationEvents(store, explorationId), explorer)!
	const answer = `${folder}/entries.json`
	const action = (
		step: string,
		file: string,
		text: string,
		extra?: Record<string, unknown>,
		answered = false
	): Action => ({
		action: step === 'study' ? 'start' : 'message',
		explorer,
		name: explorer,
		step,
		to: step === 'study' ? testerAgent : agent,
		task: `${folder}/${file}`,
		...(answered ? { answer } : {}),
		text,
		extra,
	})
	if (due === 'follow')
		return action(
			'follow',
			'task-follow.md',
			`${followBrief(phase.follow!.questions, folder, phase.follow!.seconds)}\n\n${followEntriesText(answer)}`,
			{ round: 1, after: lastEntry(store) },
			true
		)
	if (due === 'record')
		return action(
			'record',
			'task-record.md',
			recordTask(store, explorationId, explorer, answer),
			{ round: 1, after: lastEntry(store) },
			true
		)
	if (due === 'repair') {
		const repair = own.findLast((item) => item.step === 'repair')!.detail.carried as Carried
		const first = own.findLast((item) => item.step === 'action' && item.detail.round === 1)!
		return action(
			'record',
			'task-repair.md',
			repairPrompt(repair.refusals, answer),
			{ round: 2, after: first.detail.after },
			true
		)
	}
	const opened = exploration(store, explorationId)
	const launch = startOf(explorationEvents(store, explorationId))!
	const { session, dataPrefix } = launch.toolIdentities[explorer]
	const brief = explorerBrief(
		store.workspace,
		{ ...opened.charter, dataRules: launch.dataRules },
		entryValues(store, explorationId),
		dataPrefix,
		folder,
		{
			study: launch.studySeconds,
			test: launch.testSeconds,
		},
		session
	)
	return due === 'test' ? action('test', 'task-test.md', brief.test) : action('study', 'task-study.md', brief.study)
}

function rulesAction(store: Store, explorationId: string, round: string, phase: Phase): Action {
	const folder = `${workFolder(explorationId)}/rules`
	const answer = `${folder}/answer.json`
	const own = phase.events.filter((item) => ownerOf(item) === 'rules')
	const action = (file: string, text: string): Action => ({
		action: round === 'rules' ? 'start' : 'message',
		explorer: null,
		name: 'rules',
		step: 'rules',
		to: round === 'rules' ? clerkAgent : agentOf(own, 'rules')!,
		task: `${folder}/${file}`,
		answer,
		text,
		extra: { round },
	})
	if (round === 'repair') {
		const last = own.findLast((item) => item.step === 'rules-round')!
		return action('task-repair.md', rulesRepairPrompt(last.detail.refusals as string[], answer))
	}
	const opened = exploration(store, explorationId)
	return action('task.md', rulesPrompt(opened.charter.goal, ruleSources(store, opened.plan_id), answer))
}

function mergeAction(store: Store, explorationId: string, round: string, phase: Phase): Action {
	const folder = `${workFolder(explorationId)}/merge`
	const answer = `${folder}/answer.json`
	const own = phase.events.filter((item) => ownerOf(item) === 'merge')
	const last = own.findLast((item) => item.step === 'merge-round')
	const action = (file: string, text: string, extra?: Record<string, unknown>): Action => ({
		action: round === 'merge' ? 'start' : 'message',
		explorer: null,
		name: 'merge',
		step: 'merge',
		to: round === 'merge' ? clerkAgent : agentOf(own, 'merge')!,
		task: `${folder}/${file}`,
		answer,
		text,
		extra: { round, ...extra },
	})
	if (round === 'repair') return action('task-repair.md', repairPrompt(last!.detail.refusals as string[], answer))
	if (round === 'again')
		return action(
			'task-again.md',
			mergeAgainPrompt(last!.detail.unplaced as Parameters<typeof mergeAgainPrompt>[0], answer)
		)
	const input = mergeInput(store, explorationId, phase.follow?.after ?? 0)!
	return action(
		'task.md',
		mergerPrompt(input.build, input.defects, input.groups, input.questions, input.earlier, answer),
		{ reports: input.count }
	)
}

function verifyAction(store: Store, explorationId: string, round: string, phase: Phase): Action {
	const folder = `${workFolder(explorationId)}/verify`
	const answer = `${folder}/answer.json`
	const own = phase.events.filter((item) => ownerOf(item) === 'verify')
	const action = (file: string, text: string, extra?: Record<string, unknown>): Action => ({
		action: round === 'verify' ? 'start' : 'message',
		explorer: null,
		name: 'verify',
		step: 'verify',
		to: round === 'verify' ? testerAgent : agentOf(own, 'verify')!,
		task: `${folder}/${file}`,
		answer,
		text,
		extra: { round, ...extra },
	})
	if (round === 'repair') return action('task-repair.md', verifierRepairPrompt(answer))
	const input = verifyInput(store, explorationId, phase.follow?.after ?? 0)!
	return action(
		'task.md',
		verifierBrief(input.items, input.entries, input.operations, input.dataRules, input.dataPrefix, answer),
		{
			ids: input.items.map((item) => item.id),
		}
	)
}

function promptOf(action: Action) {
	return action.name === 'merge' || action.name === 'rules'
		? `Read ${action.task} and write your answer to ${action.answer}.`
		: `Read ${action.task} and do what it says.`
}

function descriptionOf(explorationId: string, action: Action) {
	return `${explorationId} ${action.name} ${action.step}`
}

function lineOf(explorationId: string, action: Action) {
	const description = action.action === 'start' ? ` description="${descriptionOf(explorationId, action)}"` : ''
	return `${action.action} ${action.name} ${action.step} agent=${action.to}${description} prompt="${promptOf(action)}"`
}

function writeFile(store: Store, path: string, text: string) {
	const full = join(store.workspace, path)
	mkdirSync(dirname(full), { recursive: true })
	writeFileSync(full, text.endsWith('\n') ? text : `${text}\n`)
}

function answerNext(
	store: Store,
	actor: string | undefined,
	explorationId: string,
	actions: Action[],
	word: 'wait' | 'finished'
) {
	return write(
		store,
		{ actor, command: 'explore next', subject: explorationId, input: { explorationId } },
		(operationId, at) => {
			for (const action of actions) {
				writeFile(store, action.task, action.text.trimEnd())
				if (action.answer) rmSync(join(store.workspace, action.answer), { force: true })
				addEvent(
					store,
					explorationId,
					{
						step: 'action',
						explorer: action.explorer,
						status: 'started',
						detail: {
							name: action.name,
							step: action.step,
							to: action.to,
							task: action.task,
							prompt: promptOf(action),
							...action.extra,
						},
					},
					operationId,
					at
				)
			}
			const lines = actions.length
				? actions.map((action) => ({
						action: action.action,
						name: action.name,
						step: action.step,
						agent: action.to,
						...(action.action === 'start' ? { description: descriptionOf(explorationId, action) } : {}),
						prompt: promptOf(action),
						line: lineOf(explorationId, action),
					}))
				: [{ action: word, line: word }]
			const events = explorationEvents(store, explorationId)
			const ended = [...events].reverse().find((item) => ['done', 'followed'].includes(item.step))
			const failed = word === 'finished' && ended?.status !== 'completed'
			return {
				reply: {
					status: failed ? 'operational_error' : 'completed',
					subject: explorationId,
					reasons: failed ? [String(ended?.detail.reason ?? `Exploration ${explorationId} failed.`)] : [],
					...(failed && ended?.detail.hint
						? { hint: String(ended.detail.hint) }
						: actions.length
							? {
									hint: `When you have sent these actions, run checkmate explore started ${explorationId} ${actions.map((action) => action.name).join(' ')}.`,
								}
							: {}),
					data: { explorationId, actions: lines },
				},
				subjects: [`exploration:${explorationId}`],
			}
		}
	)
}

function addOutcome(
	store: Store,
	actor: string | undefined,
	explorationId: string,
	item: Omit<ExplorationEvent, 'at'>,
	also: (operationId: string) => void = () => {}
) {
	return write(store, { actor, command: 'explore done', subject: explorationId, input: item }, (operationId, at) => {
		also(operationId)
		addEvent(store, explorationId, item, operationId, at)
		return {
			reply: completed(explorationId, {
				explorationId,
				name: ownerOf({ ...item, at }),
				event: item.step,
				state: item.status,
				...item.detail,
				next: [`checkmate explore next ${explorationId}`],
			}),
			subjects: [`exploration:${explorationId}`],
		}
	})
}

function finishPhase(store: Store, actor: string, explorationId: string, phase: Phase, launch: Launch) {
	const recorded = phase.events.filter((item) => item.step === 'record' && item.status === 'completed').length
	if (recorded) removeWork(store, explorationId)
	else keepToolFolders(store, explorationId)
	if (!phase.follow) {
		const revision = recorded
			? firstRevision(store, actor, explorationRow(store, explorationId).plan_id, explorationId)
			: null
		addOutcome(store, actor, explorationId, {
			step: 'done',
			explorer: null,
			status: recorded ? 'completed' : 'failed',
			detail: {
				recorded,
				...(recorded ? {} : { reason: 'No explorer session was recorded.' }),
				...(revision?.reason ? { revisionReason: revision.reason } : {}),
			},
		})
		return
	}
	const events = explorationEvents(store, explorationId)
	const reached = phase.events.filter((item) => item.step === 'follow-turn' && item.status === 'completed').length
	const row = explorationRow(store, explorationId)
	addOutcome(store, actor, explorationId, {
		step: 'followed',
		explorer: null,
		status: recorded ? 'completed' : 'failed',
		detail: {
			recorded,
			answers: phase.follow.answers,
			skipped: [
				...followTesters(events, launch).flatMap((item) => (item.skipped ? [item.skipped] : [])),
				...phase.events
					.filter((item) => item.step === 'follow-turn' && item.status !== 'completed')
					.map((item) => `The agent of ${item.explorer} could not be reached: ${String(item.detail.reason)}`),
			],
			...(recorded
				? {}
				: reached
					? { reason: 'No explorer session of the follow-up was recorded.' }
					: {
							reason: 'No tester of the follow-up could be reached.',
							hint: `The testers ran in a session that ended. Run checkmate test ${row.plan_id} --build ${shellWord(row.build)} --session again. The answers reach the new testers through the known-state file.`,
						}),
		},
	})
}

function clearPause(store: Store, actor: string | undefined, explorationId: string, events: ExplorationEvent[]) {
	if (pauseOf(events))
		addOutcome(store, actor, explorationId, { step: 'resume', explorer: null, status: 'completed', detail: {} })
}

export function pauseRun(store: Store, actor: string | undefined, explorationId: string, reason: string): Reply {
	const events = explorationEvents(store, explorationId)
	sessionLaunch(events, explorationId)
	requireCondition(
		phaseOf(events),
		`Exploration ${explorationId} has ended. There is nothing to pause.`,
		`Run checkmate explore show ${explorationId}.`
	)
	requireWellFormed(reason.trim(), 'Give the reason of the pause with --reason, in one line.')
	return addOutcome(store, actor, explorationId, {
		step: 'pause',
		explorer: null,
		status: 'started',
		detail: { reason: reason.trim(), waitsOn: 'oracle' },
	})
}

export function stepsStarted(store: Store, actor: string | undefined, explorationId: string, names: string[]): Reply {
	const events = explorationEvents(store, explorationId)
	sessionLaunch(events, explorationId)
	requireValidRecipes(
		store.workspace,
		exploration(store, explorationId).charter.tools.map(({ name }) => name)
	)
	clearPause(store, actor, explorationId, events)
	const phase = phaseOf(events)
	const given = (name: string) => {
		const last = (phase?.events ?? []).filter((item) => ownerOf(item) === name && item.step !== 'bind').at(-1)
		return last?.step === 'action' ? last : undefined
	}
	const wrong = names.filter((name) => !given(name))
	requireCondition(
		!wrong.length,
		`No given step waits to start for ${wrong.join(', ')} in exploration ${explorationId}.`,
		runningSteps(phase?.events ?? []).length
			? `The steps that run: ${runningSteps(phase!.events).join(', ')}. Give only the names of the actions that you sent.`
			: `Run checkmate explore next ${explorationId}.`
	)
	return write(
		store,
		{ actor, command: 'explore started', subject: explorationId, input: { explorationId, names } },
		(operationId, at) => {
			for (const name of names) {
				const action = given(name)!
				addEvent(
					store,
					explorationId,
					{
						step: 'started',
						explorer: action.explorer,
						status: 'started',
						detail: { name, step: action.detail.step },
					},
					operationId,
					at
				)
			}
			return {
				reply: completed(explorationId, { explorationId, started: names }),
				subjects: [`exploration:${explorationId}`],
			}
		}
	)
}

export function nextActions(store: Store, actor: string | undefined, explorationId: string): Reply {
	const events = explorationEvents(store, explorationId)
	const launch = sessionLaunch(events, explorationId)
	clearPause(store, actor, explorationId, events)
	const phase = phaseOf(events)
	if (!phase) return answerNext(store, actor, explorationId, [], 'finished')
	if (!phase.follow) {
		const owned = phase.events.filter((item) => ownerOf(item) === 'rules' && item.explorer === null)
		const planId = explorationRow(store, explorationId).plan_id
		const rules = stageDue(owned, 'rules', () => launch.explorers > 0 && rulesNeeded(store, planId))
		if (rules === 'running') return answerNext(store, actor, explorationId, [], 'wait')
		if (rules !== 'settled')
			return answerNext(store, actor, explorationId, [rulesAction(store, explorationId, rules, phase)], 'wait')
	}
	const testers = phase.follow
		? followTesters(events, launch).flatMap((item) => (item.skipped ? [] : [item.explorer]))
		: explorerNames(launch.explorers)
	const steps = testers.map((explorer) => ({
		explorer,
		due: testerDue(
			phase.events.filter((item) => item.explorer === explorer),
			phase.follow ? 'follow' : 'study'
		),
	}))
	if (steps.some((item) => item.due !== 'settled'))
		return answerNext(
			store,
			actor,
			explorationId,
			steps
				.filter((item) => !['running', 'settled'].includes(item.due))
				.map((item) => testerAction(store, explorationId, item.explorer, item.due, phase)),
			'wait'
		)
	const after = phase.follow?.after ?? 0
	if (phase.events.some((item) => item.step === 'record' && item.status === 'completed')) {
		const owned = (name: string) => phase.events.filter((item) => ownerOf(item) === name && item.explorer === null)
		const merge = stageDue(owned('merge'), 'merge', () => mergeInput(store, explorationId, after) !== null)
		if (merge === 'running') return answerNext(store, actor, explorationId, [], 'wait')
		if (merge !== 'settled')
			return answerNext(store, actor, explorationId, [mergeAction(store, explorationId, merge, phase)], 'wait')
		const verify = stageDue(
			owned('verify'),
			'verify',
			() => launch.verifier && verifyInput(store, explorationId, after) !== null
		)
		if (verify === 'running') return answerNext(store, actor, explorationId, [], 'wait')
		if (verify !== 'settled')
			return answerNext(store, actor, explorationId, [verifyAction(store, explorationId, verify, phase)], 'wait')
	}
	finishPhase(store, actor!, explorationId, phase, launch)
	return answerNext(store, actor, explorationId, [], 'finished')
}

function readText(store: Store, path: string) {
	try {
		return readFileSync(join(store.workspace, path), 'utf8')
	} catch {
		return undefined
	}
}

function rulesDone(
	store: Store,
	actor: string | undefined,
	explorationId: string,
	own: ExplorationEvent[],
	base: Record<string, unknown>,
	failed: string | undefined
) {
	const round = own.at(-1)!.detail.round as string
	const plan = explorationRow(store, explorationId).plan_id
	const names = ruleSources(store, plan)
		.filter((source) => source.text !== null)
		.map((source) => source.name)
	const answer = `${workFolder(explorationId)}/rules/answer.json`
	const checked = failed ? { rules: [], refusals: [] } : checkedRules(replyArray(readText(store, answer)), names)
	if (!failed && round === 'rules' && checked.refusals.length)
		return addOutcome(store, actor, explorationId, {
			step: 'rules-round',
			explorer: null,
			status: 'started',
			detail: { name: 'rules', ...base, round: 'repair', refusals: checked.refusals, rules: checked.rules },
		})
	const earlier = own.findLast((item) => item.step === 'rules-round')?.detail.rules as Rule[] | undefined
	const rules = checked.rules.length ? checked.rules : (earlier ?? [])
	return addOutcome(
		store,
		actor,
		explorationId,
		{
			step: 'rules',
			explorer: null,
			status: rules.length ? 'completed' : 'operational_error',
			detail: {
				name: 'rules',
				...base,
				rules: rules.length,
				refused: checked.refusals.length,
				...(failed || checked.refusals.length ? { reason: failed ?? checked.refusals.join(' ') } : {}),
			},
		},
		(operationId) => {
			if (rules.length && rulesNeeded(store, plan)) saveRules(store, operationId, plan, rules, 'derived')
		}
	)
}

function mergeDone(
	store: Store,
	actor: string | undefined,
	explorationId: string,
	own: ExplorationEvent[],
	base: Record<string, unknown>,
	failed: string | undefined,
	after: number
) {
	const round = own.at(-1)!.detail.round as string
	const answer = `${workFolder(explorationId)}/merge/answer.json`
	const refusals = failed ? [] : logMerge(store, explorationId, replyArray(readText(store, answer)))
	const outcome = (step: string, status: string, detail: Record<string, unknown>) =>
		addOutcome(store, actor, explorationId, {
			step,
			explorer: null,
			status,
			detail: { name: 'merge', ...base, ...detail },
		})
	if (!failed && round === 'merge' && refusals.length)
		return outcome('merge-round', 'started', { round: 'repair', refusals })
	const unplaced = failed || round === 'again' ? [] : unplacedReports(store, explorationId, after)
	if (unplaced.length)
		return outcome('merge-round', 'started', { round: 'again', unplaced, refused: refusals.length })
	const carried =
		round === 'again' ? (own.findLast((item) => item.step === 'merge-round')!.detail.refused as number) : 0
	const first = own.find((item) => item.step === 'action')!
	return outcome('merge', failed ? 'operational_error' : 'completed', {
		reports: first.detail.reports,
		refused: carried + refusals.length,
	})
}

function verifyDone(
	store: Store,
	actor: string | undefined,
	explorationId: string,
	own: ExplorationEvent[],
	base: Record<string, unknown>,
	failed: string | undefined
) {
	const round = own.at(-1)!.detail.round as string
	const first = own.find((item) => item.step === 'action')!
	const ids = new Set(first.detail.ids as string[])
	const answer = `${workFolder(explorationId)}/verify/answer.json`
	const { observations, refusals } = verifiedEntries(replyArray(failed ? undefined : readText(store, answer)), ids)
	const outcome = (step: string, status: string, detail: Record<string, unknown>) =>
		addOutcome(store, actor, explorationId, {
			step,
			explorer: null,
			status,
			detail: { name: 'verify', ...base, ...detail },
		})
	if (!failed && !observations.length && round === 'verify')
		return outcome('verify-round', 'started', { round: 'repair' })
	if (observations.length) logEntries(store, verifierActor, { explorationId, entries: observations })
	return outcome(
		'verify',
		observations.length ? 'completed' : failed && round === 'verify' ? 'operational_error' : 'skipped',
		{
			items: ids.size,
			verified: observations.length,
			...(refusals.length ? { reason: failed ?? refusals.join(' ') } : {}),
		}
	)
}

function recordDone(
	store: Store,
	actor: string | undefined,
	explorationId: string,
	explorer: string,
	own: ExplorationEvent[],
	base: Record<string, unknown>,
	failed: string | undefined,
	phase: Phase
) {
	const last = own.at(-1)!
	const recorded = recordAnswer(store, {
		explorationId,
		explorer,
		answer: `${workFolder(explorationId, explorer)}/entries.json`,
		after: last.detail.after as number,
		round: last.detail.round as number,
		carried: own.findLast((item) => item.step === 'repair')?.detail.carried as Carried | undefined,
		failed,
	})
	if (recorded.repair)
		return addOutcome(store, actor, explorationId, {
			step: 'repair',
			explorer,
			status: 'started',
			detail: { ...base, carried: recorded.carried },
		})
	const reply = addOutcome(store, actor, explorationId, {
		step: 'record',
		explorer,
		status: recorded.status!,
		detail: { ...base, ...recorded.detail },
	})
	keepWorkFiles(store, actor!, explorationId, explorer, phase.name)
	return reply
}

function lastStep(events: ExplorationEvent[], name: string) {
	return events.findLast((item) => ownerOf(item) === name && item.step === 'action')?.detail.step as
		string | undefined
}

function checkBinding(events: ExplorationEvent[], explorationId: string, name: string, agent: string) {
	const owners = [...new Set(events.flatMap((item) => (ownerOf(item) ? [ownerOf(item)!] : [])))]
	const other = owners.find((owner) => owner !== name && agentOf(events, owner) === agent)
	requireCondition(
		!other,
		`Agent ${agent} is bound to ${other} in exploration ${explorationId}, not to ${name}.`,
		`Give the Agent receipt ID for the assigned task ${explorationId} ${name}.`
	)
}

function runningSteps(events: ExplorationEvent[]) {
	const owners = [...new Set(events.flatMap((item) => (ownerOf(item) ? [ownerOf(item)!] : [])))]
	return owners.flatMap((owner) => {
		const last = events.filter((item) => ownerOf(item) === owner && isStep(item)).at(-1)
		return last?.step === 'action' ? [`${owner} ${String(last.detail.step)}`] : []
	})
}

export function stepDone(store: Store, actor: string | undefined, input: DoneInput): Reply {
	const { explorationId, name, step, failed } = input
	const events = explorationEvents(store, explorationId)
	sessionLaunch(events, explorationId)
	clearPause(store, actor, explorationId, events)
	const phase = phaseOf(events)
	const own = (phase?.events ?? []).filter((item) => ownerOf(item) === name && isStep(item))
	const last = own.at(-1)
	if (input.agent) checkBinding(events, explorationId, name, input.agent)
	const tester = !clerkNames.includes(name)
	if (tester && input.agent && last && last.step !== 'action' && lastStep(own, name) === step)
		return addOutcome(store, actor, explorationId, {
			step: 'bind',
			explorer: name,
			status: 'completed',
			detail: { agent: input.agent, step, ...(input.activity ? { activity: input.activity } : {}) },
		})
	const running = runningSteps(phase?.events ?? [])
	requireCondition(
		last?.step === 'action' && last.detail.step === step,
		`No ${step} step of ${name} runs in exploration ${explorationId}.`,
		running.length
			? `The steps that run: ${running.join(', ')}. Correct the name or the step, and run explore done again.`
			: `Run checkmate explore next ${explorationId}, and carry out its actions.`
	)
	const artifact = step === 'test' ? 'report.md' : step === 'follow' ? 'follow-up-report.md' : undefined
	requireCondition(
		!(failed && tester && artifact && existsSync(join(store.workspace, workFolder(explorationId, name), artifact))),
		`The tester saved ${artifact}. A completed test with a product defect is not an agent failure.`,
		'Record the completed step without failure. Checkmate records product defects from the tester report.'
	)
	const agent = input.agent ?? agentOf(tester ? events : own, name)
	requireWellFormed(agent || failed, 'Give --agent with the agent ID that the Agent tool returned.')
	const base = {
		...(agent ? { agent } : {}),
		activity: input.activity ?? (failed ? `${step} failed: ${failed}` : `${step} ended`),
		...(failed ? { reason: failed } : {}),
	}
	if (name === 'rules') return rulesDone(store, actor, explorationId, own, base, failed)
	if (name === 'merge') return mergeDone(store, actor, explorationId, own, base, failed, phase!.follow?.after ?? 0)
	if (name === 'verify') return verifyDone(store, actor, explorationId, own, base, failed)
	if (step === 'record') return recordDone(store, actor, explorationId, name, own, base, failed, phase!)
	if (step === 'follow' && !failed) {
		addOutcome(store, actor, explorationId, {
			step: 'follow-turn',
			explorer: name,
			status: 'completed',
			detail: base,
		})
		return recordDone(store, actor, explorationId, name, own, base, failed, phase!)
	}
	const status = failed ? 'operational_error' : 'completed'
	const item =
		step === 'study' && !failed
			? { step: 'turn', status: 'started', detail: { ...base, turn: 'test' } }
			: step === 'follow'
				? { step: 'follow-turn', status, detail: base }
				: { step: 'end', status, detail: { ...base, ...(failed ? { turn: step } : {}) } }
	const reply = addOutcome(store, actor, explorationId, { ...item, explorer: name })
	if (failed) keepWorkFiles(store, actor!, explorationId, name, phase!.name)
	return reply
}
