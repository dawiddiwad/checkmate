import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildOrder, handOffClaims, journal, mostFrequent, planQuestions } from '../plugin/src/journal.ts'
import { claimDetails, ruleMap } from '../plugin/src/rulemap.ts'
import { plan, planRequest, store, target } from './support.ts'
import { done, entries, openTest } from './explorations.ts'

test('builds keep the order in which a plan first tested them, not the order of the entries', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'x-1', 'b1')
	openTest(opened, 'checkout', 'x-2', 'b2')
	openTest(opened, 'checkout', 'x-3', 'b1')
	entries(opened, 'x-2', 'a1', [{ kind: 'note', text: 'Tested b2 first.' }])
	entries(opened, 'x-1', 'a1', [{ kind: 'note', text: 'Recorded b1 later.' }])
	assert.deepEqual(
		buildOrder(opened, 'checkout').map((item) => item.build),
		['b1', 'b2']
	)
	assert.deepEqual(journal(opened, 'checkout').builds, ['b1', 'b2'])
})

function seeded(t: TestContext, request = planRequest()) {
	const opened = store(t)
	target(opened)
	plan(opened, 'checkout', undefined, request)
	mkdirSync(join(opened.workspace, 'evidence'))
	writeFileSync(join(opened.workspace, 'evidence', 'cart.png'), 'png')
	openTest(opened, 'checkout', 'x-1', 'b1')
	entries(opened, 'x-1', 'a1', [
		{ kind: 'criterion', id: 'C1', rule: 'R1', text: 'A 400 PLN order totals 400 PLN.', verdict: 'ok' },
		{ ...defect('D1', 'high'), rule: 'R2', evidence: ['evidence/cart.png', 'Total 50.00'] },
		{ kind: 'question', id: 'Q1', rule: 'R3', question: 'Which orders qualify for refunds?', actual: 'All do.' },
		{ ...defect('D2', 'low'), rule: 'outside' },
		{ ...defect('D3', 'medium') },
		{ ...defect('D4', 'medium'), rule: 'R3', suspected: true, question: 'Is a refund of 0 valid?', links: ['Q1'] },
	])
	entries(opened, 'x-1', 'a2', [
		{ ...defect('D1', 'medium'), rule: 'R1' },
		{ ...defect('D2', 'medium'), rule: 'R2' },
	])
	entries(opened, 'x-1', 'merge', [
		{ kind: 'issue', title: 'Promotion breaks', severity: 'medium', reports: ['a2/D1', 'a2/D2'] },
	])
	entries(opened, 'x-1', 'verify', [{ kind: 'observation', refutes: 'a1/D2', saw: 'The page shows no error.' }])
	done(opened, 'x-1')
	openTest(opened, 'checkout', 'x-2', 'b2')
	entries(opened, 'x-2', 'a1', [
		{ kind: 'criterion', id: 'C2', rule: 'R1', text: 'A 400 PLN order totals 400 PLN.', verdict: 'ok' },
		{ kind: 'criterion', id: 'C3', rule: 'R3', text: 'Refunds follow the policy.', verdict: 'wrong' },
		{ kind: 'verdict', defect: 'D1', result: 'fixed' },
		{ kind: 'verdict', defect: 'D2', result: 'not_fixed' },
	])
	done(opened, 'x-2')
	openTest(opened, 'checkout', 'x-3', 'b3')
	entries(opened, 'x-3', 'a1', [{ kind: 'verdict', defect: 'D1', result: 'not_fixed' }])
	done(opened, 'x-3')
	return opened
}

const defect = (id: string, severity: string) => ({
	kind: 'defect',
	id,
	title: `Problem ${id}`,
	severity,
	expected: 'Right',
	actual: 'Wrong',
	steps: `Open the cart for ${id}.`,
})

