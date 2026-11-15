import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { cli, directory, json, profile } from './support.ts'

const approvals = { plan: 'none' as const, result: 'required' as const }

function setup(t: TestContext) {
	const workspace = directory(t)
	const value = profile({ approvals })
	const steps: Array<[string[], unknown?]> = [
		[
			[
				'target',
				'open',
				'checkout-local',
				'--entry-point',
				'web:url:Checkout web application and HTTP API.',
				'--capabilities',
				value.capabilities.join(','),
				'--operations',
				value.allowedOperations.join(','),
			],
		],
		[['target', 'save', 'checkout-local'], value],
		[['target', 'instance', 'add', 'checkout-local', 'local', '--entry', 'web=http://127.0.0.1:4173']],
		[['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], checklist()],
	]
	for (const [args, stdin] of steps) assert.equal(cli(workspace, args, stdin).code, 0, args.join(' '))
	mkdirSync(join(workspace, 'evidence'))
	writeFileSync(join(workspace, 'evidence', 'total.txt'), 'Total: 420 PLN')
	return workspace
}

function checklist() {
	return {
		objective: 'Verify the checkout change.',
		items: [
			{ id: 'R1', text: 'A 400 PLN order has a total of 400 PLN.', source: 'ticket.md#total' },
			{ id: 'R2', text: 'The cart keeps its items after a reload.', source: 'docs/cart.md#reload' },
		],
		questions: [{ id: 'Q1', question: 'Does the promotion stack with loyalty?', items: ['R1'] }],
	}
}

function b1Record() {
	return {
		items: [{ id: 'R3', text: 'An empty cart cannot check out.', source: 'exploration' }],
		checks: [
			{
				item: 'R1',
				check: 'The total of a 400 PLN order is 400 PLN.',
				result: 'failed',
				observed: 'The total is 420 PLN.',
				evidence: ['evidence/total.txt'],
				defect: 'D1',
			},
			{ item: 'R2', check: 'The cart keeps items after reload.', result: 'passed', observed: 'Two items stay.' },
			{
				item: 'R3',
				check: 'Checkout of an empty cart.',
				result: 'blocked',
				reason: 'The checkout button is hidden.',
			},
		],
		defects: [
			{
				id: 'D1',
				title: 'Total adds 20 PLN',
				severity: 'high',
				steps: ['Add a 400 PLN item.', 'Open checkout.'],
				expected: '400 PLN',
				actual: '420 PLN',
				evidence: ['evidence/total.txt', { text: 'GET /quote returned totalPLN 420' }],
			},
		],
		questions: [{ id: 'Q2', question: 'Can an empty cart open checkout?', items: ['R3'] }],
	}
}

function b2Record() {
	const checks: Array<Record<string, string>> = [
		{ item: 'R1', check: 'The total of a 400 PLN order is 400 PLN.', result: 'passed', observed: '400 PLN.' },
		{ item: 'R2', check: 'The cart keeps items after reload.', result: 'passed', observed: 'Two items stay.' },
		{ item: 'R3', check: 'Checkout of an empty cart.', result: 'passed', observed: 'Checkout is refused.' },
	]
	return {
		checks,
		retests: [
			{ defect: 'D1', verdict: 'fixed', observed: 'The total is 400 PLN.', evidence: [{ text: '400 PLN' }] },
		],
	}
}

test('lite records a checklist, answers, and two builds that the views and exports read', (t) => {
	const workspace = setup(t)
	let shown = json(workspace, ['lite', 'show', 'checkout']).body
	assert.deepEqual(
		shown.questions.map((question: { id: string; status: string }) => [question.id, question.status]),
		[['Q1', 'open']]
	)
	const answer = ['gap', 'answer', 'checkout', 'Q1', '--kind', 'clarify', '--value', 'No.', '--source', 'pm']
	assert.equal(cli(workspace, [...answer, '--rationale', 'PM answer']).code, 0)

	const b1 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], b1Record())
	assert.equal(b1.code, 0, JSON.stringify(b1.body))
	assert.equal(b1.body.runId, 'checkout-run-1')
	assert.equal(b1.body.plan, 'checkout@2')
	assert.deepEqual(b1.body.counts, { blocked: 1, failed: 1, passed: 1 })
	assert.deepEqual(b1.body.questions, ['Q2'])
	shown = json(workspace, ['lite', 'show', 'checkout']).body
	assert.deepEqual(
		shown.questions.map((question: { id: string; status: string; answer: string | null }) => [
			question.id,
			question.status,
			question.answer,
		]),
		[
			['Q1', 'resolved', 'No.'],
			['Q2', 'open', null],
		]
	)
	assert.deepEqual(
		shown.defects.map((defect: { id: string; runId: string }) => [defect.id, defect.runId]),
		[['D1', 'checkout-run-1']]
	)
	const status = json(workspace, ['status', 'checkout']).body
	assert.equal(status.state, 'defects_open')
	assert.deepEqual(
		status.defects.map((defect: { findingId: string }) => defect.findingId),
		['D1']
	)
	const findings = json(workspace, ['finding', 'list', '--plan', 'checkout']).body.findings
	assert.equal(findings[0].evidenceIds.length, 2)
	assert.deepEqual(findings[0].requirementIds, ['R1'])
	assert.equal(cli(workspace, ['result', 'accept', 'checkout-run-1', '--rationale', 'Seen.']).code, 0)

	const answerQ2 = ['gap', 'answer', 'checkout', 'Q2', '--kind', 'accept_assumption', '--value', 'No.']
	assert.equal(cli(workspace, [...answerQ2, '--rationale', 'PM answer']).code, 0)
	const b2 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b2'], b2Record())
	assert.equal(b2.code, 0, JSON.stringify(b2.body))
	assert.deepEqual(b2.body.retest, [{ runId: 'checkout-run-1', findingId: 'D1', verdict: 'fixed' }])
	assert.equal(b2.body.coverage, 'complete')
	const run = json(workspace, ['run', 'show', 'checkout-run-2']).body
	assert.equal(run.state, 'finalized')
	assert.equal(run.request.retestOf, 'checkout-run-1')
	assert.deepEqual(
		run.retest.map((item: { verdict: string }) => item.verdict),
		['fixed']
	)
	assert.deepEqual(json(workspace, ['lite', 'show', 'checkout']).body.defects, [])
	assert.equal(json(workspace, ['finding', 'list', '--plan', 'checkout', '--open']).body.findings.length, 0)
	const final = json(workspace, ['status', 'checkout']).body
	assert.equal(final.state, 'awaits_acceptance')
	assert.equal(final.revision, 3)
	for (const args of [
		['export', 'run', 'checkout-run-2', '--format', 'md'],
		['export', 'plan', 'checkout', '--format', 'json'],
	])
		assert.equal(cli(workspace, args).code, 0, args.join(' '))
})

