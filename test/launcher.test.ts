import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { Stage } from '../cli/src/launcher.ts'
import {
	defaultPluginRoot,
	delegate,
	minimumRules,
	reservedClaudeArgs,
	resumeReason,
	unverifiedReason,
	worker,
} from '../cli/src/launcher.ts'
import { busyReason, closeStore, openStore } from '../plugin/src/store.ts'
import { formatReply } from '../plugin/src/cli.ts'
import { answerGap, openPlan } from '../plugin/src/plans.ts'
import { retireInstance } from '../plugin/src/targets.ts'
import { rejectResult } from '../plugin/src/runs.ts'
import { saveWorkspaceHarness } from '../plugin/src/settings.ts'
import { operationLog } from '../plugin/src/views.ts'
import {
	actor,
	approved,
	begin,
	candidate,
	check,
	defectRun,
	directory,
	passRun,
	plan,
	planRequest,
	ready,
	revised,
	root,
	store,
	target,
} from './support.ts'
import type { TestContext } from 'node:test'

const rules = ['Read', 'Bash']
const pluginRoot = join(root, 'plugin')

function executable(workspace: string, name: string, code: string) {
	const path = join(workspace, name)
	writeFileSync(path, `#!/usr/bin/env node\n${code}\n`)
	chmodSync(path, 0o700)
	return path
}

function claude(workspace: string, body: string) {
	return executable(
		workspace,
		'fake-claude',
		`const { execFileSync } = require('node:child_process')
const plugin = process.argv[process.argv.indexOf('--plugin-dir') + 1]
const checkmate = (args, input = '') => execFileSync(process.execPath, [plugin + '/dist/checkmate.js', ...args], { input, encoding: 'utf8' })
const reply = (output, usage = {}) => console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: output, ...usage }))
${body}`
	)
}

function playwright(workspace: string) {
	return executable(
		workspace,
		'fake-playwright',
		`require('node:fs').appendFileSync('closed.log', process.argv.slice(2).join(' ') + '\\n')`
	)
}

function planned(t: TestContext) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	return workspace
}

function started(t: TestContext, timeoutSeconds = 600) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened)
	begin(opened, 'run-1', ['T1'], 'build-1', { timeoutSeconds })
	check(opened, 'run-1', 'T1.A1', 'passed')
	const session = opened.db.prepare('SELECT browser_session FROM runs').get()!.browser_session as string
	closeStore(opened)
	return { workspace, session }
}

function query<T>(workspace: string, sql: string) {
	const opened = openStore(workspace)
	try {
		return opened.db
			.prepare(sql)
			.all()
			.map((row) => ({ ...row })) as T[]
	} finally {
		closeStore(opened)
	}
}

function attempts(workspace: string, subject: string) {
	const opened = openStore(workspace)
	try {
		return operationLog(opened, { subject }).filter(({ command }) => command.startsWith('delegate '))
	} finally {
		closeStore(opened)
	}
}

test('the worker refuses prose, a failed envelope, and missing structured output', async (t) => {
	const workspace = directory(t)
	for (const [output, reason] of [
		['"not json"', /JSON envelope/],
		[JSON.stringify(JSON.stringify({ type: 'result', subtype: 'success' })), /structured output/],
		[
			JSON.stringify(
				JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key' })
			),
			/did not complete the stage: Invalid API key/,
		],
	] as const) {
		const path = executable(workspace, 'prose', `console.log(${output})`)
		await assert.rejects(worker(path, [], { cwd: workspace, prompt: 'x', timeoutSeconds: 5 }), reason)
	}
	const exits = executable(workspace, 'exits', `console.error('Not logged in.'); process.exit(1)`)
	await assert.rejects(
		worker(exits, [], { cwd: workspace, prompt: 'x', timeoutSeconds: 5 }),
		/Worker exited with code 1: Not logged in\./
	)
})

test('delegate refuses an empty allow list and an unknown subject before it starts Claude', async (t) => {
	const workspace = planned(t)
	const missing = '/does-not-exist'
	await assert.rejects(
		delegate(workspace, 'execute', 'run-1', { allowedTools: [], claude: missing }),
		new RegExp(`Minimum: ${minimumRules.join(', ')}$`)
	)
	await assert.rejects(
		delegate(workspace, 'setup', 'other', { allowedTools: rules, pluginRoot, claude: missing }),
		/Unknown target request/
	)
	await assert.rejects(
		delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: missing }),
		/revision 1/
	)
	await assert.rejects(
		delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: missing }),
		/no pending decision/
	)
	await assert.rejects(
		delegate(workspace, 'execute', 'run-1', { allowedTools: rules, pluginRoot, claude: missing }),
		/run begin/
	)
	assert.deepEqual(attempts(workspace, 'plan:checkout'), [])
})