test('the rule map gives each rule a status on each build, with defects by severity and the change against the build before', (t) => {
	const opened = seeded(t)
	const map = ruleMap(opened, 'checkout')
	assert.deepEqual(
		map.builds.map((item) => item.build),
		['b1', 'b2', 'b3']
	)
	assert.equal(map.rulesOrigin, 'revision')
	const row = (rule: string) => map.rows.find((item) => item.rule.id === rule)!
	const statuses = (rule: string) => row(rule).cells.map((cell) => cell.status)
	assert.deepEqual(statuses('R1'), ['failed', 'passed', 'not_checked'])
	assert.deepEqual(statuses('R2'), ['failed', 'not_checked', 'failed'])
	assert.deepEqual(statuses('R3'), ['failed', 'failed', 'not_checked'])
	assert.deepEqual(statuses('outside'), ['failed', 'failed', 'not_checked'])
	const [r2b1, r2b2, r2b3] = row('R2').cells
	assert.deepEqual(r2b1.severities, { critical: 0, high: 1, medium: 0, low: 0 })
	assert.deepEqual(
		r2b1.claims.map((claim) => [claim.id, claim.change]),
		[['a1/D1', 'new']]
	)
	assert.deepEqual(r2b2.changes, { new: [], still_present: [], fixed: ['a1/D1'], returned: [], not_retested: [] })
	assert.deepEqual([r2b3.before, r2b3.changes.returned], ['not_checked', ['a1/D1']])
	const [o1, o2, o3] = row('outside').cells
	assert.deepEqual(
		o1.claims.map((claim) => claim.id),
		['a1/D2']
	)
	assert.deepEqual(o2.changes.still_present, ['a1/D2'])
	assert.deepEqual(o3.changes.not_retested, ['a1/D2'])
	assert.deepEqual(row('R3').cells[1].criteria, { right: 0, wrong: 1 })
	assert.deepEqual(
		row('R1').cells[0].claims.map((claim) => claim.id),
		['merge/I1']
	)
	assert.deepEqual(map.unlinked, { claims: ['a1/D3'], questions: [] })
})

test('the rule map groups rules into areas in order of first rule, with the worst status of each build', (t) => {
	const request = planRequest()
	const areas = ['Checkout', 'checkout', 'Refunds']
	const opened = seeded(t, {
		...request,
		requirements: request.requirements!.map((rule, index) => ({ ...rule, area: areas[index] })),
	})
	const map = ruleMap(opened, 'checkout')
	assert.deepEqual(
		map.areas.map((area) => [area.label, area.ruleIds]),
		[
			['Checkout', ['R1', 'R2']],
			['Refunds', ['R3']],
		]
	)
	assert.deepEqual(
		map.areas.map((area) => area.cells.map((cell) => cell.status)),
		[
			['failed', 'passed', 'failed'],
			['failed', 'failed', 'not_checked'],
		]
	)
	const row = (rule: string) => map.rows.find((item) => item.rule.id === rule)!
	const [first] = map.areas
	assert.deepEqual(first.cells[0].severities, { critical: 0, high: 1, medium: 1, low: 0 })
	assert.deepEqual(first.cells[0].claims, row('R1').cells[0].claims.length + row('R2').cells[0].claims.length)
	assert.deepEqual(first.cells[0].criteria, { right: 1, wrong: 0 })
	assert.deepEqual(first.cells[1].changes, { new: 0, still_present: 0, fixed: 1, returned: 0, not_retested: 1 })
	assert.deepEqual(
		map.rows.map((item) => item.rule.id),
		['R1', 'R2', 'R3', 'outside']
	)
	assert.deepEqual(
		map.areas.flatMap((area) => area.cells.map((cell) => cell.build)),
		['b1', 'b2', 'b3', 'b1', 'b2', 'b3']
	)
})

test('rules without an area make one area named Rules', (t) => {
	const map = ruleMap(seeded(t), 'checkout')
	assert.deepEqual(
		map.areas.map((area) => [area.label, area.ruleIds]),
		[['Rules', ['R1', 'R2', 'R3']]]
	)
	assert.deepEqual(
		map.areas[0].cells.map((cell) => cell.status),
		['failed', 'failed', 'failed']
	)
})

