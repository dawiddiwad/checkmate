import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { actor, cli, directory, json, profile } from './support.ts'
import { liteSchema } from '../plugin/src/guide.ts'
import { validate } from '../plugin/src/contracts.ts'
import { run } from '../plugin/src/cli.ts'

const approvals = { plan: 'none' as const, result: 'required' as const }

function targetOnly(t: TestContext) {
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
	]
	for (const [args, stdin] of steps) assert.equal(cli(workspace, args, stdin).code, 0, args.join(' '))
	mkdirSync(join(workspace, 'evidence'))
	writeFileSync(join(workspace, 'evidence', 'total.txt'), 'Total: 420 PLN')
	return workspace
}

function setup(t: TestContext) {
	const workspace = targetOnly(t)
	const outcome = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], checklist())
	assert.equal(outcome.code, 0, JSON.stringify(outcome.body))
	return workspace
}

function checklist() {
	return {
		objective: 'Verify the checkout change.',
		criteria: 1,
		items: [
			{
				id: 'R1',
				text: 'A 400 PLN order has a total of 400 PLN.',
				source: 'ticket.md#Acceptance criteria',
				criterion: 1,
			},
			{
				id: 'R2',
				text: 'The cart keeps its items after a reload.',
				source: 'docs/cart.md#reload',
				baseline: { steps: 'GET /cart after a reload', value: '2 items', documented: '2 items' },
			},
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
			{
				item: 'R2',
				check: 'The cart keeps items after reload.',
				result: 'passed',
				observed: 'Two items stay.',
				value: '2 items',
			},
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
		{
			item: 'R2',
			check: 'The cart keeps items after reload.',
			result: 'passed',
			observed: 'Two items stay.',
			value: '2  items',
		},
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

test('lite checklist needs one item for each acceptance criterion and stores its number in the source', (t) => {
	const workspace = targetOnly(t)
	const value = { ...checklist(), criteria: 3 }
	const refused = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], value)
	assert.equal(refused.code, 1)
	assert.match(refused.body.reasons[1], /Acceptance criteria without an item: 2, 3/)
	assert.match(refused.body.hint, /"criterion"/)
	value.criteria = 0
	const above = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], value)
	assert.match(above.body.reasons[1], /Criterion numbers above the "criteria" count 0: 1/)
	assert.equal(cli(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], checklist()).code, 0)
	const shown = json(workspace, ['lite', 'show', 'checkout']).body
	assert.deepEqual(
		shown.items.map((item: { source: string }) => item.source),
		['ticket.md#ac-1', 'docs/cart.md#reload']
	)
	assert.ok(
		cli(workspace, ['lite', 'show', 'checkout']).lines.includes(
			'repeat\tR2\tsteps=GET /cart after a reload\treference=2 items (checklist)'
		)
	)
})

test('lite commands lead a lost agent back to lite checklist', (t) => {
	const workspace = targetOnly(t)
	for (const args of [
		['lite', 'show', 'checkout'],
		['lite', 'record', 'checkout', '--build', 'b1'],
	]) {
		const outcome = json(workspace, args, b1Record())
		assert.match(outcome.body.reasons[1], /Plan checkout has no checklist/, args.join(' '))
		assert.match(outcome.body.hint, /^Run lite checklist checkout --target/, args.join(' '))
	}
	const open = [
		'plan',
		'open',
		'checkout',
		'--target',
		'checkout-local@1',
		'--objective',
		'Checkout',
		'--source',
		'ticket.md',
	]
	assert.equal(cli(workspace, open).code, 0)
	assert.match(json(workspace, ['lite', 'show', 'checkout']).body.hint, /^Run lite checklist checkout/)
	const target = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local'], checklist())
	assert.match(target.body.hint, /lite checklist checkout --target checkout-local@<revision>/)
	const saved = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], checklist())
	assert.equal(saved.code, 0, JSON.stringify(saved.body))
	const again = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], checklist())
	assert.match(again.body.hint, /lite show checkout/)
	assert.equal(cli(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], b1Record()).code, 0)
	const twice = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], b1Record())
	assert.match(twice.body.reasons[1], /Build b1 has a record: checkout-run-1/)
	assert.match(twice.body.hint, /lite record checkout --build <build>/)
})

