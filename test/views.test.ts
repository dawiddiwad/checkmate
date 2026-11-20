import test from 'node:test'
import assert from 'node:assert/strict'
import { answerGap, openPlan, patchPlan, rejectPlan, revisePlan, savePlan } from '../plugin/src/plans.ts'
import { beginRun, closeTest, finishRun, recordFinding, recordGap, rejectResult } from '../plugin/src/runs.ts'
import {
	changesAfter,
	claimEvidence,
	findingList,
	mergedClaims,
	needsYou,
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
import { askRequest, requestActor, requestOf, setRequestState } from '../plugin/src/requests.ts'
import { completed, write } from '../plugin/src/store.ts'
import { addInstance } from '../plugin/src/targets.ts'
import { endSeededProcesses, seedVolume } from '../scripts/ui-volume.ts'
import {
	accept,
	actor,
	approved,
	begin,
	candidate,
	check,
	cli,
	directory,
	failT2,
	followHints,
	passRun,
	plan,
	planRequest,
	promotionDelta,
	ready,
	revised,
	store,
	target,
} from './support.ts'

test('the log filters and links chat operations while preserving their stored names and attribution', (t) => {
	const opened = store(t)
	const turn = askRequest(opened, actor, {
		text: 'Review the plan.',
		context: { planId: null, record: null },
		chatId: null,
	})
	const id = requestOf(opened, turn)!.conversation
	const subject = `chat:${id}`
	setRequestState(opened, turn, 'running')
	opened.via = turn
	write(opened, { actor: requestActor(actor, turn), command: 'plan edit', subject: 'checkout', input: null }, () => ({
		reply: completed('checkout'),
		subjects: ['plan:checkout'],
	}))
	opened.via = undefined

	const display = pagedOperations(opened, { filters: { subject }, sort: 'time', direction: 'asc' })
	assert.deepEqual(
		display.rows.map((row) => [row.command, row.actor, row.subjects, row.viaChat]),
		[
			['chat send', actor, [subject, 'chats'], null],
			['chat state', 'checkmate', [subject, 'chats'], null],
			['plan edit', actor, ['plan:checkout', subject], id],
		]
	)
	assert.equal(pagedOperations(opened, { q: 'chat state', filters: { command: 'chat state' } }).total, 1)
	const source = operationLog(opened, { subject, after: 0 })
	assert.deepEqual(
		source.map((row) => row.command),
		['request ask', 'request state', 'plan edit']
	)
	assert.equal(source[2].actor, requestActor(actor, turn))
	assert.equal(source[2].via, turn)

	const plain = cli(opened.workspace, ['log', '--subject', subject, '--limit', '2'])
	assert.equal(plain.lines.length, 3)
	assert(plain.lines[1].includes(`	${actor}	plan edit	completed	plan:checkout,/chats/${id}	`))
	assert(plain.lines[2].includes(`	chat state	completed	/chats/${id},chats	`))
	const structured = cli(opened.workspace, ['log', '--subject', subject, '--limit', '2', '--json'])
	assert.deepEqual(JSON.parse(structured.output).operations, source.slice(1).reverse())
})

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
		const status = followHints(t, opened)
		return `${status.state} ${status.waitsOn} ${status.stage}`
	}
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	assert.equal(where(), 'ready_to_test qa none')
	assert.deepEqual(planStatus(opened, 'checkout').next, ['checkmate test checkout --allow Read --allow Bash'])
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
	assert.deepEqual(fix.next, [
		'Build a fix, then checkmate run begin <runId> checkout@2 --build <new build> --partial ready_only --retest-of run-1',
	])
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
	assert.equal(where(), 'accepted none none')
	assert.deepEqual(planStatus(opened, 'checkout').why, ['run-2 is accepted'])
	patchPlan(opened, actor, { reference: 'checkout@3', patch: { tests: { T1: { action: 'Check out once.' } } } })
	approved(opened, 'checkout', 4)
	assert.equal(where(), 'needs_retest qa none')
	assert.deepEqual(planStatus(opened, 'checkout').why, ['T1 has not run on checkout@4'])
	assert.deepEqual(planStatus(opened, 'checkout').next, [
		'checkmate run begin <runId> checkout@4 --build b2 --partial ready_only',
	])
	patchPlan(opened, actor, { reference: 'checkout@4', patch: { tests: { T1: { title: 'Total' } } } })
	rejectPlan(opened, actor, { reference: 'checkout@5', rationale: 'No.' })
	assert.equal(where(), 'plan_rejected oracle none')
	assert.deepEqual(planStatus(opened, 'checkout').why, ['checkout@5 was rejected by tester: No.'])
	assert.deepEqual(
		planList(opened).map((row) => [row.planId, row.loop]),
		[['checkout', { state: 'plan_rejected', waitsOn: 'oracle' }]]
	)
})

