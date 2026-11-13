import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../plugin/src/store.ts'
import { testOutcome } from '../plugin/src/contracts.ts'
import {
	beginRun,
	checkAssertion,
	closeTest,
	finishRun,
	recordFinding,
	recordGap,
	rejectResult,
	resumeRun,
	runResult,
	stoppedReason,
} from '../plugin/src/runs.ts'
import { adoptGaps, answerGap, planRevision, planRunGaps, revisePlan } from '../plugin/src/plans.ts'
import { inbox, runDetail } from '../plugin/src/views.ts'
import { accept, actor, approved, begin, check, evidenceFile, failT2, plan, ready, store } from './support.ts'

const finish = (opened: Store, runId = 'run-1', completion = 'completed', cleanup = 'completed') =>
	finishRun(opened, actor, { runId, completion, cleanup, cleanupReason: 'Closed the browser.' })
const close = (opened: Store, testId: string, extra = {}) =>
	closeTest(opened, actor, { runId: 'run-1', testId, ...extra })

function started(t: Parameters<typeof store>[0], tests = ['T1', 'T2']) {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', tests)
	return opened
}

function passT1(opened: Store, runId = 'run-1') {
	check(opened, runId, 'T1.A1', 'passed')
	check(opened, runId, 'T1.A2', 'passed')
	closeTest(opened, actor, { runId, testId: 'T1' })
}

test('the outcome follows the first matching row: failed, error, inconclusive, passed', () => {
	assert.equal(testOutcome(['passed', 'inconclusive', 'not_checked', 'failed']), 'failed')
	assert.equal(testOutcome(['passed', 'failed']), 'failed')
	assert.equal(testOutcome(['inconclusive', 'not_checked', 'passed']), 'error')
	assert.equal(testOutcome(['passed', 'not_checked']), 'error')
	assert.equal(testOutcome(['passed', 'inconclusive']), 'inconclusive')
	assert.equal(testOutcome(['passed', 'passed']), 'passed')
})

test('run close derives the outcome from the recorded assertion results', (t) => {
	const opened = store(t)
	ready(opened)
	const rows: Array<[string, string, string]> = [
		['failed', 'not_checked', 'failed'],
		['not_checked', 'inconclusive', 'error'],
		['inconclusive', 'passed', 'inconclusive'],
		['passed', 'passed', 'passed'],
	]
	for (const [i, [a1, a2, outcome]] of rows.entries()) {
		const runId = `run-${i}`
		begin(opened, runId, ['T1'])
		check(opened, runId, 'T1.A1', a1 as 'passed')
		check(opened, runId, 'T1.A2', a2 as 'passed')
		const closed = closeTest(opened, actor, { runId, testId: 'T1' })
		assert.equal(closed.data.outcome, outcome, `${a1} + ${a2}`)
		if (outcome === 'error') assert.equal(closed.data.reason, 'Assertions not checked: T1.A1')
	}
})

test('a check records one assertion; a second check and a second close are refused', (t) => {
	const opened = started(t)
	check(opened, 'run-1', 'T1.A1', 'passed')
	const detail = runDetail(opened, 'run-1')
	assert.deepEqual(
		detail.tests[0].assertions.map((assertion) => assertion.result),
		['passed', null]
	)
	assert.equal(detail.tests[0].outcome, null)
	assert.equal(detail.state, 'started')
	assert.throws(
		() => check(opened, 'run-1', 'T1.A1', 'failed'),
		/Assertion T1.A1 has a result. An assertion result is final/
	)
	assert.throws(() => close(opened, 'T1'), /Assertions without a result: T1.A2/)
	check(opened, 'run-1', 'T1.A2', 'passed')
	assert.equal(close(opened, 'T1').data.outcome, 'passed')
	assert.throws(() => close(opened, 'T1'), /Test T1 is closed as passed. A test outcome is final/)
	assert.throws(() => check(opened, 'run-1', 'T1.A2', 'passed'), /Test T1 is closed as passed/)
})

