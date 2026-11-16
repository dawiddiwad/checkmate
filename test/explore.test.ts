import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { Profile } from '../plugin/src/types.ts'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../plugin/src/cli.ts'
import { closeStore, completed, openStore, write } from '../plugin/src/store.ts'
import { addEvent } from '../plugin/src/explorations.ts'
import { explorerBrief } from '../plugin/src/briefs.ts'
import { driveExploration, launchPlan, startOf } from '../plugin/src/explorers.ts'
import { levelNames, testLevels } from '../plugin/src/levels.ts'
import { authenticationHint, workDenyRules } from '../plugin/src/sessions.ts'
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
const others = (explorer: string, names: string[]) =>
	names.filter((name) => name !== explorer).map((name) => `.checkmate/work/x-1/${name}`)
const explorerSettings = (explorer: string) =>
	JSON.stringify({
		enabledPlugins: { 'checkmate@checkmate': false },
		permissions: { deny: workDenyRules(others(explorer, ['a1', 'a2', 'a3'])) },
	})
const nameOf = (call: { prompt: string }) => /\.checkmate\/work\/x-1\/(a\d)\//.exec(call.prompt)![1]

test('explore start launches the explorers of the level in a clean context, then records each session', (t) => {
	const { start, wait, called, workspace, command } = setup(t)
	const started = start(['--level', 'deep'])
	assert.equal(started.code, 0, JSON.stringify(started.body))
	assert.deepEqual(
		[
			started.body.level,
			started.body.explorers,
			started.body.model,
			started.body.verifier,
			started.body.pluginHidden,
		],
		['deep', 3, testLevels.deep.model, true, true]
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
		assert.equal(after(call.args, '--model'), testLevels.deep.model)
		assert.equal(after(call.args, '--settings'), explorerSettings(nameOf(call)))
		assert.equal(call.work, join(workspace, '.checkmate', 'work', 'x-1', nameOf(call)))
		assert.match(call.prompt, /^A change of the application is ready for test\. Study it before you test\.\n/)
		assert.match(
			call.prompt,
			/\nStudy the sources, the changed files and the running application\.\nWrite \.checkmate\/work\/x-1\/a[123]\/plan\.md with your test approach\.\nWrite \.checkmate\/work\/x-1\/a[123]\/questions\.md with numbered questions for the owner of the product about anything unclear, one question for each numbered line, or None\.\nDo not test the change in this turn\.\nYou have 600 seconds for this turn\. Write the two files early and update them as you go\.$/
		)
		assert.match(
			call.prompt,
			/\nTools you can use: node, playwright-cli\.\nA direct HTTP call is sufficient when it proves the behaviour\. Use the browser when the page itself is what you test\.\n/
		)
		assert.deepEqual(call.args.filter((arg: string) => arg === '--allowedTools').length, 2)
		assert.deepEqual(call.env, [])
		assert.equal(call.cwd, workspace)
		assert.doesNotMatch(call.prompt.replaceAll('.checkmate/work/', ''), /checkmate|journal|recorder|\brecord\b/i)
		assert.doesNotMatch(call.prompt, /minutes|Test until|First read|At the end/)
		assert.match(call.prompt, /http:\/\/127\.0\.0\.1:4173/)
		assert.match(call.args.join(' '), /--session-id/)
		assert(!call.args.includes('--resume'))
	}
	const sessions = new Set(explorers.map((call) => after(call.args, '--session-id')))
	const testers = calls.filter((call) => call.role === 'tester')
	assert.deepEqual(new Set(testers.map((call) => after(call.args, '--resume'))), sessions)
	for (const call of testers) {
		const study = explorers.find((item) => after(item.args, '--session-id') === after(call.args, '--resume'))
		assert(calls.indexOf(study) < calls.indexOf(call), 'study turn first')
		assert.equal(after(call.args, '--model'), testLevels.deep.model)
		assert.equal(after(call.args, '--settings'), explorerSettings(nameOf(call)))
		assert.deepEqual(
			call.args.filter((arg: string, index: number) => call.args[index - 1] === '--allowedTools'),
			['Read', 'Bash']
		)
		assert(!call.args.some((arg: string) => /--tools|disallowed|--session-id|--fork-session/.test(arg)))
		assert.doesNotMatch(call.prompt.replaceAll('.checkmate/work/', ''), /checkmate|journal|recorder|\brecord\b/i)
		const explorer = /\.checkmate\/work\/x-1\/(a\d)\/plan\.md/.exec(study.prompt)![1]
		assert.match(
			call.prompt,
			new RegExp(
				[
					'^Now test the change and the existing behaviour that it can break\\.',
					'The owner of the product has not answered your questions yet\\. Use the sources where they decide the point, and report the rest as unclear\\.',
					`Use the existing records of the application, and make new records when a case needs them\\. Start each name or value that you make with qa-x-1-${explorer}-\\.`,
					`Save the files that show a problem, for example screenshots or responses, in \\.checkmate/work/x-1/${explorer}/\\.`,
					`Write \\.checkmate/work/x-1/${explorer}/report\\.md: one section for each defect with title, severity, steps, expected result, actual result and evidence files\\. Number the defects D1, D2, and so on\\. List also what you tested and what is still unclear\\.`,
					'You have 900 seconds for this turn\\. Write the report early and update it as you go\\.$',
				].join('\\n')
			)
		)
	}
	const recorders = calls.filter((call) => call.role === 'recorder')
	assert.deepEqual(new Set(recorders.map((call) => after(call.args, '--resume'))), sessions)
	for (const call of recorders) {
		assert.equal(after(call.args, '--model'), testLevels.deep.model)
		assert.equal(after(call.args, '--settings'), hidden)
		assert(!call.args.some((arg: string) => /allowedTools|--tools|disallowed/.test(arg)), 'no tool list')
	}
	const status = run(['explore', 'status', 'x-1', '--workspace', workspace], {
		cwd: workspace,
		env: {},
		stdin: () => '',
	})
	assert.match(status.output, /^completed x-1 state=completed plan=checkout build=b1 level=deep explorers=3/)
	assert(!existsSync(join(workspace, '.checkmate', 'tmp', 'explore-x-1.log')), 'log removed')
	assert(!existsSync(join(workspace, '.checkmate', 'work', 'x-1')), 'work folder removed')
	assert(!existsSync(join(workspace, 'qa-evidence')), 'no folder in the project root')
	const shown = command(['explore', 'show', 'x-1']).body
	assert.deepEqual(
		shown.files.map((file: { explorer: string; name: string; text: string }) => [
			file.explorer,
			file.name,
			file.text,
		]),
		['a1', 'a2', 'a3'].flatMap((name) => [
			[name, 'plan.md', `explorer of qa-x-1-${name}\n`],
			[name, 'report.md', `tester of qa-x-1-${name}\n`],
		])
	)
})

