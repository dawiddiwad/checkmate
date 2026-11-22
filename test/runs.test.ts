import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../plugin/src/store.ts'
import {
	acceptResult,
	beginRun,
	checkAssertion,
	closeTest,
	finishRun,
	recordFinding,
	recordGap,
	rejectResult,
	resumeRun,
	runResult,
	runState,
	stoppedReason,
} from '../plugin/src/runs.ts'
import {
	adoptGaps,
	answerGap,
	patchPlan,
	planRevision,
	planRunGaps,
	rejectPlan,
	revisePlan,
} from '../plugin/src/plans.ts'
import { inbox, planStatus, runDetail } from '../plugin/src/views.ts'
import { addInstance, retireInstance, saveTarget } from '../plugin/src/targets.ts'
import {
	accept,
	actor,
	approved,
	begin,
	check,
	defectRun,
	evidenceFile,
	failT2,
	passRun,
	plan,
	profile,
	ready,
	regressionPlan,
	revised,
	store,
	target,
} from './support.ts'

const finish = (opened: Store, runId = 'run-1', completion = 'completed', cleanup = 'completed') =>
	finishRun(opened, actor, {
		runId,
		completion,
		...(completion === 'interrupted' ? { cause: 'host_stopped', reason: 'The host stopped the session.' } : {}),
		cleanup,
		cleanupReason: 'Closed the browser.',
	})
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
	assert.throws(() => check(opened, 'run-1', 'T2.A1', 'passed'), /Prerequisite T1 is not closed/)
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
	close(opened, 'T2', { outcome: 'not_run', reason: 'Skipped by the oracle.' })
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

test('a deadline cause needs 90 percent of the deadline of the current attempt', (t) => {
	const start = Date.parse('2026-11-15T10:00:00.000Z')
	t.mock.timers.enable({ apis: ['Date'], now: start })
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1', 'T2'], 'build-1', { timeoutSeconds: 100 })
	t.mock.timers.tick(12_000)
	assert.deepEqual(runDetail(opened, 'run-1').clock, {
		attemptStartedAt: '2026-11-15T10:00:00.000Z',
		deadline: '2026-11-15T10:01:40.000Z',
		deadlineSeconds: 100,
		elapsedSeconds: 12,
		remainingSeconds: 88,
	})
	const early =
		/Only 12% of the deadline is used: 12 of 100 seconds, 88 remain until 2026-11-15T10:01:40.000Z\. Continue the remaining tests\./
	const interrupt = (extra: { cause?: string; reason?: string }) =>
		finishRun(opened, actor, {
			runId: 'run-1',
			completion: 'interrupted',
			cleanup: 'completed',
			cleanupReason: 'Closed.',
			...extra,
		})
	const rows: Array<[string, () => unknown, RegExp]> = [
		[
			'blocked by deadline',
			() => close(opened, 'T2', { outcome: 'blocked', cause: 'deadline', reason: 'Late.' }),
			early,
		],
		[
			'not_run by deadline',
			() => close(opened, 'T2', { outcome: 'not_run', cause: 'deadline', reason: 'Late.' }),
			early,
		],
		[
			'error with cause',
			() => close(opened, 'T2', { outcome: 'error', cause: 'deadline', reason: 'x' }),
			/--cause applies only with --outcome not_run or blocked/,
		],
		[
			'unknown close cause',
			() => close(opened, 'T2', { outcome: 'not_run', cause: 'budget', reason: 'x' }),
			/Invalid cause/,
		],
		[
			'interrupted without cause',
			() => interrupt({ reason: 'Stopped.' }),
			/Missing cause \(--cause\) for completion interrupted/,
		],
		[
			'interrupted without reason',
			() => interrupt({ cause: 'host_stopped' }),
			/Missing reason \(--reason\) for completion interrupted/,
		],
		['interrupted by deadline', () => interrupt({ cause: 'deadline', reason: 'Late.' }), early],
		[
			'cause on completed',
			() =>
				finishRun(opened, actor, {
					runId: 'run-1',
					completion: 'completed',
					cause: 'deadline',
					cleanup: 'completed',
					cleanupReason: 'x',
				}),
			/--cause applies only with --completion interrupted/,
		],
	]
	for (const [name, act, refusal] of rows) assert.throws(act, refusal, name)
	assert.equal(close(opened, 'T2', { outcome: 'not_run', reason: 'The API request timed out.' }).status, 'completed')
	t.mock.timers.tick(78_000)
	assert.equal(close(opened, 'T1', { outcome: 'not_run', cause: 'deadline', reason: 'Late.' }).status, 'completed')
	const shown = runDetail(opened, 'run-1').tests.map((test) => [test.testId, test.cause])
	assert.deepEqual(shown, [
		['T1', 'deadline'],
		['T2', null],
	])
	assert.equal(interrupt({ cause: 'deadline', reason: 'The deadline is near.' }).status, 'interrupted')
	const { result } = runResult(opened, 'run-1')!
	assert.deepEqual([result.completionCause, result.completionReason], ['deadline', 'The deadline is near.'])
	assert.deepEqual(
		result.tests.map((test) => test.cause ?? null),
		['deadline', null, null]
	)
})

