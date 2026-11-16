import test from 'node:test'
import assert from 'node:assert/strict'
import type { Store } from '../plugin/src/store.ts'
import {
	answerGap,
	approvePlan,
	gate,
	openPlan,
	patchPlan,
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

function deferredPrerequisite(t: Parameters<typeof store>[0], outcome: Outcome, withT4 = false) {
	const opened = store(t)
	ready(opened)
	let tests = ['T1', 'T2']
	if (withT4) {
		const assertions = { A1: { check: 'The catalog lists the item.', checkKind: 'deterministic' as const } }
		const T4 = {
			title: 'Catalog',
			requirementIds: ['R1'],
			capability: 'http',
			operations: ['read_catalog'],
			action: 'Read the catalog.',
			assertions,
		}
		patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T4 } } })
		approved(opened, 'checkout', 3)
		tests = [...tests, 'T4']
	}
	const reference = `checkout@${planRevision(opened, 'checkout').plan.revision}`
	start(opened, 'run-1', reference, 'b1', tests)
	recordGap(opened, actor, { runId: 'run-1', gap: gap('G9', 'blocking', ['T1']) })
	record(opened, 'run-1', { T1: 'passed', T2: outcome, ...(withT4 ? { T4: 'passed' as const } : {}) })
	accept(opened, 'run-1')
	assert.deepEqual(state(opened), ['needs_answers', 'oracle', ['1 open blocking gap']])
	followHints(t, opened)
	defer(opened, 'G9')
	revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	const latest = planRevision(opened, 'checkout').plan.revision
	approved(opened, 'checkout', latest)
	assert.deepEqual(
		gate(opened, { reference: `checkout@${latest}`, build: 'b1', partial: 'ready_only' }).reply.data.leftOut,
		[
			{ testId: 'T1', reason: 'deferred by G9' },
			{ testId: 'T2', reason: 'deferred: prerequisite T1 is deferred' },
			{ testId: 'T3', reason: 'deferred by G2' },
		]
	)
	followHints(t, opened)
	return { opened, status: planStatus(opened, 'checkout'), latest }
}

test('a ready test with a deferred prerequisite counts as deferred; with no ready test, nothing is verified', (t) => {
	const { status, latest } = deferredPrerequisite(t, 'passed')
	assert.deepEqual(
		[status.state, status.waitsOn, status.why, status.next],
		[
			'nothing_to_run',
			'oracle',
			['No test is ready', 'T1 deferred by G9', 'T2 deferred: prerequisite T1 is deferred', 'T3 deferred by G2'],
			[`checkmate plan edit checkout@${latest} --patch`],
		]
	)
})

test('with another ready test that passed, a plan with a derived deferral reaches accepted', (t) => {
	const { status } = deferredPrerequisite(t, 'passed', true)
	assert.deepEqual(
		[status.state, status.waitsOn, status.why, status.next],
		['accepted', 'none', ['run-1 is accepted', 'T2 deferred: prerequisite T1 is deferred'], []]
	)
})

test('status ignores the inconclusive outcome or the defect of a test with a deferred prerequisite', (t) => {
	for (const outcome of ['inconclusive', 'failed'] as const) {
		const { opened, status } = deferredPrerequisite(t, outcome, true)
		assert.deepEqual([status.state, status.defects], ['accepted', []])
		assert.deepEqual(
			findingList(opened, { open: true }).map((row) => `${row.runId}/${row.findingId}`),
			outcome === 'failed' ? ['run-1/F-T2'] : []
		)
	}
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
	assert.deepEqual(
		[status.state, status.waitsOn, status.why, status.next],
		[
			'nothing_to_run',
			'oracle',
			['No test is ready', 'T1 deferred by G8', 'T2 deferred by G8', 'T3 deferred by G2, G8'],
			['checkmate plan edit checkout@4 --patch'],
		]
	)
	followHints(t, opened)
})