test('the level sets the count and the model; --explorers, --claude-arg --model, and the profile override it', (t) => {
	const { start, wait, called, command } = setup(t, { profile: { explore: { level: 'smoke' } } })
	assert.equal(start().body.level, 'smoke')
	wait()
	const smoke = called().filter((call) => call.role === 'explorer')
	assert.equal(smoke.length, testLevels.smoke.explorers)
	assert.equal(after(smoke[0].args, '--model'), testLevels.smoke.model)
	const normal = start(['--level', 'normal'])
	assert.deepEqual(
		[normal.body.explorers, normal.body.model, normal.body.verifier],
		[testLevels.normal.explorers, testLevels.normal.model, true]
	)
	command(['explore', 'wait', 'x-2', '--timeout', '60'])
	assert.equal(called().filter((call) => call.role === 'explorer').length, testLevels.normal.explorers)
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
		[
			['explorer', { permissions: { deny: workDenyRules([]) } }],
			['tester', { permissions: { deny: workDenyRules([]) } }],
		]
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
	assert.deepEqual(levelNames, ['smoke', 'normal', 'deep'])
	assert.deepEqual(
		levelNames.map((name) => [testLevels[name].explorers, testLevels[name].verifier]),
		[
			[1, false],
			[2, true],
			[3, true],
		]
	)
})

