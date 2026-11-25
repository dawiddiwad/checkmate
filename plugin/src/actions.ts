import type { Actions } from './types.ts'
import type { Reply, Store } from './store.ts'
import type { Env } from './sessions.ts'
import { Refusal, requireWellFormed, revisionReference, schemaProblems } from './contracts.ts'
import { completed } from './store.ts'
import { replaceInstance, setupTarget, showTarget, targetList, targetRevision } from './targets.ts'
import {
	answerGap,
	editPlan,
	openPlan,
	patchPlan,
	planRevision,
	revisePlan,
	savePlan,
	showPending,
	showPlanRequest,
} from './plans.ts'
import {
	beginRun,
	checkAssertion,
	closeTest,
	finishRun,
	recordFinding,
	recordGap,
	resumeRun,
	runState,
} from './runs.ts'
import { inbox, planStatus, rejectionLines, runDetail, runGate } from './views.ts'
import { selectedHarness } from './pi.ts'
import { ruleTokens, testerRulesText, workspaceEnv } from './settings.ts'
import { runTest } from './modes.ts'
import { explorationReport, explorationStatus, startFollow, waitExploration } from './explorers.ts'
import { nextActions, pauseRun, stepDone, stepsStarted } from './agents.ts'
import { dataRules } from './resets.ts'

export type ActionName = keyof Actions

// The name a host session calls an action tool by. Claude Code adds its own mcp__plugin_checkmate_actions__ prefix.
export function toolName(name: ActionName) {
	return `checkmate_${name}`
}

type ActionContext = {
	actor: string | undefined
	env: Env
	launch?: { allow: string[]; claudeArgs: string[]; session?: boolean }
}

// A begun or resumed run tells its agent why an earlier run that holds the tests of this run was rejected.
function withRejections(store: Store, reply: Reply): Reply {
	if (reply.status !== 'completed') return reply
	const rejections = rejectionLines(store, reply.subject)
	return rejections.length ? { ...reply, data: { ...reply.data, rejections } } : reply
}

const handlers: {
	[Name in Exclude<ActionName, 'delegate_work'>]: (
		store: Store,
		input: NonNullable<Actions[Name]>,
		context: ActionContext
	) => Reply
} = {
	setup: (store, input, { actor, env }) => setupTarget(store, actor, { ...input, env }),
	replace_instance: (store, input, { actor }) => replaceInstance(store, actor, input),
	list_targets: (store) => completed('targets', { targets: targetList(store) }),
	show_target: (store, input) => showTarget(store, input.reference, input.instance),
	open_plan: (store, input, { actor }) => {
		const target = revisionReference(input.target, 'target')
		const revision = targetRevision(store, target.id, target.revision).revision
		return openPlan(store, actor, { ...input, target: `${target.id}@${revision}` })
	},
	read_plan_request: (store, input) => showPlanRequest(store, input.planId),
	save_plan: (store, input, { actor }) => savePlan(store, actor, input),
	edit_plan: (store, input, { actor }) =>
		input.patch === undefined
			? editPlan(store, actor, { ...input, candidate: input.candidate })
			: patchPlan(store, actor, { ...input, patch: input.patch }),
	read_pending: (store, input) => showPending(store, input.planId),
	revise_plan: (store, input, { actor }) => revisePlan(store, actor, input),
	answer_gap: (store, input, { actor }) => answerGap(store, actor, { ...input, source: input.source ?? null }),
	start_test: (store, input, { actor, env, launch }) => {
		const harness = selectedHarness(workspaceEnv(store, env))
		const options = launch ?? {
			allow: ruleTokens(testerRulesText(store, harness)),
			claudeArgs: [],
			session: harness === 'claude',
		}
		return runTest(store, actor, { ...input, ...options }, env)
	},
	test_status: (store, input) =>
		input.waitSeconds === undefined
			? completed(
					input.explorationId,
					input.report
						? explorationReport(store, input.explorationId)
						: explorationStatus(store, input.explorationId)
				)
			: waitExploration(store, input.explorationId, input.waitSeconds),
	follow_test: (store, input, { actor, env, launch }) =>
		startFollow(
			store,
			actor,
			{
				...input,
				allow: launch?.allow ?? [],
				claudeArgs: launch?.claudeArgs ?? [],
			},
			env
		),
	pause_test: (store, input, { actor }) => pauseRun(store, actor, input.explorationId, input.reason),
	begin_run: (store, input, { actor }) => {
		const reference = revisionReference(input.reference, 'plan reference')
		const revision = reference.revision ?? planRevision(store, reference.id).plan.revision
		return withRejections(
			store,
			beginRun(store, actor, {
				...input,
				reference: `${reference.id}@${revision}`,
				retestOf: input.retestOf ?? null,
			})
		)
	},
	resume_run: (store, input, { actor }) => withRejections(store, resumeRun(store, actor, input)),
	read_run: (store, input) => {
		const detail = runDetail(store, input.runId)
		for (const id of input.tests ?? [])
			requireWellFormed(
				detail.tests.some((test) => test.testId === id),
				`Test ${id} is not selected in run ${detail.runId}`,
				`Use one of: ${detail.tests.map((test) => test.testId).join(', ')}.`
			)
		const tests = detail.tests.filter((test) => !input.tests || input.tests.includes(test.testId))
		const gate = input.gate ? runGate(store, detail.runId) : undefined
		let execution
		if (input.includePlan) {
			const run = runState(store, input.runId)
			const profile = targetRevision(store, run.row.target_id, run.row.target_revision).profile
			execution = {
				tests: run.plan.tests.filter((test) => tests.some((selected) => selected.testId === test.id)),
				dataRules: dataRules(
					store.workspace,
					profile.reset,
					run.request.marker ?? run.row.run_id,
					run.request.facts
				),
			}
		}
		return completed(detail.runId, {
			...detail,
			tests,
			...(gate ? { gate } : {}),
			...(execution ? { execution } : {}),
		})
	},
	record_check: (store, input, { actor }) => checkAssertion(store, actor, input),
	close_test: (store, input, { actor }) => closeTest(store, actor, input),
	record_finding: (store, input, { actor }) => recordFinding(store, actor, input),
	record_gap: (store, input, { actor }) => recordGap(store, actor, input),
	finish_run: (store, input, { actor }) => finishRun(store, actor, input),
	status: (store, input, { env }) =>
		completed(input.planId, planStatus(store, input.planId, selectedHarness(workspaceEnv(store, env)))),
	inbox: (store) => completed('inbox', inbox(store)),
	next_tester_steps: (store, input, { actor }) => nextActions(store, actor, input.explorationId),
	tester_steps_started: (store, input, { actor }) => stepsStarted(store, actor, input.explorationId, input.names),
	tester_step_done: (store, { agentId, failure, failureDetail, ...input }, { actor }) =>
		stepDone(store, actor, { ...input, agent: agentId, failed: failure ? (failureDetail ?? failure) : undefined }),
}