test('plan status reports a passed run without acceptance when the policy needs none', (t) => {
	const opened = store(t)
	ready(opened, { approvals: { plan: 'none', result: 'none' } })
	passRun(opened, 'run-1', 'b1')
	const narrow = planStatus(opened, 'checkout')
	assert.deepEqual([narrow.state, narrow.why], ['needs_retest', ['T2 has not run on checkout@2']])
	passRun(opened, 'run-2', 'b1', ['T1', 'T2'])
	const status = planStatus(opened, 'checkout')
	assert.deepEqual(
		[status.state, status.waitsOn, status.why],
		['passed', 'none', ['run-2 passed. Result acceptance is not required']]
	)
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
	assert.deepEqual(
		status.why,
		instances.map((instanceId, i) => `run-${i + 1} is started on build build-1 on instance ${instanceId}`)
	)
	assert.deepEqual(
		status.next,
		instances.map((_, i) => `checkmate delegate execute run-${i + 1} --allow Read --allow Bash`)
	)
	assert.equal(status.latestRun?.runId, 'run-5')
	const printed = cli(opened.workspace, ['status', 'checkout']).lines
	assert.match(printed[0], / run=run-5$/)
	assert(printed.includes('run-3\tstarted\tbuild=build-1\tinstance=staging'), printed.join('\n'))
	assert.deepEqual(
		runList(opened).map((run) => run.instanceId),
		instances
	)
})

function failedRun(opened: ReturnType<typeof store>, runId: string, build: string, extra = {}) {
	begin(opened, runId, ['T1', 'T2'], build, extra)
	for (const reference of ['T1.A1', 'T1.A2']) check(opened, runId, reference, 'passed')
	closeTest(opened, actor, { runId, testId: 'T1' })
	check(opened, runId, 'T2.A1', 'passed')
	failT2(opened, runId)
	closeTest(opened, actor, { runId, testId: 'T2' })
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Closed.' })
}

function openDefects(opened: ReturnType<typeof store>) {
	const status = planStatus(opened, 'checkout')
	return [status.state, status.defects.map((defect) => `${defect.runId}/${defect.findingId}`)]
}

test('a narrow run that passes other tests does not close a defect or reach acceptance', (t) => {
	const opened = store(t)
	ready(opened)
	failedRun(opened, 'run-1', 'b1')
	passRun(opened, 'run-2', 'b2', ['T1'])
	assert.deepEqual(openDefects(opened), ['defects_open', ['run-1/F1']])
	assert.deepEqual(planStatus(opened, 'checkout').why, ['run-1 has 1 defect on build b1'])
	accept(opened, 'run-2')
	assert.equal(planStatus(opened, 'checkout').state, 'defects_open')
})

test('a started retest does not close a defect', (t) => {
	const opened = store(t)
	ready(opened)
	failedRun(opened, 'run-1', 'b1')
	begin(opened, 'run-2', ['T1', 'T2'], 'b2', { retestOf: 'run-1' })
	assert.deepEqual(openDefects(opened), ['run_in_progress', ['run-1/F1']])
	assert.deepEqual(
		cli(opened.workspace, ['finding', 'list', '--open'])
			.lines.slice(0, 2)
			.map((line) => line.split('\t')[0]),
		['completed findings count=1', 'run-1/F1']
	)
})

