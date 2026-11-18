import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { harvestExploration, storableDefects } from '../plugin/src/harvest.ts'
import { openPlan, patchPlan, planRevision } from '../plugin/src/plans.ts'
import { ruleMap } from '../plugin/src/rulemap.ts'
import { explorationRules, planRules, rulesNeeded, saveRules } from '../plugin/src/rules.ts'
import type { Rule } from '../plugin/src/rules.ts'
import { closeStore, completed, write } from '../plugin/src/store.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { done, entries, openTest } from './explorations.ts'
import { fakeClaude } from './claude.ts'

const areas = ['Discount', 'Limit', 'Refund']
const derived: Rule[] = Array.from({ length: 12 }, (_, index) => ({
	id: `R${index + 1}`,
	text: `Derived rule ${index + 1}.`,
	source: `ticket.md#part${index + 1}`,
	area: areas[index % 3],
}))

const finding = (id: string, rule: string | undefined, expected = `Expected ${id}.`) => ({
	kind: 'defect',
	id,
	title: `Problem ${id}`,
	severity: 'medium',
	expected,
	actual: 'Wrong',
	steps: `Open the cart for ${id}.`,
	...(rule ? { rule } : {}),
})

function seeded(t: TestContext) {
	const opened = store(t)
	target(opened)
	openPlan(opened, actor, {
		planId: 'cart',
		target: 'checkout-local@1',
		request: { objective: 'Test the cart.', context: { sources: ['ticket.md'] } },
	})
	write(opened, { actor, command: 'rules', subject: 'cart', input: {} }, (operationId) => {
		saveRules(opened, operationId, 'cart', derived, 'derived')
		return { reply: completed('cart'), subjects: ['plan:cart'] }
	})
	openTest(opened, 'cart', 'x-1', 'b1')
	entries(opened, 'x-1', 'a1', [
		finding('D1', 'R2'),
		finding('D2', 'R7'),
		finding('D3', 'outside'),
		finding('D4', 'R9'),
		{ kind: 'criterion', id: 'C1', rule: 'R4', text: 'Derived rule 4.', verdict: 'ok' },
		{ kind: 'observation', id: 'O1', about: 'C1', steps: 'Look.', saw: 'Fine.', verdict: 'ok' },
	])
	done(opened, 'x-1')
	patchPlan(opened, actor, { reference: 'cart', patch: { requirements: { R9: null } } })
	return opened
}

const rowsOf = (map: ReturnType<typeof ruleMap>, ids: string[]) =>
	map.rows.filter((row) => ids.includes(row.rule.id)).map(({ rule, cells }) => ({ rule, cells }))
const original = derived.map((rule) => rule.id).filter((id) => id !== 'R9')

test('harvest keeps the derived rules, their areas, and the map, and attaches each test to the rule it cites', (t) => {
	const opened = seeded(t)
	const before = { rules: planRules(opened, 'cart'), map: ruleMap(opened, 'cart') }
	assert.deepEqual(before.rules.rules.length, 11)
	const first = harvestExploration(opened, actor, { explorationId: 'x-1', observations: true })
	assert.equal(first.status, 'completed')
	assert.deepEqual(first.data.tests, ['H1', 'H2', 'H3', 'H4', 'H5'])
	assert.deepEqual(first.data.attached, [
		{ test: 'H1', rule: 'R2' },
		{ test: 'H2', rule: 'R7' },
		{ test: 'H3', rule: 'HR1' },
		{ test: 'H4', rule: 'HR2' },
		{ test: 'H5', rule: 'R4' },
	])
	assert.deepEqual([first.data.rules, first.data.rulesWithTests], [13, 5])
	const after = planRules(opened, 'cart')
	assert.equal(after.origin, 'harvested')
	assert.deepEqual(after.rules.slice(0, 11), before.rules.rules)
	assert.deepEqual(
		after.rules.slice(11).map((rule) => rule.id),
		['HR1', 'HR2']
	)
	const map = ruleMap(opened, 'cart')
	assert.deepEqual(rowsOf(map, original), rowsOf(before.map, original))
	assert.deepEqual(map.areas.slice(0, 3), before.map.areas)
	assert.deepEqual(map.rows.at(-1)!.rule.id, 'outside')
	assert.deepEqual(
		map.rows.filter((row) => row.storedTests).map((row) => [row.rule.id, row.storedTests]),
		[
			['R2', 1],
			['R4', 1],
			['R7', 1],
			['HR1', 1],
			['HR2', 1],
		]
	)
	assert.deepEqual(
		map.rows.find((row) => row.rule.id === 'outside')!.cells,
		before.map.rows.find((row) => row.rule.id === 'outside')!.cells
	)
	const revision = planRevision(opened, 'cart').plan
	assert.deepEqual(
		revision.requirements.map((rule) => rule.id),
		['R2', 'R7', 'HR1', 'HR2', 'R4']
	)
	assert.deepEqual(revision.requirements[0], {
		id: 'R2',
		text: 'Derived rule 2.',
		source: 'ticket.md#part2',
		area: 'Limit',
	})
	assert.equal(rulesNeeded(opened, 'cart'), false)
	assert.deepEqual(
		explorationRules(opened, 'x-1').map((rule) => rule.id),
		derived.map((rule) => rule.id)
	)
})

