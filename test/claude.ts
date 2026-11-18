import type { TestContext } from 'node:test'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { directory } from './support.ts'

const script = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const args = process.argv.slice(2)
const prompt = readFileSync(0, 'utf8')
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const resumed = after('--resume')
const role = args.includes('--fork-session')
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
const env = Object.keys(process.env).filter((name) => name.startsWith('CHECKMATE_')).sort()
const work = process.env.PLAYWRIGHT_MCP_OUTPUT_DIR
const files = { explorer: 'plan.md', tester: 'report.md', follower: 'follow-up-report.md' }
if (work && files[role]) writeFileSync(join(work, files[role]), role + ' of ' + process.env.PLAYWRIGHT_CLI_SESSION + '\\n')
appendFileSync(process.env.FAKE_CLAUDE_CALL, JSON.stringify({ role, args, prompt, cwd: process.cwd(), env, work, session }) + '\\n')
const replies = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_REPLIES, 'utf8'))
const chosen = replies[role]
const reply = chosen && typeof chosen === 'object' && !Array.isArray(chosen) ? chosen[resumed ?? ''] ?? chosen['*'] : chosen
if (reply === '!fail') {
	process.stderr.write('API error: overloaded\\n')
	process.exit(2)
}
if (reply === '!auth') {
	process.stderr.write('Invalid API key. Authentication error.\\n')
	process.exit(1)
}
if (reply === '!crash') {
	for (let line = 1; line <= 12; line++) process.stderr.write('stack line ' + line + '\\n')
	process.exit(1)
}
if (reply === '!model') {
	process.stderr.write('Error: unknown model ' + after('--model') + '\\n')
	process.exit(1)
}
if (reply === '!stubborn') {
	process.on('SIGTERM', () => {})
	setTimeout(() => {}, 60000)
} else if (reply === '!sleep') setTimeout(() => {}, 60000)
else if (reply === '!ask') askHooks().then(() => finish('Done.'))
else finish(typeof reply === 'string' ? reply : JSON.stringify(reply ?? 'Done.'))
function finish(result) {
	process.stdout.write(
		JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: session, total_cost_usd: 0.25, duration_ms: 1000 })
	)
}
async function askHooks() {
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
	const tool = { tool_name: 'Bash', tool_input: { command: 'npm view left-pad' } }
	await post(hooks.PreToolUse[0].hooks[0], { hook_event_name: 'PreToolUse', ...tool })
	const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm view *' }], behavior: 'allow', destination: 'localSettings' }]
	const answer = await post(hooks.PermissionRequest[0].hooks[0], { hook_event_name: 'PermissionRequest', ...tool, permission_suggestions: suggestions })
	appendFileSync(process.env.FAKE_CLAUDE_ANSWERS, answer + '\\n')
}
`

export type FakeReplies = Partial<
	Record<
		'recorder' | 'repair' | 'explorer' | 'tester' | 'follower' | 'merger' | 'verifier' | 'rules' | 'rules-repair',
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
	}
	const called = () => {
		const lines = existsSync(call) ? readFileSync(call, 'utf8').trim().split('\n') : []
		rmSync(call, { force: true })
		return lines.map((line) => JSON.parse(line))
	}
	const heard = () => (existsSync(answered) ? readFileSync(answered, 'utf8').trim().split('\n') : [])
	return { env, config, reply, called, answers: heard }
}
