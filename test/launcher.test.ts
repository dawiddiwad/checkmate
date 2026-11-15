import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { Stage } from '../cli/src/launcher.ts'
import {
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
import {
	actor,
	begin,
	candidate,
	check,
	directory,
	passRun,
	plan,
	planRequest,
	ready,
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
const reply = (output) => console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: output }))
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

function started(t: TestContext) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened)
	begin(opened, 'run-1', ['T1'], 'build-1')
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
	assert.doesNotMatch(plan, /person/)
	assert(
		plan.includes(`\`checkmate <command>\` means \`node ${join(pluginRoot, 'dist', 'checkmate.js')} <command>\`.`)
	)
	assert.match(await prompt('setup', 'checkout-local'), /checkmate target instance list checkout-local/)
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
	assert.equal(run('--claude-arg'), 'invalid_request delegate\nreason: Missing value for --claude-arg\n')
	assert.equal(run('--claude-arg', '--model'), 'needs_decision checkout\nreason: Stopped.\n')
	assert.deepEqual(args().slice(0, 3), ['-p', '--model', '--plugin-dir'])
	assert.deepEqual(args().slice(-4), ['--allowedTools', 'Read', '--allowedTools', 'Bash'])
	for (const timeout of ['0', 'abc', '3601'])
		assert.equal(
			run('--timeout', timeout),
			`invalid_request delegate\nreason: Invalid --timeout: ${timeout}. Use a whole number from 1 to 3600.\n`
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
reply({ status, subject, reasons })`
	)
	renameSync(join(bin, 'fake-claude'), join(bin, 'claude'))
	const output = execFileSync(
		process.execPath,
		[join(root, 'cli/src/main.ts'), 'delegate', 'plan', 'checkout', '--allow', 'Read', '--allow', 'Bash'],
		{ cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' }
	)
	const lines = output.trim().split('\n')
	const [operation] = query<{ id: string; response: string }>(
		workspace,
		"SELECT id, response FROM operations WHERE command = 'plan save' AND status != 'rejected'"
	)
	const sha256 = JSON.parse(operation.response).data.sha256 as string
	assert.deepEqual(lines, [
		`needs_decision checkout@1 sha256=${sha256.slice(0, 8)} operation=${operation.id}`,
		'reason: G1: Does the promotion stack with loyalty?',
		'reason: G2: Which orders qualify for refunds?',
	])
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
	const quits = claude(workspace, `reply({ status: 'completed', subject: 'run-1', reasons: [] })`)
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
	})
	assert.equal(await refused, `operational_error checkout\nreason: database is locked\nreason: ${busyReason}\n`)
	releaseEarly()
	assert.equal(existsSync(join(early, 'args.json')), false)
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

test('a deadline kills the worker group, keeps the run started, and closes the browser once', async (t) => {
	const { workspace, session } = started(t)
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
		timeoutSeconds: 1,
		claude: hangs,
		playwright: playwright(workspace),
	})
	assert.equal(result.status, 'interrupted')
	assert.deepEqual(result.reasons, ['Worker deadline exceeded', resumeReason('run-1')])
	assert.match(result.reasons[1], /checkmate run resume run-1/)
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
			'Reset: `npm run db:reset`. Run it exactly as recorded before a test that needs a fresh state.'
		),
		prompt
	)
	assert.match(prompt, /adapt the test data within the intent of the test before you record a blocking gap/)
	assert.match(
		prompt,
		/Run deadline: \d{4}-\d\d-\d\dT\S+Z \(UTC\)\. \d+ of 600 seconds are used, and \d+ remain\. The `time` line of `checkmate run show run-1`/
	)
	assert(
		prompt.includes(
			'Instance local is retired; its sandbox may be gone. Stop with a blocked gap if it does not respond.'
		),
		prompt
	)
})

test('the execute prompt gives the rationale of a rejected run that the run tests again', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened, { reset: { owner: 'factory', command: null } })
	passRun(opened, 'run-1', 'b1', ['T1'])
	rejectResult(opened, 'Dawid', { runId: 'run-1', rationale: 'Wrong account.' })
	passRun(opened, 'run-2', 'b2', ['T1'])
	rejectResult(opened, 'Dawid', { runId: 'run-2', rationale: 'I need fullsize screenshots for evidence' })
	begin(opened, 'run-3', ['T1'], 'b2')
	closeStore(opened)
	const quits = claude(
		workspace,
		`require('node:fs').writeFileSync('prompt.txt', require('node:fs').readFileSync(0, 'utf8'))
reply({ status: 'completed', subject: 'run-3', reasons: [] })`
	)
	await delegate(workspace, 'execute', 'run-3', { allowedTools: rules, pluginRoot, claude: quits })
	const prompt = readFileSync(join(workspace, 'prompt.txt'), 'utf8')
	assert(
		prompt.includes('The oracle rejected run-2: I need fullsize screenshots for evidence. Address it.\n'),
		prompt
	)
	assert.doesNotMatch(prompt, /run-1|Wrong account/)
	assert.match(prompt, /Reset: the factory owns it \(no command\)\. Do not run it\./)
})