test('the parent checks the database, not the worker claim', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const liar = claude(workspace, `reply({ status: 'completed', subject: 'checkout', reasons: [] })`)
	const lied = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: liar })
	assert.equal(lied.status, 'operational_error')
	assert.match(lied.reasons[0], /Worker returned completed, but no plan save for checkout was recorded/)
	const wrong = claude(workspace, `reply({ status: 'completed', subject: 'other', reasons: [] })`)
	const misnamed = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: wrong })
	assert.equal(misnamed.status, 'operational_error')
	assert.match(misnamed.reasons[0], /names other, not checkout/)
	const denied = claude(
		workspace,
		`reply({ status: 'needs_decision', subject: 'checkout', reasons: ['No Bash permission.'] })`
	)
	assert.deepEqual(
		await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: denied }),
		{
			status: 'needs_decision',
			subject: 'checkout',
			reasons: ['No Bash permission.'],
			operation: null,
		}
	)
	const honest = claude(
		workspace,
		`const out = checkmate(['plan', 'save', 'checkout', '--json'], ${JSON.stringify(JSON.stringify(candidate()))})
const { status, subject, reasons } = JSON.parse(out)
reply({ status, subject, reasons })`
	)
	const saved = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: honest })
	assert.equal(saved.status, 'needs_decision')
	assert.equal(saved.subject, 'checkout@1')
	assert.deepEqual(saved.reasons, [
		'G1: Does the promotion stack with loyalty?',
		'G2: Which orders qualify for refunds?',
	])
	const [operation] = query<{ id: string; actor: string }>(
		workspace,
		"SELECT id, actor FROM operations WHERE command = 'plan save' AND status != 'rejected'"
	)
	assert.deepEqual(operation, { id: saved.operation, actor: 'claude:plan' })
})

test('the delegated prompt names the plugin CLI and the commands of the stage, and tells the worker not to ask or wait for the oracle', async (t) => {
	const workspace = requested(t)
	const prompt = async (stage: Stage, subject: string) => {
		const records = claude(
			workspace,
			`require('node:fs').writeFileSync('prompt.txt', require('node:fs').readFileSync(0, 'utf8'))
reply({ status: 'needs_decision', subject: '${subject}', reasons: ['Stopped.'] })`
		)
		await delegate(workspace, stage, subject, { allowedTools: rules, pluginRoot, claude: records })
		return readFileSync(join(workspace, 'prompt.txt'), 'utf8')
	}
	const plan = await prompt('plan', 'checkout')
	assert.match(plan, /Do not ask the oracle\. Do not wait for the oracle\./)
	assert.match(plan, /Write an open blocking gap for each vague term that changes an expected value/)
	assert.match(plan, /Plan regression tests only for existing rules that the sources state/)
	assert.match(plan, /Deadline: 300 seconds from now \(\S+Z UTC\)\. Check the time with `date -u`\./)
	assert.match(plan, /stop and return needs_decision/)
	assert(plan.includes(`read ${join(pluginRoot, 'skills', 'plan', 'SKILL.md')} and`), plan)
	assert.doesNotMatch(plan, /person/)
	assert(
		plan.includes(`\`checkmate <command>\` means \`node '${join(pluginRoot, 'dist', 'checkmate.js')}' <command>\`.`)
	)
	assert.match(await prompt('setup', 'checkout-local'), /checkmate target instance list checkout-local/)
	assert.deepEqual(attempts(workspace, 'target:checkout-local')[0].response, {
		status: 'needs_decision',
		subject: 'checkout-local',
		reasons: [],
		data: { operation: null },
	})
})

function requested(t: TestContext) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	return workspace
}

const recordsArgs = `require('node:fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))
reply({ status: 'needs_decision', subject: 'checkout', reasons: ['Stopped.'] })`

test('delegate puts each --claude-arg right after -p, so a dangling flag cannot take a tool rule', async (t) => {
	const workspace = requested(t)
	const records = claude(workspace, recordsArgs)
	const read = () => JSON.parse(readFileSync(join(workspace, 'args.json'), 'utf8')) as string[]
	const claudeArgs = ['--model', 'claude-haiku-5-5', '--add-dir=/srv/specs', 'Write']
	await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, claudeArgs, pluginRoot, claude: records })
	const args = read()
	assert.deepEqual(args.slice(0, 6), ['-p', ...claudeArgs, '--plugin-dir'])
	assert.deepEqual(args.slice(-4), ['--allowedTools', 'Read', '--allowedTools', 'Bash'])
	await delegate(workspace, 'plan', 'checkout', {
		allowedTools: rules,
		claudeArgs: ['--model'],
		pluginRoot,
		claude: records,
	})
	const dangling = read()
	assert.deepEqual(dangling.slice(0, 3), ['-p', '--model', '--plugin-dir'])
	assert.deepEqual(dangling.slice(-4), ['--allowedTools', 'Read', '--allowedTools', 'Bash'])
})

test('delegate refuses a --claude-arg that changes the worker contract', async (t) => {
	const workspace = requested(t)
	const missing = '/does-not-exist'
	for (const arg of [...reservedClaudeArgs, '--output-format=text', '--json-schema={}'])
		await assert.rejects(
			delegate(workspace, 'plan', 'checkout', {
				allowedTools: rules,
				claudeArgs: [arg],
				pluginRoot,
				claude: missing,
			}),
			(error: Error) => error.message.startsWith(`--claude-arg ${arg} is not permitted.`)
		)
	await assert.rejects(
		delegate(workspace, 'plan', 'checkout', {
			allowedTools: rules,
			claudeArgs: ['--allowedTools', 'Write'],
			pluginRoot,
			claude: missing,
		}),
		/Use --allow <rule> for tools\./
	)
})

