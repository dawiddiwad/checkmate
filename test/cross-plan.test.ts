import test from 'node:test'
import assert from 'node:assert/strict'
import type { Store } from '../plugin/src/store.ts'
import type { PlanCandidate } from '../plugin/src/types.ts'
import { approvePlan, editPlan, gate, latestPlans, planCandidate, planRevision } from '../plugin/src/plans.ts'
import { beginRun, closeTest, finishRun, recordFinding } from '../plugin/src/runs.ts'
import { dependencyCheck } from '../plugin/src/contracts.ts'
import { planList } from '../plugin/src/views.ts'
import { accept, actor, candidate, check, plan, store, target } from './support.ts'

const loginRequest = {
	objective: 'Verify login.',
	requirements: [{ id: 'L1', text: 'A user can log in.', source: 'brief#login' }],
	sourceContext: [],
}

function loginCandidate(): PlanCandidate {
	return {
		tests: [
			{
				id: 'T3',
				title: 'Login',
				requirementIds: ['L1'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Log in.',
				assertions: [{ id: 'A1', check: 'The session cookie is set.', oracleKind: 'deterministic' }],
			},
		],
		gaps: [],
	}
}

function checkoutCandidate(dependency = 'login:T3') {
	const value = candidate()
	value.tests[0].dependsOn = [dependency]
	return value
}

function setup(t: Parameters<typeof store>[0]) {
	const opened = store(t)
	target(opened)
	plan(opened, 'login', loginCandidate(), loginRequest)
	approvePlan(opened, actor, { reference: 'login@1', rationale: 'Ok.' })
	plan(opened, 'checkout', checkoutCandidate())
	approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'Ok.' })
	return opened
}

function loginRun(opened: Store, runId: string, build: string, result: 'passed' | 'failed' | 'inconclusive') {
	const begun = beginRun(opened, actor, { runId, reference: 'login@1', tests: ['T3'], build })
	assert.equal(begun.status, 'completed', begun.reasons.join('; '))
	const checked = check(opened, runId, 'T3.A1', result)
	if (result === 'failed')
		recordFinding(opened, actor, {
			runId,
			finding: {
				id: 'F1',
				type: 'defect',
				severity: 'high',
				assertionIds: ['T3.A1'],
				requirementIds: ['L1'],
				title: 'No session cookie',
				expected: 'A session cookie.',
				observed: 'No cookie.',
				reproduction: ['Log in.'],
				evidenceIds: checked.data.evidenceIds as string[],
			},
		})
	closeTest(opened, actor, { runId, testId: 'T3' })
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'not_applicable', cleanupReason: 'No state.' })
}

const reasons = (opened: Store, build: string) =>
	gate(opened, { reference: 'checkout@1', tests: ['T1'], build, partial: 'ready_only' }).reply.reasons

test('plan save refuses a missing plan or test in a cross-plan reference', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened, 'login', loginCandidate(), loginRequest)
	assert.throws(() => plan(opened, 'checkout', checkoutCandidate('nope:T3')), /Unknown plan in nope:T3: nope/)
	assert.throws(
		() => plan(opened, 'shop', checkoutCandidate('login:T9')),
		/Unknown test in login:T9: T9 is not in login@1/
	)
	const value = candidate()
	value.gaps[0].testIds = ['T2', 'login:T8']
	assert.throws(() => plan(opened, 'cart', value), /Unknown test in login:T8/)
})

test('a dependency cycle across plans is refused', (t) => {
	const opened = setup(t)
	const latest = latestPlans(opened)
	const login = structuredClone(latest.get('login')!)
	login.tests[0].dependsOn = ['checkout:T1']
	latest.delete('login')
	assert.throws(() => dependencyCheck(login, latest), /Test dependency cycle: checkout:T1 -> login:T3 -> checkout:T1/)
	assert.doesNotThrow(() => dependencyCheck(planRevision(opened, 'login').plan, latest))
})

test('the gate blocks a cross-plan dependency without a passed and accepted result for the build', (t) => {
	const opened = setup(t)
	assert.deepEqual(reasons(opened, 'b1'), ['Blocked by login:T3: no finalized result for build b1'])
	loginRun(opened, 'login-1', 'b1', 'failed')
	assert.deepEqual(reasons(opened, 'b1'), ['Blocked by login:T3: latest result login-1 shows failed'])
	loginRun(opened, 'login-2', 'b1', 'inconclusive')
	assert.deepEqual(reasons(opened, 'b1'), ['Blocked by login:T3: latest result login-2 shows inconclusive'])
	loginRun(opened, 'login-3', 'b1', 'passed')
	assert.deepEqual(reasons(opened, 'b1'), ['Blocked by login:T3: result login-3 is not accepted'])
	accept(opened, 'login-3')
	assert.deepEqual(reasons(opened, 'b1'), [])
	assert.deepEqual(reasons(opened, 'b2'), ['Blocked by login:T3: no finalized result for build b2'])
	assert.deepEqual(planList(opened).find((row) => row.planId === 'checkout')!.blocked, [])
})

test('an open blocking gap in another plan blocks the dependency', (t) => {
	const opened = setup(t)
	loginRun(opened, 'login-1', 'b1', 'passed')
	accept(opened, 'login-1')
	const value = candidate()
	value.gaps[0].testIds = ['T2', 'login:T3']
	plan(opened, 'audit', value)
	assert.deepEqual(reasons(opened, 'b1'), ['Blocked by login:T3: open blocking gap G1 in audit'])
	assert.deepEqual(planList(opened).find((row) => row.planId === 'checkout')!.blocked, [
		{ testId: 'T1', dependency: 'login:T3', cause: 'open blocking gap G1 in audit' },
	])
})

test('a result that does not need acceptance satisfies a dependency once it passed', (t) => {
	const opened = store(t)
	target(opened, { approvals: { plan: 'none', result: 'none' } })
	plan(opened, 'login', loginCandidate(), loginRequest)
	plan(opened, 'checkout', checkoutCandidate())
	loginRun(opened, 'login-1', 'b1', 'passed')
	assert.deepEqual(reasons(opened, 'b1'), [])
})

test('an edit cannot remove a test that another plan depends on', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened, 'login', loginCandidate(), loginRequest)
	plan(opened, 'checkout', checkoutCandidate())
	const content = planCandidate(planRevision(opened, 'login').plan)
	content.tests[0].id = 'T4'
	assert.throws(
		() => editPlan(opened, actor, { reference: 'login@1', candidate: content }),
		/Unknown test in login:T3: T3 is not in login@1/
	)
})