export function actionInput<Name extends ActionName>(name: Name, input: unknown) {
	if (name === 'setup' || name === 'start_test') {
		const fields = input as { build?: unknown } | null
		if (typeof fields?.build === 'string') input = { ...fields, build: fields.build.trim() }
	}
	const problems = schemaProblems('actions', { [name]: input }, 'input').map((problem) => problem.text)
	if (problems.length) {
		const fields = input as { planId?: string; observed?: string; absent?: boolean } | null
		if (name === 'open_plan' && ['stdin', '-'].includes(fields?.planId ?? ''))
			throw new Refusal(
				'malformed',
				`${fields?.planId} is not a valid plan ID.`,
				'Leave out the plan ID to derive it from the first source, or give a plan ID such as checkout.'
			)
		if (name === 'record_check' && fields?.absent === true && fields.observed !== undefined)
			throw new Refusal(
				'malformed',
				'--absent and --observed do not go together',
				'Give absent when the page was read and the value is missing. Give observed when it is present.'
			)
		const repair =
			name === 'record_check' || name === 'close_test'
				? 'Use evidence: [{text: "the actual response or observation", kind: "http_exchange"}]. For a fresh file in the run evidence directory, give {file, kind}. Correct any other named fields and retry.'
				: name === 'tester_step_done'
					? 'Use the assigned Agent receipt. Record product defects in the tester report.'
					: 'Correct the named fields and retry the action.'
		throw new Refusal('malformed', problems.join('. '), repair)
	}
	return input as NonNullable<Actions[Name]>
}

export function performAction<Name extends Exclude<ActionName, 'delegate_work'>>(
	store: Store,
	name: Name,
	input: unknown,
	context: ActionContext
) {
	return dispatchAction(store, name, actionInput(name, input), context)
}

export function dispatchAction<Name extends Exclude<ActionName, 'delegate_work'>>(
	store: Store,
	name: Name,
	input: NonNullable<Actions[Name]>,
	context: ActionContext
) {
	return handlers[name](store, input, context)
}

export function actionRecovery(name: ActionName, reply: Reply) {
	if (!['rejected', 'invalid_request', 'needs_decision', 'operational_error', 'interrupted'].includes(reply.status))
		return reply
	const recheck: Partial<Record<ActionName, ActionName>> = {
		replace_instance: 'show_target',
		read_plan_request: 'inbox',
		save_plan: 'read_plan_request',
		edit_plan: 'status',
		revise_plan: 'read_pending',
		answer_gap: 'status',
		begin_run: 'status',
		resume_run: 'read_run',
		record_check: 'read_run',
		close_test: 'read_run',
		record_finding: 'read_run',
		record_gap: 'read_run',
		finish_run: 'read_run',
		status: 'inbox',
		follow_test: 'test_status',
	}
	const recovery = reply.hint ?? (typeof reply.data.next === 'string' ? reply.data.next : undefined)
	const next = recovery || reply.refusal === 'malformed' ? name : (recheck[name] ?? name)
	return {
		...reply,
		data: {
			...reply.data,
			nextAction: {
				action: next,
				instruction:
					recovery ??
					(next !== name
						? `Read the current record with checkmate_${next} before retrying. Use the record ID in the request.`
						: 'Resolve the condition in reasons before retrying. Ask the oracle for any missing decision.'),
			},
		},
	}
}