test('the npm CLI always takes the next token as the --claude-arg value, also one that starts with --, and refuses a missing one', (t) => {
	const workspace = requested(t)
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	claude(bin, recordsArgs)
	renameSync(join(bin, 'fake-claude'), join(bin, 'claude'))
	const run = (...flags: string[]) => {
		try {
			return execFileSync(
				process.execPath,
				[
					join(root, 'cli/src/main.ts'),
					'delegate',
					'plan',
					'checkout',
					'--allow',
					'Read',
					'--allow',
					'Bash',
					...flags,
				],
				{ cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' }
			)
		} catch (error) {
			return (error as { stdout: string }).stdout
		}
	}
	const args = () => JSON.parse(readFileSync(join(workspace, 'args.json'), 'utf8')) as string[]
	assert.equal(
		run('--claude-arg', '--model', '--claude-arg', 'claude-haiku-5-5', '--workspace', workspace),
		'needs_decision checkout\nreason: Stopped.\n'
	)
	assert.deepEqual(args().slice(1, 3), ['--model', 'claude-haiku-5-5'])
	assert.equal(run('--claude-arg', '--json', '--claude-arg', '--help'), 'needs_decision checkout\nreason: Stopped.\n')
	assert.deepEqual(args().slice(0, 4), ['-p', '--json', '--help', '--plugin-dir'])
	assert.match(run('--claude-arg', '--model', '--help'), /^completed delegate\ncheckmate delegate <setup\|plan/)
	const malformed = (reason: string) =>
		`invalid_request delegate refusal=malformed\nreason: Refused: malformed request.\nreason: ${reason}\nhint: Usage: checkmate delegate <setup|plan|revise|execute> `
	assert(run('--claude-arg').startsWith(malformed('Missing value for --claude-arg')))
	assert.equal(run('--claude-arg', '--model'), 'needs_decision checkout\nreason: Stopped.\n')
	assert.deepEqual(args().slice(0, 3), ['-p', '--model', '--plugin-dir'])
	assert.deepEqual(args().slice(-4), ['--allowedTools', 'Read', '--allowedTools', 'Bash'])
	for (const timeout of ['0', 'abc', '3601'])
		assert(
			run('--timeout', timeout).startsWith(
				malformed(`Invalid --timeout: ${timeout}. Use a whole number from 1 to 3600.`)
			)
		)
})

test('the npm CLI prints the facts of the recorded command with the operation', (t) => {
	const workspace = requested(t)
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	claude(
		bin,
		`const out = checkmate(['plan', 'save', 'checkout', '--json'], ${JSON.stringify(JSON.stringify(candidate()))})
const { status, subject, reasons } = JSON.parse(out)
reply({ status, subject, reasons }, { total_cost_usd: 0, modelUsage: { 'actual-claude': { provider: 'fixture' } } })`
	)
	renameSync(join(bin, 'fake-claude'), join(bin, 'claude'))
	const output = execFileSync(
		process.execPath,
		[join(root, 'cli/src/main.ts'), 'delegate', 'plan', 'checkout', '--allow', 'Read', '--allow', 'Bash'],
		{ cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' }
	)
	const lines = output.trim().split('\n')
	const { operations } = JSON.parse(
		execFileSync(process.execPath, [join(root, 'cli/src/main.ts'), 'log', '--subject', 'plan:checkout', '--json'], {
			cwd: workspace,
			encoding: 'utf8',
		})
	) as { operations: ReturnType<typeof operationLog> }
	const operation = operations.find(({ command }) => command === 'plan save')!
	const attempt = operations.find(({ command }) => command === 'delegate plan')!
	const sha256 = (operation.response as { data: { sha256: string } }).data.sha256
	assert.deepEqual(attempt.response, {
		status: 'needs_decision',
		subject: 'checkout@1',
		reasons: [],
		data: { operation: operation.id, observedModels: ['fixture/actual-claude'], costUsd: 0 },
	})
	assert.deepEqual(lines, [
		`needs_decision checkout@1 sha256=${sha256.slice(0, 8)} operation=${operation.id} model=fixture/actual-claude costUsd=0`,
		'reason: G1: Does the promotion stack with loyalty?',
		'reason: G2: Which orders qualify for refunds?',
	])
})

test('the npm CLI delegates through Pi and verifies a stage after more than 4 MiB of output', (t) => {
	const workspace = requested(t)
	const opened = store(t, workspace)
	saveWorkspaceHarness(opened, actor, 'pi')
	closeStore(opened)
	const bundledPlugin = defaultPluginRoot()
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	claude(bin, recordsArgs)
	renameSync(join(bin, 'fake-claude'), join(bin, 'claude'))
	executable(
		bin,
		'pi',
		`const { readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
if (process.argv.includes('rpc')) {
	const scope = process.argv[process.argv.indexOf('--models') + 1]
	if (scope !== 'fixture-provider/**') throw new Error('Expected the requested provider scope')
	const request = JSON.parse(readFileSync(0, 'utf8'))
	const response = { type: 'response', id: request.id, success: true, data: { model: { provider: 'fixture-provider', id: 'native-default' } } }
	writeFileSync(1, JSON.stringify(response) + '\\n')
	process.exit(0)
}
const providerOnly = process.env.FAKE_PI_OUTPUT === 'provider-only'
const response = (status, subject, reasons) => JSON.stringify({ status, subject, reasons })
const event = (text, stopReason = 'stop') => console.log(JSON.stringify({
	type: 'agent_end',
	messages: [{ role: 'assistant', provider: providerOnly ? 'fixture-provider' : 'actual-provider', model: providerOnly ? 'native-default' : 'actual-model', usage: { cost: { total: 0.25 } }, stopReason, content: [{ type: 'text', text }] }],
}))
const fence = ${JSON.stringify('```')}
const decision = response('needs_decision', 'checkout', ['No target instance.'])
const fenced = fence + 'json\\n' + decision + '\\n' + fence
writeFileSync('pi-args.json', JSON.stringify(process.argv.slice(2)))
writeFileSync('pi-prompt.txt', readFileSync(0, 'utf8'))
if (process.env.FAKE_PI_OUTPUT === 'invalid') {
	event(response('completed', 'checkout', [5]))
} else if (process.env.FAKE_PI_OUTPUT === 'unrecorded') {
	event(response('completed', 'checkout', []))
} else if (process.env.FAKE_PI_OUTPUT === 'fenced' || providerOnly) {
	event('  \\n' + fenced + '\\n  ')
} else if (process.env.FAKE_PI_OUTPUT === 'trailing') {
	event(fenced + '\\nThe stage needs a decision.')
} else if (process.env.FAKE_PI_OUTPUT === 'multiple') {
	event(fenced + '\\n' + fenced)
} else if (process.env.FAKE_PI_OUTPUT === 'incomplete') {
	event(decision, 'toolUse')
} else {
	const update = {
		type: 'tool_execution_update',
		partialResult: { content: [{ type: 'text', text: 'x'.repeat(5 * 1024 * 1024) }] },
	}
	process.stdout.write(JSON.stringify(update) + '\\n', () => {
		const recorded = execFileSync(process.execPath, [${JSON.stringify(join(bundledPlugin, 'dist/checkmate.js'))}, 'plan', 'save', 'checkout', '--json'], {
			input: ${JSON.stringify(JSON.stringify(candidate()))},
			encoding: 'utf8',
		})
		const { status, subject, reasons } = JSON.parse(recorded)
		event(response(status, subject, reasons))
	})
}`
	)
	const run = (output: string, ...flags: string[]) => {
		const args = [join(root, 'cli/src/main.ts'), 'delegate', 'plan', 'checkout', '--json', ...flags]
		const env = {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			CHECKMATE_HARNESS: output === 'claude' ? 'claude' : undefined,
			CHECKMATE_PI_MODEL: output === 'provider-only' ? undefined : 'fixture-model',
			CHECKMATE_PI_PROVIDER: 'fixture-provider',
			FAKE_PI_OUTPUT: output,
		}
		try {
			return JSON.parse(execFileSync(process.execPath, args, { cwd: workspace, env, encoding: 'utf8' }))
		} catch (error) {
			return JSON.parse((error as { stdout: string }).stdout)
		}
	}
	for (const flags of [
		['--allow', 'Read'],
		['--claude-arg', '--model'],
	])
		assert.match(run('', ...flags).reasons.join(' '), /Pi delegate does not accept/)
	assert.deepEqual(run('claude', '--allow', 'Read').reasons, ['Stopped.'])
	assert.equal(existsSync(join(workspace, 'pi-args.json')), false)
	const invalid = run('invalid')
	assert.equal(invalid.status, 'operational_error')
	assert.match(invalid.reasons[0], /reasons\/0/)
	const unrecorded = run('unrecorded')
	assert.equal(unrecorded.status, 'operational_error')
	assert.match(unrecorded.reasons[0], /no plan save for checkout was recorded/)
	assert.deepEqual(run('fenced'), {
		status: 'needs_decision',
		subject: 'checkout',
		reasons: ['No target instance.'],
		operation: null,
		observedModels: ['actual-provider/actual-model'],
		costUsd: 0.25,
	})
	assert.deepEqual(run('provider-only').observedModels, ['fixture-provider/native-default'])
	assert.deepEqual(JSON.parse(readFileSync(join(workspace, 'pi-args.json'), 'utf8')).slice(3, 7), [
		'--provider',
		'fixture-provider',
		'--model',
		'native-default',
	])
	for (const output of ['trailing', 'multiple']) {
		const result = run(output)
		assert.equal(result.status, 'operational_error')
		assert.match(result.reasons[0], /Pi did not return a JSON response/)
	}
	assert.equal(run('incomplete').status, 'operational_error')
	const saved = run('recorded')
	assert.equal(saved.subject, 'checkout@1')
	assert.equal(saved.status, 'needs_decision')
	assert.deepEqual(saved.observedModels, ['actual-provider/actual-model'])
	assert.equal(saved.costUsd, 0.25)
	const [operation] = query<{ id: string; actor: string }>(
		workspace,
		"SELECT id, actor FROM operations WHERE command = 'plan save' AND status != 'rejected'"
	)
	assert.deepEqual(operation, { id: saved.operation, actor: 'pi:plan' })
	assert.deepEqual(JSON.parse(readFileSync(join(workspace, 'pi-args.json'), 'utf8')), [
		'-p',
		'--mode',
		'json',
		'--model',
		'fixture-model',
		'--provider',
		'fixture-provider',
		'--no-session',
		'--no-mcp',
		'--no-skills',
		'--tools',
		'read,bash',
	])
	const prompt = readFileSync(join(workspace, 'pi-prompt.txt'), 'utf8')
	assert.match(prompt, /checkmate plan save <planId> --actor pi:plan/)
	assert.match(prompt, /Write an open blocking gap/)
	assert(prompt.includes(join(bundledPlugin, 'references', 'workflow.md')))
	assert.doesNotMatch(prompt, /CLAUDE_PLUGIN_ROOT|--actor claude:/)
})

test('a Pi worker can run the CLI commands in its prompt from paths with shell characters', async (t) => {
	const workspace = join(directory(t), 'factory workspace')
	mkdirSync(workspace)
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	saveWorkspaceHarness(opened, actor, 'pi')
	closeStore(opened)
	const installedPlugin = join(workspace, `factory's "plugin" $CHECKMATE_ACTOR`)
	symlinkSync(pluginRoot, installedPlugin)
	const pi = executable(
		workspace,
		'fake-pi',
		`const { readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const prompt = readFileSync(0, 'utf8')
const commands = prompt.split('\\n').filter((line) =>
	line.startsWith('The plugin CLI is') || line.startsWith('\`checkmate <command>\` means')
)
if (commands.length !== 2) throw new Error('Expected two CLI references')
for (const line of commands) {
	const command = line.split('\`').find((code) => code.startsWith('node ') && code.endsWith(' <command>'))
	const output = execFileSync('/bin/sh', ['-c', command.replace('<command>', 'target show checkout-local --json')], {
		encoding: 'utf8',
	})
	if (JSON.parse(output).subject !== 'checkout-local@1') throw new Error(output)
}
const text = JSON.stringify({ status: 'needs_decision', subject: 'checkout', reasons: ['Stopped.'] })
console.log(JSON.stringify({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] }] }))`
	)
	const result = await delegate(workspace, 'plan', 'checkout', { allowedTools: [], pluginRoot: installedPlugin, pi })
	assert.deepEqual(result.reasons, ['Stopped.'])
	assert.equal(result.status, 'needs_decision')
})

test('Pi recovers a malformed reply only from the delegated stage write', async (t) => {
	const invalid = 'Pi did not return a JSON response'
	const cases = [
		{ name: 'prose after the requested write', planId: 'checkout' },
		{
			name: 'invalid schema after the requested write',
			planId: 'checkout',
			content: JSON.stringify({ status: 'completed', subject: 'checkout', reasons: [5] }),
		},
		{ name: 'no write', reason: invalid },
		{ name: 'another actor', planId: 'checkout', writer: 'oracle', reason: invalid },
		{ name: 'another subject', planId: 'other', reason: invalid },
		{
			name: 'a wrong reply subject',
			planId: 'checkout',
			content: JSON.stringify({ status: 'completed', subject: 'other', reasons: [] }),
			reason: 'Worker response names other, not checkout',
		},
		{
			name: 'a wrong reply subject with an invalid schema',
			planId: 'checkout',
			content: JSON.stringify({ status: 'completed', subject: 'other', reasons: [5] }),
			reason: 'Worker response names other, not checkout',
		},
		{
			name: 'a process exit',
			planId: 'checkout',
			end: 'process.exitCode = 1',
			reason: 'pi exited with code 1',
			partial: true,
		},
		{
			name: 'a deadline',
			planId: 'checkout',
			end: 'setInterval(() => {}, 1000)',
			reason: 'Worker deadline exceeded',
			interrupted: true,
			partial: true,
		},
		{
			name: 'output beyond the cap',
			end: `const { once } = require('node:events')
async function send() {
	const chunk = JSON.stringify({ type: 'tool_execution_update', result: 'x'.repeat(1024 * 1024) }) + '\\n'
	for (let index = 0; index < 101; index++) {
		if (!process.stdout.write(chunk)) await once(process.stdout, 'drain')
	}
}
send()`,
			reason: 'Worker output exceeds 100 MiB',
			partial: true,
		},
	]
	for (const { name, planId, writer, content, end, reason, interrupted, partial } of cases)
		await t.test(name, async (scenario) => {
			const workspace = requested(scenario)
			const opened = store(scenario, workspace)
			saveWorkspaceHarness(opened, actor, 'pi')
			if (planId === 'other')
				openPlan(opened, actor, { planId, target: 'checkout-local@1', request: planRequest() })
			closeStore(opened)
			const saveArgs = [join(pluginRoot, 'dist/checkmate.js'), 'plan', 'save', planId, '--json']
			if (writer) saveArgs.push('--actor', writer)
			const save = planId
				? `const { execFileSync } = require('node:child_process')
execFileSync(process.execPath, ${JSON.stringify(saveArgs)}, { input: ${JSON.stringify(JSON.stringify(candidate()))} })`
				: ''
			const pi = executable(
				workspace,
				'fake-pi',
				`${save}
console.log(JSON.stringify({
	type: 'agent_end',
	messages: [{ role: 'assistant', provider: 'actual-provider', model: 'actual-model', usage: { cost: { total: 0 } }, stopReason: 'stop', content: [{ type: 'text', text: ${JSON.stringify(content ?? 'The plan is saved.')} }] }],
}))
${end ?? ''}`
			)
			const result = await delegate(workspace, 'plan', 'checkout', {
				allowedTools: [],
				pluginRoot,
				pi,
				timeoutSeconds: interrupted ? 2 : 20,
			})
			const usage = {
				observedModels: ['actual-provider/actual-model'],
				costUsd: 0,
				...(partial ? { costPartial: true } : {}),
			}
			const writes = query<{ id: string; actor: string; status: string }>(
				workspace,
				"SELECT id, actor, status FROM operations WHERE command = 'plan save'"
			)
			assert.equal(writes.length, planId ? 1 : 0)
			if (reason) {
				assert.deepEqual(result, {
					status: interrupted ? 'interrupted' : 'operational_error',
					subject: 'checkout',
					reasons: [reason],
					operation: null,
					...usage,
				})
			} else {
				assert.equal(result.status, 'needs_decision')
				assert.equal(result.subject, 'checkout@1')
				assert.deepEqual(writes[0], { id: result.operation, actor: 'pi:plan', status: result.status })
				assert.deepEqual(result.observedModels, usage.observedModels)
				assert.equal(result.costUsd, usage.costUsd)
			}
			const [attempt] = attempts(workspace, 'plan:checkout')
			assert.equal(attempt.actor, 'checkmate:delegate')
			assert.equal(attempt.command, 'delegate plan')
			assert.equal(attempt.status, result.status)
			assert.deepEqual(attempt.arguments, { harness: 'pi', subject: 'checkout' })
			assert.deepEqual(attempt.response, {
				status: result.status,
				subject: result.subject,
				reasons: [],
				data: { operation: result.operation, ...usage },
			})
		})
})

function hold(workspace: string) {
	const holder = openStore(workspace)
	holder.db.exec('BEGIN IMMEDIATE')
	return () => {
		holder.db.exec('ROLLBACK')
		closeStore(holder)
	}
}

test('a lock gives operational_error: retry before the worker, read the record after it', async (t) => {
	process.env.CHECKMATE_BUSY_TIMEOUT_MS = '1000'
	t.after(() => delete process.env.CHECKMATE_BUSY_TIMEOUT_MS)
	const early = requested(t)
	const bin = join(early, 'bin')
	mkdirSync(bin)
	claude(bin, recordsArgs)
	renameSync(join(bin, 'fake-claude'), join(bin, 'claude'))
	const releaseEarly = hold(early)
	const refused = new Promise<string>((resolve) =>
		execFile(
			process.execPath,
			[join(root, 'cli/src/main.ts'), 'delegate', 'plan', 'checkout', '--allow', 'Read', '--allow', 'Bash'],
			{ cwd: early, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' },
			(_, stdout) => resolve(stdout)
		)
	)
	const { workspace, session } = started(t)
	const quits = claude(
		workspace,
		`reply({ status: 'completed', subject: 'run-1', reasons: [] }, { total_cost_usd: 0 })`
	)
	const pending = delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: quits,
		playwright: '/missing-playwright',
	})
	const releaseLate = hold(workspace)
	const late = await pending
	releaseLate()
	assert.deepEqual(late, {
		status: 'operational_error',
		subject: 'run-1',
		reasons: [
			'database is locked',
			unverifiedReason,
			`Browser session ${session} was not closed: the command is unavailable.`,
			resumeReason('run-1'),
		],
		operation: null,
		costUsd: 0,
		usageWarning: 'Checkmate could not record the delegated worker attempt.',
	})
	assert.deepEqual(attempts(workspace, 'run:run-1'), [])
	assert.equal(await refused, `operational_error checkout\nreason: database is locked\nreason: ${busyReason}\n`)
	releaseEarly()
	assert.equal(existsSync(join(early, 'args.json')), false)
})

test('a refused attempt record preserves the verified response and its usage', async (t) => {
	const workspace = requested(t)
	const opened = openStore(workspace)
	opened.db.exec(`CREATE TRIGGER reject_delegate_attempt BEFORE INSERT ON operations
		WHEN new.command = 'delegate plan' BEGIN SELECT RAISE(ABORT, 'Cannot record the attempt'); END`)
	closeStore(opened)
	const saves = claude(
		workspace,
		`const out = checkmate(['plan', 'save', 'checkout', '--json'], ${JSON.stringify(JSON.stringify(candidate()))})
const { status, subject, reasons } = JSON.parse(out)
reply({ status, subject, reasons }, { total_cost_usd: 0.5 })`
	)
	const receipt = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: saves })
	assert.equal(receipt.status, 'needs_decision')
	assert.ok(receipt.operation)
	assert.equal(receipt.costUsd, 0.5)
	assert.match(receipt.usageWarning ?? '', /could not record the delegated worker attempt/)
	assert.deepEqual(attempts(workspace, 'plan:checkout'), [])
})

