import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { checkedRules } from '../plugin/src/rules.ts'
import { closeStore } from '../plugin/src/store.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import type { FakeReplies } from './claude.ts'

const allow = ['--allow', 'Read', '--allow', 'Bash']
const ticket = '# Cart\n\n## Discount\n\n5 or more items get 10% off.\n\n## Limit\n\nA cart holds at most 20 items.\n'
const derived = [
	{ id: 'R1', text: '5 or more items get 10% off.', source: 'ticket.md#Discount', area: 'Discount' },
	{ id: 'R2', text: 'A cart holds at most 20 items.', source: 'ticket.md#Limit', area: 'Limit' },
]

function setup(
	t: TestContext,
	replies: FakeReplies = { rules: derived },
	prepare: (opened: ReturnType<typeof store>) => unknown = target
) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	prepare(opened)
	closeStore(opened)
	writeFileSync(join(workspace, 'ticket.md'), ticket)
	const fake = fakeClaude(t, {
		explorer: 'Tested.',
		recorder: [{ kind: 'note', text: 'Explored the cart.' }],
		...replies,
	})
	const command = (args: string[], stdin = '') => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => stdin,
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	const testBuild = (build: string, extra: string[] = []) => {
		const started = command(['test', 'cart', '--build', build, '--level', 'smoke', ...allow, ...extra])
		assert.equal(started.code, 0, started.output)
		const id = started.body.explorationId as string
		assert.equal(command(['explore', 'wait', id, '--timeout', '60']).code, 0)
		return id
	}
	const stored = () =>
		command(['query', 'SELECT origin, body FROM plan_rules ORDER BY rowid']).body.rows as Array<{
			origin: string
			body: string
		}>
	return { workspace, command, testBuild, stored, ...fake }
}

test('the first test of a plan without rules derives them once from the sources, before the testers', (t) => {
	const { command, testBuild, stored, called } = setup(t)
	testBuild('b1', ['--source', 'ticket.md', '--objective', 'Check the cart.', '--target', 'checkout-local'])
	const calls = called()
	assert.deepEqual(
		calls.map((call) => call.role),
		['rules', 'explorer', 'tester', 'recorder']
	)
	const [rules, explorer] = calls
	assert.match(rules.prompt, /^Write the rules of the change that the sources below describe\. Do not test\.\n/)
	assert.match(rules.prompt, /Use no tool\./)
	assert.match(
		rules.prompt,
		/\nSort the rules into areas\. Use at most nine areas for one plan\. Put each rule in exactly one area\. Rules that test one feature or one page share an area\. An area name is a plain noun phrase of one to three words, taken from the words of the sources/
	)
	assert.match(rules.prompt, /"area": "<the area of the rule>"/)
	assert(rules.prompt.endsWith(`Goal: Check the cart.\n\nSource ticket.md:\n${ticket}`), rules.prompt)
	assert(rules.args.includes('--session-id'))
	assert(!rules.args.includes('--allowedTools'))
	assert.match(
		explorer.prompt,
		/\nRules of the change:\n- R1: 5 or more items get 10% off\.\n- R2: A cart holds at most 20 items\.\n/
	)
	assert.deepEqual(stored()[0].origin, 'derived')
	assert.deepEqual(JSON.parse(stored()[0].body), derived)
	const events = command(['query', "SELECT status, detail FROM exploration_events WHERE step = 'rules'"]).body.rows
	assert.equal(events[0].status, 'completed')
	assert.deepEqual([JSON.parse(events[0].detail).rules, JSON.parse(events[0].detail).calls], [2, 1])
	const status = command(['status', 'cart']).body
	assert.equal(
		status.rules,
		'2 rules were derived from the sources. Correct them with checkmate plan edit cart --patch.'
	)
	testBuild('b2')
	assert.deepEqual(
		called().map((call) => call.role),
		['explorer', 'tester', 'recorder']
	)
	assert.equal(stored().length, 1)
})

