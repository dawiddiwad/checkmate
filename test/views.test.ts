import test from 'node:test'
import assert from 'node:assert/strict'
import { answerGap, openPlan, patchPlan, rejectPlan, revisePlan, savePlan } from '../plugin/src/plans.ts'
import { beginRun, closeTest, finishRun, recordFinding, recordGap } from '../plugin/src/runs.ts'
import {
	changesAfter,
	inbox,
	operationLog,
	pagedOperations,
	pagedPlans,
	pagedRuns,
	planDetail,
	planList,
	planStatus,
	runList,
} from '../plugin/src/views.ts'
import { addInstance } from '../plugin/src/targets.ts'
import {
	accept,
	actor,
	approved,
	begin,
	candidate,
	check,
	cli,
	failT2,
	passRun,
	plan,
	planRequest,
	promotionDelta,
	ready,
	revised,
	store,
	target,
} from './support.ts'

test('the inbox lists open gaps without a decision, plans to approve, and results to accept', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	let waiting = inbox(opened)
	assert.deepEqual(
		waiting.gaps.map((gap) => [gap.planId, gap.revision, gap.gapId, gap.severity]),
		[
			['checkout', 1, 'G1', 'blocking'],
			['checkout', 1, 'G2', 'blocking'],
		]
	)
	assert.deepEqual(
		waiting.plans.map((row) => [row.planId, row.revision, row.summary]),
		[['checkout', 1, '3 tests: 1 ready, 2 blocked, 0 deferred; 2 open gaps']]
	)
	answerGap(opened, actor, { planId: 'checkout', gapId: 'G2', kind: 'defer', value: 'Later.', rationale: 'Scope.' })
	assert.deepEqual(
		inbox(opened).gaps.map((gap) => gap.gapId),
		['G1']
	)
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G1',
		kind: 'clarify',
		value: 'Promotion replaces loyalty.',
		source: 'decisions#1',
		rationale: 'Product.',
	})
	revisePlan(opened, actor, { planId: 'checkout', delta: promotionDelta })
	waiting = inbox(opened)
	assert.deepEqual(waiting.gaps, [])
	assert.deepEqual(
		waiting.plans.map((row) => `${row.planId}@${row.revision}`),
		['checkout@2']
	)
	approved(opened)
	const cursor = changesAfter(opened, 0).at(-1)!.rowid
	passRun(opened, 'run-1', 'build-1')
	waiting = inbox(opened)
	assert.deepEqual(waiting.plans, [])
	assert.deepEqual(
		waiting.results.map((row) => [row.runId, row.build, row.coverage, row.counts]),
		[['run-1', 'build-1', 'partial', { passed: 1 }]]
	)
	const changes = changesAfter(opened, cursor)
	assert.deepEqual(changes.at(-1)!.subjects, ['run:run-1', 'plan:checkout', 'inbox'])
	assert(changes.every((change) => change.rowid > cursor))
	assert.equal(operationLog(opened, { after: cursor }).length, changes.length)
	assert.deepEqual(
		runList(opened, { planId: 'checkout' }).map((row) => [row.runId, row.state, row.acceptance]),
		[['run-1', 'finalized', 'pending']]
	)
	assert.deepEqual(runList(opened, { build: 'other' }), [])
	assert.deepEqual(
		planList(opened).map((row) => [row.planId, row.revision, row.approval, row.openGaps]),
		[['checkout', 2, 'approved', []]]
	)
})

test('a plan request without a revision is in the inbox and the plan list until plan save', (t) => {
	const opened = store(t)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	assert.deepEqual(
		inbox(opened).requests.map((row) => [row.planId, row.target, row.objective]),
		[['checkout', 'checkout-local@1', planRequest().objective]]
	)
	assert.deepEqual(
		planList(opened).map((row) => [row.planId, row.status, row.revision, row.approval]),
		[['checkout', 'requested', null, null]]
	)
	assert.deepEqual(
		pagedPlans(opened).rows.map((row) => row.status),
		['requested']
	)
	plan(opened)
	assert.deepEqual(inbox(opened).requests, [])
	assert.deepEqual(
		planList(opened).map((row) => [row.planId, row.status, row.revision]),
		[['checkout', 'drafted', 1]]
	)
})