test('delegate revise needs every pending decision applied', async (t) => {
	const workspace = planned(t)
	const opened = store(t, workspace)
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G2',
		kind: 'defer',
		value: 'Out of scope.',
		source: null,
		rationale: 'Later.',
	})
	closeStore(opened)
	const revises = claude(
		workspace,
		`const { status, subject, reasons } = JSON.parse(checkmate(['plan', 'revise', 'checkout', '--json'], '{"tests":{}}'))
reply({ status, subject, reasons })`
	)
	const revised = await delegate(workspace, 'revise', 'checkout', {
		allowedTools: rules,
		pluginRoot,
		claude: revises,
	})
	assert.equal(revised.status, 'needs_decision', revised.reasons.join('; '))
	assert.equal(revised.subject, 'checkout@2')
})

test('the run deadline kills the worker group, keeps the run started, and closes the browser once', async (t) => {
	const { workspace, session } = started(t, 1)
	const hangs = executable(
		workspace,
		'fake-claude',
		`const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
require('node:fs').writeFileSync('child.pid', String(child.pid))
setInterval(() => {}, 1000)`
	)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: hangs,
		playwright: playwright(workspace),
	})
	assert.equal(result.status, 'interrupted')
	assert.deepEqual(result.reasons, ['Worker deadline exceeded', resumeReason('run-1')])
	assert.match(result.reasons[1], /checkmate run resume run-1/)
	assert.deepEqual(attempts(workspace, 'run:run-1')[0].arguments, { subject: 'run-1', harness: 'claude', attempt: 1 })
	assert.deepEqual(query(workspace, 'SELECT run_id FROM results'), [])
	assert.deepEqual(
		query(workspace, "SELECT test_id, assertion_id, result FROM assertion_results WHERE run_id = 'run-1'"),
		[{ test_id: 'T1', assertion_id: 'A1', result: 'passed' }]
	)
	assert.deepEqual(readFileSync(join(workspace, 'closed.log'), 'utf8').trim().split('\n'), [`-s=${session} close`])
	const pid = Number(readFileSync(join(workspace, 'child.pid'), 'utf8'))
	try {
		process.kill(pid, 0)
		assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8'), /\) Z /)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== 'ESRCH' && code !== 'ENOENT') throw error
	}
})