test('lite record compares each value with the reference value and sets the result', (t) => {
	const workspace = setup(t)
	const send = (record: ReturnType<typeof b1Record>) =>
		json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record)
	const regression = (record: ReturnType<typeof b1Record>) => record.checks[1] as Record<string, unknown>
	const values = (value: string) => `the value "${value}" and the reference value "2 items" \\(checklist\\)`
	const cases: Array<[string, (record: ReturnType<typeof b1Record>) => void, RegExp]> = [
		[
			'no value',
			(record) => delete regression(record).value,
			/Items with a reference value and no check with value: R2/,
		],
		[
			'a different value without a defect or an intended note',
			(record) => Object.assign(regression(record), { value: '1 item', result: undefined }),
			new RegExp(`R2 \\(checks\\[1\\]\\): ${values('1 item')} are different`),
		],
		[
			'a passed result for a different value',
			(record) => Object.assign(regression(record), { value: '1 item' }),
			new RegExp(`${values('1 item')} are different`),
		],
		[
			'a failed result for an equal value',
			(record) => Object.assign(regression(record), { result: 'failed' }),
			new RegExp(`is failed, but ${values('2 items')} are equal`),
		],
		[
			'a passed result for a different value with a defect',
			(record) => Object.assign(regression(record), { value: '1 item', defect: 'D1' }),
			new RegExp(`is passed, but ${values('1 item')} are different`),
		],
		[
			'a blocked result with a value',
			(record) => Object.assign(regression(record), { result: 'blocked', reason: 'No cart.' }),
			new RegExp(`is blocked, but ${values('2 items')} are equal`),
		],
		[
			'a check without a result and without a reference value',
			(record) => delete (record.checks[0] as { result?: string }).result,
			/R1 \(checks\[0\]\) has no result/,
		],
		[
			'a criterion with only not_run checks',
			(record) => Object.assign(record.checks[0], { result: 'not_run', reason: 'No time.', defect: undefined }),
			/Acceptance criteria items with only not_run checks: R1/,
		],
	]
	for (const [name, change, reason] of cases) {
		const record = b1Record()
		change(record)
		const outcome = send(JSON.parse(JSON.stringify(record)))
		assert.equal(outcome.code, 1, name)
		assert.match(outcome.body.reasons[1], reason, name)
		assert.ok(outcome.body.hint, name)
	}
	const different = b1Record()
	Object.assign(regression(different), { value: '1 item', result: undefined })
	const hint = send(different).body.hint
	assert.match(hint, /"defect": "<defect ID>"/)
	assert.match(hint, /"intended": \{"note"/)

	const record = b1Record()
	const intended = { note: 'The ticket keeps one item after a reload.', source: 'ticket.md criterion 2' }
	record.checks[1] = { item: 'R2', check: 'GET /cart after a reload', value: ' 1 item', intended } as never
	record.checks[2] = {
		item: 'R3',
		check: 'POST /checkout with an empty cart.',
		result: 'passed',
		observed: '409.',
		value: '409  "Cart is empty"',
	} as never
	const b1 = send(record)
	assert.equal(b1.code, 0, JSON.stringify(b1.body))
	assert.deepEqual(b1.body.counts, { failed: 1, passed: 2 })
	const run = json(workspace, ['run', 'show', 'checkout-run-1']).body
	const test = run.tests.find((item: { testId: string }) => item.testId === 'R2-1')
	assert.equal(
		test.assertions[0].observed,
		'Value:  1 item. Reference value: 2 items (checklist). Intended change: The ticket keeps one item after a reload. (source: ticket.md criterion 2).'
	)
	const guide = cli(workspace, ['lite', 'guide', 'checkout']).lines
	assert.ok(guide.includes('repeat\tR2\tsteps=GET /cart after a reload\treference= 1 item (build b1)'))
	assert.ok(
		guide.includes(
			'repeat\tR3\tsteps=POST /checkout with an empty cart.\treference=409  "Cart is empty" (build b1)'
		)
	)

	const later = b2Record()
	later.checks[1] = { item: 'R2', check: 'GET /cart after a reload', value: '1   item' }
	later.checks[2] = { item: 'R3', check: 'POST /checkout with an empty cart.', value: '409 "Cart is empty"' }
	const b2 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b2'], later)
	assert.equal(b2.code, 0, JSON.stringify(b2.body))
	assert.deepEqual(b2.body.counts, { passed: 4 })
})