test('the oracle corrects derived rules with plan edit, and later charters use the correction', (t) => {
	const { command, testBuild, stored, workspace } = setup(t)
	testBuild('b1', ['--source', 'ticket.md', '--objective', 'Check the cart.', '--target', 'checkout-local'])
	const edit = command(
		['plan', 'edit', 'cart', '--patch'],
		JSON.stringify({ requirements: { R2: { text: 'A cart holds at most 25 items.' } } })
	)
	assert.equal(edit.code, 0, edit.output)
	assert.deepEqual([edit.body.edit, edit.body.origin, edit.body.rules], ['rules', 'corrected', ['R1', 'R2']])
	assert.equal(stored().at(-1)!.origin, 'corrected')
	assert.match(command(['status', 'cart']).body.rules, /^2 rules were derived from the sources and corrected\./)
	const tests = command(['plan', 'edit', 'cart', '--patch'], JSON.stringify({ tests: { T1: null } }))
	assert.equal(tests.code, 1)
	assert.match(tests.body.reasons.join(' '), /only "requirements"/)
	command(['explore', 'open', 'cart', '--build', 'b2'])
	const charter = JSON.parse(
		command(['query', "SELECT charter FROM explorations WHERE exploration_id = 'x-2'"]).body.rows[0].charter
	)
	assert.deepEqual(charter.requirements[1], { id: 'R2', text: 'A cart holds at most 25 items.' })
	assert(readFileSync(join(workspace, 'ticket.md'), 'utf8').includes('20 items'))
})

test('refused rules get one repair round, and a plan with rules or without a readable source skips the step', (t) => {
	const { testBuild, stored, called } = setup(t, {
		rules: [{ id: 'R1', text: 'Discount.', source: 'wiki.md#x', area: 'Discount' }],
		'rules-repair': derived,
	})
	testBuild('b1', ['--source', 'ticket.md', '--objective', 'Check the cart.', '--target', 'checkout-local'])
	const [first, repair] = called()
	assert.equal(first.role, 'rules')
	assert.equal(repair.role, 'rules-repair')
	assert.match(
		repair.prompt,
		/^Checkmate refused these rules of your reply:\n- \[0\] "source" must start with one of: ticket\.md\./
	)
	assert.equal(repair.args[repair.args.indexOf('--resume') + 1], first.session)
	assert.equal(stored().length, 1)

	const planned = setup(t, {}, (opened) => {
		target(opened)
		plan(opened, 'cart')
	})
	planned.testBuild('b1')
	assert(!planned.called().some((call) => call.role === 'rules'))

	const unreadable = setup(t)
	unreadable.testBuild('b1', ['--source', 'missing.md', '--objective', 'Check.', '--target', 'checkout-local'])
	assert(!unreadable.called().some((call) => call.role === 'rules'))
	assert.equal(unreadable.command(['status', 'cart']).body.rules, null)
})

test('on the session path a clerk derives the rules before the testers study', (t) => {
	const { command, workspace } = setup(t)
	const started = command([
		'test',
		'cart',
		'--build',
		'b1',
		'--source',
		'ticket.md',
		'--level',
		'smoke',
		'--target',
		'checkout-local',
		'--session',
	])
	assert.equal(started.code, 0, started.output)
	const lines = () => (command(['explore', 'next', 'x-1']).body.actions as Array<{ line: string }>).map((a) => a.line)
	const put = (value: unknown) => {
		mkdirSync(join(workspace, '.checkmate/work/x-1/rules'), { recursive: true })
		writeFileSync(join(workspace, '.checkmate/work/x-1/rules/answer.json'), JSON.stringify(value))
	}
	assert.deepEqual(lines(), [
		'start rules rules agent=checkmate:clerk description="x-1 rules rules" prompt="Read .checkmate/work/x-1/rules/task.md and write your answer to .checkmate/work/x-1/rules/answer.json."',
	])
	const task = readFileSync(join(workspace, '.checkmate/work/x-1/rules/task.md'), 'utf8')
	assert.match(task, /Write only one JSON array of rules to \.checkmate\/work\/x-1\/rules\/answer\.json/)
	assert.match(task, /End your reply with this line: rules done\n$/)
	assert.deepEqual(lines(), ['wait'])
	put([{ id: 'R1', text: '', source: 'ticket.md', area: 'Discount' }])
	const done = (extra: string[] = []) =>
		command(['explore', 'done', 'x-1', 'rules', 'rules', '--reply-line', 'rules done', ...extra])
	assert.equal(done(['--agent', 'clerk-1']).code, 0)
	assert.deepEqual(lines(), [
		'message rules rules agent=clerk-1 prompt="Read .checkmate/work/x-1/rules/task-repair.md and write your answer to .checkmate/work/x-1/rules/answer.json."',
	])
	assert.match(
		readFileSync(join(workspace, '.checkmate/work/x-1/rules/task-repair.md'), 'utf8'),
		/^These rules of your file were refused:\n- \[0\] "text" is missing\./
	)
	put(derived)
	assert.equal(done().code, 0)
	const next = lines()
	assert.match(next[0], /^start a1 study agent=checkmate:tester/)
	assert.match(
		readFileSync(join(workspace, '.checkmate/work/x-1/a1/task-study.md'), 'utf8'),
		/\nRules of the change:\n- R1: 5 or more items get 10% off\.\n- R2: A cart holds at most 20 items\.\n/
	)
	const rows = command(['query', 'SELECT origin FROM plan_rules']).body.rows
	assert.deepEqual(rows, [{ origin: 'derived' }])
})

