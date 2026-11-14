import test from 'node:test'
import assert from 'node:assert/strict'
import type { Store } from '../plugin/src/store.ts'
import {
	answerGap,
	approvePlan,
	gate,
	openPlan,
	patchPlan,
	rejectPlan,
	planRevision,
	revisePlan,
	savePlan,
} from '../plugin/src/plans.ts'
import { beginRun, closeTest, finishRun, recordFinding, recordGap, rejectResult, runState } from '../plugin/src/runs.ts'
import { findingList, inbox, planStatus } from '../plugin/src/views.ts'
import { addInstance, retireInstance } from '../plugin/src/targets.ts'
import {
	accept,
	actor,
	approved,
	candidate,
	check,
	followHints,
	plan,
	planRequest,
	ready,
	revised,
	store,
	target,
} from './support.ts'

type Outcome = 'passed' | 'failed' | 'inconclusive'

function record(opened: Store, runId: string, outcomes: Record<string, Outcome>) {
	const tests = runState(opened, runId).plan.tests
	for (const [testId, outcome] of Object.entries(outcomes)) {
		const test = tests.find((item) => item.id === testId)!
		test.assertions.forEach((assertion, i) => {
			const last = i === test.assertions.length - 1
			const reply = check(opened, runId, `${testId}.${assertion.id}`, last ? outcome : 'passed')
			if (last && outcome === 'failed')
				recordFinding(opened, actor, {
					runId,
					finding: {
						id: `F-${testId}`,
						type: 'defect',
						severity: 'high',
						assertionIds: [`${testId}.${assertion.id}`],
						requirementIds: [test.requirementIds[0]],
						title: `${testId} is broken`,
						expected: 'Pass.',
						observed: 'Fail.',
						reproduction: ['Run it.'],
						evidenceIds: reply.data.evidenceIds as string[],
					},
				})
		})
		closeTest(opened, actor, { runId, testId })
	}
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Closed.' })
}

function start(opened: Store, runId: string, reference: string, build: string, tests: string[], extra = {}) {
	const reply = beginRun(opened, actor, { runId, reference, tests, build, ...extra })
	assert.equal(reply.status, 'completed', reply.reasons.join('; '))
}

function execute(
	opened: Store,
	runId: string,
	reference: string,
	build: string,
	outcomes: Record<string, Outcome>,
	extra = {}
) {
	start(opened, runId, reference, build, Object.keys(outcomes), extra)
	record(opened, runId, outcomes)
}

function instance(opened: Store, instanceId: string) {
	addInstance(opened, actor, {
		targetId: 'checkout-local',
		instanceId,
		instance: { entries: { web: `https://${instanceId}.example.com` } },
	})
}

function gap(id: string, severity: 'blocking' | 'non_blocking', testIds: string[], requirementIds: string[] = []) {
	return {
		id,
		severity,
		status: 'open' as const,
		requirementIds,
		testIds,
		question: `${id}: is it right?`,
		consequence: 'Unchecked.',
		decisionId: null,
	}
}

function patchGap(id: string, severity: 'blocking' | 'non_blocking', testIds: string[]) {
	const { severity: kept, requirementIds, question, consequence } = gap(id, severity, testIds)
	return { severity: kept, requirementIds, testIds, question, consequence }
}

function independent(opened: Store) {
	target(opened)
	const value = candidate()
	value.tests[1].dependsOn = []
	plan(opened, 'checkout', value)
	revised(opened)
	approved(opened)
}

function state(opened: Store, planId = 'checkout') {
	const status = planStatus(opened, planId)
	return [status.state, status.waitsOn, status.why]
}

const defer = (opened: Store, gapId: string) =>
	answerGap(opened, actor, { planId: 'checkout', gapId, kind: 'defer', value: 'Later.', rationale: 'Scope.' })

