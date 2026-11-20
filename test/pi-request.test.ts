import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { directory, root } from './support.ts'
import { piModelArgs, resolvePiModelArgs } from '../plugin/src/pi.ts'
import { streamPi } from '../plugin/src/ui/pi-request.ts'
import { executableOnPath } from '../plugin/src/sessions.ts'

test('Pi RPC verifies the permission extension before sending a request', async (t) => {
	const pi = executableOnPath('pi', process.env)
	if (!pi) return t.skip('Pi is not installed')
	const workspace = directory(t)
	const agent = join(workspace, 'agent')
	mkdirSync(agent)
	let calls = 0
	const requests: string[] = []
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		requests.push(body)
		calls++
		res.writeHead(200, { 'Content-Type': 'text/event-stream' })
		const delta =
			calls === 1
				? {
						role: 'assistant',
						tool_calls: [
							{
								index: 0,
								id: 'call1',
								type: 'function',
								function: { name: 'bash', arguments: JSON.stringify({ command: 'touch blocked' }) },
							},
						],
					}
				: { role: 'assistant', content: 'Hello.' }

		res.write(
			`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
		)
		res.write(
			`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\n`
		)
		res.end('data: [DONE]\n\n')
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	t.after(() => server.close())
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	writeFileSync(
		join(agent, 'models.json'),
		JSON.stringify({
			providers: {
				localfixture: {
					baseUrl: `http://127.0.0.1:${address.port}/v1`,
					api: 'openai-completions',
					apiKey: 'fixture',
					models: [{ id: 'fixture-older' }, { id: 'fixture' }],
				},
			},
		})
	)
	writeFileSync(
		join(agent, 'settings.json'),
		JSON.stringify({ defaultProvider: 'localfixture', defaultModel: 'fixture' })
	)
	const hook = createServer((_req, res) => {
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify({ hookSpecificOutput: { decision: { behavior: 'deny', message: 'Denied by test.' } } }))
	})
	hook.listen(0, '127.0.0.1')
	await once(hook, 'listening')
	t.after(() => hook.close())
	const hookAddress = hook.address()
	assert.ok(hookAddress && typeof hookAddress !== 'string')
	const extension = join(root, 'plugin/pi/permission.mjs')
	const env = {
		PATH: process.env.PATH,
		HOME: workspace,
		PI_CODING_AGENT_DIR: agent,
		PI_OFFLINE: '1',
		CHECKMATE_PI_HOOK: JSON.stringify({
			port: hookAddress.port,
			token: 'test',
			explorationId: 'request',
			who: 'R1',
		}),
	}
	const lines: string[] = []
	const sessionId = randomUUID()
	const scope = piModelArgs({ CHECKMATE_PI_PROVIDER: 'localfixture' })
	const modelArgs = resolvePiModelArgs(pi, scope, workspace, env)
	assert.deepEqual(modelArgs, ['--provider', 'localfixture', '--model', 'fixture'])
	assert.throws(
		() => resolvePiModelArgs(pi, piModelArgs({ CHECKMATE_PI_PROVIDER: 'absentfixture' }), workspace, env),
		/Pi could not select an available model for provider absentfixture/
	)
	assert.equal(calls, 0)
	const args = ['--mode', 'rpc', ...modelArgs, '--no-extensions', '--extension', extension, '--session-id', sessionId]
	const run = streamPi(
		pi,
		args,
		'Say hello.',
		workspace,
		env,
		extension,
		'test-session',
		(line) => lines.push(line),
		{ terminate: 100, kill: 100 }
	)
	const result = await run.finished
	assert.equal(result.error, null, result.stderr)
	assert.deepEqual(result.observedModels, ['localfixture/fixture'])
	assert.equal(calls, 2)
	assert.match(requests[1], /Denied by test/)
	assert.equal(existsSync(join(workspace, 'blocked')), false)
	assert.ok(lines.some((line) => line.includes('Hello.')))
	const resumeArgs = args.slice(0, -2).concat('--session', sessionId)
	const resumed = streamPi(pi, resumeArgs, 'Continue.', workspace, env, extension, sessionId, () => {}, {
		terminate: 100,
		kill: 100,
	})
	assert.equal((await resumed.finished).error, null)
	assert.equal(calls, 3)
	assert.match(requests[2], /Say hello/)
	const missingArgs = args.filter(
		(_, index) => index !== args.indexOf('--extension') && index !== args.indexOf('--extension') + 1
	)
	const missing = streamPi(pi, missingArgs, 'Do not send.', workspace, env, extension, sessionId, () => {}, {
		terminate: 100,
		kill: 100,
	})
	assert.match((await missing.finished).error ?? '', /did not load the permission gate/)
	const bad = streamPi(
		pi,
		args,
		'Do not send.',
		workspace,
		env,
		join(workspace, 'wrong.mjs'),
		'test-session',
		() => {},
		{ terminate: 100, kill: 100 }
	)
	const rejected = await bad.finished
	assert.match(rejected.error ?? '', /did not load the permission gate/)
	assert.equal(calls, 3)
})

test('Pi RPC kills a process that does not complete startup', async (t) => {
	const workspace = directory(t)
	const script = join(workspace, 'stuck.mjs')
	writeFileSync(script, "process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000)")
	const run = streamPi(
		process.execPath,
		[script],
		'Do not send.',
		workspace,
		process.env,
		'/missing',
		'session',
		() => {},
		{ terminate: 100, kill: 100 }
	)
	const result = await run.finished
	assert.match(result.error ?? '', /did not verify the permission gate/)
	assert.equal(result.signal, 'SIGKILL')
})