const names = ['ticket.md']
const rule = (id: string, area?: unknown) => ({ id, text: `Rule ${id}.`, source: 'ticket.md#x', area })

test('a rule needs an area of 1 to 40 characters', () => {
	const refused = checkedRules([rule('R1'), rule('R2', '  '), rule('R3', 4), rule('R4', 'x'.repeat(41))], names)
	assert.deepEqual(refused.rules, [])
	assert.deepEqual(refused.refusals, [
		'[0] "area" is missing.',
		'[1] "area" is missing.',
		'[2] "area" is missing.',
		'[3] "area" must have at most 40 characters.',
	])
	assert.equal(checkedRules([rule('R1', 'x'.repeat(40))], names).refusals.length, 0)
})

test('areas are compared without case, trimmed, and keep the first spelling', () => {
	const checked = checkedRules(
		[rule('R1', ' Approval '), rule('R2', 'API'), rule('R3', 'approval'), rule('R4', 'api')],
		names
	)
	assert.deepEqual(checked.refusals, [])
	assert.deepEqual(
		checked.rules.map((item) => item.area),
		['Approval', 'API', 'Approval', 'API']
	)
})

test('a reply with more than nine distinct areas is refused, and nine areas are accepted', () => {
	const nine = Array.from({ length: 12 }, (_, index) => rule(`R${index + 1}`, `Area ${Math.min(index + 1, 9)}`))
	assert.deepEqual(checkedRules(nine, names).refusals, [])
	const ten = Array.from({ length: 12 }, (_, index) => rule(`R${index + 1}`, `Area ${Math.min(index + 1, 10)}`))
	assert.deepEqual(checkedRules(ten, names).refusals, ['The rules have 10 areas. Use at most 9 areas for the plan.'])
	const same = Array.from({ length: 12 }, (_, index) => rule(`R${index + 1}`, index % 2 ? 'Cart' : 'cart'))
	assert.deepEqual(checkedRules(same, names).refusals, [])
})

test('the repair round of a reply with too many areas names the count', (t) => {
	const many = Array.from({ length: 10 }, (_, index) => ({
		id: `R${index + 1}`,
		text: `Rule ${index + 1}.`,
		source: 'ticket.md#Limit',
		area: `Area ${index + 1}`,
	}))
	const { testBuild, stored, called } = setup(t, { rules: many, 'rules-repair': derived })
	testBuild('b1', ['--source', 'ticket.md', '--objective', 'Check the cart.', '--target', 'checkout-local'])
	assert.match(called()[1].prompt, /^Checkmate refused these rules of your reply:\n- The rules have 10 areas\./)
	assert.equal(stored().length, 1)
	assert.deepEqual(
		(JSON.parse(stored()[0].body) as Array<{ area: string }>).map((item) => item.area),
		['Discount', 'Limit']
	)
})

test('the oracle can give a derived rule an area', (t) => {
	const { command, testBuild } = setup(t)
	testBuild('b1', ['--source', 'ticket.md', '--objective', 'Check the cart.', '--target', 'checkout-local'])
	const edit = command(
		['plan', 'edit', 'cart', '--patch'],
		JSON.stringify({ requirements: { R2: { area: 'Cart limit' } } })
	)
	assert.equal(edit.code, 0, edit.output)
	const rows = command(['query', 'SELECT body FROM plan_rules ORDER BY rowid']).body.rows as Array<{ body: string }>
	assert.deepEqual(
		(JSON.parse(rows.at(-1)!.body) as Array<{ area: string }>).map((item) => item.area),
		['Discount', 'Cart limit']
	)
	const tooLong = command(
		['plan', 'edit', 'cart', '--patch'],
		JSON.stringify({ requirements: { R2: { area: 'x'.repeat(41) } } })
	)
	assert.equal(tooLong.code, 1)
})
