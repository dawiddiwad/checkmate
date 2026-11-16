import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { Profile } from '../plugin/src/types.ts'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore } from '../plugin/src/store.ts'
import { levelNames, testLevels } from '../plugin/src/levels.ts'
import { authenticationHint, storeDenyRules } from '../plugin/src/sessions.ts'
import { actor, directory, plan, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import type { FakeReplies } from './claude.ts'

const defect = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }
const allow = ['--allow', 'Read', '--allow', 'Bash']

function setup(
	t: TestContext,
	options: { profile?: Partial<Profile>; installed?: boolean; replies?: FakeReplies } = {}
) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	target(opened, options.profile)
	plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, options.replies ?? { explorer: 'Tested the cart.', recorder: [defect] })
	if (options.installed !== false) {
		mkdirSync(join(fake.config, 'plugins'), { recursive: true })
		writeFileSync(
			join(fake.config, 'plugins', 'installed_plugins.json'),
			JSON.stringify({ version: 2, plugins: { 'checkmate@checkmate': [{ installPath: join(root, 'plugin') }] } })
		)
	}
	const command = (args: string[]) => {
		const outcome = run([...args, '--workspace', workspace, '--json'], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_ACTOR: actor, ...fake.env },
			stdin: () => '',
		})
		return { code: outcome.code, body: JSON.parse(outcome.output) }
	}
	const start = (extra: string[] = []) =>
		command(['explore', 'start', 'checkout', '--build', 'b1', ...allow, ...extra])
	const wait = () => command(['explore', 'wait', 'x-1', '--timeout', '60'])
	return { workspace, command, start, wait, ...fake }
}

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1]
const hidden = JSON.stringify({ enabledPlugins: { 'checkmate@checkmate': false } })
const explorerSettings = JSON.stringify({
	enabledPlugins: { 'checkmate@checkmate': false },
	permissions: { deny: storeDenyRules },
})

test('explore start launches the explorers of the level in a clean context, then records each session', (t) => {
	const { start, wait, called, workspace } = setup(t)
	const started = start()
	assert.equal(started.code, 0, JSON.stringify(started.body))
	assert.deepEqual(
		[
			started.body.level,
			started.body.explorers,
			started.body.model,
			started.body.verifier,
			started.body.pluginHidden,
		],
		['standard', 3, testLevels.standard.model, true, true]
	)
	const done = wait()
	assert.equal(done.code, 0, JSON.stringify(done.body))
	assert.equal(done.body.outcome, 'done')
	assert.deepEqual(
		done.body.explorers.map((item: { explorer: string; ended: string; recorded: string; saved: number }) => [
			item.explorer,
			item.ended,
			item.recorded,
			item.saved,
		]),
		[
			['a1', 'completed', 'completed', 1],
			['a2', 'completed', 'completed', 1],
			['a3', 'completed', 'completed', 1],
		]
	)
	const calls = called()
	const explorers = calls.filter((call) => call.role === 'explorer')
	assert.equal(explorers.length, 3)
	for (const call of explorers) {
		assert.equal(after(call.args, '--model'), testLevels.standard.model)
		assert.equal(after(call.args, '--settings'), explorerSettings)
		assert.match(call.prompt, /\nYou have about 10 minutes\. Write your report before the time ends\.\n/)
		assert.match(
			call.prompt,
			/\nTools you can use: node, playwright-cli\.\nUse the fastest check that proves the behaviour: a direct HTTP call where it proves the point, the browser where the page itself is what you test\.\n/
		)
		assert.deepEqual(call.args.filter((arg: string) => arg === '--allowedTools').length, 2)
		assert.deepEqual(call.env, [])
		assert.equal(call.cwd, workspace)
		assert.doesNotMatch(call.prompt, /checkmate|record|journal/i)
		assert.match(call.prompt, /^Test this change of the application and find its defects\./)
		assert.match(call.prompt, /http:\/\/127\.0\.0\.1:4173/)
		assert.match(call.prompt, /Start each name or value that you make with qa-x-1-a[123]-\./)
	}
	const sessions = new Set(explorers.map((call) => after(call.args, '--session-id')))
	const recorders = calls.filter((call) => call.role === 'recorder')
	assert.deepEqual(new Set(recorders.map((call) => after(call.args, '--resume'))), sessions)
	for (const call of recorders) {
		assert.equal(after(call.args, '--model'), testLevels.standard.model)
		assert.equal(after(call.args, '--settings'), hidden)
		assert(!call.args.some((arg: string) => /allowedTools|--tools|disallowed/.test(arg)), 'no tool list')
	}
	const status = run(['explore', 'status', 'x-1', '--workspace', workspace], {
		cwd: workspace,
		env: {},
		stdin: () => '',
	})
	assert.match(status.output, /^completed x-1 state=completed plan=checkout build=b1 level=standard explorers=3/)
	assert.match(readFileSync(join(workspace, '.checkmate', 'tmp', 'explore-x-1.log'), 'utf8'), /^$/)
})