test('a test that changes in a new revision has not run on that revision; an unchanged test keeps its pass', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' })
	accept(opened, 'run-1')
	const a3 = { check: 'Loyalty is not applied.', checkKind: 'deterministic' as const }
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T2: { assertions: { A3: a3 } } } } })
	approved(opened, 'checkout', 3)
	execute(opened, 'run-2', 'checkout@3', 'b1', { T1: 'passed' })
	accept(opened, 'run-2')
	assert.deepEqual(state(opened), ['needs_retest', 'qa', ['T2 has not run on checkout@3']])
	followHints(t, opened)

	const other = store(t)
	independent(other)
	execute(other, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' })
	accept(other, 'run-1')
	patchPlan(other, actor, { reference: 'checkout@2', patch: { tests: { T2: { assertions: { A3: a3 } } } } })
	approved(other, 'checkout', 3)
	execute(other, 'run-2', 'checkout@3', 'b1', { T2: 'passed' })
	assert.deepEqual(state(other), ['awaits_acceptance', 'oracle', ['run-2 on build b1 waits for acceptance']])
	accept(other, 'run-2')
	assert.deepEqual(state(other), ['accepted', 'none', ['run-1, run-2 are accepted']])
})

test('a gap ID is unique in a plan, its revisions, and the open gaps of its runs', (t) => {
	const opened = store(t)
	ready(opened)
	instance(opened, 'qa')
	start(opened, 'run-uat', 'checkout@2', 'b1', ['T1', 'T2'], { instance: 'local' })
	start(opened, 'run-qa', 'checkout@2', 'b1', ['T1', 'T2'], { instance: 'qa' })
	recordGap(opened, actor, { runId: 'run-uat', gap: gap('G9', 'blocking', ['T1']) })
	assert.throws(
		() => recordGap(opened, actor, { runId: 'run-qa', gap: gap('G9', 'non_blocking', ['T1']) }),
		/Gap ID G9 is in use. Use a new ID/
	)
	assert.throws(
		() => recordGap(opened, actor, { runId: 'run-qa', gap: gap('G2', 'non_blocking', ['T1']) }),
		/Gap ID G2 is in use. Use a new ID/
	)
	record(opened, 'run-uat', { T1: 'passed', T2: 'passed' })
	record(opened, 'run-qa', { T1: 'passed', T2: 'passed' })
	const fields = patchGap('G9', 'non_blocking', ['T2'])
	assert.throws(
		() => patchPlan(opened, actor, { reference: `checkout@2`, patch: { gaps: { G9: fields } } }),
		/Gap ID G9 is in use. Use a new ID/
	)
	assert.equal(planStatus(opened, 'checkout').state, 'needs_answers')
	followHints(t, opened, 'checkout', { '<kind>': 'clarify' })
	const answered = answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G9',
		kind: 'clarify',
		value: 'PLN.',
		source: 'decisions#currency',
		rationale: 'Product.',
	})
	assert.equal((answered.data.adopted as { runId: string }).runId, 'run-uat')
})

test('a deferred prerequisite gives nothing_to_run, and the hint is not a run the gate refuses', (t) => {
	const opened = store(t)
	ready(opened)
	start(opened, 'run-1', 'checkout@2', 'b1', ['T1', 'T2'])
	recordGap(opened, actor, { runId: 'run-1', gap: gap('G9', 'blocking', ['T1']) })
	record(opened, 'run-1', { T1: 'passed', T2: 'passed' })
	accept(opened, 'run-1')
	assert.deepEqual(state(opened), ['needs_answers', 'oracle', ['1 open blocking gap']])
	followHints(t, opened)
	defer(opened, 'G9')
	revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	approved(opened, 'checkout', 4)
	const status = planStatus(opened, 'checkout')
	assert.deepEqual(
		[status.state, status.waitsOn, status.why, status.next],
		[
			'nothing_to_run',
			'oracle',
			['T1 deferred by G9', 'T2 needs T1, which is left out', 'T3 deferred by G2'],
			['checkmate plan edit checkout@4 --patch'],
		]
	)
	assert.equal(
		gate(opened, { reference: 'checkout@4', build: 'b1', partial: 'ready_only' }).reply.status,
		'needs_decision'
	)
	followHints(t, opened)
})

test('a plan with every test deferred after a run gives nothing_to_run', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' })
	accept(opened, 'run-1')
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { gaps: { G8: patchGap('G8', 'blocking', []) } } })
	defer(opened, 'G8')
	revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	approved(opened, 'checkout', 4)
	const status = planStatus(opened, 'checkout')
	assert.deepEqual([status.state, status.waitsOn, status.why[0]], ['nothing_to_run', 'oracle', 'No test is ready'])
	followHints(t, opened)
})

