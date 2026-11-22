import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore, completed, openStore, write } from '../plugin/src/store.ts'
import { acceptResult, beginRun, closeTest, finishRun } from '../plugin/src/runs.ts'
import { approvePlan, openPlan, patchPlan, savePlan } from '../plugin/src/plans.ts'
import { promotePlan } from '../plugin/src/promotion.ts'
import { saveRules } from '../plugin/src/rules.ts'
import {
	accept,
	actor,
	candidate as sampleCandidate,
	check,
	directory,
	plan,
	planRequest,
	passRun,
	ready,
	root,
	store,
	target,
} from './support.ts'
import { fakeClaude } from './claude.ts'

const candidate = {
	requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
	tests: [
		{
			id: 'T1',
			title: 'Quote',
			requirementIds: ['R1'],
			capability: 'http',
			operations: ['read_catalog'],
			dependsOn: [],
			preconditions: [],
			action: 'Read the quote.',
			assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
		},
	],
	gaps: [],
}

test('build-first records, accepts and explicitly promotes the passing ticket tests', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	closeStore(opened)
	const fake = fakeClaude(t, { recorder: [{ kind: 'note', text: 'Explored the first build.' }] }, 'pi')
	const command = (args: string[], stdin = '') => {
		const result = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, ...fake.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' },
			stdin: () => stdin,
		})
		return { code: result.code, body: JSON.parse(result.output), output: result.output }
	}
	const ok = (args: string[], stdin = '') => {
		const result = command(args, stdin)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const refused = (args: string[], pattern: RegExp) => {
		const result = command(args)
		assert.equal(result.code, 1, result.output)
		assert.match(result.output, pattern)
	}
	ok([
		'plan',
		'open',
		'ticket-1',
		'--target',
		'checkout-local@1',
		'--objective',
		'Check the quote.',
		'--source',
		'ticket.md',
	])
	ok(['plan', 'save', 'ticket-1'], JSON.stringify(candidate))
	ok(['plan', 'approve', 'ticket-1@1', '--rationale', 'The ticket rules are correct.'])
	const initial = ok(['explore', 'start', 'ticket-1', '--build', 'broken', '--level', 'smoke', '--allow', 'Read'])
	assert.equal(ok(['explore', 'wait', initial.explorationId, '--timeout', '60']).state, 'completed')
	ok(['run', 'begin', 'run-1', 'ticket-1@1', '--build', 'broken', '--tests', 'T1'])
	const failed = ok(
		['run', 'check', 'run-1', 'T1', 'A1', '--result', 'failed', '--observed', '220', '--evidence', '-'],
		'HTTP 200: 220'
	)
	ok(
		['run', 'finding', 'run-1'],
		JSON.stringify({
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			title: 'Wrong quote',
			expected: '240',
			observed: '220',
			reproduction: ['Read the quote.'],
			evidenceIds: failed.evidenceIds,
		})
	)
	ok(['run', 'close', 'run-1', 'T1'])
	ok([
		'run',
		'finish',
		'run-1',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No test data.',
	])
	ok(['result', 'accept', 'run-1', '--rationale', 'The finding is valid.'])
	refused(
		['plan', 'promote', 'ticket-1@1', '--run', 'run-1', '--build', 'broken', '--rationale', 'Save tests.'],
		/not accepted|did not pass/
	)
	ok(['run', 'begin', 'run-2', 'ticket-1@1', '--build', 'fixed', '--tests', 'T1', '--retest-of', 'run-1'])
	refused(
		['run', 'check', 'run-2', 'T1', 'A1', '--result', 'passed', '--observed', '240'],
		/needs an observation.*evidence/
	)
	ok(
		['run', 'check', 'run-2', 'T1', 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'],
		'HTTP 200: 240'
	)
	ok(['run', 'close', 'run-2', 'T1'])
	ok([
		'run',
		'finish',
		'run-2',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No test data.',
	])
	const promote = [
		'plan',
		'promote',
		'ticket-1@1',
		'--run',
		'run-2',
		'--build',
		'fixed',
		'--rationale',
		'Save tests.',
	]
	refused(promote, /Accept result/)
	ok(['result', 'accept', 'run-2', '--rationale', 'The fixed build passes.'])
	refused(
		['plan', 'promote', 'other@1', '--run', 'run-2', '--build', 'fixed', '--rationale', 'Save tests.'],
		/does not belong/
	)
	refused(
		['plan', 'promote', 'ticket-1@1', '--run', 'run-2', '--build', 'broken', '--rationale', 'Save tests.'],
		/not on build/
	)
	fake.reply({ explorer: '!fail' })
	const interrupted = ok(['explore', 'start', 'ticket-1', '--build', 'fixed', '--level', 'smoke', '--allow', 'Read'])
	assert.equal(command(['explore', 'wait', interrupted.explorationId, '--timeout', '60']).code, 1)
	refused(promote, /Exploration .* is failed/)
	fake.reply({ recorder: [{ kind: 'note', text: 'Exploration completed.' }] })
	const old = ok(['explore', 'start', 'ticket-1', '--build', 'broken', '--level', 'smoke', '--allow', 'Read'])
	ok(['explore', 'wait', old.explorationId, '--timeout', '60'])
	refused(promote, /not the latest build/)
	const current = ok(['explore', 'start', 'ticket-1', '--build', 'fixed', '--level', 'smoke', '--allow', 'Read'])
	ok(['explore', 'wait', current.explorationId, '--timeout', '60'])
	assert.equal(ok(['query', 'SELECT * FROM plan_promotions']).rows.length, 0)
	assert.equal(ok(['query', "SELECT revision FROM plan_revisions WHERE plan_id = 'ticket-1'"]).rows.length, 1)
	const saved = ok(promote)
	assert.deepEqual([saved.subject, saved.recorded, saved.tests], ['ticket-1@2', true, ['T1']])
	assert.deepEqual([ok(promote).subject, ok(promote).recorded], ['ticket-1@2', false])
	const revisions = ok([
		'query',
		"SELECT revision FROM plan_revisions WHERE plan_id = 'ticket-1' ORDER BY revision",
	]).rows
	assert.deepEqual(
		revisions.map((row: { revision: number }) => row.revision),
		[1, 2]
	)
	const records = ok(['query', 'SELECT * FROM plan_promotions']).rows
	assert.equal(records.length, 1)
	assert.deepEqual(
		[
			records[0].plan_id,
			records[0].source_revision,
			records[0].promoted_revision,
			records[0].run_id,
			records[0].build,
		],
		['ticket-1', 1, 2, 'run-2', 'fixed']
	)
	const shown = ok(['plan', 'show', 'ticket-1@2'])
	assert.equal(shown.plan.tests[0].id, 'T1')
	const direct = openStore(workspace)
	assert.throws(
		() => direct.db.exec("UPDATE plan_revisions SET body = body WHERE plan_id = 'ticket-1' AND revision = 2"),
		/promoted plan revisions are immutable/
	)
	closeStore(direct)
	assert.deepEqual(JSON.parse(records[0].tests), ['T1'])
	const original = ok(['query', "SELECT body FROM results WHERE run_id = 'run-1'"]).rows[0]
	assert.equal(JSON.parse(original.body).tests[0].outcome, 'failed')
	assert.ok(JSON.parse(original.body).tests[0].assertions[0].evidenceIds.length)
	const promotions = ok(['plan', 'promotions', 'ticket-1']).promotions
	assert.deepEqual(
		[
			promotions[0].sourceRevision,
			promotions[0].revision,
			promotions[0].build,
			promotions[0].runId,
			promotions[0].tests,
		],
		[1, 2, 'fixed', 'run-2', ['T1']]
	)
	const bundled = JSON.parse(
		execFileSync(
			process.execPath,
			[
				join(root, 'plugin/dist/checkmate.js'),
				'plan',
				'promotions',
				'ticket-1',
				'--workspace',
				workspace,
				'--json',
			],
			{ encoding: 'utf8' }
		)
	)
	assert.deepEqual(bundled.promotions[0].tests, ['T1'])
	const printed = run(['plan', 'promotions', 'ticket-1', '--workspace', workspace], {
		cwd: workspace,
		env: { ...process.env, ...fake.env },
		stdin: () => '',
	})
	assert.match(printed.output, /sha256=[a-f0-9]{8}/)
	refused(
		['plan', 'promote', 'ticket-1@1', '--run', 'run-1', '--build', 'broken', '--rationale', 'Save tests.'],
		/not the latest build/
	)
	const edited = ok(
		['plan', 'edit', 'ticket-1@2', '--patch'],
		JSON.stringify({ tests: { T1: { title: 'Changed quote' } } })
	)
	assert.equal(edited.subject, 'ticket-1@3')
	assert.equal(ok(['plan', 'show', 'ticket-1@2']).plan.tests[0].title, 'Quote')
	assert.deepEqual(ok(['plan', 'promotions', 'ticket-1']).promotions[0].tests, ['T1'])
	refused(promote, /changed since promotion/)
	ok(['result', 'reject', 'run-2', '--rationale', 'Acceptance was withdrawn.'])
	assert.equal(ok(['plan', 'promotions', 'ticket-1']).promotions[0].accepted, false)
	assert.equal(ok(['plan', 'promotions', 'ticket-1']).promotions[0].revision, 2)
	refused(promote, /Accept result/)
})