function payPlan(opened: Store, dependencies = ['T1']) {
	openPlan(opened, actor, {
		planId: 'pay',
		target: 'checkout-local@1',
		request: { ...planRequest(), requirements: [{ id: 'P', text: 'Pay works.', source: 'brief#pay' }] },
	})
	savePlan(opened, actor, {
		planId: 'pay',
		candidate: {
			tests: dependencies.map((testId, i) => ({
				id: `P${i + 1}`,
				title: 'Pay',
				requirementIds: ['P'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [`checkout:${testId}`],
				preconditions: [],
				action: 'Pay.',
				assertions: [{ id: 'A1', check: 'Paid.', checkKind: 'deterministic' }],
			})),
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
	patchPlan(opened, actor, {
		reference: 'checkout@2',
		patch: { tests: { T2: null }, gaps: { G1: { testIds: [] } } },
		rationale: 'The promotion is out of scope.',
	})
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
	const waiting = gate(opened, {
		reference: 'checkout@2',
		build: 'b2',
		tests: ['T1', 'T2'],
		partial: 'wait_for_resolution',
	}).reply
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

test('a rejected run has no open defects, and its tests need a retest', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'failed' })
	rejectResult(opened, actor, { runId: 'run-1', rationale: 'The record is wrong.' })
	const status = planStatus(opened, 'checkout')
	assert.deepEqual(
		[status.state, status.why, status.defects],
		[
			'needs_retest',
			[
				'run-1 was rejected by tester: The record is wrong.',
				"T1's latest pass is in rejected run-1",
				'T2 is failed in run-1',
			],
			[],
		]
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
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T1: { action: 'Check out once.' } } } })
	approved(opened, 'checkout', 3)
	const retest = planStatus(opened, 'checkout')
	assert.deepEqual(
		[retest.state, retest.why, retest.next],
		[
			'needs_retest',
			['T1 has not run on checkout@3'],
			['checkmate run begin <runId> checkout@3 --build b1 --instance local --partial ready_only'],
		]
	)
	followHints(t, opened)
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

function follow(opened: Store, runId: string, hint: string) {
	const build = / --build (\S+)/.exec(hint)![1]
	const instanceId = / --instance (\S+)/.exec(hint)?.[1]
	const retestOf = / --retest-of (\S+)/.exec(hint)?.[1]
	execute(
		opened,
		runId,
		hint.split(' ')[4],
		build,
		{ T1: 'passed', T2: 'passed' },
		{ instance: instanceId, retestOf }
	)
}

test('a retest hint names the instance of the run that needs it, so following it ends needs_retest', (t) => {
	const matrix = (reject: boolean) => {
		const opened = store(t)
		ready(opened)
		instance(opened, 'qa')
		execute(
			opened,
			'run-a',
			'checkout@2',
			'b1',
			{ T1: 'passed', T2: reject ? 'passed' : 'inconclusive' },
			{
				instance: 'qa',
			}
		)
		execute(opened, 'run-b', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' }, { instance: 'local' })
		if (reject) rejectResult(opened, actor, { runId: 'run-a', rationale: 'The record is wrong.' })
		const status = planStatus(opened, 'checkout')
		assert.deepEqual(
			[status.state, status.next],
			['needs_retest', ['checkmate run begin <runId> checkout@2 --build b1 --instance qa --partial ready_only']]
		)
		assert.deepEqual(
			inbox(opened).results.map((row) => row.runId),
			reject ? ['run-b'] : ['run-a', 'run-b']
		)
		followHints(t, opened)
		follow(opened, 'run-c', status.next[0])
		assert.equal(planStatus(opened, 'checkout').state, 'awaits_acceptance')
	}
	matrix(false)
	matrix(true)
})

test('a retest hint for a run on a retired instance is a retest on a new instance with the same build', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-a', 'checkout@2', 'b1', { T1: 'passed', T2: 'inconclusive' })
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	instance(opened, 'local-2')
	const status = planStatus(opened, 'checkout')
	assert.deepEqual(status.next, [
		'checkmate run begin <runId> checkout@2 --build b1 --partial ready_only --retest-of run-a',
	])
	followHints(t, opened)
	follow(opened, 'run-b', status.next[0])
	assert.equal(planStatus(opened, 'checkout').state, 'awaits_acceptance')

	const defect = store(t)
	ready(defect)
	execute(defect, 'run-a', 'checkout@2', 'b1', { T1: 'passed', T2: 'failed' })
	retireInstance(defect, actor, { targetId: 'checkout-local', instanceId: 'local' })
	instance(defect, 'local-2')
	assert.equal(planStatus(defect, 'checkout').state, 'defects_open')
	followHints(t, defect)
})

test('a cross-plan dependency that passed on another build gives a run on that build', (t) => {
	const opened = store(t)
	ready(opened)
	payPlan(opened)
	execute(opened, 'c-1', 'checkout@2', 'b1', { T1: 'passed' })
	accept(opened, 'c-1')
	assert.deepEqual(planStatus(opened, 'pay').next, [
		'checkmate run begin <runId> pay@1 --build b1 --partial ready_only',
	])
	followHints(t, opened, 'pay')

	const other = store(t)
	ready(other)
	payPlan(other)
	execute(other, 'c-2', 'checkout@2', 'b2', { T1: 'passed' })
	accept(other, 'c-2')
	execute(other, 'pay-1', 'pay@1', 'b2', { P1: 'inconclusive' })
	rejectResult(other, actor, { runId: 'c-2', rationale: 'The record is wrong.' })
	execute(other, 'c-3', 'checkout@2', 'b3', { T1: 'passed', T2: 'passed' })
	accept(other, 'c-3')
	assert.equal(planStatus(other, 'checkout').state, 'accepted')
	const status = planStatus(other, 'pay')
	assert.deepEqual(
		[status.state, status.next],
		['needs_retest', ['checkmate run begin <runId> pay@1 --build b3 --partial ready_only']]
	)
	followHints(t, other, 'pay')
})

test('before the first run, a non-blocking gap does not hide a cross-plan block', (t) => {
	const opened = store(t)
	ready(opened)
	payPlan(opened)
	patchPlan(opened, actor, { reference: 'pay@1', patch: { gaps: { N1: patchGap('N1', 'non_blocking', ['P1']) } } })
	approvePlan(opened, actor, { reference: 'pay@2', rationale: 'Ok.' })
	const status = planStatus(opened, 'pay')
	assert.deepEqual(
		[status.state, status.waitsOn, status.next],
		['nothing_to_run', 'qa', ['checkmate status checkout']]
	)
	followHints(t, opened, 'pay')
})

test('a gap ID that an earlier revision removed cannot come back', (t) => {
	const opened = store(t)
	ready(opened)
	patchPlan(opened, actor, {
		reference: 'checkout@2',
		patch: { gaps: { G8: patchGap('G8', 'non_blocking', ['T1']) } },
	})
	approved(opened, 'checkout', 3)
	patchPlan(opened, actor, { reference: 'checkout@3', patch: { gaps: { G8: null } } })
	approved(opened, 'checkout', 4)
	assert.throws(
		() =>
			patchPlan(opened, actor, {
				reference: 'checkout@4',
				patch: { gaps: { G8: patchGap('G8', 'blocking', ['T2']) } },
			}),
		/Gap ID G8 is in use. Use a new ID/
	)
})

test('a changed requirement text or a new requirement of a test needs a retest', (t) => {
	const opened = store(t)
	ready(opened)
	execute(opened, 'run-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' })
	accept(opened, 'run-1')
	const text = 'A standard order for a 400 PLN item has a total of 500 PLN.'
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { requirements: { R1: { text } } } })
	approved(opened, 'checkout', 3)
	assert.deepEqual(state(opened), ['needs_retest', 'qa', ['T1 has not run on checkout@3']])
	followHints(t, opened)
	execute(opened, 'run-2', 'checkout@3', 'b1', { T1: 'passed', T2: 'passed' })
	accept(opened, 'run-2')
	patchPlan(opened, actor, { reference: 'checkout@3', patch: { tests: { T2: { requirementIds: ['R2', 'R1'] } } } })
	approved(opened, 'checkout', 4)
	assert.deepEqual(state(opened), ['needs_retest', 'qa', ['T2 has not run on checkout@4']])
	followHints(t, opened)
})

test('a cross-plan build hint names the build that selects the most tests, the newest on a tie', (t) => {
	const opened = store(t)
	ready(opened)
	payPlan(opened, ['T1', 'T2'])
	execute(opened, 'c-1', 'checkout@2', 'b1', { T1: 'passed', T2: 'passed' })
	accept(opened, 'c-1')
	execute(opened, 'c-2', 'checkout@2', 'b2', { T1: 'passed' })
	accept(opened, 'c-2')
	assert.deepEqual(planStatus(opened, 'pay').next, [
		'checkmate run begin <runId> pay@1 --build b1 --partial ready_only',
	])
	followHints(t, opened, 'pay')
	execute(opened, 'c-3', 'checkout@2', 'b3', { T1: 'passed', T2: 'passed' })
	accept(opened, 'c-3')
	assert.deepEqual(planStatus(opened, 'pay').next, [
		'checkmate run begin <runId> pay@1 --build b3 --partial ready_only',
	])
	followHints(t, opened, 'pay')
})
