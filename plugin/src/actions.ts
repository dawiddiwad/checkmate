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
	revisePlan,
	savePlan,
	showPending,
	showPlanRequest,
} from './plans.ts'
import { beginRun, checkAssertion, closeTest, finishRun, recordFinding, recordGap } from './runs.ts'
import { inbox, planStatus, runDetail, runGate } from './views.ts'
import { selectedHarness } from './pi.ts'
import { ruleTokens, testerRulesText, workspaceEnv } from './settings.ts'
import { runTest } from './modes.ts'
import { explorationReport, explorationStatus } from './explorers.ts'
import { nextActions, stepDone, stepsStarted } from './agents.ts'

export type ActionName = keyof Actions
type ActionContext = {
	actor: string | undefined
	env: Env
	launch?: { allow: string[]; claudeArgs: string[]; session: boolean }
}

const handlers: {
	[Name in ActionName]: (store: Store, input: NonNullable<Actions[Name]>, context: ActionContext) => Reply
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
		completed(
			input.explorationId,
			input.report ? explorationReport(store, input.explorationId) : explorationStatus(store, input.explorationId)
		),
	begin_run: (store, input, { actor }) => beginRun(store, actor, { ...input, retestOf: input.retestOf ?? null }),
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
		return completed(detail.runId, { ...detail, tests, ...(gate ? { gate } : {}) })
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
	tester_step_done: (store, input, { actor }) => stepDone(store, actor, input),
}

export function performAction<Name extends ActionName>(
	store: Store,
	name: Name,
	input: unknown,
	context: ActionContext
) {
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
		throw new Refusal('malformed', problems.join('. '), 'Correct the named fields and retry the action.')
	}
	return handlers[name](store, input as NonNullable<Actions[Name]>, context)
}

export function actionRecovery(name: ActionName, reply: Reply) {
	if (!['rejected', 'invalid_request', 'needs_decision', 'operational_error'].includes(reply.status)) return reply
	return {
		...reply,
		data: {
			...reply.data,
			nextAction: {
				action: name,
				instruction:
					reply.hint ??
					(typeof reply.data.next === 'string'
						? reply.data.next
						: 'Resolve the condition in reasons before retrying this action. Ask the oracle for any missing decision.'),
			},
		},
	}
}
