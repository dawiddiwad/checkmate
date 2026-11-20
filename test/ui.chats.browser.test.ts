import test from 'node:test'
import type { TestContext } from 'node:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { directory } from './support.ts'
import assert from 'node:assert/strict'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { fakeClaude } from './claude.ts'
import { endProcessesIn } from './actions.ts'

function fakePi(t: TestContext) {
	const bin = directory(t)
	const script = `#!/usr/bin/env node
const readline = require('node:readline')
const args = process.argv.slice(2)
const extension = args[args.indexOf('--extension') + 1]
const models = [{ provider: 'local', id: 'think', reasoning: true }, { provider: 'local', id: 'plain', reasoning: false }]
const send = (value) => console.log(JSON.stringify(value))
readline.createInterface({ input: process.stdin }).on('line', (line) => {
	const command = JSON.parse(line)
	if (command.type === 'get_available_models') send({ type: 'response', id: command.id, command: command.type, success: true, data: { models } })
	else if (command.type === 'get_state') send({ type: 'response', id: command.id, command: command.type, success: true, data: { model: models[0] } })
	else if (command.type === 'get_commands') send({ type: 'response', id: command.id, success: true, data: { commands: [{ name: 'checkmate-permission-ready', source: 'extension', sourceInfo: { path: extension } }] } })
	else if (command.type === 'prompt') {
		send({ type: 'response', id: command.id, success: true })
		send({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Pi reply.' }] }] })
		send({ type: 'agent_settled', aborted: false })
	}
})
`
	writeFileSync(join(bin, 'pi'), script)
	chmodSync(join(bin, 'pi'), 0o755)
	return bin
}

test.before(() => launchWith(seedVolume))
test.after(stop)

test('Find opens a chat and a follow-up stays in its history', browserTest, async (t) => {
	const fake = fakeClaude(t, { request: { result: 'A reply.' } })
	const app = await open(t, { viewport: { width: 1440, height: 900 } }, { ...process.env, ...fake.env })
	t.after(() => endProcessesIn(app.workspace))
	await app.page.goto(app.url('/plans/coupons'))
	await app.page.keyboard.press('/')
	await app.page.locator('[data-find-input]').fill('Explain the plan')
	await app.page.locator('[data-find-ask]').click()
	await app.page.waitForURL(/\/chats\/[^/]+$/)
	await app.page.locator('.chat-user').getByText('Explain the plan', { exact: true }).waitFor()
	await app.page.getByText('A reply.', { exact: true }).waitFor()
	const address = app.page.url()
	await app.page.locator('[name="text"]').fill('What next?')
	await app.page.getByRole('button', { name: 'Send' }).click()
	await app.page.waitForURL(address)
	await app.page.getByText('What next?', { exact: true }).waitFor()
	assert.equal(await app.page.locator('.chat-user').count(), 2)
	await app.page.getByRole('link', { name: 'Chats', exact: true }).first().click()
	await app.page.getByRole('link', { name: /Explain the plan/ }).waitFor()
})

test('chat controls switch harness and retain model and effort at mobile width', browserTest, async (t) => {
	const claude = fakeClaude(t, {
		request: { result: 'Claude reply.' },
		models: [
			{ value: 'default', displayName: 'Default', supportedEffortLevels: ['medium', 'high'] },
			{ value: 'fixture-claude', displayName: 'Fixture Claude', supportedEffortLevels: ['medium', 'high'] },
		],
	})
	const pi = fakePi(t)
	const app = await open(
		t,
		{ viewport: { width: 390, height: 844 } },
		{ ...process.env, ...claude.env, PATH: `${pi}:${claude.env.PATH}` }
	)
	t.after(() => endProcessesIn(app.workspace))
	await app.page.goto(app.url('/chats?new=1'))
	await app.page.locator('[name="text"]').fill('First message')
	await app.page.getByRole('button', { name: 'Send' }).click()
	await app.page.waitForURL(/\/chats\/[^/]+$/)
	await app.page.getByText('Claude reply.', { exact: true }).waitFor()
	const address = app.page.url()
	const harness = app.page.locator('[data-chat-harness]')
	const model = app.page.locator('[data-chat-model]')
	const effort = app.page.locator('[data-chat-effort]')
	await harness.selectOption('pi')
	await model.locator('option[value="local/think"]').waitFor({ state: 'attached' })
	assert.deepEqual(
		await model.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value)),
		['', 'local/think', 'local/plain']
	)
	await model.selectOption('local/plain')
	assert.equal(await effort.isHidden(), true)
	await model.selectOption('local/think')
	await effort.selectOption('high')
	await app.page.locator('[name="text"]').fill('Continue with Pi')
	await app.page.getByRole('button', { name: 'Send' }).click()
	await app.page.waitForURL(address)
	await app.page.getByText('Pi reply.', { exact: true }).waitFor()
	await app.page.reload()
	await effort.locator('option[value="high"]').waitFor({ state: 'attached' })
	assert.equal(await harness.inputValue(), 'pi')
	assert.equal(await model.inputValue(), 'local/think')
	assert.equal(await effort.inputValue(), 'high')
	assert.equal(await app.page.locator('.chat-user').count(), 2)
	assert.equal(await app.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})

test('a refused chat message keeps the draft and shows the error', browserTest, async (t) => {
	const fake = fakeClaude(t, { request: { result: 'A reply.' } })
	const app = await open(t, { viewport: { width: 390, height: 844 } }, { ...process.env, ...fake.env })
	t.after(() => endProcessesIn(app.workspace))
	await app.page.goto(app.url('/chats?new=1'))
	const message = app.page.locator('[name="text"]')
	await message.fill('Keep this draft')
	await app.page.route('**/chats', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 422, contentType: 'text/html', body: '<p role="alert">Refused by test.</p>' })
			: route.continue()
	)
	await app.page.getByRole('button', { name: 'Send' }).click()
	await app.page.locator('[data-chat-error]:not([hidden])').waitFor()
	assert.equal(await message.inputValue(), 'Keep this draft')
	assert.equal(await app.page.getByRole('button', { name: 'Send' }).isEnabled(), true)
	await app.page.reload()
	assert.equal(await message.inputValue(), 'Keep this draft')
})