test('an accepted partial run cannot promote a plan with open gaps', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'Run the ready test.' })
	const begun = beginRun(opened, actor, {
		runId: 'partial',
		reference: 'checkout@1',
		build: 'b1',
		partial: 'ready_only',
	})
	assert.equal(begun.status, 'completed')
	for (const assertion of ['A1', 'A2']) check(opened, 'partial', `T1.${assertion}`, 'passed')
	closeTest(opened, actor, { runId: 'partial', testId: 'T1' })
	finishRun(opened, actor, {
		runId: 'partial',
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Done.',
	})
	acceptResult(opened, actor, { runId: 'partial', rationale: 'The ready test passed.' })
	assert.throws(
		() =>
			promotePlan(opened, actor, { reference: 'checkout@1', runId: 'partial', build: 'b1', rationale: 'Save.' }),
		/Resolve all plan gaps/
	)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_promotions').get()!.count, 0)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_revisions').get()!.count, 1)
	assert.equal(
		opened.db.prepare("SELECT status FROM operations WHERE command = 'plan promote'").get()!.status,
		'rejected'
	)
})

test('an accepted run cannot promote an uncovered ticket rule', (t) => {
	const opened = store(t)
	target(opened)
	const incomplete = sampleCandidate()
	incomplete.tests = [incomplete.tests[0]]
	incomplete.gaps = incomplete.gaps.map((gap) => ({ ...gap, status: 'not_needed', testIds: [] }))
	plan(opened, 'checkout', incomplete)
	approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'Run the test.' })
	beginRun(opened, actor, { runId: 'only-one', reference: 'checkout@1', build: 'b1', tests: ['T1'] })
	for (const assertion of ['A1', 'A2']) check(opened, 'only-one', `T1.${assertion}`, 'passed')
	closeTest(opened, actor, { runId: 'only-one', testId: 'T1' })
	finishRun(opened, actor, {
		runId: 'only-one',
		completion: 'completed',
		cleanup: 'completed',
		cleanupReason: 'Done.',
	})
	acceptResult(opened, actor, { runId: 'only-one', rationale: 'The selected test passed.' })
	assert.throws(
		() =>
			promotePlan(opened, actor, { reference: 'checkout@1', runId: 'only-one', build: 'b1', rationale: 'Save.' }),
		/Rule R2 has no test/
	)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_promotions').get()!.count, 0)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_revisions').get()!.count, 1)
})