test('a second harvest adds only new tests, attaches them the same way, and keeps the rules', (t) => {
	const opened = seeded(t)
	harvestExploration(opened, actor, { explorationId: 'x-1', observations: true })
	const mid = { rules: planRules(opened, 'cart').rules, map: ruleMap(opened, 'cart') }
	assert.deepEqual(
		mid.rules.map((rule) => rule.id),
		[...original, 'HR1', 'HR2']
	)
	openTest(opened, 'cart', 'x-2', 'b2')
	entries(opened, 'x-2', 'a1', [
		finding('D5', 'R2'),
		finding('D6', 'R11'),
		finding('D7', 'R7', 'Expected again.'),
		finding('D8', undefined, 'Derived rule 3.'),
	])
	done(opened, 'x-2')
	assert.deepEqual(
		explorationRules(opened, 'x-2').map((rule) => rule.id),
		mid.rules.map((rule) => rule.id)
	)
	const second = harvestExploration(opened, actor, { explorationId: 'x-2', observations: false })
	assert.deepEqual(second.data.attached, [
		{ test: 'H6', rule: 'R2' },
		{ test: 'H7', rule: 'R11' },
		{ test: 'H8', rule: 'R7' },
		{ test: 'H9', rule: 'R3' },
	])
	assert.deepEqual([second.data.rules, second.data.rulesWithTests], [13, 7])
	const after = planRules(opened, 'cart').rules
	assert.deepEqual(after, mid.rules)
	assert.throws(
		() => harvestExploration(opened, actor, { explorationId: 'x-2', observations: false }),
		/Each item of x-2 is harvested already/
	)
	assert.equal(planRevision(opened, 'cart').plan.tests.length, 9)
	const map = ruleMap(opened, 'cart')
	assert.deepEqual(
		rowsOf(map, original).map((row) => row.rule),
		rowsOf(mid.map, original).map((row) => row.rule)
	)
})

test('after a harvest, rules with a stored test are corrected in the revision, and the other rules by patch', (t) => {
	const opened = seeded(t)
	harvestExploration(opened, actor, { explorationId: 'x-1', observations: false })
	const patch = (reference: string, requirements: Record<string, object>) =>
		patchPlan(opened, actor, { reference, patch: { requirements } })
	assert.throws(
		() => patch('cart', { R2: { text: 'No.' } }),
		/Rule R2 has a stored test, so it belongs to revision 1\./
	)
	assert.throws(
		() => patch('cart@1', { R3: { text: 'No.' } }),
		/Rule R3 has no stored test, so it is not in revision 1\./
	)
	const free = patch('cart', { R3: { area: 'Limit' } })
	assert.equal(free.status, 'completed', free.reasons.join(' '))
	assert.equal(free.data.origin, 'harvested')
	assert.equal(planRules(opened, 'cart').rules.find((rule) => rule.id === 'R3')!.area, 'Limit')
	const edited = patch('cart@1', { R2: { text: 'Better.' } })
	assert.equal(edited.status, 'completed', edited.reasons.join(' '))
	assert.equal(planRules(opened, 'cart').rules.find((rule) => rule.id === 'R2')!.text, 'Better.')
	assert.equal(planRules(opened, 'cart').rules.length, 13)
})

test('a plan with a revision of a person keeps its rules, and a test attaches to the rule that the finding cites', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'x-1', 'b1')
	entries(opened, 'x-1', 'a1', [
		finding('D1', 'R3', 'Another text.'),
		finding('D2', 'R9', 'Unknown rule.'),
		finding('D3', undefined, 'A new requirement text.'),
	])
	done(opened, 'x-1')
	const before = planRules(opened, 'checkout')
	const result = harvestExploration(opened, actor, { explorationId: 'x-1', observations: false })
	assert.deepEqual(result.data.attached, [
		{ test: 'H1', rule: 'R3' },
		{ test: 'H2', rule: 'HR1' },
		{ test: 'H3', rule: 'HR2' },
	])
	const after = planRules(opened, 'checkout')
	assert.equal(after.origin, 'revision')
	assert.deepEqual(after.rules.slice(0, 3), before.rules)
	assert.deepEqual([result.data.rules, result.data.rulesWithTests], [5, 5])
})