test('an execute worker that exits without finishing leaves the run started', async (t) => {
	const { workspace, session } = started(t)
	const quits = claude(workspace, `reply({ status: 'completed', subject: 'run-1', reasons: [] })`)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: quits,
		playwright: '/missing-playwright',
	})
	assert.equal(result.status, 'operational_error')
	assert.deepEqual(result.reasons, [
		'Worker returned completed, but run run-1 is not finished',
		`Browser session ${session} was not closed: the command is unavailable.`,
		resumeReason('run-1'),
	])
})

test('an execute worker that finishes the run through the plugin CLI completes the stage', async (t) => {
	const { workspace, session } = started(t)
	const finishes = claude(
		workspace,
		`const fs = require('node:fs')
fs.writeFileSync('output-dir.txt', process.env.PLAYWRIGHT_MCP_OUTPUT_DIR)
fs.writeFileSync('.checkmate/tmp/run-1/a2.txt', 'one item')
checkmate(['run', 'check', 'run-1', 'T1', 'A2', '--result', 'passed', '--observed', 'One item.', '--evidence', '.checkmate/tmp/run-1/a2.txt'])
checkmate(['run', 'close', 'run-1', 'T1'])
const { status, subject, reasons } = JSON.parse(checkmate(['run', 'finish', 'run-1', '--completion', 'completed', '--cleanup', 'completed', '--cleanup-reason', 'Closed the browser.', '--json']))
reply({ status, subject, reasons })`
	)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: finishes,
		playwright: playwright(workspace),
	})
	assert.deepEqual(
		{ ...result, operation: undefined, data: undefined },
		{
			status: 'completed',
			subject: 'run-1',
			reasons: [],
			operation: undefined,
			command: 'run finish',
			data: undefined,
		}
	)
	assert.equal(typeof result.data!.coverage, 'string')
	assert.deepEqual(
		attempts(workspace, 'plan:checkout').map(({ command }) => command),
		['delegate execute']
	)
	assert.match(String(result.data!.sha256), /^[a-f0-9]{64}$/)
	const printed = formatReply('run finish', { ...result, data: result.data! }, false).split('\n')
	assert.match(printed[0], /^completed run-1 coverage=\S+ sha256=[a-f0-9]{8}$/)
	assert.deepEqual(printed.slice(1), ['passed\t1'])
	assert.deepEqual(
		query<{ actor: string }>(workspace, "SELECT actor FROM operations WHERE command = 'run finish'").map(
			(row) => row.actor
		),
		['claude:execute']
	)
	assert.equal(readFileSync(join(workspace, 'closed.log'), 'utf8'), `-s=${session} close\n`)
	assert.equal(readFileSync(join(workspace, 'output-dir.txt'), 'utf8'), join(workspace, '.checkmate', 'tmp', 'run-1'))
})

