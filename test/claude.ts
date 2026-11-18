import type { TestContext } from 'node:test'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { directory, root } from './support.ts'

const script = `#!/usr/bin/env node
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const args = process.argv.slice(2)
const prompt = readFileSync(0, 'utf8')
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const resumed = after('--resume')
const streamed = args.includes('stream-json')
const role = streamed
	? 'request'
	: args.includes('--fork-session')
	? 'recorder'
	: /^Write the rules /.test(prompt)
		? 'rules'
	: /^Checkmate refused these rules /.test(prompt)
		? 'rules-repair'
	: resumed && /^Now test /.test(prompt)
		? 'tester'
		: resumed && /^The owner of the product answered /.test(prompt)
			? 'follower'
			: resumed
				? 'repair'
				: /^Merge /.test(prompt)
					? 'merger'
					: /^Reproduce /.test(prompt)
						? 'verifier'
						: 'explorer'
const session = after('--session-id') ?? resumed ?? randomUUID()
const emit = (value) => process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value)) + '\\n')
const env = Object.keys(process.env).filter((name) => name.startsWith('CHECKMATE_')).sort()
const work = process.env.PLAYWRIGHT_MCP_OUTPUT_DIR
const files = { explorer: 'plan.md', tester: 'report.md', follower: 'follow-up-report.md' }
if (work && files[role]) writeFileSync(join(work, files[role]), role + ' of ' + process.env.PLAYWRIGHT_CLI_SESSION + '\\n')
appendFileSync(process.env.FAKE_CLAUDE_CALL, JSON.stringify({ role, args, prompt, cwd: process.cwd(), env, work, session, actor: process.env.CHECKMATE_ACTOR }) + '\\n')
const replies = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_REPLIES, 'utf8'))
const chosen = replies[role]
const reply = chosen && typeof chosen === 'object' && !Array.isArray(chosen) ? chosen[resumed ?? ''] ?? chosen['*'] ?? (streamed ? chosen : undefined) : chosen
if (streamed) {
	streamRequest(reply).then(() => process.exit(0))
} else if (reply === '!fail') {
	process.stderr.write('API error: overloaded\\n')
	process.exit(2)
}
else if (reply === '!auth') {
	process.stderr.write('Invalid API key. Authentication error.\\n')
	process.exit(1)
}
else if (reply === '!crash') {
	for (let line = 1; line <= 12; line++) process.stderr.write('stack line ' + line + '\\n')
	process.exit(1)
}
else if (reply === '!model') {
	process.stderr.write('Error: unknown model ' + after('--model') + '\\n')
	process.exit(1)
}
else if (reply === '!stubborn') {
	process.on('SIGTERM', () => {})
	setTimeout(() => {}, 60000)
} else if (reply === '!sleep') setTimeout(() => {}, 60000)
else if (reply === '!stray') {
	mkdirSync(join(process.cwd(), 'qa-scratch'), { recursive: true })
	writeFileSync(join(process.cwd(), 'qa-scratch', 'notes.md'), 'x')
	finish('Done.')
} else if (reply === '!ask') askHooks().then(() => finish('Done.'))
else finish(typeof reply === 'string' ? reply : JSON.stringify(reply ?? 'Done.'))
function finish(result) {
	process.stdout.write(
		JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: session, total_cost_usd: 0.25, duration_ms: 1000 })
	)
}
async function askHooks(asking) {
	const settings = JSON.parse(after('--settings') ?? '{}')
	const hooks = settings.hooks
	if (!hooks) return appendFileSync(process.env.FAKE_CLAUDE_ANSWERS, 'no hook\\n')
	const post = async (hook, body) => {
		const authorization = hook.headers.Authorization.replace('$CHECKMATE_HOOK_TOKEN', process.env.CHECKMATE_HOOK_TOKEN)
		const response = await fetch(hook.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: authorization },
			body: JSON.stringify({ session_id: session, cwd: process.cwd(), permission_mode: 'default', ...body }),
		})
		return response.text()
	}
	const tool = asking ? { tool_name: asking.name, tool_input: asking.input } : { tool_name: 'Bash', tool_input: { command: 'npm view left-pad' } }
	await post(hooks.PreToolUse[0].hooks[0], { hook_event_name: 'PreToolUse', ...tool })
	const rule = asking ? asking.rule : 'npm view *'
	const suggestions = rule ? [{ type: 'addRules', rules: [{ toolName: tool.tool_name, ruleContent: rule }], behavior: 'allow', destination: 'localSettings' }] : []
	const answer = await post(hooks.PermissionRequest[0].hooks[0], { hook_event_name: 'PermissionRequest', ...tool, permission_suggestions: suggestions })
	appendFileSync(process.env.FAKE_CLAUDE_ANSWERS, answer + '\\n')
	return answer
}
async function streamRequest(reply) {
	const spec = reply && typeof reply === 'object' ? reply : { result: typeof reply === 'string' ? reply : 'Done.' }
	if (reply === '!fail') {
		process.stderr.write('API error: overloaded\\n')
		process.exit(2)
	}
	if (reply === '!auth') {
		process.stderr.write('Invalid API key. Authentication error.\\n')
		process.exit(1)
	}
	if (reply === '!crash') {
		for (let line = 1; line <= 30; line++) process.stderr.write('stack line ' + line + '\\n')
		process.exit(1)
	}
	if (reply === '!garbage') {
		emit('this is not json')
		await new Promise((resolve) => setTimeout(resolve, 60000))
	}
	emit({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), model: 'fake', tools: ['Bash', 'Read'] })
	const tools = spec.tools ?? []
	for (const tool of tools)
		emit({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }, { type: 'tool_use', id: 'toolu_1', name: tool.name, input: tool.input }] } })
	emit({ type: 'user', session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } })
	if (reply === '!ignore-interrupt') process.on('SIGINT', () => {})
	if (reply === '!stubborn') {
		process.on('SIGINT', () => {})
		process.on('SIGTERM', () => {})
	}
	if (reply === '!hang' || reply === '!ignore-interrupt' || reply === '!stubborn') {
		appendFileSync(process.env.FAKE_CLAUDE_ANSWERS, 'hanging\\n')
		await new Promise((resolve) => setTimeout(resolve, 60000))
	}
	const denials = []
	for (const asking of spec.ask ?? []) {
		const answer = await askHooks(asking)
		if (answer.includes('"behavior":"deny"')) denials.push({ tool_name: asking.name, tool_input: asking.input })
	}
	for (const argv of spec.run ?? []) {
		const done = require('node:child_process').spawnSync(process.execPath, [process.env.FAKE_CHECKMATE_CLI, ...argv, '--workspace', process.cwd()], { encoding: 'utf8', env: process.env })
		appendFileSync(process.env.FAKE_CLAUDE_ANSWERS, 'ran ' + argv.join(' ') + ' ' + done.status + '\\n')
	}
	if (spec.hang) {
		appendFileSync(process.env.FAKE_CLAUDE_ANSWERS, 'hanging\\n')
		await new Promise((resolve) => setTimeout(resolve, 60000))
	}
	if (spec.noResult) return
	emit({ type: 'result', subtype: spec.isError ? 'error_during_execution' : 'success', is_error: Boolean(spec.isError), result: spec.result ?? 'Done.', session_id: session, total_cost_usd: spec.cost ?? 0.06, duration_ms: 1000, permission_denials: denials })
}
`

