import type { Plan } from '../plugin/src/types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { approvePlan, planRevision } from '../plugin/src/plans.ts'
import { planDetail } from '../plugin/src/views.ts'
import { candidate, json, plan, revised, store, target } from './support.ts'

type Editable = Pick<Plan, 'objective' | 'requirements' | 'tests'>

const invalidEdits: Array<{ name: string; change: (input: Editable) => void; reason: RegExp }> = [
	{
		name: 'missing requirements',
		change: (input) => {
			input.requirements = input.requirements.filter((item) => item.id !== 'R1')
		},
		reason: /Unknown requirement in test T1/,
	},
	{
		name: 'disallowed operations',
		change: (input) => {
			input.tests[0].operations = ['delete_orders']
		},
		reason: /operation delete_orders, which the target does not permit/,
	},
	{
		name: 'missing capabilities',
		change: (input) => {
			input.tests[0].capability = 'mobile'
		},
		reason: /capability mobile, which the target lacks/,
	},
	{
		name: 'dependency cycles',
		change: (input) => {
			input.tests[0].dependsOn = ['T2']
		},
		reason: /Test dependency cycle/,
	},
	{
		name: 'removing tests with recorded gap decisions',
		change: (input) => {
			input.tests = input.tests.filter((item) => item.id !== 'T2')
		},
		reason: /Unknown test in gap G1/,
	},
]

for (const invalid of invalidEdits) {
	test(`CLI edits reject ${invalid.name} without changing the saved revision`, (t) => {
		const opened = store(t)
		target(opened)
		plan(opened)
		revised(opened)
		const before = planRevision(opened, 'checkout')
		const input = structuredClone(before.plan)
		invalid.change(input)
		const result = json(opened.workspace, ['plan', 'edit', 'checkout', '--expect-sha', before.sha256], input)
		assert.equal(result.code, 1)
		assert.match(result.body.reasons.join(' '), invalid.reason)
		assert.deepEqual(planRevision(opened, 'checkout'), before)
	})
}

for (const relation of ['dependency', 'gap'] as const) {
	test(`CLI edits cannot remove a test named by another plan's ${relation}`, (t) => {
		const opened = store(t)
		target(opened)
		plan(opened)
		const consumer = candidate()
		if (relation === 'dependency') consumer.tests[0].dependsOn = ['checkout:T1']
		else consumer.gaps[0].testIds.push('checkout:T1')
		plan(opened, 'consumer', consumer)
		const before = planRevision(opened, 'checkout')
		const input = structuredClone(before.plan)
		input.requirements = input.requirements.filter((item) => item.id !== 'R1')
		input.tests = input.tests.filter((item) => item.id !== 'T1')
		input.tests[0].dependsOn = []
		const result = json(opened.workspace, ['plan', 'edit', 'checkout', '--expect-sha', before.sha256], input)
		assert.equal(result.code, 1)
		assert.match(result.body.reasons.join(' '), /Unknown test in checkout:T1/)
		assert.deepEqual(planRevision(opened, 'checkout'), before)
	})
}

test('CLI edits add requirements and tests with fresh coverage and revision-specific approval', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	approvePlan(opened, 'caller', { reference: 'checkout@1', rationale: 'Reviewed scope' })
	const before = planRevision(opened, 'checkout')
	const input = structuredClone(before.plan)
	input.requirements.push({ id: 'R4', text: 'A new agreed checkout check.', source: 'ticket#new-check' })
	input.tests.push({ ...structuredClone(input.tests[0]), id: 'T4', requirementIds: ['R4'] })
	const result = json(opened.workspace, ['plan', 'edit', 'checkout', '--expect-sha', before.sha256], input)
	assert.equal(result.code, 0)
	const after = planDetail(opened, 'checkout')
	assert.equal(after.revision, 2)
	assert.deepEqual(
		after.plan.coverage.find((item) => item.requirementId === 'R4'),
		{ requirementId: 'R4', testIds: ['T4'], status: 'planned' }
	)
	assert.equal(after.approval.state, 'pending')
	assert.equal(planDetail(opened, 'checkout', 1).approval.state, 'approved')
	assert.deepEqual(planRevision(opened, 'checkout', 1), before)
})
