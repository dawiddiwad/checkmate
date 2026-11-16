import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { execFileSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore } from '../plugin/src/store.ts'
import { actor, directory, ready, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

const allow = ['--allow', 'Read', '--allow', 'Bash']

function setup(t: TestContext, prepare: (opened: ReturnType<typeof store>) => void = target) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	prepare(opened)
	closeStore(opened)
	const fake = fakeClaude(t, { explorer: 'Tested.', recorder: [{ kind: 'note', text: 'Explored the cart.' }] })
	const command = (args: string[]) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output), output: outcome.output }
	}
	const wait = (id: string) => assert.equal(command(['explore', 'wait', id, '--timeout', '60']).code, 0)
	return { workspace, command, wait, ...fake }
}

test('test records a missing request, explores first, and checks the stored tests later', (t) => {
	const { command, wait } = setup(t)
	const bare = command(['test', 'cart', '--build', 'b1', ...allow])
	assert.equal(bare.code, 1)
	assert.match(bare.body.reasons[1], /^Unknown plan: cart\. Give the ticket or the criteria file with --source\./)
	const base = ['test', 'cart', '--build', 'b1', '--level', 'smoke', ...allow]
	const first = command([
		...base,
		'--objective',
		'Check the cart.',
		'--target',
		'checkout-local',
		'--source',
		'ticket.md',
	])
	assert.equal(first.code, 0, first.output)
	assert.deepEqual([first.body.mode, first.body.chosenBy, first.body.run], ['exploratory', 'auto', null])
	assert.deepEqual(first.body.next, ['checkmate explore wait x-1'])
	wait('x-1')
	const second = command(['test', 'cart', '--build', 'b2', '--level', 'smoke', ...allow])
	assert.deepEqual([second.body.mode, second.body.run], ['regression', null])
	assert.deepEqual(second.body.checkSkipped, ['Plan cart has no stored tests.'])
	wait('x-2')
	const shown = command(['explore', 'show', 'x-2']).body
	assert.equal(shown.mode, 'regression')
})

test('test in regression mode begins a run of the ready tests and explores the changed files', (t) => {
	const { command, wait, called, workspace } = setup(t, ready)
	execFileSync('git', ['init', '-q'], { cwd: workspace })
	writeFileSync(join(workspace, 'cart.js'), 'one\n')
	execFileSync('git', ['add', 'cart.js'], { cwd: workspace })
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: workspace })
	writeFileSync(join(workspace, 'cart.js'), 'two\n')
	const reply = command([
		'test',
		'checkout',
		'--build',
		'b1',
		'--mode',
		'regression',
		'--level',
		'smoke',
		'--since',
		'HEAD',
		...allow,
	])
	assert.equal(reply.code, 0, reply.output)
	assert.deepEqual(reply.body.run, { runId: 'run-1', tests: ['T1', 'T2'] })
	assert.deepEqual(reply.body.scope, ['cart.js'])
	assert.deepEqual(reply.body.next, [
		'Execute the stored tests of run-1: /checkmate:execute run-1, or checkmate delegate execute run-1',
		'checkmate explore wait x-1',
	])
	wait('x-1')
	const [explorer] = called().filter((call) => call.role === 'explorer')
	assert.match(explorer.prompt, /\nChanged files:\n- cart\.js\n/)
	const text = run(
		['test', 'checkout', '--build', 'b2', '--since', 'no-such-ref', ...allow, '--workspace', workspace],
		{
			cwd: workspace,
			env: {},
			stdin: () => '',
		}
	).output
	assert.match(text, /reason: git diff --name-only no-such-ref failed/)
})