test('the execute prompt names the instance; the browser closes only for a target with playwright-cli', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened, {
		tools: [{ name: 'node', kind: 'cli', purpose: 'Send HTTP requests.', version: '24.12.0', reachable: true }],
		reset: { owner: 'checkmate', command: ['npm run db:reset'] },
	})
	begin(opened, 'run-1', ['T1'], 'build-1')
	const retired = retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	assert.deepEqual([retired.status, retired.data.startedRuns], ['completed', ['run-1']])
	closeStore(opened)
	const quits = claude(
		workspace,
		`require('node:fs').writeFileSync('prompt.txt', require('node:fs').readFileSync(0, 'utf8'))
reply({ status: 'completed', subject: 'run-1', reasons: [] })`
	)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: quits,
		playwright: playwright(workspace),
	})
	assert.deepEqual(result.reasons, [
		'Worker returned completed, but run run-1 is not finished',
		resumeReason('run-1'),
	])
	assert.equal(existsSync(join(workspace, 'closed.log')), false)
	const prompt = readFileSync(join(workspace, 'prompt.txt'), 'utf8')
	assert(
		prompt.includes(
			'Instance: local. Read its entry values with `checkmate target show checkout-local --instance local`.'
		),
		prompt
	)
	assert.match(prompt, /Run a command entry at test time\./)
	assert(
		prompt.includes(
			'Reset: `npm run db:reset`. The profile authorizes it. Run it exactly as recorded, only between tests,'
		),
		prompt
	)
	assert.match(prompt, /adapt the test data within the intent of the test before you record a blocking gap/)
	assert.match(prompt, /Run deadline: \d{4}-\d\d-\d\dT\S+Z \(UTC\)\. \d+ of 600 seconds remain now\./)
	assert.match(prompt, /read `remaining=` on its `time` line/)
	assert.doesNotMatch(prompt, /seconds from now/)
	assert.match(prompt, /Do not return before `run finish`\./)
	assert.doesNotMatch(prompt, /stop and return needs_decision/)
	assert(
		prompt.includes('Instance local is retired. If its entries do not respond, close each test as error'),
		prompt
	)
})