test('a not_fixed retest keeps the defect open on the new build', (t) => {
	const workspace = setup(t)
	assert.equal(cli(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], b1Record()).code, 0)
	const record = b2Record()
	record.retests[0].verdict = 'not_fixed'
	record.retests[0].observed = 'The total is still 420 PLN.'
	record.checks[0] = { ...record.checks[0], result: 'failed', observed: '420 PLN.' }
	const refused = json(workspace, ['lite', 'record', 'checkout', '--build', 'b2'], record)
	assert.match(refused.body.reasons[1], /Failed checks without a defect: R1/)
	record.checks[0] = { ...record.checks[0], defect: 'D1' }
	const b2 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b2'], record)
	assert.equal(b2.code, 0, JSON.stringify(b2.body))
	assert.deepEqual(
		b2.body.retest.map((item: { verdict: string }) => item.verdict),
		['not_fixed']
	)
	assert.deepEqual(
		json(workspace, ['lite', 'show', 'checkout']).body.defects.map((defect: { id: string; runId: string }) => [
			defect.id,
			defect.runId,
		]),
		[['D1', 'checkout-run-2']]
	)
	const findings = json(workspace, ['finding', 'list', '--plan', 'checkout']).body.findings
	assert.deepEqual(findings[1].testIds, ['R1-1', 'R1-2'])
})

test('lite record refuses an incomplete build record', (t) => {
	const workspace = setup(t)
	const cases: Array<[string, (record: ReturnType<typeof b1Record>) => void, RegExp]> = [
		['an item without a check', (record) => record.checks.pop(), /Checklist items without a check: R3/],
		[
			'a failed check without a defect',
			(record) => delete (record.checks[0] as { defect?: string }).defect,
			/Failed checks without a defect: R1/,
		],
		['a defect without evidence', (record) => (record.defects[0].evidence = []), /Defects without evidence: D1/],
	]
	for (const [name, change, reason] of cases) {
		const record = b1Record()
		change(record)
		const outcome = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record)
		assert.equal(outcome.code, 1, name)
		assert.equal(outcome.body.refusal, 'prohibited', name)
		assert.match(outcome.body.reasons[1], reason, name)
		assert.ok(outcome.body.hint, name)
	}
	assert.equal(cli(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], b1Record()).code, 0)
	const record = b2Record()
	delete (record as { retests?: unknown }).retests
	const outcome = json(workspace, ['lite', 'record', 'checkout', '--build', 'b2'], record)
	assert.match(outcome.body.reasons[1], /Earlier defects without a retest verdict: D1/)
	assert.equal(json(workspace, ['run', 'list', '--plan', 'checkout']).body.runs.length, 1)
})