test('test after a harvest explores with every rule and begins a run of the stored tests', (t) => {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened)
	closeStore(opened)
	writeFileSync(join(workspace, 'ticket.md'), '# Cart\n\n## Discount\n\nOne.\n\n## Limit\n\nTwo.\n')
	const rules = [
		{ id: 'R1', text: 'One.', source: 'ticket.md#Discount', area: 'Discount' },
		{ id: 'R2', text: 'Two.', source: 'ticket.md#Limit', area: 'Limit' },
	]
	const fake = fakeClaude(t, { explorer: 'Tested.', rules, recorder: [finding('D1', 'R1')] })
	const command = (args: string[], stdin = '') => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => stdin,
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	const allow = ['--allow', 'Read', '--allow', 'Bash']
	const start = (build: string, extra: string[] = []) => {
		const started = command(['test', 'cart', '--build', build, '--level', 'smoke', ...allow, ...extra])
		assert.equal(started.code, 0, started.output)
		assert.equal(command(['explore', 'wait', started.body.explorationId, '--timeout', '60']).code, 0)
		return started.body
	}
	start('b1', ['--source', 'ticket.md', '--objective', 'Check.', '--target', 'checkout-local'])
	const harvested = command(['harvest', 'x-1'])
	assert.equal(harvested.code, 0, harvested.output)
	assert.deepEqual(harvested.body.attached, [{ test: 'H1', rule: 'R1' }])
	assert.deepEqual([harvested.body.rules, harvested.body.rulesWithTests], [2, 1])
	const second = start('b2')
	assert.deepEqual([second.mode, second.chosenBy], ['regression', 'auto'])
	assert.deepEqual([second.run, second.checkSkipped], [null, ['Plan cart@1 is not approved']])
	const approved = command(['plan', 'approve', 'cart@1', '--rationale', 'Checked.'])
	assert.equal(approved.code, 0, approved.output)
	assert.deepEqual(start('b3').run, { runId: 'run-1', tests: ['H1'] })
	const calls = fake.called()
	assert.equal(calls.filter((call) => call.role === 'rules').length, 1)
	const explorer = calls.filter((call) => call.role === 'explorer').at(-1)!
	assert.match(explorer.prompt, /\nRules of the change:\n- R1: One\.\n- R2: Two\.\n/)
	const status = command(['status', 'cart']).body
	assert.match(
		status.rules,
		/^2 rules were derived from the sources\. 1 have a stored test and belong to revision 1\./
	)
	const patch = (body: unknown, reference = 'cart') =>
		command(['plan', 'edit', reference, '--patch'], JSON.stringify(body))
	assert.match(patch({ requirements: { R1: { text: 'x' } } }).body.reasons.join(' '), /Rule R1 has a stored test/)
	assert.equal(patch({ requirements: { R2: { text: 'Two or more.' } } }).code, 0)
})

test('harvest prints the rule of each test and how many rules have a stored test', (t) => {
	const opened = seeded(t)
	const workspace = opened.workspace
	closeStore(opened)
	const outcome = run(['harvest', 'x-1', '--workspace', workspace], {
		cwd: workspace,
		env: { ...process.env, CHECKMATE_ACTOR: actor },
		stdin: () => '',
	})
	assert.equal(outcome.code, 0, outcome.output)
	assert.match(outcome.output, / attached=H1:R2,H2:R7,H3:HR1,H4:HR2 rules_with_tests=4\/13$/)
})

test('the defects to store are the claims that a harvest without observations would store', (t) => {
	const opened = seeded(t)
	const storable = storableDefects(opened, 'cart')
	assert.deepEqual(storable, [{ explorationId: 'x-1', claims: ['a1/D1', 'a1/D2', 'a1/D3', 'a1/D4'] }])
	const stored = harvestExploration(opened, actor, { explorationId: 'x-1', observations: false })
	assert.equal((stored.data.tests as string[]).length, storable[0].claims.length)
	assert.deepEqual(storableDefects(opened, 'cart'), [])
})

test('harvest keeps the rules of a request that has no revision, in the order of the request', (t) => {
	const opened = store(t)
	target(opened)
	const requirements = [
		{ id: 'R1', text: 'Rule one.', source: 'brief#one', area: 'Discount' },
		{ id: 'R2', text: 'Rule two.', source: 'brief#two', area: 'Limit' },
		{ id: 'R3', text: 'Rule three.', source: 'brief#three', area: 'Limit' },
		{ id: 'R4', text: 'Rule four.', source: 'brief#four' },
	]
	openPlan(opened, actor, {
		planId: 'cart',
		target: 'checkout-local@1',
		request: { objective: 'Test the cart.', requirements, context: { sources: [] } },
	})
	openTest(opened, 'cart', 'x-1', 'b1')
	entries(opened, 'x-1', 'a1', [finding('D1', 'R3'), finding('D2', 'R2'), finding('D3', 'outside')])
	done(opened, 'x-1')
	const reply = harvestExploration(opened, actor, { explorationId: 'x-1', observations: false })
	assert.equal(reply.status, 'completed')
	const after = planRules(opened, 'cart')
	assert.equal(after.origin, 'harvested')
	assert.deepEqual(
		after.rules.map((rule) => rule.id),
		['R1', 'R2', 'R3', 'R4', 'HR1']
	)
	assert.deepEqual(after.rules.slice(0, 4), requirements)
	assert.deepEqual(
		planRevision(opened, 'cart').plan.requirements.map((rule) => rule.id),
		['R3', 'R2', 'HR1']
	)
	assert.deepEqual([reply.data.rules, reply.data.rulesWithTests], [5, 3])
})