test('a check names a selected test, a known assertion, and passed prerequisites', (t) => {
	const opened = started(t, ['T1', 'T2'])
	assert.throws(() => check(opened, 'run-1', 'T3.A1', 'passed'), /Test T3 is not selected in run run-1/)
	assert.throws(() => check(opened, 'run-1', 'T1.A9', 'passed'), /Unknown assertion T1.A9/)
	assert.throws(() => check(opened, 'run-1', 'T2.A1', 'passed'), /Prerequisite T1 has not passed/)
	assert.throws(() => check(opened, 'run-2', 'T1.A1', 'passed'), /Unknown run: run-2|Evidence directory/)
	const base = { runId: 'run-1', testId: 'T1', assertionId: 'A1' }
	assert.throws(
		() => checkAssertion(opened, actor, { ...base, result: 'skipped' }),
		/Invalid result \(--result\): skipped/
	)
	assert.throws(
		() => checkAssertion(opened, actor, { ...base, result: 'passed', observed: '400 PLN' }),
		/A passed result needs an observation \(--observed\) and one or more evidence items/
	)
	assert.throws(
		() =>
			checkAssertion(opened, actor, {
				...base,
				result: 'failed',
				evidence: [evidenceFile(opened, 'run-1', 'a.txt')],
			}),
		/A failed result needs an observation/
	)
	assert.throws(
		() =>
			checkAssertion(opened, actor, {
				...base,
				result: 'inconclusive',
				observed: 'A total, without discount lines.',
				evidence: [evidenceFile(opened, 'run-1', 'b.txt')],
			}),
		/An inconclusive result needs a reason/
	)
	assert.throws(
		() =>
			checkAssertion(opened, actor, {
				...base,
				result: 'inconclusive',
				observed: 'A total.',
				reason: 'The quote does not list discounts.',
			}),
		/An inconclusive result needs an observation \(--observed\) and one or more evidence items/
	)
	assert.throws(
		() => checkAssertion(opened, actor, { ...base, result: 'not_checked' }),
		/A not_checked result needs a reason/
	)
	assert.throws(
		() => checkAssertion(opened, undefined, { ...base, result: 'not_checked', reason: 'x' }),
		/needs an actor/
	)
	assert.equal(
		checkAssertion(opened, actor, { ...base, result: 'not_checked', reason: 'Stopped after a tool failure.' }).data
			.result,
		'not_checked'
	)
})

test('run close records a test that did not start, or an error that keeps recorded results', (t) => {
	const opened = started(t)
	check(opened, 'run-1', 'T1.A1', 'passed')
	assert.throws(() => close(opened, 'T1', { outcome: 'blocked', reason: 'x' }), /T1 has assertion results/)
	assert.throws(() => close(opened, 'T1', { outcome: 'error' }), /Missing reason \(--reason\) for outcome error/)
	assert.throws(() => close(opened, 'T1', { reason: 'x' }), /--reason applies only with --outcome/)
	assert.throws(() => close(opened, 'T1', { outcome: 'passed', reason: 'x' }), /Invalid outcome/)
	const screenshot = evidenceFile(opened, 'run-1', 'error.png', 'png')
	const closed = close(opened, 'T1', { outcome: 'error', reason: 'The browser crashed.', evidence: [screenshot] })
	assert.equal(closed.data.outcome, 'error')
	const detail = runDetail(opened, 'run-1')
	assert.equal(detail.tests[0].assertions[0].result, 'passed')
	assert.deepEqual(
		detail.tests[0].evidence.map((item) => [item.kind, item.assertionId]),
		[['screenshot', null]]
	)
	assert.throws(
		() =>
			close(opened, 'T2', {
				outcome: 'not_run',
				reason: 'x',
				evidence: [evidenceFile(opened, 'run-1', 'c.txt')],
			}),
		/--evidence applies only with --outcome error/
	)
	assert.equal(close(opened, 'T2', { outcome: 'blocked', reason: 'Prerequisite T1 failed.' }).data.outcome, 'blocked')
})