function payPlan(opened: Store) {
	openPlan(opened, actor, {
		planId: 'pay',
		target: 'checkout-local@1',
		request: { ...planRequest(), requirements: [{ id: 'P', text: 'Pay works.', source: 'brief#pay' }] },
	})
	savePlan(opened, actor, {
		planId: 'pay',
		candidate: {
			tests: [
				{
					id: 'P1',
					title: 'Pay',
					requirementIds: ['P'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: ['checkout:T1'],
					preconditions: [],
					action: 'Pay.',
					assertions: [{ id: 'A1', check: 'Paid.', checkKind: 'deterministic' }],
				},
			],
			gaps: [],
		},
	})
	approvePlan(opened, actor, { reference: 'pay@1', rationale: 'Ok.' })
}

test('a cross-plan dependency that has not passed gives nothing_to_run that waits on the other plan', (t) => {
	const opened = store(t)
	ready(opened)
	payPlan(opened)
	const before = planStatus(opened, 'pay')
	assert.deepEqual(
		[before.state, before.waitsOn, before.why, before.next],
		['nothing_to_run', 'qa', ['P1 blocked by checkout:T1: no finalized result'], ['checkmate status checkout']]
	)
	followHints(t, opened, 'pay')
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed' })
	accept(opened, 'run-1')
	assert.equal(planStatus(opened, 'pay').state, 'ready_to_run')
	followHints(t, opened, 'pay', { '<build>': 'b1' })
	execute(opened, 'pay-1', 'pay@1', 'b1', { P1: 'inconclusive' })
	assert.equal(planStatus(opened, 'pay').state, 'needs_retest')
	followHints(t, opened, 'pay')
	rejectResult(opened, actor, { runId: 'run-1', rationale: 'Wrong record.' })
	assert.deepEqual(state(opened, 'pay'), [
		'nothing_to_run',
		'qa',
		['P1 blocked by checkout:T1: result run-1 is not accepted'],
	])
	followHints(t, opened, 'pay')
})

test('a cross-plan dependency is satisfied by a pass on any instance of the build, in either order', (t) => {
	for (const order of [
		['qa', 'dev'],
		['dev', 'qa'],
	]) {
		const opened = store(t)
		ready(opened)
		instance(opened, 'qa')
		instance(opened, 'dev')
		payPlan(opened)
		for (const instanceId of order) {
			const runId = `run-${instanceId}`
			execute(
				opened,
				runId,
				'checkout@2',
				'b1',
				{ T1: instanceId === 'qa' ? 'passed' : 'failed' },
				{
					instance: instanceId,
				}
			)
			accept(opened, runId)
		}
		const checked = gate(opened, { reference: 'pay@1', build: 'b1', partial: 'ready_only' })
		assert.deepEqual([checked.reply.status, checked.tests], ['completed', ['P1']], order.join(' '))
	}
})

test('a run gap that names a removed test is still answerable and keeps the scope of the removed test', (t) => {
	const opened = store(t)
	ready(opened)
	start(opened, 'run-1', 'checkout@2', 'b1', ['T1', 'T2'])
	recordGap(opened, actor, { runId: 'run-1', gap: gap('G9', 'blocking', ['T2']) })
	record(opened, 'run-1', { T1: 'passed', T2: 'passed' })
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T2: null }, gaps: { G1: { testIds: [] } } } })
	approved(opened, 'checkout', 3)
	assert.equal(planStatus(opened, 'checkout').state, 'needs_answers')
	followHints(t, opened)
	assert.equal(defer(opened, 'G9').status, 'completed')
	const adopted = planRevision(opened, 'checkout').plan.gaps.find((item) => item.id === 'G9')!
	assert.deepEqual([adopted.testIds, adopted.requirementIds], [[], ['R2']])
	assert.equal(planRevision(opened, 'checkout').plan.tests.find((test) => test.id === 'T1')!.readiness, 'ready')
})