test('the level sets the count and the model; --explorers, --claude-arg --model, and the profile override it', (t) => {
	const { start, wait, called, command } = setup(t, { profile: { explore: { level: 'smoke' } } })
	assert.equal(start().body.level, 'smoke')
	wait()
	const smoke = called().filter((call) => call.role === 'explorer')
	assert.equal(smoke.length, testLevels.smoke.explorers)
	assert.equal(after(smoke[0].args, '--model'), testLevels.smoke.model)
	const deep = start(['--level', 'deep'])
	assert.deepEqual([deep.body.explorers, deep.body.model], [testLevels.deep.explorers, testLevels.deep.model])
	command(['explore', 'wait', 'x-2', '--timeout', '60'])
	assert.equal(called().filter((call) => call.role === 'explorer').length, testLevels.deep.explorers)
	const host = start(['--level', 'deep', '--explorers', '1', '--claude-arg', '--model', '--claude-arg', 'host-model'])
	assert.deepEqual([host.body.explorers, host.body.model], [1, 'host-model'])
	command(['explore', 'wait', 'x-3', '--timeout', '60'])
	const status = command(['explore', 'status', 'x-3']).body
	assert.deepEqual(
		[status.level, status.explorerCount, status.model, status.modelFrom],
		['deep', 1, 'host-model', 'host']
	)
	const [explorer] = called().filter((call) => call.role === 'explorer')
	assert.deepEqual(explorer.args.filter((arg: string) => arg === '--model').length, 1)
	assert.equal(after(explorer.args, '--model'), 'host-model')
})

test('a refused model fails the launch with a hint that names the override, and nothing retries', (t) => {
	const { start, wait, called } = setup(t, { replies: { explorer: '!model' } })
	start(['--level', 'smoke'])
	const failed = wait()
	assert.equal(failed.code, 1)
	assert.equal(failed.body.outcome, 'failed')
	assert.match(
		failed.body.hint,
		/The host refused the model .* of level smoke\. Give another model with --claude-arg --model/
	)
	assert.deepEqual(
		called().map((call) => call.role),
		['explorer']
	)
})

test('without an install record the explorers start without the override, and status prints no note', (t) => {
	const { start, wait, called, workspace } = setup(t, { installed: false })
	assert.equal(start(['--level', 'smoke']).body.pluginHidden, false)
	wait()
	const calls = called()
	assert.deepEqual(
		calls
			.filter((call) => call.args.includes('--settings'))
			.map((call) => [call.role, JSON.parse(after(call.args, '--settings'))]),
		[['explorer', { permissions: { deny: storeDenyRules } }]]
	)
	const status = run(['explore', 'status', 'x-1', '--workspace', workspace], {
		cwd: workspace,
		env: {},
		stdin: () => '',
	})
	assert.doesNotMatch(status.output, /note|install|plugin/i)
})