test('lite record compares the numbers in a value by their numeric value', (t) => {
	const workspace = targetOnly(t)
	const value = checklist()
	value.items[1].baseline!.value = 'fee 1.50 PLN, 007 days'
	assert.equal(cli(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], value).code, 0)
	const record = (seen: string) => ({
		checks: [
			{ item: 'R1', check: 'Total of a 400 PLN order.', result: 'passed', observed: '400 PLN.' },
			{ item: 'R2', check: 'GET /cart after a reload', value: seen },
		],
	})
	const refused = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record('Fee 1.5 PLN, 7 days'))
	assert.match(refused.body.reasons[1], /are different/)
	const b1 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record(' fee 1.5 PLN,  7 days '))
	assert.equal(b1.code, 0, JSON.stringify(b1.body))
})

test('lite changes list the changed areas and suggest an item for an area that no item covers', (t) => {
	const workspace = targetOnly(t)
	const value = {
		...checklist(),
		changes: [
			{ area: 'Order total', source: 'src/total.ts @@ -10,6 +10,8 @@', items: ['R1'] },
			{ area: 'Cart export', source: 'src/export.ts' } as { area: string; source: string; items?: string[] },
		],
	}
	const unknown = structuredClone(value)
	unknown.changes[1].items = ['R9']
	const refused = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], unknown)
	assert.match(refused.body.reasons[1], /changes\[\]\.items names unknown items: R9/)
	assert.equal(cli(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], value).code, 0)
	const suggestion =
		'suggest\tCart export\tsrc/export.ts\tNo item covers this changed area. You can add an item or a baseline.'
	assert.ok(cli(workspace, ['lite', 'show', 'checkout']).lines.includes(suggestion))
	const guide = cli(workspace, ['lite', 'guide', 'checkout']).lines
	assert.ok(guide.includes(suggestion))
	assert.ok(!guide.some((line) => line.startsWith('need\tchanges')))
	const record = {
		...b1Record(),
		items: [...b1Record().items, { id: 'R4', text: 'The export has the cart total.', source: 'exploration' }],
		checks: [
			...b1Record().checks,
			{ item: 'R4', check: 'Export the cart.', result: 'passed', observed: 'The total is in the export.' },
		],
		changes: [{ area: 'Cart export', source: 'src/export.ts', items: ['R4'] }],
	}
	const b1 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record)
	assert.equal(b1.code, 0, JSON.stringify(b1.body))
	const shown = json(workspace, ['lite', 'show', 'checkout']).body
	assert.equal(shown.changes.length, 3)
	assert.deepEqual(shown.uncovered, [])
})

test('every lite payload field has a description and each schema example is valid', () => {
	for (const name of ['lite-checklist', 'lite-record'] as const) {
		const schema = liteSchema(name)
		assert.ok(schema.about, name)
		for (const field of schema.fields) assert.ok(field.description, `${name} ${field.path}`)
		assert.doesNotThrow(() => validate(name, schema.example), name)
	}
})