test('finish completes a run with coverage, defects, and not_run for unselected tests', (t) => {
	const opened = started(t)
	passT1(opened)
	check(opened, 'run-1', 'T2.A1', 'passed')
	failT2(opened, 'run-1')
	close(opened, 'T2')
	const finished = finish(opened)
	assert.equal(finished.status, 'completed')
	assert.deepEqual(finished.data.counts, { passed: 1, failed: 1 })
	const { result, sha256 } = runResult(opened, 'run-1')!
	assert.equal(finished.data.sha256, sha256)
	assert.deepEqual(
		result.tests.map((test) => [test.testId, test.outcome, test.reason]),
		[
			['T1', 'passed', null],
			['T2', 'failed', null],
			['T3', 'not_run', 'Test was not selected.'],
		]
	)
	assert.deepEqual(result.tests[1].assertions[1].check, 'totalPLN equals 240.')
	assert.deepEqual(result.findings[0].testIds, ['T2'])
	assert.deepEqual(
		result.coverage.requirements.map((row) => row.status),
		['tested', 'tested', 'deferred']
	)
	assert.equal(result.coverage.status, 'partial')
	assert.equal(result.attempts, 1)
	assert.throws(() => finish(opened), /Run run-1 is finished. A finished run does not change/)
	assert.throws(() => check(opened, 'run-1', 'T1.A1', 'passed'), /is finished/)
})

test('finish refuses a completed run that is not complete', (t) => {
	const opened = started(t)
	assert.throws(() => finish(opened), /Selected tests are not closed: T1, T2. Close them, or finish as interrupted/)
	check(opened, 'run-1', 'T1.A1', 'passed')
	check(opened, 'run-1', 'T1.A2', 'failed')
	close(opened, 'T1')
	close(opened, 'T2', { outcome: 'blocked', reason: 'T1 failed.' })
	assert.throws(() => finish(opened), /Failed assertion T1.A2 needs a defect finding/)
	recordFinding(opened, actor, {
		runId: 'run-1',
		finding: {
			id: 'F1',
			type: 'defect',
			severity: 'low',
			assertionIds: ['T1.A2'],
			requirementIds: ['R1'],
			title: 'Two items',
			expected: 'One item.',
			observed: 'Two items.',
			reproduction: ['Check out.'],
			evidenceIds: runDetail(opened, 'run-1').tests[0].assertions[1].evidence.map((item) => item.id),
		},
	})
	assert.throws(
		() => finish(opened, 'run-1', 'completed', 'failed'),
		/Cleanup failed, so the run cannot be completed/
	)
	assert.equal(finish(opened).status, 'completed')
})

test('finish needs a cause for a selected test that did not run', (t) => {
	const opened = started(t)
	passT1(opened)
	close(opened, 'T2', { outcome: 'not_run', reason: 'Ran out of time.' })
	assert.throws(() => finish(opened), /Selected test T2 is not_run without a cause/)
	recordGap(opened, actor, {
		runId: 'run-1',
		gap: {
			id: 'G7',
			severity: 'blocking',
			status: 'open',
			requirementIds: ['R2'],
			testIds: ['T2'],
			question: 'The quote API changed. Which version applies?',
			consequence: 'The quote cannot be checked.',
			decisionId: null,
		},
	})
	const finished = finish(opened)
	assert.equal(finished.status, 'completed')
	assert.deepEqual(
		runResult(opened, 'run-1')!.result.newGaps.map((gap) => gap.id),
		['G7']
	)
})

test('finish refuses an error outcome for a completed run and accepts it as an operational error', (t) => {
	const opened = started(t, ['T1'])
	check(opened, 'run-1', 'T1.A1', 'passed')
	check(opened, 'run-1', 'T1.A2', 'not_checked', { reason: 'The tool failed.' })
	assert.equal(close(opened, 'T1').data.outcome, 'error')
	assert.throws(() => finish(opened), /Operational failure cannot be completed: T1 closed as error/)
	const finished = finish(opened, 'run-1', 'operational_error')
	assert.equal(finished.status, 'operational_error')
	assert.equal(runResult(opened, 'run-1')!.result.coverage.status, 'partial')
})

