import test from 'node:test'
import assert from 'node:assert/strict'
import { answerGap, revisePlan } from '../plugin/src/plans.ts'
import {
	changesAfter,
	inbox,
	operationLog,
	pagedOperations,
	pagedPlans,
	pagedRuns,
	planDetail,
	planList,
	runList,
} from '../plugin/src/views.ts'
import { actor, approved, begin, passRun, plan, promotionDelta, ready, revised, store, target } from './support.ts'

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
		[['run-1', 'build-1', 'partial', { passed: 1, not_run: 2 }]]
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