test('promotion refuses a run that does not contain every rule even when another run passed', (t) => {
	const opened = store(t)
	target(opened)
	const request = planRequest()
	request.requirements = request.requirements!.slice(0, 2)
	const two = sampleCandidate()
	two.tests = two.tests.slice(0, 2)
	two.tests[1].dependsOn = []
	two.gaps = []
	plan(opened, 'checkout', two, request)
	approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'Run both rules.' })
	for (const [runId, testId, assertions] of [
		['r1', 'T1', ['A1', 'A2']],
		['r2', 'T2', ['A1']],
	] as const) {
		beginRun(opened, actor, { runId, reference: 'checkout@1', build: 'b1', tests: [testId] })
		for (const assertion of assertions) check(opened, runId, `${testId}.${assertion}`, 'passed')
		closeTest(opened, actor, { runId, testId })
		finishRun(opened, actor, { runId, completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
		acceptResult(opened, actor, { runId, rationale: 'The selected test passed.' })
	}
	assert.throws(
		() => promotePlan(opened, actor, { reference: 'checkout@1', runId: 'r1', build: 'b1', rationale: 'Save.' }),
		/Test T2 did not pass/
	)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_promotions').get()!.count, 0)
})

test('promotion includes held rules that are not in a harvested revision', (t) => {
	const opened = store(t)
	target(opened)
	openPlan(opened, actor, {
		planId: 'ticket',
		target: 'checkout-local@1',
		request: { objective: 'Check the quote.', context: { sources: ['ticket.md'] } },
	})
	savePlan(opened, actor, { planId: 'ticket', candidate })
	write(opened, { actor, command: 'fixture', subject: 'ticket', input: null }, (operationId) => {
		saveRules(
			opened,
			operationId,
			'ticket',
			[
				{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' },
				{ id: 'R2', text: 'The receipt is sent.', source: 'ticket.md' },
			],
			'harvested'
		)
		return { reply: completed('ticket'), subjects: ['plan:ticket'] }
	})
	approvePlan(opened, actor, { reference: 'ticket@1', rationale: 'Run the test.' })
	beginRun(opened, actor, { runId: 'r1', reference: 'ticket@1', build: 'b1', tests: ['T1'] })
	check(opened, 'r1', 'T1.A1', 'passed')
	closeTest(opened, actor, { runId: 'r1', testId: 'T1' })
	finishRun(opened, actor, { runId: 'r1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	acceptResult(opened, actor, { runId: 'r1', rationale: 'The test passed.' })
	assert.throws(
		() => promotePlan(opened, actor, { reference: 'ticket@1', runId: 'r1', build: 'b1', rationale: 'Save.' }),
		/Rule R2 has no test/
	)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_promotions').get()!.count, 0)
})

test('a passing accepted result cannot promote an older plan revision', (t) => {
	const opened = store(t)
	ready(opened)
	passRun(opened, 'old', 'b1', ['T1', 'T2'])
	accept(opened, 'old')
	patchPlan(opened, actor, { reference: 'checkout@2', patch: { tests: { T1: { title: 'Changed rule test' } } } })
	assert.throws(
		() => promotePlan(opened, actor, { reference: 'checkout@2', runId: 'old', build: 'b1', rationale: 'Save.' }),
		/not the latest revision/
	)
	assert.equal(opened.db.prepare('SELECT count(*) AS count FROM plan_promotions').get()!.count, 0)
})

test('promotion needs explicit result acceptance even when the target policy does not', (t) => {
	const opened = store(t)
	target(opened, { approvals: { plan: 'none', result: 'none' } })
	openPlan(opened, actor, {
		planId: 'ticket',
		target: 'checkout-local@1',
		request: { objective: 'Check the quote.', context: { sources: ['ticket.md'] } },
	})
	savePlan(opened, actor, { planId: 'ticket', candidate })
	beginRun(opened, actor, { runId: 'r1', reference: 'ticket@1', build: 'b1', tests: ['T1'] })
	check(opened, 'r1', 'T1.A1', 'passed')
	closeTest(opened, actor, { runId: 'r1', testId: 'T1' })
	finishRun(opened, actor, { runId: 'r1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	const input = { reference: 'ticket@1', runId: 'r1', build: 'b1', rationale: 'Save.' }
	assert.throws(() => promotePlan(opened, actor, input), /Accept result/)
	acceptResult(opened, actor, { runId: 'r1', rationale: 'The rule passed.' })
	assert.equal(promotePlan(opened, actor, input).data.recorded, true)
})