test('a requirement that only a deferred decision leaves open is deferred; a missing check is uncovered', (t) => {
	const opened = started(t, ['T1'])
	passT1(opened)
	finish(opened)
	const { result } = runResult(opened, 'run-1')!
	assert.deepEqual(
		result.coverage.requirements.map((row) => [row.requirementId, row.status, row.reason]),
		[
			['R1', 'tested', null],
			['R2', 'uncovered', 'At least one required check or decision is missing.'],
			['R3', 'deferred', 'An oracle decision deferred the missing checks.'],
		]
	)
	assert.equal(result.coverage.status, 'partial')
})

test('an inconclusive test does not cover its requirement and does not prevent completion', (t) => {
	const opened = started(t, ['T1'])
	check(opened, 'run-1', 'T1.A1', 'inconclusive', { reason: 'The page shows a total but not its currency.' })
	check(opened, 'run-1', 'T1.A2', 'passed')
	assert.equal(close(opened, 'T1').data.outcome, 'inconclusive')
	assert.equal(finish(opened).status, 'completed')
	const { result } = runResult(opened, 'run-1')!
	assert.deepEqual(result.coverage.requirements[0], {
		requirementId: 'R1',
		status: 'uncovered',
		testIds: ['T1'],
		reason: 'An assertion is inconclusive.',
	})
	assert.equal(result.tests[0].assertions[0].reason, 'The page shows a total but not its currency.')
})

test('an interrupted finish records each unclosed selected test as error', (t) => {
	const opened = started(t)
	passT1(opened)
	check(opened, 'run-1', 'T2.A1', 'passed')
	const finished = finish(opened, 'run-1', 'interrupted', 'failed')
	assert.equal(finished.status, 'interrupted')
	const { result } = runResult(opened, 'run-1')!
	assert.deepEqual(
		result.tests.map((test) => [test.testId, test.outcome, test.reason]),
		[
			['T1', 'passed', null],
			['T2', 'error', stoppedReason],
			['T3', 'not_run', 'Test was not selected.'],
		]
	)
	assert.equal(result.tests[1].assertions.length, 1)
	assert.equal(result.completion, 'interrupted')
	assert.equal(result.cleanup.status, 'failed')
})

test('resume keeps recorded results, lists what is open, and can close stalled tests as error', (t) => {
	const opened = started(t)
	passT1(opened)
	check(opened, 'run-1', 'T2.A1', 'passed')
	const resumed = resumeRun(opened, actor, { runId: 'run-1' })
	assert.equal(resumed.data.attempt, 2)
	assert.deepEqual(resumed.data.tests, [
		{
			testId: 'T2',
			warning: 'Actions may have occurred',
			recorded: 1,
			assertions: [{ id: 'A2', check: 'totalPLN equals 240.', checkKind: 'deterministic' }],
		},
	])
	assert.equal(runDetail(opened, 'run-1').tests[1].assertions[0].result, 'passed')
	assert.throws(() => resumeRun(opened, actor, { runId: 'run-1', reason: 'x' }), /--reason applies only with --error/)
	assert.throws(() => resumeRun(opened, actor, { runId: 'run-1', error: ['T2'] }), /Missing reason/)
	assert.throws(() => resumeRun(opened, actor, { runId: 'run-1', error: ['T1'], reason: 'x' }), /T1 is closed/)
	assert.throws(() => resumeRun(opened, actor, { runId: 'run-1', error: ['T3'], reason: 'x' }), /T3 is not selected/)
	const stalled = resumeRun(opened, actor, { runId: 'run-1', error: ['T2'], reason: 'The worker stopped in T2.' })
	assert.equal(stalled.data.attempt, 3)
	assert.deepEqual(stalled.data.tests, [])
	assert.deepEqual(
		runDetail(opened, 'run-1').attempts.map((row) => row.attempt),
		[1, 2, 3]
	)
	finish(opened, 'run-1', 'operational_error')
	const { result } = runResult(opened, 'run-1')!
	assert.equal(result.attempts, 3)
	assert.deepEqual(
		[result.tests[1].outcome, result.tests[1].reason, result.tests[1].assertions.length],
		['error', 'The worker stopped in T2.', 1]
	)
})