test('the factory resumes a stalled run and finishes it as interrupted because the host stopped', (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T10:00:00.000Z') })
	const opened = started(t)
	passT1(opened)
	t.mock.timers.tick(5_000)
	const resumed = resumeRun(opened, actor, { runId: 'run-1' })
	assert.deepEqual([resumed.data.attempt, resumed.data.deadline], [2, '2026-11-15T10:10:05.000Z'])
	assert.equal(runDetail(opened, 'run-1').clock.remainingSeconds, 600)
	assert.throws(() => interruptedBy(opened, 'deadline'), /Only 0% of the deadline is used/)
	assert.equal(interruptedBy(opened, 'host_stopped').status, 'interrupted')
	const { result } = runResult(opened, 'run-1')!
	assert.deepEqual(
		result.tests.map((test) => [test.testId, test.outcome]),
		[
			['T1', 'passed'],
			['T2', 'error'],
			['T3', 'not_run'],
		]
	)
	assert.equal(result.completionCause, 'host_stopped')
})

function interruptedBy(opened: Store, cause: string) {
	return finishRun(opened, actor, {
		runId: 'run-1',
		completion: 'interrupted',
		cause,
		reason: 'The worker stopped before the run finished.',
		cleanup: 'completed',
		cleanupReason: 'Closed.',
	})
}

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

test('resume refuses a retired instance even when the target has another active instance', (t) => {
	const opened = started(t)
	check(opened, 'run-1', 'T1.A1', 'passed')
	addInstance(opened, actor, {
		targetId: 'checkout-local',
		instanceId: 'replacement',
		instance: { entries: { web: 'https://replacement.example.com' } },
	})
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	const before = runDetail(opened, 'run-1')
	assert.throws(
		() => resumeRun(opened, actor, { runId: 'run-1', error: ['T1'], reason: 'The host stopped.' }),
		/Instance checkout-local\/local is retired\. Run run-1 cannot resume/
	)
	const after = runDetail(opened, 'run-1')
	assert.deepEqual([after.instance, after.attempts, after.tests], [before.instance, before.attempts, before.tests])
})

test('resume checks the latest target profile and keeps the pinned target revision', (t) => {
	const opened = started(t)
	const save = (revision: number, readyForLiveExecution: boolean) =>
		saveTarget(opened, actor, { targetId: 'checkout-local', profile: profile({ revision, readyForLiveExecution }) })
	assert.equal(save(2, false).status, 'needs_decision')
	assert.throws(
		() => resumeRun(opened, actor, { runId: 'run-1' }),
		/Target prerequisites are not ready: checkout-local@2/
	)
	assert.equal(runDetail(opened, 'run-1').attempts.length, 1)
	assert.equal(save(3, true).status, 'completed')
	assert.equal(resumeRun(opened, actor, { runId: 'run-1' }).data.attempt, 2)
	assert.equal(runDetail(opened, 'run-1').target, 'checkout-local@1')
})

test('resume gives the gate refusal and leaves the attempt, selection and recorded work intact', (t) => {
	const opened = started(t)
	passT1(opened)
	check(opened, 'run-1', 'T2.A1', 'passed')
	const before = runDetail(opened, 'run-1')
	rejectPlan(opened, actor, { reference: 'checkout@2', rationale: 'The oracle withdrew approval.' })
	const resumed = resumeRun(opened, actor, { runId: 'run-1', error: ['T2'], reason: 'The host stopped.' })
	assert.equal(resumed.status, 'rejected')
	assert.equal(resumed.refusal, 'prohibited')
	assert(resumed.reasons.includes('Plan checkout@2 is not approved'))
	const after = runDetail(opened, 'run-1')
	assert.deepEqual([after.attempts, after.request, after.tests], [before.attempts, before.request, before.tests])
	approved(opened)
	assert.equal(resumeRun(opened, actor, { runId: 'run-1' }).data.attempt, 2)
})