test('approval policy none keeps plans and results out of the inbox', (t) => {
	const opened = store(t)
	target(opened, { approvals: { plan: 'none', result: 'none' } })
	plan(opened)
	revised(opened)
	passRun(opened, 'run-1', 'build-1')
	const waiting = inbox(opened)
	assert.deepEqual([waiting.plans, waiting.results], [[], []])
	assert.equal(planList(opened)[0].approval, 'not_required')
})

test('plan detail lists the runs of the plan with outcome counts and acceptance', (t) => {
	const opened = store(t)
	ready(opened)
	passRun(opened, 'run-1', 'build-1')
	begin(opened, 'run-2', ['T1'], 'build-2')
	const runs = planDetail(opened, 'checkout').runs
	assert.deepEqual(
		runs.map((run) => [run.runId, run.revision, run.build, run.state, run.completion, run.counts, run.acceptance]),
		[
			['run-1', 2, 'build-1', 'finalized', 'completed', { passed: 1 }, 'pending'],
			['run-2', 2, 'build-2', 'started', null, {}, null],
		]
	)
	assert.match(runs[0].startedAt, /^\d{4}-\d\d-\d\dT/)
})

test('paged lists sort, filter by text and dropdown, and report the total', (t) => {
	const opened = store(t)
	ready(opened)
	for (const id of ['alpha', 'beta', 'gamma']) plan(opened, id)
	t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T00:00:00Z') })
	for (let i = 1; i <= 30; i++) begin(opened, `run-${String(i).padStart(2, '0')}`, ['T1'], i % 2 ? 'odd' : 'even')
	t.mock.timers.reset()
	const plans = pagedPlans(opened, { sort: 'plan', direction: 'desc', limit: 25 })
	assert.deepEqual(
		plans.rows.map((row) => row.planId),
		['gamma', 'checkout', 'beta', 'alpha']
	)
	assert.equal(plans.total, 4)
	assert.deepEqual(
		pagedPlans(opened, { q: 'GAM' }).rows.map((row) => row.planId),
		['gamma']
	)
	assert.deepEqual(
		pagedPlans(opened, { filters: { approval: 'approved' } }).rows.map((row) => row.planId),
		['checkout']
	)
	assert.deepEqual(
		pagedPlans(opened, { filters: { show: 'needs_decision' }, sort: 'gaps' }).rows.map((row) => row.planId),
		['alpha', 'beta', 'gamma']
	)
	const first = pagedRuns(opened)
	assert.deepEqual([first.total, first.rows.length, first.sort, first.direction], [30, 25, 'started', 'desc'])
	assert.equal(first.rows[0].runId, 'run-30')
	assert.equal(pagedRuns(opened, { direction: 'asc' }).rows[0].runId, 'run-01')
	const second = pagedRuns(opened, { offset: 25, sort: 'run', direction: 'asc', limit: 25 })
	assert.deepEqual(
		second.rows.map((row) => row.runId),
		['run-26', 'run-27', 'run-28', 'run-29', 'run-30']
	)
	const odd = pagedRuns(opened, { filters: { build: 'odd', status: 'started' }, limit: 50 })
	assert.equal(odd.total, 15)
	assert.deepEqual(
		pagedRuns(opened, { q: 'run-0', sort: 'run' }).rows.map((row) => row.runId),
		['run-01', 'run-02', 'run-03', 'run-04', 'run-05', 'run-06', 'run-07', 'run-08', 'run-09']
	)
	const log = pagedOperations(opened, { filters: { command: 'run begin' }, limit: 25 })
	assert.deepEqual([log.total, log.rows.length, log.rows[0].subjects[0]], [30, 25, 'run:run-30'])
	assert.equal(pagedOperations(opened, { q: 'RUN:RUN-07' }).total, 1)
	assert.deepEqual(
		pagedOperations(opened, { sort: 'command', direction: 'asc', filters: { subject: 'plan:alpha' } }).rows.map(
			(row) => row.command
		),
		['plan open', 'plan save']
	)
	assert.throws(() => pagedRuns(opened, { limit: 10 }), /Invalid limit: 10. Use one of: 25, 50, 100/)
	assert.throws(() => pagedRuns(opened, { sort: 'size' }), /Invalid sort column: size/)
	assert.throws(() => pagedPlans(opened, { filters: { owner: 'x' } }), /Unknown filter: owner/)
	assert.throws(() => pagedPlans(opened, { filters: { show: 'some' } }), /Invalid show filter: some/)
	assert.throws(() => pagedOperations(opened, { offset: -1 }), /Invalid offset: -1/)
})