test('without --level and a profile level, an exploration uses the level normal', () => {
	const input = { planId: 'checkout', build: 'b1', allow: [], claudeArgs: [], session: true }
	const launch = launchPlan({} as Profile, input, {})
	assert.deepEqual([launch.level, launch.explorers, launch.verifier], ['normal', 2, true])
})

test('the old level name standard in a profile or a stored exploration reads as normal', () => {
	const input = { planId: 'checkout', build: 'b1', allow: [], claudeArgs: [], session: true }
	const old = { explore: { level: 'standard' } } as unknown as Profile
	const launch = launchPlan(old, input, {})
	assert.deepEqual([launch.level, launch.explorers, launch.verifier], ['normal', 2, true])
	const event = { at: '', step: 'start', explorer: null, status: 'started', detail: { ...launch, level: 'standard' } }
	assert.equal(startOf([event])!.level, 'normal')
})

test('a failed launch keeps the last lines of stderr, and status offers the test again', (t) => {
	const { workspace, command } = setup(t, { replies: { explorer: '!crash' } })
	command(['plan', 'open', 'later', '--target', 'checkout-local@1', '--objective', 'Later.', '--source', 't.md'])
	assert.equal(command(['explore', 'start', 'later', '--build', 'b1', '--level', 'smoke', ...allow]).code, 0)
	const failed = command(['explore', 'wait', 'x-1', '--timeout', '60'])
	assert.equal(failed.body.outcome, 'failed')
	assert.equal(failed.body.workFolder, '.checkmate/work/x-1')
	assert(existsSync(join(workspace, '.checkmate', 'work', 'x-1', 'a1', 'plan.md')))
	assert(existsSync(join(workspace, '.checkmate', 'tmp', 'explore-x-1.log')))
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

test('--minutes sets the seconds of the test turn only, and the safety timeout stays well above it', (t) => {
	const { start, wait, called, command } = setup(t)
	const started = start(['--level', 'smoke', '--minutes', '25'])
	assert.deepEqual([started.body.studySeconds, started.body.testSeconds], [300, 1500])
	wait()
	const [explorer] = called().filter((call) => call.role === 'tester')
	assert.match(
		explorer.prompt,
		/\nYou have 1500 seconds for this turn\. Write the report early and update it as you go\.$/
	)
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual([status.studySeconds, status.testSeconds], [300, 1500])
	const events = command(['query', "SELECT detail FROM exploration_events WHERE step = 'start'"]).body.rows
	assert.equal(JSON.parse(events[0].detail).timeoutSeconds, 1500 * 3)
	start(['--level', 'smoke'])
	command(['explore', 'wait', 'x-2', '--timeout', '60'])
	const turns = called().filter((call) => call.role === 'explorer' || call.role === 'tester')
	assert.match(turns[0].prompt, /\nYou have 300 seconds for this turn\./)
	assert.match(turns[1].prompt, /\nYou have 600 seconds for this turn\./)
	assert.deepEqual(
		levelNames.map((name) => [testLevels[name].studySeconds, testLevels[name].testSeconds]),
		[
			[300, 600],
			[600, 900],
			[600, 900],
		]
	)
})

test('a failed study turn ends the explorer, and the test turn does not start', (t) => {
	const { start, wait, called, command } = setup(t, { replies: { explorer: '!fail' } })
	start(['--level', 'smoke'])
	assert.equal(wait().body.explorers[0].ended, 'operational_error')
	assert.deepEqual(
		called().map((call) => call.role),
		['explorer']
	)
	const ended = command(['query', "SELECT detail FROM exploration_events WHERE step = 'end'"]).body.rows
	assert.equal(JSON.parse(ended[0].detail).turn, 'study')
})

test('the brief of a retest asks for one line in the report for each problem of the known state', () => {
	const brief = explorerBrief(
		{
			goal: 'g',
			requirements: [],
			sources: [],
			instructions: null,
			capabilities: [],
			operations: [],
			tools: [],
			scope: [],
			change: null,
			knownState: 'qa-evidence/x-2/known-state.md',
		},
		[],
		'qa-',
		'qa-evidence/x-2/a1',
		{ study: 600, test: 900 }
	)
	assert.match(brief.study, /\nRead qa-evidence\/x-2\/known-state\.md\. It has the results of earlier builds\./)
	assert.match(
		brief.test,
		/\nFor each problem in qa-evidence\/x-2\/known-state\.md, write one line in the report: still present, fixed, or not retested with the reason\.\nYou have 900 seconds/
	)
})

test('a test turn that times out keeps its work: the recorder forks the session', async (t) => {
	const { workspace, command, called, env } = setup(t, { replies: { tester: '!sleep', recorder: [defect] } })
	assert.equal(command(['explore', 'open', 'checkout', '--build', 'b1']).code, 0)
	const full = { ...process.env, ...env }
	const launch = launchPlan(
		{} as Profile,
		{ planId: 'checkout', build: 'b1', level: 'smoke', allow: ['Read'], claudeArgs: [] },
		full
	)
	const opened = openStore(workspace)
	write(opened, { actor, command: 'explore start', subject: 'x-1', input: {} }, (operationId, at) => {
		addEvent(
			opened,
			'x-1',
			{ step: 'start', explorer: null, status: 'started', detail: { ...launch, timeoutSeconds: 1 } },
			operationId,
			at
		)
		return { reply: completed('x-1'), subjects: ['exploration:x-1'] }
	})
	closeStore(opened)
	await driveExploration(workspace, 'x-1', full)
	const status = command(['explore', 'status', 'x-1']).body
	assert.deepEqual(
		[status.state, status.explorers[0].ended, status.explorers[0].recorded, status.explorers[0].saved],
		['completed', 'interrupted', 'completed', 1]
	)
	const calls = called()
	assert.deepEqual(
		calls.map((call) => call.role),
		['explorer', 'tester', 'recorder']
	)
	assert.equal(after(calls[2].args, '--resume'), after(calls[0].args, '--session-id'))
})

test('the recorder stores each evidence file of the work folder as a blob before the folder goes', (t) => {
	const { start, wait, command, workspace } = setup(t, {
		replies: { explorer: 'Tested.', recorder: [{ ...defect, evidence: 'report.md' }] },
	})
	start(['--level', 'smoke'])
	assert.equal(wait().body.outcome, 'done')
	const [entry] = command(['query', "SELECT body FROM journal_entries WHERE kind = 'defect'"]).body.rows
	const [evidence] = JSON.parse(entry.body).evidence
	assert.equal(evidence.path, '.checkmate/work/x-1/a1/report.md')
	const blob = command(['query', `SELECT size FROM blobs WHERE sha256 = '${evidence.sha256}'`]).body.rows
	assert.deepEqual(blob, [{ size: evidence.size }])
	assert(!existsSync(join(workspace, '.checkmate', 'work', 'x-1')))
})

test('on the process path a browser folder that a tester made goes with the work folder, and an older one stays', async (t) => {
	for (const before of [false, true]) {
		const { workspace, command, env } = setup(t)
		assert.equal(command(['explore', 'open', 'checkout', '--build', 'b1']).code, 0)
		const full = { ...process.env, ...env }
		const launch = launchPlan(
			{} as Profile,
			{ planId: 'checkout', build: 'b1', level: 'smoke', allow: ['Read'], claudeArgs: [] },
			full
		)
		const opened = openStore(workspace)
		write(opened, { actor, command: 'explore start', subject: 'x-1', input: {} }, (operationId, at) => {
			addEvent(
				opened,
				'x-1',
				{ step: 'start', explorer: null, status: 'started', detail: { ...launch, browserFolder: before } },
				operationId,
				at
			)
			return { reply: completed('x-1'), subjects: ['exploration:x-1'] }
		})
		closeStore(opened)
		mkdirSync(join(workspace, '.playwright-cli'))
		writeFileSync(join(workspace, '.playwright-cli', 'page.yml'), 'snapshot')
		await driveExploration(workspace, 'x-1', full)
		assert.equal(command(['explore', 'status', 'x-1']).body.state, 'completed')
		assert.equal(existsSync(join(workspace, '.playwright-cli', 'page.yml')), before)
		assert(!existsSync(join(workspace, '.checkmate', 'work', 'x-1')))
	}
})