test('ready_only resume refuses a new blocking run gap until its affected test closes', (t) => {
	const opened = store(t)
	regressionPlan(opened)
	begin(opened)
	begin(opened, 'run-independent', ['T1'])
	runGap(opened, 'G9', 'blocking')
	const before = runDetail(opened, 'run-1')
	const refused = resumeRun(opened, actor, { runId: 'run-1', error: ['T1'], reason: 'The host stopped.' })
	assert.equal(refused.status, 'rejected')
	assert(refused.reasons.includes('Open blocking gap G9 of run-1 affects T2'))
	assert.match(refused.hint!, /checkmate run close run-1 <testId> --outcome <blocked\|error>/)
	const after = runDetail(opened, 'run-1')
	assert.deepEqual([after.attempts, after.tests], [before.attempts, before.tests])
	assert.equal(resumeRun(opened, actor, { runId: 'run-independent' }).data.attempt, 2)
	close(opened, 'T2', { outcome: 'blocked', reason: 'G9 blocks T2.' })
	const resumed = resumeRun(opened, actor, { runId: 'run-1' })
	assert.equal(resumed.data.attempt, 2)
	assert.deepEqual(
		(resumed.data.tests as { testId: string }[]).map((test) => test.testId),
		['T1']
	)
	assert.deepEqual(runState(opened, 'run-1').request.selectedTestIds, ['T1', 'T2'])
})

test('runs warn about shared open tests on the same instance, including across builds', (t) => {
	const opened = store(t)
	regressionPlan(opened)
	addInstance(opened, actor, {
		targetId: 'checkout-local',
		instanceId: 'staging',
		instance: { entries: { web: 'https://staging.example.com' } },
	})
	begin(opened, 'run-1', ['T1'], 'b1', { instance: 'local' })
	assert.deepEqual(begin(opened, 'run-matrix', ['T1'], 'b1', { instance: 'staging' }).data.warnings, [])
	assert.deepEqual(begin(opened, 'run-disjoint', ['T2'], 'b1', { instance: 'local' }).data.warnings, [])
	const duplicate = begin(opened, 'run-overlap', ['T1'], 'b2', { instance: 'local' })
	assert.deepEqual(duplicate.data.warnings, ['Run run-1 also has open tests on checkout-local/local: T1.'])
	assert.deepEqual(resumeRun(opened, actor, { runId: 'run-overlap' }).data.warnings, duplicate.data.warnings)
	assert.deepEqual(runDetail(opened, 'run-1').warnings, [
		'Run run-overlap also has open tests on checkout-local/local: T1.',
	])
	passT1(opened)
	assert.deepEqual(runDetail(opened, 'run-overlap').warnings, [])
	assert.equal((begin(opened, 'run-active', ['T1'], 'b2', { instance: 'local' }).data.warnings as string[]).length, 1)
	finish(opened, 'run-overlap', 'interrupted')
	assert.deepEqual(runDetail(opened, 'run-overlap').warnings, [])
	assert.deepEqual(runDetail(opened, 'run-active').warnings, [])
})

