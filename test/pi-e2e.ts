import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { directory, profile, root } from './support.ts'

test('real Pi runs a tool and delegate verifies the recorded setup', async (t) => {
	const workspace = directory(t)
	const agent = join(workspace, 'agent')
	mkdirSync(agent)
	const cli = join(root, 'cli/dist/checkmate.js')
	const value = profile()
	writeFileSync(join(workspace, 'profile.json'), JSON.stringify(value))
	const command = `node "${cli}" target save checkout-local --actor pi:setup < profile.json`
	const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		requests.push(JSON.parse(body))
		const call = requests.length === 1
		const delta = call
			? {
					tool_calls: [
						{
							index: 0,
							id: 'save',
							type: 'function',
							function: { name: 'bash', arguments: JSON.stringify({ command }) },
						},
					],
				}
			: { content: JSON.stringify({ status: 'completed', subject: 'checkout-local', reasons: [] }) }
		res.writeHead(200, { 'Content-Type': 'text/event-stream' })
		for (const [payload, reason] of [
			[{ role: 'assistant', ...delta }, null],
			[{}, call ? 'tool_calls' : 'stop'],
		]) {
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: payload, finish_reason: reason }] })}\n\n`
			)
		}
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
					models: [{ id: 'fixture' }],
				},
			},
		})
	)
	const env = {
		PATH: process.env.PATH,
		HOME: workspace,
		PI_CODING_AGENT_DIR: agent,
		PI_OFFLINE: '1',
		CHECKMATE_ACTOR: 'tester',
		CHECKMATE_HARNESS: 'pi',
		CHECKMATE_PI_PROVIDER: 'localfixture',
		CHECKMATE_PI_MODEL: 'fixture',
	}
	const run = async (...args: string[]) =>
		(await promisify(execFile)(process.execPath, [cli, ...args], { cwd: workspace, env })).stdout
	await run('init')
	await run(
		'target',
		'open',
		value.targetId,
		'--entry-point',
		'web:url:Checkout web application and HTTP API.',
		'--capabilities',
		value.capabilities.join(','),
		'--operations',
		value.allowedOperations.join(',')
	)
	const response = JSON.parse(await run('delegate', 'setup', value.targetId, '--json', '--timeout', '30'))
	assert.equal(response.status, 'completed')
	assert.ok(response.operation)
	assert.equal(requests.length, 2)
	assert.equal(requests[0].model, 'fixture')
	assert.ok(
		requests[1].messages.some((m) => m.role === 'tool' && JSON.stringify(m.content).includes('checkout-local'))
	)
})
