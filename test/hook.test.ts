import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import * as support from './support.ts'
import { directory, root } from './support.ts'

function guideBlock(guide: string, after: string, language: string) {
	const start = guide.indexOf(after)
	assert(start >= 0, after)
	const block = guide.slice(start).match(new RegExp(`\\n {3}\`\`\`${language}\\n([\\s\\S]*?)\\n {3}\`\`\`\\n`))
	assert(block, `${language} block after ${after}`)
	return block[1]
		.split('\n')
		.map((line) => line.replace(/^ {3}/, ''))
		.join('\n')
}

const guide = readFileSync(join(root, 'docs/guides/factory.md'), 'utf8')
const scriptText = guideBlock(guide, 'Save this script as `.claude/hooks/checkmate-signal.mjs`', 'js') + '\n'
const settings = JSON.parse(guideBlock(guide, 'Add the hook to `.claude/settings.json`', 'json'))
const commands = ['PostToolUse', 'PostToolUseFailure'].map((event) => {
	const [entry] = settings.hooks[event]
	assert.equal(entry.matcher, 'Bash', event)
	assert.equal(entry.hooks[0].async, true, event)
	return entry.hooks[0].command as string
})
assert.equal(commands[0], commands[1])
const settingsCommand = commands[0]

test('the oracle signal hook from the factory guide sends one line only for new inbox work', async (t) => {
	const project = directory(t)
	const other = directory(t)
	const bin = join(project, 'bin')
	mkdirSync(bin)
	mkdirSync(join(project, '.claude', 'hooks'), { recursive: true })
	writeFileSync(join(project, '.claude', 'hooks', 'checkmate-signal.mjs'), scriptText)
	writeFileSync(
		join(bin, 'checkmate'),
		`#!/bin/sh\nexec "${process.execPath}" "${join(root, 'plugin/dist/checkmate.js')}" "$@"\n`
	)
	chmodSync(join(bin, 'checkmate'), 0o755)

	const posts: string[] = []
	let answer = 200
	const server = createServer((request, response) => {
		let body = ''
		request.on('data', (bytes) => (body += bytes))
		request.on('end', () => {
			posts.push(JSON.parse(body).text)
			response.statusCode = answer
			response.end('ok')
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		CLAUDE_PROJECT_DIR: project,
		CHECKMATE_ACTOR: 'tester',
	}

	function checkmate(args: string[], input = '', cwd = project) {
		try {
			return execFileSync('checkmate', args, { cwd, env, input, encoding: 'utf8' })
		} catch (error) {
			return (error as { stdout: string }).stdout
		}
	}

	function hook(payload: Record<string, unknown>, webhook: string | undefined = url) {
		return new Promise<{ code: number; output: string }>((resolve) => {
			const child = spawn('sh', ['-c', settingsCommand], {
				cwd: project,
				env: { ...env, ORACLE_WEBHOOK_URL: webhook },
				stdio: ['pipe', 'pipe', 'pipe'],
			})
			let output = ''
			child.stdout.on('data', (bytes) => (output += bytes))
			child.stderr.on('data', (bytes) => (output += bytes))
			child.on('close', (code) => resolve({ code: code ?? -1, output }))
			child.stdin.end(JSON.stringify(payload))
		})
	}

	const bash = (command: string) => ({
		session_id: 'abc123',
		transcript_path: '/tmp/t.jsonl',
		cwd: project,
		permission_mode: 'default',
		hook_event_name: 'PostToolUse',
		tool_name: 'Bash',
		tool_input: { command, description: 'x' },
		tool_response: { stdout: '', stderr: '', interrupted: false },
		tool_use_id: 'toolu_1',
	})
	const file = join(project, '.claude', 'hooks', '.checkmate-cursor')
	const cursor = () => JSON.parse(readFileSync(file, 'utf8'))[project]
	const database = join(project, '.checkmate', 'checkmate.db')

	assert.deepEqual(await hook(bash('checkmate status checkout'), undefined), { code: 0, output: '' })
	assert.deepEqual(await hook(bash('checkmate status checkout'), ''), { code: 0, output: '' })
	assert.equal((await hook(bash('npm test'))).code, 0)
	for (const command of ['checkmate inbox', 'grep checkmate notes.txt']) {
		assert.equal((await hook(bash(command))).code, 0)
		assert.equal(existsSync(database), false, `${command} does not create a database`)
	}
	assert.equal(existsSync(file), false)

	const profile = support.profile()
	checkmate([
		'target',
		'open',
		'checkout-local',
		'--entry-point',
		'web:url:Checkout web application and HTTP API.',
		'--capabilities',
		'browser,http',
		'--operations',
		profile.allowedOperations.join(','),
		...profile.tools.flatMap((tool: { name: string; kind: string; purpose: string }) => [
			'--tool',
			`${tool.name}:${tool.kind}:${tool.purpose}`,
		]),
	])
	checkmate(['target', 'save', 'checkout-local'], JSON.stringify(profile))
	assert.equal((await hook(bash('npm test'))).code, 0)
	assert.equal(existsSync(file), false)
	assert.equal((await hook(bash('grep checkmate notes.txt'))).code, 0)
	assert.equal(cursor(), 2, 'grep checkmate costs one read')
	assert.deepEqual(posts, [], 'and sends no signal')

	checkmate(['plan', 'open', 'checkout', '--target', 'checkout-local@1'], JSON.stringify(support.planRequest()))
	checkmate(['plan', 'save', 'checkout'], JSON.stringify(support.candidate()))
	answer = 500
	assert.equal((await hook(bash('node /plugin/dist/checkmate.js plan save checkout <<EOF'))).code, 1)
	assert.equal(cursor(), 2)
	answer = 200
	assert.equal((await hook(bash('cd app && node /plugin/dist/checkmate.js plan save checkout <<EOF'))).code, 0)
	assert.equal(cursor(), 4)
	assert.deepEqual(posts, [
		'Checkmate inbox: 2 gaps, 1 plans, 0 results, 0 requests.',
		'Checkmate inbox: 2 gaps, 1 plans, 0 results, 0 requests.',
	])

	assert.equal((await hook(bash('checkmate inbox'))).code, 0)
	assert.equal(posts.length, 2)

	checkmate(['plan', 'approve', 'checkout@1', '--rationale', ''])
	assert.equal(
		(await hook({ ...bash(''), hook_event_name: 'Stop', tool_input: undefined, stop_hook_active: false })).code,
		0
	)
	assert.equal(cursor(), 5)
	assert.equal(posts.length, 2)

	checkmate(['plan', 'approve', 'checkout@1', '--rationale', 'Ok.'])
	assert.equal(
		(await hook({ ...bash('checkmate plan approve checkout@1'), hook_event_name: 'PostToolUseFailure' })).code,
		0
	)
	assert.equal(cursor(), 6)
	assert.deepEqual(posts.at(-1), 'Checkmate inbox: 2 gaps, 0 plans, 0 results, 0 requests.')

	writeFileSync(file, JSON.stringify({ [project]: 999 }))
	assert.equal((await hook(bash('checkmate inbox'))).code, 0)
	assert.equal(cursor(), 6, 'a cursor beyond the last row ID starts again')
	assert.equal(posts.length, 4)
	writeFileSync(file, 'not json')
	assert.equal((await hook(bash('checkmate inbox'))).code, 0)
	assert.equal(cursor(), 6, 'a corrupt cursor starts again')
	assert.equal(posts.length, 5)
	for (const text of ['null', '[3]', '7']) {
		writeFileSync(file, text)
		assert.equal((await hook(bash('checkmate inbox'))).code, 0, text)
		assert.equal(cursor(), 6, `a cursor file with ${text} starts again`)
	}
	assert.equal(posts.length, 8)

	let rows = 6
	for (const command of [
		'node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" plan reject checkout@1 --rationale No.',
		'npx checkmate plan reject checkout@1 --rationale No.',
		'CHECKMATE_ACTOR=x checkmate plan reject checkout@1 --rationale No.',
		'bash -c "checkmate plan reject checkout@1 --rationale No."',
	]) {
		const opened = checkmate([
			'plan',
			'open',
			`p${rows}`,
			'--target',
			'checkout-local@1',
			'--objective',
			'X.',
			'--source',
			's',
		])
		assert.match(opened, /^completed/, opened)
		rows = JSON.parse(checkmate(['log', '--limit', '1', '--json'])).operations[0].rowid as number
		const before: number = posts.length
		assert.equal((await hook(bash(command))).code, 0, command)
		assert.equal(cursor(), rows, command)
		assert.equal(posts.length, before + 1, command)
	}

	checkmate(
		['target', 'open', 'shop', '--entry-point', 'web:url:Shop.', '--capabilities', 'http', '--operations', 'read'],
		'',
		other
	)
	assert.equal((await hook(bash(`checkmate target open shop --workspace ${other}`))).code, 0)
	assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { [project]: rows, [other]: 1 })
	checkmate(
		['target', 'open', 'shop2', '--entry-point', 'web:url:Shop.', '--capabilities', 'http', '--operations', 'read'],
		'',
		other
	)
	assert.equal((await hook({ ...bash('checkmate target open shop2'), cwd: other })).code, 0)
	assert.deepEqual(
		JSON.parse(readFileSync(file, 'utf8')),
		{ [project]: rows, [other]: 2 },
		'the hook cwd is the default'
	)
	assert.equal((await hook(bash('checkmate inbox --workspace ./missing'))).code, 0)
	assert.equal(existsSync(join(project, 'missing')), false)
	assert.equal((await hook(bash('checkmate inbox --workspace "$HOME/app"'))).code, 0)
	assert.equal(existsSync(join(project, '$HOME')), false)
})