test('run begin runs the gate and refuses an existing run ID', (t) => {
	const opened = store(t)
	ready(opened)
	const refused = beginRun(opened, actor, { runId: 'run-1', reference: 'checkout@2', tests: ['T2'], build: 'b' })
	assert.equal(refused.status, 'needs_decision')
	assert.deepEqual(refused.reasons, ['Missing prerequisite: T1'])
	assert.throws(() => runDetail(opened, 'run-1'), /Unknown run: run-1/)
	const begun = begin(opened)
	assert.equal(begun.data.deadlineSeconds, 600)
	assert.match(String(begun.data.browserSession), /^cm-/)
	assert.equal(begun.data.evidenceDirectory, '.checkmate/tmp/run-1/')
	assert.throws(() => begin(opened), /Run run-1 exists/)
	assert.throws(
		() =>
			beginRun(opened, actor, {
				runId: 'run-2',
				reference: 'checkout@2',
				tests: ['T1'],
				build: 'b',
				timeoutSeconds: 0,
			}),
		/Invalid timeout: 0/
	)
	assert.throws(
		() => beginRun(opened, actor, { runId: 'run 2', reference: 'checkout@2', tests: ['T1'], build: 'b' }),
		/Invalid run ID/
	)
})

test('a retest is a new run with a new build of a finished run with the same plan and target', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'], 'build-1')
	const retest = (runId: string, build: string) =>
		beginRun(opened, actor, { runId, reference: 'checkout@2', tests: ['T1'], build, retestOf: 'run-1' })
	assert.throws(() => retest('run-2', 'build-2'), /Run run-1 is not finished. Retest a finished run/)
	passT1(opened)
	finish(opened)
	assert.throws(() => retest('run-2', 'build-1'), /Retest needs a new build/)
	assert.throws(() => retest('run-1', 'build-2'), /Run run-1 exists/)
	plan(opened, 'other')
	approved(opened, 'other', 1)
	assert.throws(
		() =>
			beginRun(opened, actor, {
				runId: 'run-2',
				reference: 'other@1',
				tests: ['T1'],
				build: 'b2',
				retestOf: 'run-1',
			}),
		/Retest scope changed: run-1 ran plan checkout/
	)
	const before = runResult(opened, 'run-1')!.sha256
	assert.equal(retest('run-4', 'build-4').status, 'completed')
	passT1(opened, 'run-4')
	finish(opened, 'run-4')
	assert.equal(runResult(opened, 'run-4')!.result.retestOf, 'run-1')
	assert.equal(runResult(opened, 'run-1')!.sha256, before)
})

test('findings name recorded assertions, matching requirements, and evidence of those assertions', (t) => {
	const opened = started(t)
	const passed = check(opened, 'run-1', 'T1.A1', 'passed')
	check(opened, 'run-1', 'T1.A2', 'passed')
	close(opened, 'T1')
	const failed = check(opened, 'run-1', 'T2.A2', 'failed')
	const finding = (overrides: Record<string, unknown>) =>
		recordFinding(opened, actor, {
			runId: 'run-1',
			finding: {
				id: 'F1',
				type: 'defect',
				severity: 'medium',
				assertionIds: ['T2.A2'],
				requirementIds: ['R2'],
				title: 'Wrong total',
				expected: '240',
				observed: '220',
				reproduction: ['Apply the promotion.'],
				evidenceIds: failed.data.evidenceIds,
				...overrides,
			},
		})
	assert.throws(
		() => finding({ assertionIds: ['T1.A1'], requirementIds: ['R1'] }),
		/names T1.A1, which is not failed/
	)
	assert.throws(() => finding({ assertionIds: ['T2.A9'] }), /Unknown assertion in finding F1: T2.A9/)
	assert.throws(() => finding({ assertionIds: ['T3.A1'] }), /Test T3 is not selected/)
	assert.throws(() => finding({ requirementIds: ['R1'] }), /requirement R1, which test T2 does not cover/)
	assert.throws(
		() => finding({ evidenceIds: passed.data.evidenceIds }),
		/does not belong to the assertions or tests of finding F1/
	)
	assert.throws(() => finding({ evidenceIds: ['01ABCDEFGHJKMNPQRSTVWXYZ00'] }), /Unknown evidence in finding F1/)
	assert.equal(finding({}).status, 'completed')
	assert.throws(() => finding({}), /Finding F1 exists in run run-1/)
	assert.deepEqual(
		finding({
			id: 'F2',
			type: 'potential_issue',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			evidenceIds: passed.data.evidenceIds,
		}).data.testIds,
		['T1']
	)
})