test('an open question makes a cell a question, and a rule without a record is not checked, never passed', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'x-1', 'b1')
	entries(opened, 'x-1', 'a1', [
		{ kind: 'question', id: 'Q1', rule: 'R3', question: 'Which orders qualify for refunds?' },
		{ kind: 'criterion', id: 'C1', rule: 'R1', text: 'A 400 PLN order totals 400 PLN.' },
		{ kind: 'criterion', id: 'C2', text: 'Old style criterion.' },
	])
	done(opened, 'x-1')
	const map = ruleMap(opened, 'checkout')
	const status = (rule: string) => map.rows.find((item) => item.rule.id === rule)!.cells[0]
	assert.equal(status('R3').status, 'question')
	assert.equal(map.areas[0].cells[0].status, 'question')
	assert.deepEqual(status('R3').questions, [
		{ id: 'a1/Q1', question: 'Which orders qualify for refunds?', label: null },
	])
	assert.equal(status('R1').status, 'not_checked')
	assert.equal(status('R2').status, 'not_checked')
})

test('a claim state on each build tells new, still present, fixed, returned, and not retested apart', (t) => {
	const opened = seeded(t)
	const details = new Map(claimDetails(opened, 'checkout').map((claim) => [claim.id, claim]))
	assert.deepEqual(details.get('a1/D1')!.builds, [
		{ build: 'b1', state: 'new' },
		{ build: 'b2', state: 'fixed' },
		{ build: 'b3', state: 'returned' },
	])
	assert.deepEqual(details.get('a1/D2')!.builds, [
		{ build: 'b1', state: 'new' },
		{ build: 'b2', state: 'still_present' },
		{ build: 'b3', state: 'not_retested' },
	])
	assert.deepEqual(
		details.get('a1/D3')!.builds.map((item) => item.state),
		['new', 'not_retested', 'not_retested']
	)
})

test('the rule of a claim is the most frequent rule of its reports, and a tie goes to the first', (t) => {
	const opened = seeded(t)
	assert.equal(mostFrequent(['R2', 'R1', 'R1']), 'R1')
	assert.equal(mostFrequent([undefined, 'R2', 'R1']), 'R2')
	assert.equal(mostFrequent([undefined]), null)
	const details = new Map(claimDetails(opened, 'checkout').map((claim) => [claim.id, claim]))
	assert.equal(details.get('merge/I1')!.rule, 'R1')
	assert.deepEqual(
		details.get('merge/I1')!.reporters.map((item) => [item.explorer, item.report, item.build, item.rule]),
		[
			['a2', 'a2/D1', 'b1', 'R1'],
			['a2', 'a2/D2', 'b1', 'R2'],
		]
	)
	assert.equal(details.get('a1/D3')!.rule, null)
	const question = planQuestions(opened, 'checkout').find((item) => item.id === 'a1/Q1')!
	assert.deepEqual([question.rule, question.actual, question.builds], ['R3', 'All do.', ['b1']])
})

test('a claim says why it is uncertain, and lists all evidence of its reports with kind and thumbnail', (t) => {
	const opened = seeded(t)
	const details = new Map(claimDetails(opened, 'checkout').map((claim) => [claim.id, claim]))
	assert.deepEqual(details.get('a1/D4')!.uncertain, [
		{ reason: 'tester_unsure', text: 'Is a refund of 0 valid?' },
		{ reason: 'open_question', text: 'Which orders qualify for refunds?', questionId: 'a1/Q1' },
	])
	assert.deepEqual(details.get('a1/D2')!.uncertain, [{ reason: 'not_reproduced', text: 'The page shows no error.' }])
	assert.deepEqual(details.get('a1/D1')!.uncertain, [])
	assert.equal(details.get('a1/D1')!.handoff, null)
	handOffClaims(opened, 'tester', { planId: 'checkout', claimIds: ['a1/D1'], to: 'Cart team', undo: false })
	const handed = claimDetails(opened, 'checkout').find((claim) => claim.id === 'a1/D1')!
	assert.deepEqual([handed.handoff?.to, handed.handoff?.actor], ['Cart team', 'tester'])
	assert.deepEqual(
		details.get('a1/D1')!.evidence.map((item) => [item.report, item.index, item.kind, item.name, item.thumbnail]),
		[
			['a1/D1', 0, 'image', 'cart.png', true],
			['a1/D1', 1, 'note', null, false],
		]
	)
})
