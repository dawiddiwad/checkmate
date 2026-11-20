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
	assert.deepEqual(
		[second.body.checkSkipped, second.body.storedTests],
		[[], 'none, the testers retest the earlier findings']
	)
	assert.deepEqual(second.body.next, ['checkmate explore wait x-2'])
	assert.doesNotMatch(second.output, /harvest|no stored tests/i)
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
		'Execute the stored tests of run-1: checkmate delegate execute run-1 --allow Read --allow Bash',
		'checkmate explore wait x-1',
	])
	wait('x-1')
	const calls = called()
	const [explorer] = calls.filter((call) => call.role === 'explorer')
	const [tester] = calls.filter((call) => call.role === 'tester')
	assert.match(
		explorer.prompt,
		/\nChanged files:\n- cart\.js\n\nThe code of the change is shown by git diff --merge-base HEAD in the workspace\.\nRead the diff first\. Test what the diff changes and what depends on it\.\n/
	)
	assert.match(
		tester.prompt,
		/unclear\.\nThe code of the change is shown by git diff --merge-base HEAD in the workspace\.\nRead the diff first\. Test what the diff changes and what depends on it\.\nUse the existing records/
	)
	assert.doesNotMatch(explorer.prompt + tester.prompt, /version before the change/)
	const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim()
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.since, status.until], ['HEAD', head])
	const text = run(
		['test', 'checkout', '--build', 'b2', '--since', 'no-such-ref', ...allow, '--workspace', workspace],
		{
			cwd: workspace,
			env: {},
			stdin: () => '',
		}
	).output
	assert.match(text, /reason: git diff --name-only --merge-base no-such-ref failed/)
})

function commit(cwd: string, text: string) {
	writeFileSync(join(cwd, 'cart.js'), text)
	execFileSync('git', ['add', 'cart.js'], { cwd })
	execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', text], { cwd })
}

test('--until names the end of the change; the checked-out files are then the version before it', (t) => {
	const { command, wait, called, workspace } = setup(t, ready)
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspace })
	commit(workspace, 'one')
	execFileSync('git', ['checkout', '-qb', 'feature'], { cwd: workspace })
	commit(workspace, 'two')
	execFileSync('git', ['checkout', '-q', 'main'], { cwd: workspace })
	const lone = command(['test', 'checkout', '--build', 'b1', '--until', 'feature', ...allow])
	assert.match(lone.body.reasons[1], /--until needs --since/)
	const reply = command([
		'explore',
		'start',
		'checkout',
		'--build',
		'b1',
		'--level',
		'smoke',
		'--since',
		'main',
		'--until',
		'feature',
		...allow,
	])
	assert.equal(reply.code, 0, reply.output)
	wait('x-1')
	const turns = called().filter((call) => call.role === 'explorer' || call.role === 'tester')
	for (const turn of turns)
		assert.match(
			turn.prompt,
			/\nThe code of the change is shown by git diff main\.\.\.feature in the workspace\.\nThe checked-out files are the version before the change, and the diff shows the change\.\nRead the diff first\./
		)
	assert.match(turns[0].prompt, /\nChanged files:\n- cart\.js\n/)
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.since, status.until], ['main', 'feature'])
	const shown = run(['explore', 'show', 'x-1', '--workspace', workspace], {
		cwd: workspace,
		env: {},
		stdin: () => '',
	})
	assert.match(shown.output, / since=main until=feature /)
})

test('without --since, test assumes the default branch of origin when it is behind the checked-out commit', (t) => {
	const { command, wait, called, workspace } = setup(t, ready)
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspace })
	commit(workspace, 'one')
	const none = command(['test', 'checkout', '--build', 'b1', '--level', 'smoke', ...allow])
	assert.deepEqual(none.body.assumed, [
		'since=none (no diff is given: no --since, and no default branch of origin behind the checked-out commit)',
	])
	wait('x-1')
	assert.doesNotMatch(called()[0].prompt, /git diff/)
	execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: workspace })
	execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: workspace })
	commit(workspace, 'two')
	const assumed = command(['test', 'checkout', '--build', 'b2', '--level', 'smoke', ...allow])
	assert.deepEqual(assumed.body.assumed, [
		'since=origin/main (the default branch of origin, behind the checked-out commit)',
	])
	assert.deepEqual(assumed.body.scope, ['cart.js'])
	wait('x-2')
	assert.match(called()[0].prompt, /git diff --merge-base origin\/main in the workspace\./)
	assert.equal(command(['explore', 'status', 'x-2']).body.since, 'origin/main')
})