test('a runtime gap is new, open, and names known requirements and tests', (t) => {
	const opened = started(t)
	const gap = (overrides: Record<string, unknown>) =>
		recordGap(opened, actor, {
			runId: 'run-1',
			gap: {
				id: 'G7',
				severity: 'non_blocking',
				status: 'open',
				requirementIds: ['R2'],
				testIds: ['T2'],
				question: 'Is the label right?',
				consequence: 'Unchecked label.',
				decisionId: null,
				...overrides,
			},
		})
	assert.throws(() => gap({ status: 'resolved' }), /must be open and have no decision/)
	assert.throws(() => gap({ id: 'G1' }), /Gap G1 exists in checkout@2/)
	assert.throws(() => gap({ requirementIds: ['R9'] }), /Unknown requirement in gap G7: R9/)
	assert.throws(() => gap({ testIds: ['login:T1'] }), /Unknown test in gap G7: login:T1/)
	assert.equal(gap({}).status, 'completed')
	assert.throws(() => gap({}), /Gap G7 exists in run run-1/)
})

function runGap(opened: Store, id: string, severity: 'blocking' | 'non_blocking', runId = 'run-1') {
	return recordGap(opened, actor, {
		runId,
		gap: {
			id,
			severity,
			status: 'open',
			requirementIds: [],
			testIds: ['T2'],
			question: `${id}: is the label right?`,
			consequence: 'Unchecked label.',
			decisionId: null,
		},
	})
}

test('plan adopt-gaps brings run gaps into the next revision or into an unused revision in place', (t) => {
	const opened = started(t)
	runGap(opened, 'G3', 'blocking')
	runGap(opened, 'G4', 'non_blocking')
	const adopt = (reference: string, gapIds?: string[]) =>
		adoptGaps(opened, actor, { reference, runId: 'run-1', gapIds })
	assert.throws(() => adopt('checkout@1'), /checkout@1 is not the latest revision. Edit checkout@2/)
	assert.throws(() => adoptGaps(opened, actor, { reference: 'checkout@2', runId: 'run-9' }), /Unknown run: run-9/)
	assert.throws(() => adopt('checkout@2', ['G9']), /Run run-1 has no gap G9/)
	const first = adopt('checkout@2', ['G3'])
	assert.deepEqual(
		[first.status, first.subject, first.data.edit, first.data.reason, first.data.adopted],
		['needs_decision', 'checkout@3', 'new_revision', 'run', ['G3']]
	)
	assert.deepEqual(first.reasons, ['G3: G3: is the label right?'])
	const third = planRevision(opened, 'checkout', 3).plan
	assert.equal(third.tests.find((test) => test.id === 'T2')!.readiness, 'blocked')
	assert.deepEqual(
		planRunGaps(opened, 'checkout').map((item) => [item.runId, item.gap.id, item.adopted]),
		[
			['run-1', 'G3', true],
			['run-1', 'G4', false],
		]
	)
	assert.throws(() => adopt('checkout@3', ['G3']), /Gap G3 of run run-1 is in plan checkout/)
	const second = adopt('checkout@3')
	assert.deepEqual([second.subject, second.data.edit, second.data.adopted], ['checkout@3', 'in_place', ['G4']])
	assert.throws(() => adopt('checkout@3'), /Run run-1 has no gap to adopt/)
	const log = opened.db
		.prepare("SELECT subjects FROM operations WHERE command = 'plan adopt-gaps' AND status != 'rejected'")
		.all()
	assert.deepEqual(
		log.map((row) => JSON.parse(String(row.subjects))),
		[
			['plan:checkout', 'inbox', 'run:run-1'],
			['plan:checkout', 'inbox', 'run:run-1'],
		]
	)
})