test('plan status follows the loop and names the role and the delegate stage', (t) => {
	const opened = store(t)
	target(opened)
	const where = () => {
		const status = planStatus(opened, 'checkout')
		return `${status.state} ${status.waitsOn} ${status.stage}`
	}
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	assert.equal(where(), 'needs_plan planner plan')
	savePlan(opened, actor, { planId: 'checkout', candidate: candidate() })
	assert.equal(where(), 'needs_answers oracle none')
	approved(opened, 'checkout', 1)
	assert.equal(where(), 'ready_to_run qa none')
	beginRun(opened, actor, { runId: 'run-1', reference: 'checkout@1', build: 'b1', partial: 'ready_only' })
	assert.equal(where(), 'run_in_progress qa execute')
	const failed = check(opened, 'run-1', 'T1.A1', 'failed')
	check(opened, 'run-1', 'T1.A2', 'passed')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	recordFinding(opened, actor, {
		runId: 'run-1',
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			title: 'Wrong total',
			expected: '400 PLN',
			observed: '380 PLN',
			reproduction: ['Check out.'],
			evidenceIds: failed.data.evidenceIds as string[],
		},
	})
	finishRun(opened, actor, {
		runId: 'run-1',
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Closed.',
	})
	const early = planStatus(opened, 'checkout')
	assert.deepEqual(
		[early.state, early.gaps.map((gap) => gap.gapId), early.defects.map((defect) => defect.findingId)],
		['needs_answers', ['G1', 'G2'], ['F1']]
	)
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G1',
		kind: 'clarify',
		value: '240 PLN.',
		source: 'd#1',
		rationale: 'R.',
	})
	answerGap(opened, actor, { planId: 'checkout', gapId: 'G2', kind: 'defer', value: 'Later.', rationale: 'R.' })
	assert.equal(where(), 'needs_revision planner revise')
	revisePlan(opened, actor, { planId: 'checkout', delta: promotionDelta })
	assert.equal(where(), 'needs_approval oracle none')
	approved(opened)
	const fix = planStatus(opened, 'checkout')
	assert.deepEqual([fix.state, fix.waitsOn, fix.why], ['defects_open', 'factory', ['run-1 has 1 defect on build b1']])
	assert.equal(
		fix.next,
		'Build a fix, then checkmate run begin <runId> checkout@2 --build <new build> --retest-of run-1'
	)
	begin(opened, 'run-2', ['T1', 'T2'], 'b2', { retestOf: 'run-1' })
	assert.equal(where(), 'run_in_progress qa execute')
	for (const testId of ['T1', 'T2']) {
		for (const assertionId of ['A1', 'A2']) check(opened, 'run-2', `${testId}.${assertionId}`, 'passed')
		closeTest(opened, actor, { runId: 'run-2', testId })
	}
	finishRun(opened, actor, {
		runId: 'run-2',
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Closed.',
	})
	assert.equal(where(), 'awaits_acceptance oracle none')
	assert.deepEqual(
		inbox(opened).results.map((row) => row.runId),
		['run-2']
	)
	assert.equal(planStatus(opened, 'checkout').latestRun?.runId, 'run-2')
	assert.equal(accept(opened, 'run-1').status, 'completed')
	assert.equal(where(), 'awaits_acceptance oracle none')
	accept(opened, 'run-2')
	assert.equal(where(), 'accepted none none')
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T1: { title: 'Order total' } } } })
	assert.equal(where(), 'needs_approval oracle none')
	approved(opened, 'checkout', 3)
	assert.deepEqual(planStatus(opened, 'checkout').why, ['run-2 tested checkout@2, not checkout@3'])
	assert.equal(where(), 'needs_retest qa none')
	assert.equal(
		planStatus(opened, 'checkout').next,
		'checkmate run begin <runId> checkout@3 --build b2 --partial ready_only'
	)
	patchPlan(opened, actor, { reference: 'checkout@3', patch: { tests: { T1: { title: 'Total' } } } })
	rejectPlan(opened, actor, { reference: 'checkout@4', rationale: 'No.' })
	assert.equal(where(), 'plan_rejected oracle none')
	assert.deepEqual(
		planList(opened).map((row) => [row.planId, row.loop]),
		[['checkout', { state: 'plan_rejected', waitsOn: 'oracle' }]]
	)
})