test('a defect closes only by a run that began later, and the retest hint runs', (t) => {
	const opened = store(t)
	ready(opened)
	start(opened, 'run-old', 'checkout@2', 'b1', ['T1', 'T2'])
	start(opened, 'run-new', 'checkout@2', 'b2', ['T1', 'T2'])
	record(opened, 'run-new', { T1: 'passed', T2: 'failed' })
	record(opened, 'run-old', { T1: 'passed', T2: 'passed' })
	assert.deepEqual(state(opened), ['defects_open', 'factory', ['run-new has 1 defect on build b2']])
	assert.deepEqual(
		findingList(opened, { open: true }).map((row) => `${row.runId}/${row.findingId}`),
		['run-new/F-T2']
	)
	followHints(t, opened)
})

test('on one build, a pass on one instance does not hide a failure on another, in either finish order', (t) => {
	const verdict = (first: string) => {
		const opened = store(t)
		ready(opened)
		instance(opened, 'qa')
		start(opened, 'run-uat', 'checkout@2', 'b1', ['T1', 'T2'], { instance: 'local' })
		start(opened, 'run-qa', 'checkout@2', 'b1', ['T1', 'T2'], { instance: 'qa' })
		const outcomes = {
			'run-uat': { T1: 'passed', T2: 'failed' } as const,
			'run-qa': { T1: 'passed', T2: 'passed' } as const,
		}
		const order = first === 'run-uat' ? (['run-uat', 'run-qa'] as const) : (['run-qa', 'run-uat'] as const)
		for (const runId of order) record(opened, runId, outcomes[runId])
		accept(opened, 'run-qa')
		accept(opened, 'run-uat')
		followHints(t, opened)
		return [...state(opened), findingList(opened, { open: true }).map((row) => `${row.runId}/${row.findingId}`)]
	}
	const expected = ['defects_open', 'factory', ['run-uat has 1 defect on build b1'], ['run-uat/F-T2']]
	assert.deepEqual(verdict('run-uat'), expected)
	assert.deepEqual(verdict('run-qa'), expected)
})

test('the inbox lists exactly the runs that status waits on', (t) => {
	const opened = store(t)
	ready(opened)
	const results = () => inbox(opened).results.map((row) => row.runId)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'inconclusive' })
	execute(opened, 'run-2', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' })
	assert.deepEqual(results(), ['run-2'])
	accept(opened, 'run-2')
	assert.deepEqual(results(), [])

	const chain = store(t)
	ready(chain)
	const chained = () => inbox(chain).results.map((row) => row.runId)
	execute(chain, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'failed' })
	execute(chain, 'run-2', 'checkout@2', 'b2', { T1: 'passed', T2: 'passed' }, { retestOf: 'run-1' })
	execute(chain, 'run-3', 'checkout@2', 'b3', { T1: 'passed', T2: 'failed' }, { retestOf: 'run-1' })
	assert.deepEqual(chained(), ['run-3'])
	execute(chain, 'run-4', 'checkout@2', 'b4', { T1: 'passed', T2: 'passed' }, { retestOf: 'run-3' })
	assert.deepEqual(chained(), ['run-4'])
	accept(chain, 'run-4')
	assert.deepEqual([chained(), planStatus(chain, 'checkout').state], [[], 'accepted'])
})

test('an open blocking run gap stops the gate for its tests; ready_only leaves them out', (t) => {
	const opened = store(t)
	ready(opened)
	start(opened, 'run-1', 'checkout@2', 'b1', ['T1', 'T2'])
	recordGap(opened, actor, { runId: 'run-1', gap: gap('G9', 'blocking', ['T1']) })
	record(opened, 'run-1', { T1: 'passed', T2: 'passed' })
	const waiting = gate(opened, { reference: 'checkout@2', build: 'b2', tests: ['T1', 'T2'] }).reply
	assert.deepEqual(
		[waiting.status, waiting.reasons],
		['needs_decision', ['Open blocking gap G9 of run-1 affects T1']]
	)
	const partial = gate(opened, { reference: 'checkout@2', build: 'b2', partial: 'ready_only' }).reply
	assert.deepEqual(partial.data.leftOut, [
		{ testId: 'T1', reason: 'blocked by G9 of run-1' },
		{ testId: 'T2', reason: 'needs T1, which is left out' },
		{ testId: 'T3', reason: 'deferred by G2' },
	])
})

