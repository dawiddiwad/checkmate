import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { RequestListener } from 'node:http'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { promisify } from 'node:util'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { chatOf } from '../plugin/src/requests.ts'
import { planCosts } from '../plugin/src/costs.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { directory, plan, profile, root, target } from './support.ts'
import { call, token, waitFor } from './actions.ts'

const cli = join(root, 'cli/dist/checkmate.js')
const runFile = promisify(execFile)

async function piFixture(
	t: TestContext,
	handler: RequestListener,
	apiKey = 'fixture',
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
) {
	const workspace = directory(t)
	const agent = join(workspace, 'agent')
	mkdirSync(agent)
	const server = createServer(handler)
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
					apiKey,
					models: [{ id: 'fixture', ...(cost ? { cost } : {}) }],
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
		(await runFile(process.execPath, [cli, ...args], { cwd: workspace, env, timeout: 45_000 })).stdout
	return { workspace, env, run }
}

test('real Pi runs a tool and delegate verifies the recorded setup', async (t) => {
	const value = profile()
	const command = `node "${cli}" target save checkout-local --actor pi:setup < profile.json`
	const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = []
	const { workspace, run } = await piFixture(t, async (req, res) => {
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
	writeFileSync(join(workspace, 'profile.json'), JSON.stringify(value))
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

test('real Pi charges this exploration only for new study, test and recorder messages', async (t) => {
	let calls = 0
	const { workspace, run } = await piFixture(
		t,
		(req, res) => {
			req.resume()
			calls++
			const content =
				calls === 3
					? JSON.stringify([{ kind: 'note', text: 'The fixture exploration completed.' }])
					: 'Finished the test turn.'
			res.writeHead(200, { 'Content-Type': 'text/event-stream' })
			const send = (chunk: Record<string, unknown>) =>
				res.write(
					`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', ...chunk })}\n\n`
				)
			send({ choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })
			send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
			const input = 2 ** (calls - 1)
			send({ choices: [], usage: { prompt_tokens: input, completion_tokens: 1, total_tokens: input + 1 } })
			res.end('data: [DONE]\n\n')
		},
		'fixture',
		{ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
	)
	const opened = openStore(workspace)
	try {
		target(opened)
		plan(opened)
	} finally {
		closeStore(opened)
	}
	const started = JSON.parse(
		await run('explore', 'start', 'checkout', '--build', 'cost', '--level', 'smoke', '--allow', 'Read', '--json')
	)
	const finished = JSON.parse(await run('explore', 'wait', started.explorationId, '--timeout', '30', '--json'))
	assert.equal(finished.state, 'completed')
	assert.equal(calls, 3)
	const reader = openStore(workspace)
	try {
		const events = explorationEvents(reader, started.explorationId)
		assert.equal(events.find((event) => event.step === 'end')?.detail.costUsd, 3)
		assert.equal(events.find((event) => event.step === 'record')?.detail.costUsd, 4)
	} finally {
		closeStore(reader)
	}
})

test('real Pi adds each new turn of a resumed plan chat to its plan exactly once', async (t) => {
	const conversations: Array<Array<{ role: string; content: unknown }>> = []
	const { workspace, env } = await piFixture(
		t,
		async (req, res) => {
			let body = ''
			for await (const chunk of req) body += chunk
			conversations.push(JSON.parse(body).messages)
			const calls = conversations.length
			res.writeHead(200, { 'Content-Type': 'text/event-stream' })
			const send = (chunk: Record<string, unknown>) =>
				res.write(
					`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', ...chunk })}\n\n`
				)
			send({
				choices: [
					{
						index: 0,
						delta: { role: 'assistant', content: 'This is the fixture reply.' },
						finish_reason: null,
					},
				],
			})
			send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
			send({ choices: [], usage: { prompt_tokens: calls, completion_tokens: 1, total_tokens: calls + 1 } })
			res.end('data: [DONE]\n\n')
		},
		'fixture',
		{ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
	)
	const store = openStore(workspace)
	target(store)
	plan(store)
	const ui = await startUi({ workspace, env, defaultActor: 'tester' })
	try {
		const csrf = token((await call(ui, '/plans/checkout')).body)
		const first = await call(ui, '/plans/checkout/chats', { csrf, harness: 'pi', text: 'Review checkout.' })
		assert.equal(first.status, 303, first.body)
		const address = String(first.headers.location)
		const id = new URL(address, ui.url).searchParams.get('chat')
		assert.ok(id, address)
		await waitFor('the first Pi chat reply', () => chatOf(store, id)?.turns[0]?.state === 'answered')
		assert.equal(chatOf(store, id)?.costUsd, 1)
		const second = await call(ui, `/plans/checkout/chats/${id}/turns`, {
			csrf,
			harness: 'pi',
			text: 'What should I test next?',
		})
		assert.equal(second.status, 303, second.body)
		await waitFor('the resumed reply', () => chatOf(store, id)?.turns[1]?.state === 'answered')
		const chat = chatOf(store, id)!
		assert.equal(conversations.length, 2)
		for (const messages of conversations)
			assert.match(JSON.stringify(messages.at(-1)?.content), /This conversation is about plan checkout\./)
		assert.match(JSON.stringify(conversations[1]), /This is the fixture reply\./)
		assert.equal(chat.turns[0].sessionId, chat.turns[1].sessionId)
		assert.deepEqual(
			chat.turns.map((turn) => turn.costUsd),
			[1, 2]
		)
		assert.equal(chat.costUsd, 3)
		assert.deepEqual(planCosts(store).get('checkout'), { costUsd: 3, costPartial: false })
		assert.match((await call(ui, '/')).body, /Total cost \$3\.00/)
	} finally {
		await ui.close()
		closeStore(store)
	}
})

test('real Pi records an expired-key failure and shows a safe diagnosis', async (t) => {
	const fixtureKey = 'fixture-expired-key-do-not-display'
	const header = 'Bearer error="invalid_token", error_description="API key expired"'
	let requests = 0
	let authorized = false
	const { workspace, env, run } = await piFixture(
		t,
		(req, res) => {
			requests++
			authorized ||= req.headers.authorization === `Bearer ${fixtureKey}`
			req.resume()
			res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': header })
			res.end(
				JSON.stringify({
					error: {
						message: 'API key expired.',
						code: 401,
						metadata: { headers: { 'WWW-Authenticate': header } },
					},
				})
			)
		},
		fixtureKey
	)
	const store = openStore(workspace)
	try {
		target(store)
		plan(store)
	} finally {
		closeStore(store)
	}
	const ui = await startUi({ workspace, env })
	try {
		const started = JSON.parse(
			await run(
				'explore',
				'start',
				'checkout',
				'--build',
				'b1',
				'--level',
				'smoke',
				'--allow',
				'Read',
				'--allow',
				'Bash',
				'--json'
			)
		)
		assert.equal(started.status, 'completed')
		await assert.rejects(run('explore', 'wait', started.subject, '--timeout', '30', '--json'), (error) => {
			const reply = JSON.parse((error as { stdout: string }).stdout)
			assert.equal(reply.outcome, 'failed')
			return true
		})
		assert.equal(requests, 1)
		assert(authorized, 'Pi did not pass the fixture key to its provider')
		const status = await run('explore', 'status', started.subject, '--json')
		const compact = await run('explore', 'status', started.subject)
		const log = await run('log', '--json')
		const outcome = JSON.parse(status)
		assert.equal(outcome.explorers[0].recorded, null)
		assert.match(outcome.reason, /Host authentication/)
		const recorded = openStore(workspace)
		try {
			const ended = explorationEvents(recorded, started.subject).find(
				(item) => item.step === 'end' && item.explorer === 'a1'
			)
			assert.equal(ended?.status, 'operational_error')
			assert.match(String(ended.detail.reason), /\b401\b.*API key expired\./)
		} finally {
			closeStore(recorded)
		}
		const overview = '/explorations/' + started.subject
		const pages = await Promise.all(
			[overview, overview + '?item=explorer:a1'].map(async (path) => {
				const response = await fetch(new URL(path, ui.url))
				assert.equal(response.status, 200)
				return response.text()
			})
		)
		const detailAt = pages[1].indexOf('data-region="exploration-detail"')
		assert.notEqual(detailAt, -1)
		const outputs = {
			'JSON status': status,
			'compact status': compact,
			'operation log': log,
			'exploration overview': pages[0],
			'tester detail': pages[1].slice(detailAt),
		}
		for (const [place, output] of Object.entries(outputs))
			assert(/\b401\b[^\n]*API key expired\./.test(output), `Missing expiry diagnosis in ${place}`)
		const supervisorLog = readFileSync(
			join(workspace, '.checkmate', 'tmp', `explore-${started.subject}.log`),
			'utf8'
		)
		const privateData = /WWW-Authenticate|error_description|invalid_token/i
		for (const [place, output] of Object.entries({
			...outputs,
			'tester page': pages[1],
			'supervisor log': supervisorLog,
		})) {
			assert(!output.includes(fixtureKey), `Provider key leaked in ${place}`)
			assert(!privateData.test(output), `Provider header leaked in ${place}`)
		}
	} finally {
		await ui.close()
	}
})