export type FakeReplies = Partial<
	Record<
		| 'recorder'
		| 'repair'
		| 'explorer'
		| 'tester'
		| 'follower'
		| 'merger'
		| 'verifier'
		| 'rules'
		| 'rules-repair'
		| 'request',
		unknown
	>
>

export function fakeClaude(t: TestContext, replies: FakeReplies = {}) {
	const bin = directory(t)
	writeFileSync(join(bin, 'claude'), script)
	chmodSync(join(bin, 'claude'), 0o755)
	const config = directory(t)
	const call = join(directory(t), 'calls.jsonl')
	const answers = join(directory(t), 'replies.json')
	const reply = (next: FakeReplies) => writeFileSync(answers, JSON.stringify(next))
	reply(replies)
	const answered = join(directory(t), 'answers.txt')
	const env: Record<string, string> = {
		FAKE_CLAUDE_ANSWERS: answered,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CLAUDE_CONFIG_DIR: config,
		FAKE_CLAUDE_CALL: call,
		FAKE_CLAUDE_REPLIES: answers,
		FAKE_CHECKMATE_CLI: join(root, 'plugin', 'bin', 'checkmate.ts'),
	}
	const called = () => {
		const lines = existsSync(call) ? readFileSync(call, 'utf8').trim().split('\n') : []
		rmSync(call, { force: true })
		return lines.map((line) => JSON.parse(line))
	}
	const heard = () => (existsSync(answered) ? readFileSync(answered, 'utf8').trim().split('\n') : [])
	return { env, config, reply, called, answers: heard }
}