test('a narrow run closes a defect only when it passes every test of the defect', (t) => {
	const opened = store(t)
	ready(opened)
	failedRun(opened, 'run-1', 'b1')
	begin(opened, 'run-2', ['T1'], 'b2')
	for (const assertionId of ['A1', 'A2']) check(opened, 'run-2', `T1.${assertionId}`, 'passed')
	closeTest(opened, actor, { runId: 'run-2', testId: 'T1' })
	finishRun(opened, actor, { runId: 'run-2', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	assert.deepEqual(openDefects(opened), ['defects_open', ['run-1/F1']])
	begin(opened, 'run-3', ['T1', 'T2'], 'b3', { retestOf: 'run-1' })
	for (const testId of ['T1', 'T2']) {
		for (const assertionId of ['A1', 'A2']) check(opened, 'run-3', `${testId}.${assertionId}`, 'passed')
		closeTest(opened, actor, { runId: 'run-3', testId })
	}
	finishRun(opened, actor, { runId: 'run-3', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	assert.deepEqual(openDefects(opened), ['awaits_acceptance', []])
})

test('a retest in the chain that finds the defect again replaces it; a run outside the chain does not', (t) => {
	const opened = store(t)
	ready(opened)
	failedRun(opened, 'run-1', 'b1')
	failedRun(opened, 'run-2', 'b2', { retestOf: 'run-1' })
	assert.deepEqual(openDefects(opened), ['defects_open', ['run-2/F1']])
	assert.deepEqual(planStatus(opened, 'checkout').next, [
		'Build a fix, then checkmate run begin <runId> checkout@2 --build <new build> --partial ready_only --retest-of run-2',
	])
	failedRun(opened, 'run-3', 'b3', { retestOf: 'run-2' })
	assert.deepEqual(openDefects(opened), ['defects_open', ['run-3/F1']])
	failedRun(opened, 'run-4', 'b4')
	assert.deepEqual(openDefects(opened), ['defects_open', ['run-3/F1', 'run-4/F1']])
	assert.deepEqual(planStatus(opened, 'checkout').why, [
		'run-3 has 1 defect on build b3',
		'run-4 has 1 defect on build b4',
	])
	assert.deepEqual(
		planStatus(opened, 'checkout').next.map((line) => line.split(' ').at(-1)),
		['run-3', 'run-4']
	)
})

test('the latest outcome of each test decides needs_retest when no defect is open', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1', 'T2'], 'b1')
	check(opened, 'run-1', 'T1.A1', 'inconclusive')
	check(opened, 'run-1', 'T1.A2', 'passed')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2', outcome: 'blocked', reason: 'T1 is inconclusive.' })
	finishRun(opened, actor, { runId: 'run-1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	passRun(opened, 'run-2', 'b2', ['T1'])
	const status = planStatus(opened, 'checkout')
	assert.deepEqual([status.state, status.why], ['needs_retest', ['T2 is blocked in run-1']])
})

function deferT2(opened: ReturnType<typeof store>, runId: string) {
	recordGap(opened, actor, {
		runId,
		gap: {
			id: 'G7',
			severity: 'blocking',
			status: 'open',
			requirementIds: [],
			testIds: ['T2'],
			question: 'Is the promotion in scope?',
			consequence: 'T2 cannot assert a total.',
			decisionId: null,
		},
	})
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Closed.' })
	answerGap(opened, actor, { planId: 'checkout', gapId: 'G7', kind: 'defer', value: 'Later.', rationale: 'R.' })
	revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	const revision = planDetail(opened, 'checkout').revision
	approved(opened, 'checkout', revision)
	return `checkout@${revision}`
}

function passOn(opened: ReturnType<typeof store>, runId: string, reference: string, tests: string[]) {
	beginRun(opened, actor, { runId, reference, tests, build: 'b2' })
	for (const testId of tests) {
		for (const assertionId of ['A1', 'A2']) check(opened, runId, `${testId}.${assertionId}`, 'passed')
		closeTest(opened, actor, { runId, testId })
	}
	finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
}

test('status ignores the defect or the inconclusive outcome of a deferred test, and finding list --open still lists the defect', (t) => {
	for (const outcome of ['failed', 'inconclusive'] as const) {
		const opened = store(t)
		ready(opened)
		begin(opened, 'run-1', ['T1', 'T2'], 'b1')
		for (const reference of ['T1.A1', 'T1.A2']) check(opened, 'run-1', reference, 'passed')
		closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
		check(opened, 'run-1', 'T2.A1', 'passed')
		if (outcome === 'failed') failT2(opened, 'run-1')
		else check(opened, 'run-1', 'T2.A2', 'inconclusive')
		closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
		const reference = deferT2(opened, 'run-1')
		const status = planStatus(opened, 'checkout')
		assert.equal(
			planDetail(opened, 'checkout').plan.tests.find((test) => test.id === 'T2')?.readiness,
			'deferred',
			outcome
		)
		assert.deepEqual(
			[status.state, status.defects, status.why],
			['awaits_acceptance', [], ['run-1 on build b1 waits for acceptance']],
			outcome
		)
		assert.deepEqual(
			findingList(opened, { open: true }).map((row) => `${row.runId}/${row.findingId}`),
			outcome === 'failed' ? ['run-1/F1'] : [],
			outcome
		)
		passOn(opened, 'run-2', reference, ['T1'])
		const after = planStatus(opened, 'checkout')
		assert.deepEqual(
			[after.state, after.why],
			['awaits_acceptance', ['run-2 on build b2 waits for acceptance']],
			outcome
		)
		accept(opened, 'run-2')
		assert.equal(planStatus(opened, 'checkout').state, 'accepted', outcome)
	}
})

test('acceptance covers every run that gives a latest outcome', (t) => {
	const opened = store(t)
	ready(opened)
	passRun(opened, 'run-1', 'b1', ['T1', 'T2'])
	passRun(opened, 'run-2', 'b2', ['T1'])
	const waiting = planStatus(opened, 'checkout')
	assert.deepEqual(
		[waiting.state, waiting.why, waiting.next],
		[
			'awaits_acceptance',
			['run-1 on build b1 waits for acceptance', 'run-2 on build b2 waits for acceptance'],
			['checkmate result accept run-1 --rationale "<why>"', 'checkmate result accept run-2 --rationale "<why>"'],
		]
	)
	accept(opened, 'run-2')
	assert.deepEqual(planStatus(opened, 'checkout').why, ['run-1 on build b1 waits for acceptance'])
	rejectResult(opened, actor, { runId: 'run-1', rationale: 'Wrong build.' })
	const rejected = planStatus(opened, 'checkout')
	assert.deepEqual(
		[rejected.state, rejected.why],
		['needs_retest', ['run-1 was rejected by tester: Wrong build.', "T2's latest pass is in rejected run-1"]]
	)
	accept(opened, 'run-1')
	const accepted = planStatus(opened, 'checkout')
	assert.deepEqual([accepted.state, accepted.why], ['accepted', ['run-1, run-2 are accepted']])
})

test('the inbox lists an earlier run of a retest chain while status waits for it', (t) => {
	const opened = store(t)
	target(opened)
	const value = candidate()
	value.tests[1].dependsOn = []
	plan(opened, 'checkout', value)
	revised(opened)
	approved(opened)
	begin(opened, 'run-1', ['T1', 'T2'], 'b1')
	for (const reference of ['T1.A1', 'T1.A2']) check(opened, 'run-1', reference, 'passed')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	check(opened, 'run-1', 'T2.A1', 'passed')
	failT2(opened, 'run-1')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
	finishRun(opened, actor, { runId: 'run-1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	begin(opened, 'run-2', ['T2'], 'b2', { retestOf: 'run-1' })
	for (const assertionId of ['A1', 'A2']) check(opened, 'run-2', `T2.${assertionId}`, 'passed')
	closeTest(opened, actor, { runId: 'run-2', testId: 'T2' })
	finishRun(opened, actor, { runId: 'run-2', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	assert.deepEqual(
		inbox(opened).results.map((row) => row.runId),
		['run-1', 'run-2']
	)
	accept(opened, 'run-2')
	const status = planStatus(opened, 'checkout')
	assert.deepEqual([status.state, status.why], ['awaits_acceptance', ['run-1 on build b1 waits for acceptance']])
	assert.deepEqual(
		inbox(opened).results.map((row) => row.runId),
		['run-1']
	)
	accept(opened, 'run-1')
	assert.deepEqual(inbox(opened).results, [])
	assert.equal(planStatus(opened, 'checkout').state, 'accepted')
})

test('needs you puts blocking questions first, then claims by severity, approvals, and other questions', (t) => {
	const workspace = directory(t)
	seedVolume(workspace)
	t.after(endSeededProcesses)
	const opened = store(t, workspace)
	const waiting = needsYou(opened)
	const groups = waiting.items.map((item) => item.group)
	assert.deepEqual([...new Set(groups)], ['blocking', 'claims', 'approvals', 'questions'])
	assert.deepEqual(
		groups,
		[...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b))
	)
	const severities = waiting.items.filter((item) => item.kind === 'claim').map((item) => item.severity!)
	assert.deepEqual(
		severities,
		[...severities].sort((a, b) => ranks.indexOf(a) - ranks.indexOf(b))
	)
	assert(waiting.items.filter((item) => item.group === 'blocking').every((item) => item.severity === 'blocking'))
	assert.equal(waiting.urgent, waiting.items.filter((item) => item.group !== 'questions').length)
	assert.deepEqual(
		waiting.running.map((item) => [item.explorationId, item.paused !== null]),
		[
			['x-10', true],
			['x-9', false],
			['x-14', false],
		]
	)
	assert.deepEqual(
		waiting.failed.map((item) => item.explorationId),
		['x-17']
	)
	const claim = mergedClaims(opened, 'checkout').find((item) => item.id === 'a1/D1')!
	const file = claimEvidence(opened, 'checkout', 'a1/D1', 0)
	assert.equal(file.mediaType, 'image/png')
	assert.equal(file.size, (claim.evidence[0] as { size: number }).size)
	assert.throws(() => claimEvidence(opened, 'checkout', 'a1/D1', 9), /Unknown evidence 9/)
})

const order = ['blocking', 'claims', 'approvals', 'questions']
const ranks = ['critical', 'high', 'medium', 'low']