test('lite guide prints the next step, its fields, an example, the state, and the next lines', (t) => {
	const workspace = targetOnly(t)
	const first = cli(workspace, ['lite', 'guide'])
	assert.equal(first.code, 0)
	assert.match(first.lines[0], /^completed lite guide step=checklist/)
	assert.ok(first.output.length < 6000, `${first.output.length} characters`)
	for (const path of ['items[].baseline.steps', 'questions[].items'])
		assert.ok(
			first.lines.some((line) => line.startsWith(`field\t${path}\t`)),
			path
		)
	assert.ok(first.output.includes("checkmate lite checklist <planId> --target checkout-local@1 <<'EOF'"))
	assert.ok(first.lines.at(-1)!.startsWith('next: Record the checklist in one call'))

	const example = liteSchema('lite-checklist').example
	const recorded = json(workspace, ['lite', 'checklist', 'checkout', '--target', 'checkout-local@1'], example)
	assert.equal(recorded.code, 0, JSON.stringify(recorded.body))
	const guide = json(workspace, ['lite', 'guide', 'checkout']).body
	assert.equal(guide.step, 'record')
	assert.deepEqual(guide.need, [['checks[].result', ['R1'], 'passed, failed, or blocked']])
	assert.deepEqual(guide.repeat, [
		{
			item: 'R2',
			steps: 'Return loan L1 3 days late. Then GET /api/loans/L1.',
			value: 'fee 1.50',
			from: 'checklist',
		},
	])
	assert.ok(!guide.fields.some((field: { path: string }) => field.path.startsWith('retests')))
	writeFileSync(join(workspace, 'evidence', 'd1.png'), 'shot')
	const b1 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], liteSchema('lite-record').example)
	assert.equal(b1.code, 0, JSON.stringify(b1.body))

	const printed = cli(workspace, ['lite', 'guide', 'checkout'])
	assert.ok(printed.output.length < 4000, `${printed.output.length} characters`)
	assert.ok(printed.lines.includes('open_defect\tD1\tcheckout-run-1\thigh\tR1\tA sixth loan is accepted'))
	assert.ok(printed.lines.includes('need\tretests[].defect\tD1\ta verdict with evidence'))
	assert.ok(
		printed.lines.some((line) => line.startsWith('field\tretests\t') && line.includes('verdict (fixed|not_fixed)'))
	)
	assert.ok(!printed.lines.some((line) => line.startsWith('example')))
	assert.ok(
		printed.lines.includes(
			"command\tcheckmate lite record checkout --build <build> <<'EOF'\tthe JSON payload, then EOF"
		)
	)
	assert.ok(
		cli(workspace, ['lite', 'show', 'checkout']).lines.includes(
			'next: Give a verdict in retests for each open defect: D1.'
		)
	)
})

test('lite refusals name the field and give a hint', (t) => {
	const workspace = setup(t)
	const send = (record: unknown) => json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record)
	const passed = b1Record()
	Object.assign(passed.checks[1], { defect: 'D1' })
	const named = send(passed)
	assert.match(named.body.reasons[1], /of R2 \(checks\[1\]\) is passed\. Only a failed check names a defect/)
	assert.match(named.body.hint, /Remove "defect" from checks\[1\]/)
	const unknown = send({ ...b1Record(), note: 'x' })
	assert.match(unknown.body.reasons[1], /lite-record has unknown field "note"/)
	assert.match(unknown.body.hint, /Run checkmate lite guide checkout to read the fields/)
	const twice = b1Record()
	twice.defects.push({ ...twice.defects[0] })
	assert.match(send(twice).body.hint, /defects\[\]/)
})

test('lite record saves drafts and checks the full record only on the last call', (t) => {
	const workspace = setup(t)
	const send = (record: unknown, draft = true) =>
		json(workspace, ['lite', 'record', 'checkout', '--build', 'b1', ...(draft ? ['--draft'] : [])], record)
	const full = b1Record()
	const first = send({ checks: [full.checks[0]], defects: full.defects })
	assert.equal(first.code, 0, JSON.stringify(first.body))
	assert.equal(first.body.parts, 1)
	assert.deepEqual(first.body.missing, ['Checklist items without a check: R2'])
	assert.equal(json(workspace, ['run', 'list', '--plan', 'checkout']).body.runs.length, 0)
	const printed = cli(workspace, ['lite', 'record', 'checkout', '--build', 'b1', '--draft'], {
		checks: [{ ...full.checks[1], observed: 'Two items stay after the reload.' }],
	})
	assert.match(printed.lines[0], /^completed checkout draft=b1 parts=2/)
	assert.ok(printed.lines.includes('checks\t2'))
	assert.ok(!printed.lines.some((line) => line.startsWith('missing')))

	const refused = send({ items: full.items }, false)
	assert.equal(refused.code, 1)
	assert.match(refused.body.reasons[1], /Checklist items without a check: R3/)
	const done = send({ items: full.items, checks: [full.checks[2]], questions: full.questions }, false)
	assert.equal(done.code, 0, JSON.stringify(done.body))
	assert.deepEqual(done.body.counts, { blocked: 1, failed: 1, passed: 1 })
	const shown = json(workspace, ['run', 'show', 'checkout-run-1']).body
	const kept = shown.tests.find((item: { testId: string }) => item.testId === 'R2-1')
	assert.match(kept.assertions[0].observed, /^Two items stay after the reload\./)
	assert.equal(send({ checks: full.checks }).body.reasons[1], 'Build b1 has a record: checkout-run-1.')
	assert.equal(send({}, false).code, 1)
})