test('gap answer adopts a run gap into the plan and records the decision on that revision', (t) => {
	const opened = started(t)
	runGap(opened, 'G3', 'blocking')
	assert.deepEqual(
		inbox(opened).gaps.map((gap) => [gap.planId, gap.revision, gap.gapId, gap.runId]),
		[['checkout', 2, 'G3', 'run-1']]
	)
	const answer = (gapId: string) =>
		answerGap(opened, actor, { planId: 'checkout', gapId, kind: 'defer', value: 'Not now.', rationale: 'Scope.' })
	assert.throws(() => answer('G9'), /Unknown gap G9 in checkout@2/)
	const answered = answer('G3')
	assert.equal(answered.status, 'completed')
	assert.deepEqual(answered.data.adopted, { runId: 'run-1', revision: 3, edit: 'new_revision' })
	assert.equal(answered.data.baseRevision, 3)
	assert.deepEqual(planRevision(opened, 'checkout', 3).plan.gaps.at(-1)!.id, 'G3')
	assert.deepEqual(inbox(opened).gaps, [])
	assert.deepEqual(
		inbox(opened).plans.map((row) => row.revision),
		[3]
	)
	const revised = revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	assert.equal(revised.subject, 'checkout@4')
	assert.equal(planRevision(opened, 'checkout', 4).plan.gaps.at(-1)!.status, 'deferred')
	begin(opened, 'run-2', ['T1'], 'build-2')
	runGap(opened, 'G5', 'non_blocking', 'run-1')
	runGap(opened, 'G5', 'non_blocking', 'run-2')
	assert.throws(
		() => answer('G5'),
		/Gap G5 is in runs run-1, run-2. Run plan adopt-gaps checkout@4 --run <runId> --gaps G5 first/
	)
})

test('result accept and reject need a finished run and record the result digest', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'])
	assert.throws(() => accept(opened, 'run-1'), /Run run-1 is not finished/)
	passT1(opened)
	finish(opened)
	assert.deepEqual(
		inbox(opened).results.map((row) => row.runId),
		['run-1']
	)
	assert.throws(
		() => rejectResult(opened, actor, { runId: 'run-1', rationale: 'No.', expectSha256: '12345678' }),
		/run-1 has digest/
	)
	const accepted = accept(opened, 'run-1')
	assert.equal(accepted.data.sha256, runResult(opened, 'run-1')!.sha256)
	assert.deepEqual(inbox(opened).results, [])
	assert.equal(runDetail(opened, 'run-1').result!.acceptance, 'approved')
})

test('run finish removes the evidence directory of the run with its files', (t) => {
	const opened = started(t, ['T1'])
	begin(opened, 'run-2', ['T1'], 'build-2')
	const tmp = join(opened.workspace, '.checkmate/tmp')
	passT1(opened)
	finish(opened)
	assert.deepEqual(readdirSync(tmp), ['run-2'])
	passT1(opened, 'run-2')
	evidenceFile(opened, 'run-2', 'left.txt')
	mkdirSync(join(tmp, 'run-2', 'browser'))
	evidenceFile(opened, 'run-2', 'browser/page.yml')
	finish(opened, 'run-2')
	assert.equal(existsSync(tmp), false)
})

test('run finish removes .checkmate/tmp when no run directory is left', (t) => {
	const opened = started(t, ['T1'])
	passT1(opened)
	finish(opened)
	assert.equal(existsSync(join(opened.workspace, '.checkmate/tmp')), false)
})
