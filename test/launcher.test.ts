import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
	delegate,
	minimumRules,
	reservedClaudeArgs,
	resumeReason,
	unverifiedReason,
	worker,
} from '../cli/src/launcher.ts'
import { busyReason, closeStore, openStore } from '../plugin/src/store.ts'
import { answerGap, openPlan } from '../plugin/src/plans.ts'
import { actor, begin, candidate, check, directory, plan, planRequest, ready, root, store, target } from './support.ts'
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

test('the delegated prompt names the plugin CLI and tells the worker not to ask or wait for the oracle', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const records = claude(
		workspace,
		`require('node:fs').writeFileSync('prompt.txt', require('node:fs').readFileSync(0, 'utf8'))
reply({ status: 'needs_decision', subject: 'checkout', reasons: ['Stopped.'] })`
	)
	await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: records })
	const prompt = readFileSync(join(workspace, 'prompt.txt'), 'utf8')
	assert.match(prompt, /Do not ask the oracle\. Do not wait for the oracle\./)
	assert.doesNotMatch(prompt, /person/)
	assert(
		prompt.includes(`\`checkmate <command>\` means \`node ${join(pluginRoot, 'dist', 'checkmate.js')} <command>\`.`)
	)
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

test('delegate puts each --claude-arg before the tool rules, so a value cannot add a tool', async (t) => {
	const workspace = requested(t)
	const records = claude(workspace, recordsArgs)
	const claudeArgs = ['--model', 'claude-haiku-5-5', '--add-dir=/srv/specs', 'Write']
	await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, claudeArgs, pluginRoot, claude: records })
	const args = JSON.parse(readFileSync(join(workspace, 'args.json'), 'utf8')) as string[]
	assert.equal(args[0], '-p')
	assert.deepEqual(args.slice(-8), [...claudeArgs, '--allowedTools', 'Read', '--allowedTools', 'Bash'])
	assert.equal(args.indexOf('Write'), args.indexOf('--allowedTools') - 1)
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

test('the npm CLI takes --claude-arg values that start with --', (t) => {
	const workspace = requested(t)
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	claude(bin, recordsArgs)
	renameSync(join(bin, 'fake-claude'), join(bin, 'claude'))
	const output = execFileSync(
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
			'--claude-arg',
			'--model',
			'--claude-arg',
			'claude-haiku-5-5',
			'--workspace',
			workspace,
		],
		{ cwd: workspace, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' }
	)
	assert.equal(output, 'needs_decision checkout\nreason: Stopped.\n')
	const args = JSON.parse(readFileSync(join(workspace, 'args.json'), 'utf8')) as string[]
	assert.deepEqual(args.slice(-6, -4), ['--model', 'claude-haiku-5-5'])
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
		{ ...result, operation: undefined },
		{
			status: 'completed',
			subject: 'run-1',
			reasons: [],
			operation: undefined,
		}
	)
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
	})
	begin(opened, 'run-1', ['T1'], 'build-1')
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
})

test('the setup prompt names the instances of the target', async (t) => {
	const workspace = planned(t)
	const records = claude(
		workspace,
		`require('node:fs').writeFileSync('prompt.txt', require('node:fs').readFileSync(0, 'utf8'))
reply({ status: 'needs_decision', subject: 'checkout-local', reasons: ['Stopped.'] })`
	)
	await delegate(workspace, 'setup', 'checkout-local', { allowedTools: rules, pluginRoot, claude: records })
	assert.match(readFileSync(join(workspace, 'prompt.txt'), 'utf8'), /checkmate target instance list checkout-local/)
})