test('lite record lists every missing part in one refusal', (t) => {
	const workspace = setup(t)
	const record = b1Record()
	record.checks.pop()
	delete (record.checks[1] as { value?: string }).value
	record.defects.push({ ...record.defects[0], id: 'D2', evidence: ['evidence/missing.txt'] })
	const refused = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record)
	assert.equal(refused.code, 1)
	const reason = refused.body.reasons[1]
	for (const part of [
		/\(1\) Checklist items without a check: R3/,
		/\(2\) Items with a reference value and no check with value: R2/,
		/\(3\) Defects without a failed check: D2/,
		/\(4\) defects\[1\]\.evidence\[0\]: Evidence file not found: evidence\/missing\.txt/,
	])
		assert.match(reason, part)
	assert.match(refused.body.hint, /\(2\) .*\{"item": "R2", "value": "<what you saw>"\}/)
	assert.match(refused.body.hint, /"result": "failed", "observed": "<what you saw>", "defect": "D2"\}/)
})

test('a different value with a reason records the result without a defect and keeps the reference', (t) => {
	const workspace = setup(t)
	const record = b1Record()
	record.checks[1] = {
		item: 'R2',
		value: '3 items',
		result: 'passed',
		reason: 'The third item is the one that this test added.',
	} as never
	record.checks[2] = {
		item: 'R3',
		check: 'Checkout of an empty cart.',
		result: 'passed',
		observed: 'Refused.',
		evidence: ['POST /checkout: 409 Cart is empty'],
	} as never
	const b1 = json(workspace, ['lite', 'record', 'checkout', '--build', 'b1'], record)
	assert.equal(b1.code, 0, JSON.stringify(b1.body))
	assert.deepEqual(b1.body.counts, { failed: 1, passed: 2 })
	const shown = json(workspace, ['run', 'show', 'checkout-run-1']).body
	const test = shown.tests.find((item: { testId: string }) => item.testId === 'R2-1')
	assert.equal(test.title, 'GET /cart after a reload')
	assert.match(test.assertions[0].observed, /Reason: The third item is the one that this test added\./)
	const guide = cli(workspace, ['lite', 'guide', 'checkout']).lines
	assert.ok(guide.includes('repeat\tR2\tsteps=GET /cart after a reload\treference=2 items (checklist)'))
	assert.ok(!guide.some((line) => line.startsWith('item\t')))
	assert.ok(guide.some((line) => line.startsWith('field\tchecks\t') && line.includes('Required fields: item.')))
})

test('the workspace is the nearest directory with a Checkmate store', (t) => {
	const workspace = setup(t)
	const inner = join(workspace, 'repo', 'src')
	mkdirSync(inner, { recursive: true })
	const outcome = run(['lite', 'show', 'checkout', '--json'], {
		cwd: inner,
		env: { CHECKMATE_ACTOR: actor },
		stdin: () => '',
	})
	assert.equal(outcome.code, 0, outcome.output)
	assert.equal(JSON.parse(outcome.output).planId, 'checkout')
	const missing = json(workspace, ['lite', 'checklist', 'other', '--target', 'other-target@1'], checklist())
	assert.match(missing.body.hint, /Run checkmate target list/)
})