test('a superseded revision cannot be approved, rejected, or run', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	revised(opened)
	for (const decide of [approvePlan, rejectPlan])
		assert.throws(
			() => decide(opened, actor, { reference: 'checkout@1', rationale: 'Old.' }),
			/checkout@1 is not the latest revision. Use checkout@2/
		)
	assert.throws(
		() => beginRun(opened, actor, { runId: 'run-1', reference: 'checkout@1', build: 'b1', partial: 'ready_only' }),
		/checkout@1 is not the latest revision. Use checkout@2/
	)
})

test('a rejected run has no open defects, and its tests need a retest', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'failed' })
	rejectResult(opened, actor, { runId: 'run-1', rationale: 'The record is wrong.' })
	const status = planStatus(opened, 'checkout')
	assert.deepEqual(
		[status.state, status.why, status.defects],
		['needs_retest', ["T1's latest pass is in rejected run-1", 'T2 is failed in run-1'], []]
	)
	assert.deepEqual(findingList(opened, { open: true }), [])
	followHints(t, opened)
})

test('status names every run of a matrix in begin order and gives the instance in hints', (t) => {
	const opened = store(t)
	ready(opened)
	instance(opened, 'qa')
	assert.deepEqual(planStatus(opened, 'checkout').next, [
		'checkmate run begin <runId> checkout@2 --build <build> --instance <instanceId> --partial ready_only',
	])
	followHints(t, opened)
	start(opened, 'run-a', 'checkout@2', 'b1', ['T1', 'T2'], { instance: 'qa' })
	start(opened, 'run-b', 'checkout@2', 'b1', ['T1', 'T2'], { instance: 'local' })
	const started = planStatus(opened, 'checkout')
	assert.deepEqual(
		[started.latestRun?.runId, started.why],
		['run-b', ['run-a is started on build b1 on instance qa', 'run-b is started on build b1 on instance local']]
	)
	record(opened, 'run-b', { T1: 'passed', T2: 'passed' })
	record(opened, 'run-a', { T1: 'passed', T2: 'passed' })
	assert.deepEqual(state(opened), [
		'awaits_acceptance',
		'oracle',
		['run-a on build b1 waits for acceptance', 'run-b on build b1 waits for acceptance'],
	])
	assert.equal(planStatus(opened, 'checkout').latestRun?.runId, 'run-b')
	assert.deepEqual(
		inbox(opened).results.map((row) => row.runId),
		['run-a', 'run-b']
	)
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T1: { title: 'Order total' } } } })
	approved(opened, 'checkout', 3)
	const retest = planStatus(opened, 'checkout')
	assert.deepEqual(
		[retest.state, retest.why, retest.next],
		[
			'needs_retest',
			['run-a tested checkout@2, not checkout@3', 'run-b tested checkout@2, not checkout@3'],
			['checkmate run begin <runId> checkout@3 --build b1 --instance local --partial ready_only'],
		]
	)
	followHints(t, opened)
})

test('run begin checks the instance before the gate', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	assert.throws(
		() => beginRun(opened, actor, { runId: 'run-1', reference: 'checkout@1', build: 'b1', instance: 'nope' }),
		/Unknown instance: checkout-local\/nope/
	)
})

test('a retest keeps the build only on a new instance after the old instance is retired', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'failed' })
	instance(opened, 'qa')
	const retest = (runId: string, instanceId: string) =>
		beginRun(opened, actor, {
			runId,
			reference: 'checkout@2',
			tests: ['T1', 'T2'],
			build: 'b1',
			instance: instanceId,
			retestOf: 'run-1',
		})
	assert.throws(() => retest('run-2', 'qa'), /Retest needs a new build. Run run-1 used build b1/)
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	instance(opened, 'local-2')
	assert.equal(retest('run-2', 'local-2').status, 'completed')
	record(opened, 'run-2', { T1: 'passed', T2: 'passed' })
	assert.deepEqual(state(opened), ['awaits_acceptance', 'oracle', ['run-2 on build b1 waits for acceptance']])
})
