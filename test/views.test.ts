import test from 'node:test'
import assert from 'node:assert/strict'
import { answerGap, revisePlan } from '../plugin/src/plans.ts'
import { changesAfter, inbox, operationLog, planList, runList } from '../plugin/src/views.ts'
import { actor, approved, passRun, plan, promotionDelta, revised, store, target } from './support.ts'

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