test('a delegated retest consumes the ticket, instance, owner policy, and rejected-result context', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened, { reset: { owner: 'factory', command: null } })
	const source = 'Checkout fixture guide.md'
	writeFileSync(join(workspace, source), 'The promotion quote is 240 PLN.')
	const tests = candidate()
	tests.tests[0].metadata = { type: 'regression' }
	tests.tests[1].dependsOn = []
	plan(opened, 'checkout', tests, {
		...planRequest(),
		context: { sources: [source, 'jira:SHOP-12'], instructions: 'Read the fixture guide for the quote.' },
		tools: ['node', { name: 'fixture-cli', kind: 'cli', purpose: 'Set up checkout data.' }],
	})
	revised(opened)
	approved(opened)
	passRun(opened, 'run-old', 'b0', ['T1'])
	rejectResult(opened, 'Dawid', { runId: 'run-old', rationale: 'Wrong account.' })
	defectRun(opened, 'run-1', 'b1')
	passRun(opened, 'run-2', 'b1', ['T1'])
	rejectResult(opened, 'Dawid', { runId: 'run-2', rationale: 'Use fullsize screenshots.' })
	begin(opened, 'run-3', ['T1', 'T2'], 'b2', { retestOf: 'run-1' })
	closeStore(opened)
	const worker = claude(
		workspace,
		`const fs = require('node:fs')
const prompt = fs.readFileSync(0, 'utf8')
const source = /Plan request sources: "([^"]+)"/.exec(prompt)?.[1]
const instance = /checkmate target show ([^ ]+) --instance ([^\x60 ]+)/.exec(prompt)
const priority = /Run the tests of the open defects first: (T[0-9]+)/.exec(prompt)?.[1]
if (!source || !instance || !priority || !prompt.includes('Read the fixture guide for the quote.') || !prompt.includes('fixture-cli (cli)') || !prompt.includes('read_catalog') || !prompt.includes('factory owns it') || !prompt.includes('Use fullsize screenshots') || prompt.includes('Wrong account')) throw Error('Missing execution context')
const target = JSON.parse(checkmate(['target', 'show', instance[1], '--instance', instance[2], '--json']))
if (target.instance.entries.web !== 'http://127.0.0.1:4173') throw Error('Wrong instance')
const evidence = fs.readFileSync(source, 'utf8')
if (!evidence.includes('240 PLN')) throw Error('Wrong ticket source')
for (const test of [priority, ...['T1', 'T2'].filter(id => id !== priority)]) {
 for (const assertion of ['A1', 'A2']) checkmate(['run', 'check', 'run-3', test, assertion, '--result', 'passed', '--observed', 'Verified with fullsize screenshots.', '--evidence', '-'], evidence)
 checkmate(['run', 'close', 'run-3', test])
}
const { status, subject, reasons } = JSON.parse(checkmate(['run', 'finish', 'run-3', '--completion', 'completed', '--cleanup', 'completed', '--cleanup-reason', 'Closed.', '--json']))
reply({ status, subject, reasons })`
	)
	const result = await delegate(workspace, 'execute', 'run-3', {
		allowedTools: rules,
		pluginRoot,
		claude: worker,
		playwright: playwright(workspace),
	})
	assert.equal(result.status, 'completed', result.reasons.join('; '))
	const checks = query<{ test_id: string; observed: string }>(
		workspace,
		"SELECT test_id, observed FROM assertion_results WHERE run_id = 'run-3' ORDER BY rowid"
	)
	assert.deepEqual(
		checks.map((item) => item.test_id),
		['T2', 'T2', 'T1', 'T1']
	)
	assert.ok(checks.every((item) => item.observed === 'Verified with fullsize screenshots.'))
	const evidence = query<{ bytes: Uint8Array }>(
		workspace,
		"SELECT b.bytes FROM evidence e JOIN blobs b ON b.sha256 = e.sha256 WHERE e.run_id = 'run-3'"
	)
	assert.ok(evidence.some((item) => Buffer.from(item.bytes).toString() === 'The promotion quote is 240 PLN.'))
})