test('plan status reports a passed run without acceptance when the policy needs none', (t) => {
	const opened = store(t)
	ready(opened, { approvals: { plan: 'none', result: 'none' } })
	passRun(opened, 'run-1', 'b1')
	assert.deepEqual([planStatus(opened, 'checkout').state, planStatus(opened, 'checkout').waitsOn], ['passed', 'none'])
})

test('plan status puts blocking gaps before defects and defects before non-blocking gaps', (t) => {
	const finished = (severity: 'blocking' | 'non_blocking') => {
		const opened = store(t)
		ready(opened)
		begin(opened, 'run-1', ['T1', 'T2'], 'b1')
		for (const reference of ['T1.A1', 'T1.A2']) check(opened, 'run-1', reference, 'passed')
		closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
		check(opened, 'run-1', 'T2.A1', 'passed')
		failT2(opened, 'run-1')
		closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
		recordGap(opened, actor, {
			runId: 'run-1',
			gap: {
				id: 'G7',
				severity,
				status: 'open',
				requirementIds: [],
				testIds: ['T2'],
				question: 'Is the label right?',
				consequence: 'Unchecked label.',
				decisionId: null,
			},
		})
		finishRun(opened, actor, {
			runId: 'run-1',
			completion: 'completed',
			cleanup: 'completed',
			cleanupReason: 'Closed.',
		})
		return planStatus(opened, 'checkout')
	}
	const blocking = finished('blocking')
	assert.deepEqual(
		[blocking.state, blocking.waitsOn, blocking.why],
		['needs_answers', 'oracle', ['1 open blocking gap']]
	)
	const minor = finished('non_blocking')
	assert.deepEqual([minor.state, minor.waitsOn], ['defects_open', 'factory'])
	assert.deepEqual(
		minor.gaps.map((gap) => [gap.gapId, gap.severity, gap.runId]),
		[['G7', 'non_blocking', 'run-1']]
	)
	assert.deepEqual(
		minor.defects.map((defect) => defect.findingId),
		['F1']
	)
})

test('plan status lists every open run of a matrix with its instance', (t) => {
	const opened = store(t)
	ready(opened)
	const instances = ['local', 'uat', 'staging', 'eu', 'us']
	for (const instanceId of instances.slice(1))
		addInstance(opened, actor, {
			targetId: 'checkout-local',
			instanceId,
			instance: { entries: { web: `https://${instanceId}.example.com` } },
		})
	instances.forEach((instanceId, i) => begin(opened, `run-${i + 1}`, ['T1'], 'build-1', { instance: instanceId }))
	const status = planStatus(opened, 'checkout')
	assert.equal(status.state, 'run_in_progress')
	assert.equal(status.stage, 'execute')
	assert.deepEqual(
		status.openRuns.map((run) => [run.runId, run.instanceId]),
		instances.map((instanceId, i) => [`run-${i + 1}`, instanceId])
	)
	assert.deepEqual(status.why, ['5 runs are started'])
	assert.equal(status.next, 'checkmate delegate execute <runId>, for each started run')
	const printed = cli(opened.workspace, ['status', 'checkout']).lines
	assert(printed.includes('run-3\tstarted\tbuild=build-1\tinstance=staging'), printed.join('\n'))
	assert.deepEqual(
		runList(opened).map((run) => run.instanceId),
		instances
	)
})