test('explore start refuses without tool rules or with a reserved Claude argument', (t) => {
	const { command } = setup(t)
	const bare = command(['explore', 'start', 'checkout', '--build', 'b1'])
	assert.equal(bare.code, 1)
	assert.match(bare.body.reasons[1], /Give the tool rules of the explorers and the verifier with --allow/)
	const reserved = command(['explore', 'start', 'checkout', '--build', 'b1', ...allow, '--claude-arg', '--settings'])
	assert.match(reserved.body.reasons[1], /--claude-arg --settings is not permitted/)
	assert.equal(command(['query', 'SELECT count(*) AS n FROM explorations']).body.rows[0].n, 0)
})

test('the levels have one table, and the profile schema names the same levels', () => {
	const schema = JSON.parse(readFileSync(join(root, 'plugin/contracts/profile.schema.json'), 'utf8'))
	assert.deepEqual(schema.properties.explore.properties.level.enum, levelNames)
})

test('a failed launch keeps the last lines of stderr, and status offers the test again', (t) => {
	const { workspace, command } = setup(t, { replies: { explorer: '!crash' } })
	command(['plan', 'open', 'later', '--target', 'checkout-local@1', '--objective', 'Later.', '--source', 't.md'])
	assert.equal(command(['explore', 'start', 'later', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	const failed = command(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.equal(failed.body.outcome, 'failed')
	assert.deepEqual(
		failed.body.explorers[0].stderr,
		Array.from({ length: 10 }, (_, index) => `stack line ${index + 3}`)
	)
	const shown = run(['explore', 'show', 'x-1', '--workspace', workspace], {
		cwd: workspace,
		env: {},
		stdin: () => '',
	})
	assert.match(shown.output, /\na1\tstderr\tstack line 3\n/)
	assert.match(shown.output, /\na1\tstderr\tstack line 12(\n|$)/)
	const status = command(['status', 'later']).body
	assert.deepEqual(
		[status.state, status.waitsOn, status.why, status.next],
		[
			'ready_to_test',
			'qa',
			['x-1 failed on build b1: No explorer session was recorded.'],
			['checkmate test later --allow Read --allow Bash'],
		]
	)
})

test('a host authentication failure fails the exploration with the plain hint, and nothing retries', (t) => {
	const { start, wait, called, command } = setup(t, { replies: { explorer: '!auth', recorder: '!auth' } })
	start(['--level', 'smoke'])
	const failed = wait()
	assert.equal(failed.code, 1)
	assert.equal(failed.body.outcome, 'failed')
	assert.deepEqual(failed.body.reasons, ['Host authentication: no session could log in.'])
	assert.equal(failed.body.hint, authenticationHint)
	assert.deepEqual(
		called().map((call) => call.role),
		['explorer']
	)
	const recorded = command(['record', 'x-1', '--explorer', 'b1', '--session', '44444444-4444-4444-8444-444444444444'])
	assert.equal(recorded.body.status, 'operational_error')
	assert.equal(recorded.body.hint, authenticationHint)
	assert.equal(called().length, 1)
})

test('--minutes sets the time budget of the brief, and the safety timeout stays well above it', (t) => {
	const { start, wait, called, command } = setup(t)
	const started = start(['--level', 'smoke', '--minutes', '25'])
	assert.equal(started.body.minutes, 25)
	wait()
	const [explorer] = called().filter((call) => call.role === 'explorer')
	assert.match(explorer.prompt, /\nYou have about 25 minutes\. Write your report before the time ends\.\n/)
	const status = command(['explore', 'status', 'x-1']).body
	assert.equal(status.minutes, 25)
	const events = command(['query', "SELECT detail FROM exploration_events WHERE step = 'start'"]).body.rows
	assert.equal(JSON.parse(events[0].detail).timeoutSeconds, 25 * 60 * 3)
	assert.deepEqual(
		levelNames.map((name) => testLevels[name].minutes),
		[5, 10, 20]
	)
})