test('run begin runs the gate and refuses an existing run ID', (t) => {
	const opened = store(t)
	ready(opened)
	const refused = beginRun(opened, actor, { runId: 'run-1', reference: 'checkout@2', tests: ['T2'], build: 'b' })
	assert.equal(refused.status, 'needs_decision')
	assert.deepEqual(refused.reasons, ['Refused: prohibited in the current state.', 'Missing prerequisite: T1'])
	assert.equal(refused.refusal, 'prohibited')
	assert.equal(refused.hint, 'Add T1 to --tests.')
	assert.throws(() => runDetail(opened, 'run-1'), /Unknown run: run-1/)
	const begun = begin(opened)
	assert.equal(begun.data.deadlineSeconds, 600)
	assert.equal(runState(opened, 'run-1').request.onNewBlocker, 'continue_independent')
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
	begin(opened, 'run-3', ['T1'], 'b', { onNewBlocker: 'return_to_oracle' })
	assert.equal(runState(opened, 'run-3').request.onNewBlocker, 'return_to_oracle')
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

test('a retest gives a verdict for each open defect of its chain and completes only when it ran their tests', (t) => {
	const opened = store(t)
	regressionPlan(opened)
	defectRun(opened, 'run-1', 'b1')
	const retest = (runId: string, build: string, retestOf: string) => {
		const reply = beginRun(opened, actor, {
			runId,
			reference: 'checkout@2',
			build,
			partial: 'ready_only',
			retestOf,
		})
		assert.equal(reply.status, 'completed', reply.reasons.join('; '))
	}
	const verdicts = (runId: string) =>
		runDetail(opened, runId).retest.map((item) => `${item.runId}/${item.findingId} ${item.verdict}`)
	const loop = () => {
		const status = planStatus(opened, 'checkout')
		return [status.state, status.waitsOn, status.retest?.runId, status.retest?.verdicts.map((item) => item.verdict)]
	}
	const earlier = { runId: 'run-1', findingId: 'F1', title: 'Promotion stacks with loyalty', testIds: ['T2'] }
	retest('run-2', 'b2', 'run-1')
	assert.deepEqual(runState(opened, 'run-2').request.retestDefects, [earlier])
	assert.deepEqual(loop(), ['run_in_progress', 'qa', 'run-2', ['not_retested']])
	passT1(opened, 'run-2')
	closeTest(opened, actor, { runId: 'run-2', testId: 'T2', outcome: 'not_run', reason: 'Skipped.' })
	assert.throws(
		() => finish(opened, 'run-2'),
		/Retest run-2 did not run T2 of defect F1 of run-1\. Run T2, or finish as interrupted with a cause and a reason\./
	)
	assert.equal(finish(opened, 'run-2', 'interrupted').status, 'interrupted')
	assert.deepEqual(verdicts('run-2'), ['run-1/F1 not_retested'])
	assert.deepEqual(loop(), ['defects_open', 'factory', 'run-2', ['not_retested']])
	retest('run-3', 'b3', 'run-2')
	assert.deepEqual(runState(opened, 'run-3').request.retestDefects, [earlier])
	passT1(opened, 'run-3')
	check(opened, 'run-3', 'T2.A1', 'passed')
	check(opened, 'run-3', 'T2.A2', 'inconclusive')
	closeTest(opened, actor, { runId: 'run-3', testId: 'T2' })
	assert.equal(finish(opened, 'run-3').status, 'completed')
	assert.deepEqual(verdicts('run-3'), ['run-1/F1 not_retested'])
	retest('run-4', 'b4', 'run-3')
	passT1(opened, 'run-4')
	check(opened, 'run-4', 'T2.A1', 'passed')
	failT2(opened, 'run-4')
	closeTest(opened, actor, { runId: 'run-4', testId: 'T2' })
	assert.equal(finish(opened, 'run-4').status, 'completed')
	assert.deepEqual(verdicts('run-4'), ['run-1/F1 not_fixed'])
	const status = planStatus(opened, 'checkout')
	assert.deepEqual(
		status.defects.map((defect) => `${defect.runId}/${defect.findingId}`),
		['run-4/F1']
	)
	assert.match(status.next[0], /--retest-of run-4$/)
	retest('run-5', 'b5', 'run-4')
	for (const testId of ['T1', 'T2']) {
		for (const assertionId of ['A1', 'A2']) check(opened, 'run-5', `${testId}.${assertionId}`, 'passed')
		closeTest(opened, actor, { runId: 'run-5', testId })
	}
	assert.equal(finish(opened, 'run-5').status, 'completed')
	assert.deepEqual(verdicts('run-5'), ['run-4/F1 fixed'])
	assert.deepEqual(loop(), ['awaits_acceptance', 'oracle', 'run-5', ['fixed']])
	passRun(opened, 'run-6', 'b6', ['T1'])
	assert.deepEqual(loop(), ['awaits_acceptance', 'oracle', undefined, undefined])
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
		/names T1.A1, which is passed\. A defect names only failed assertions/
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
	assert.throws(
		() => finding({ id: 'F3', assertionIds: [], requirementIds: [], evidenceIds: [] }),
		/Defect F3 needs one or more failed assertions/
	)
	assert.deepEqual(
		finding({ id: 'F4', type: 'potential_issue', assertionIds: [], requirementIds: [], evidenceIds: [] }).data
			.testIds,
		[]
	)
	assert.equal(finding({ id: 'F5', requirementIds: [] }).status, 'completed')
	check(opened, 'run-1', 'T2.A1', 'passed')
	close(opened, 'T2')
	assert.equal(finish(opened).status, 'completed')
	const result = runResult(opened, 'run-1')!.result
	assert.deepEqual(result.findings.find(({ id }) => id === 'F4')?.assertionIds, [])
	assert.deepEqual(result.findings.find(({ id }) => id === 'F4')?.testIds, [])
	assert.deepEqual(result.findings.find(({ id }) => id === 'F5')?.requirementIds, [])
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
	assert.throws(() => gap({ id: 'G1' }), /Gap ID G1 is in use. Use a new ID/)
	assert.throws(() => gap({ requirementIds: ['R9'] }), /Unknown requirement in gap G7: R9/)
	assert.throws(() => gap({ testIds: ['login:T1'] }), /Unknown test in gap G7: login:T1/)
	assert.equal(gap({}).status, 'completed')
	assert.throws(() => gap({}), /Gap ID G7 is in use. Use a new ID/)
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
	runGap(opened, 'G5', 'non_blocking', 'run-1')
	assert.throws(() => runGap(opened, 'G5', 'non_blocking', 'run-1'), /Gap ID G5 is in use. Use a new ID/)
	assert.throws(() => runGap(opened, 'G3', 'non_blocking', 'run-1'), /Gap ID G3 is in use. Use a new ID/)
	const added = { severity: 'non_blocking', requirementIds: [], testIds: ['T1'], question: 'Q?', consequence: 'C.' }
	assert.throws(
		() => patchPlan(opened, actor, { reference: 'checkout@4', patch: { gaps: { G5: added } } }),
		/Gap ID G5 is in use. Use a new ID/
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

test('a result decision with a stale decision token throws and records no approval', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'])
	passT1(opened)
	finish(opened)
	const approvals = () => opened.db.prepare("SELECT count(*) AS n FROM approvals WHERE subject_id = 'run-1'").get()?.n
	acceptResult(opened, 'other', { runId: 'run-1', rationale: 'Fine.', expectDecision: 'none' })
	for (const decide of [acceptResult, rejectResult])
		assert.throws(
			() => decide(opened, actor, { runId: 'run-1', rationale: 'No.', expectDecision: 'none' }),
			/run-1 has a newer decision/
		)
	assert.equal(approvals(), 1)
	assert.equal(runDetail(opened, 'run-1').result!.latestDecision?.actor, 'other')
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

test('run begin checks the instance before the gate, uses the only active instance or a named one, and never a retired one', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	assert.throws(
		() => beginRun(opened, actor, { runId: 'run-1', reference: 'checkout@1', build: 'b1', instance: 'nope' }),
		/Unknown instance: checkout-local\/nope/
	)
	revised(opened)
	approved(opened)
	assert.equal(begin(opened, 'run-1', ['T1']).data.instanceId, 'local')
	const staging = { entries: { web: 'https://staging.example.com' }, environment: 'Staging' }
	addInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'staging', instance: staging })
	const start = (runId: string, instance?: string) =>
		beginRun(opened, actor, { runId, reference: 'checkout@2', tests: ['T1'], build: 'b', instance })
	assert.throws(
		() => start('run-2'),
		/Target checkout-local has 2 active instances: local, staging\. Name one with --instance/
	)
	assert.throws(() => start('run-2', 'prod'), /Unknown instance: checkout-local\/prod/)
	assert.equal(start('run-2', 'staging').data.instanceId, 'staging')
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'staging' })
	assert.throws(() => start('run-3', 'staging'), /Instance checkout-local\/staging is retired\. A retired instance/)
	assert.equal(start('run-3').data.instanceId, 'local')
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	assert.throws(() => start('run-4'), /Target checkout-local has no active instance/)
	assert.deepEqual(
		opened.db
			.prepare('SELECT run_id, instance_id FROM runs ORDER BY rowid')
			.all()
			.map((row) => [row.run_id, row.instance_id]),
		[
			['run-1', 'local'],
			['run-2', 'staging'],
			['run-3', 'local'],
		]
	)
	assert.equal(runDetail(opened, 'run-2').instance.environment, 'Staging')
	assert(runDetail(opened, 'run-2').instance.retired)
})

test('a retest of a refreshed sandbox runs on the new instance with the same plan and chain', (t) => {
	const opened = store(t)
	ready(opened)
	begin(opened, 'run-1', ['T1'], 'build-1')
	passT1(opened)
	finish(opened)
	assert.equal(runResult(opened, 'run-1')!.result.instanceId, 'local')
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	addInstance(opened, actor, {
		targetId: 'checkout-local',
		instanceId: 'local-2',
		instance: { entries: { web: 'http://127.0.0.1:4174' } },
	})
	const retest = beginRun(opened, actor, {
		runId: 'run-2',
		reference: 'checkout@2',
		tests: ['T1'],
		build: 'build-1',
		retestOf: 'run-1',
	})
	assert.equal(retest.status, 'completed', retest.reasons.join('; '))
	assert.equal(retest.data.instanceId, 'local-2')
	const request = runState(opened, 'run-2').request
	assert.equal(resumeRun(opened, actor, { runId: 'run-2' }).data.attempt, 2)
	assert.deepEqual(runState(opened, 'run-2').request, request)
	passT1(opened, 'run-2')
	finish(opened, 'run-2')
	const result = runResult(opened, 'run-2')!.result
	assert.deepEqual([result.retestOf, result.instanceId, result.plan.planId], ['run-1', 'local-2', 'checkout'])
})
