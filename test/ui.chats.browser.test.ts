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
import { closeStore, openStore } from '../plugin/src/index.ts'
import { addRequestActivity, askRequest, requestOf, setRequestState } from '../plugin/src/requests.ts'

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
	assert.equal(await app.page.locator('.chat-assistant [data-status="answered"]').count(), 0)
	assert.match(
		(await app.page.getByRole('link', { name: 'Turn 1' }).getAttribute('href'))!,
		/^\/chats\/[^/]+\/messages\/R1$/
	)
	const address = app.page.url()
	await app.page.locator('[name="text"]').fill('What next?')
	await app.page.getByRole('button', { name: 'Send' }).click()
	await app.page.waitForURL(address)
	await app.page.getByText('What next?', { exact: true }).waitFor()
	assert.equal(await app.page.locator('.chat-user').count(), 2)
	await app.page.getByRole('link', { name: 'Chats', exact: true }).first().click()
	const row = app.page.getByRole('link', { name: /Explain the plan/ })
	await row.waitFor()
	assert.equal(await row.locator('[data-status="answered"]').count(), 0)
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
	await app.page.setViewportSize({ width: 1440, height: 900 })
	const rows = await Promise.all([harness, model, effort].map((field) => field.boundingBox()))
	assert.equal(new Set(rows.map((row) => row!.y)).size, 1)
	const send = await app.page.getByRole('button', { name: 'Send' }).boundingBox()
	assert.equal(rows[0]!.y + rows[0]!.height, send!.y + send!.height)
	await app.page.setViewportSize({ width: 390, height: 844 })
	const mobileRows = await Promise.all([harness, model, effort].map((field) => field.boundingBox()))
	assert.equal(new Set(mobileRows.map((row) => row!.y)).size, 1)
	await app.page.setViewportSize({ width: 320, height: 844 })
	assert.equal(await app.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
	await app.page.setViewportSize({ width: 390, height: 844 })
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

test('chat scrolls to new messages inside its history and keeps a draft', browserTest, async (t) => {
	const app = await open(t, { viewport: { width: 1440, height: 900 } })
	const write = <T>(run: (store: ReturnType<typeof openStore>) => T) => {
		const store = openStore(app.workspace)
		try {
			return run(store)
		} finally {
			closeStore(store)
		}
	}
	let chatId = ''
	for (let i = 0; i < 6; i++) {
		const id = write((store) =>
			askRequest(store, 'qa', {
				text: `Message ${i} ${'long text '.repeat(20)}`,
				context: { planId: null, record: null },
				chatId: chatId || null,
			})
		)
		chatId = write((store) => requestOf(store, id)!.conversation)
		write((store) =>
			setRequestState(store, id, 'answered', { reply: `Reply ${i} ${'long text '.repeat(20)}`, changes: [] })
		)
	}
	await app.page.goto(app.url(`/chats/${chatId}`))
	const history = app.page.locator('[data-chat-history]')
	const atBottom = () =>
		history.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop < 2)
	assert.equal(await atBottom(), true)
	await app.page.locator('[name="text"]').fill('Keep this draft')
	for (let i = 0; i < 2; i++) {
		await history.evaluate((element) => {
			element.scrollTop = 0
		})
		const id = write((store) =>
			askRequest(store, 'qa', {
				text: `Incoming ${i}`,
				context: { planId: null, record: null },
				chatId,
			})
		)
		write((store) => setRequestState(store, id, 'answered', { reply: `New reply ${i}`, changes: [] }))
		await app.page.getByText(`New reply ${i}`, { exact: true }).waitFor()
		assert.equal(await atBottom(), true)
		assert.equal(await app.page.locator('[name="text"]').inputValue(), 'Keep this draft')
	}
	const pending = write((store) =>
		askRequest(store, 'qa', {
			text: 'Last question',
			context: { planId: null, record: null },
			chatId,
		})
	)
	write((store) => setRequestState(store, pending, 'running'))
	await app.page.getByText('Last question', { exact: true }).waitFor()
	await app.page.reload()
	await app.page.getByText('Last question', { exact: true }).waitFor({ state: 'attached' })
	await history.evaluate((element) => {
		element.scrollTop = 0
	})
	write((store) => addRequestActivity(store, pending, 'Checking'))
	await app.page.getByText('Activity (1)', { exact: true }).waitFor({ state: 'attached' })
	assert.equal(await history.evaluate((element) => element.scrollTop), 0)
	write((store) => setRequestState(store, pending, 'failed', { reason: 'Provider error' }))
	await app.page.getByText('Provider error', { exact: true }).waitFor({ state: 'attached' })
	assert.equal(await atBottom(), true)
	const empty = write((store) =>
		askRequest(store, 'qa', {
			text: 'Empty reply',
			context: { planId: null, record: null },
			chatId,
			harness: 'pi',
		})
	)
	write((store) => setRequestState(store, empty, 'running'))
	await app.page.getByText('Empty reply', { exact: true }).waitFor({ state: 'attached' })
	await history.evaluate((element) => {
		element.scrollTop = 0
	})
	write((store) => setRequestState(store, empty, 'answered', { reply: '', changes: [], costUsd: 0.25 }))
	await app.page.getByText('Chat cost $0.25 (partial)', { exact: true }).waitFor()
	assert.equal(await atBottom(), true)
})

test('the active plan chat tab is visible on a narrow screen', browserTest, async (t) => {
	const app = await open(t, { viewport: { width: 320, height: 844 } })
	await app.page.goto(app.url('/plans/coupons?chat=list'))
	const nav = app.page.locator('[data-navigator]')
	const tab = nav.locator('[data-target="chats"][aria-selected="true"]')
	const bounds = await Promise.all([nav.boundingBox(), tab.boundingBox()])
	assert(bounds[1]!.x >= bounds[0]!.x)
	assert(bounds[1]!.x + bounds[1]!.width <= bounds[0]!.x + bounds[0]!.width)
	assert.equal(await app.page.evaluate(() => window.scrollY), 0)
})

test('arrows navigate from the plan to its chat list, turns, and back', browserTest, async (t) => {
	const pi = fakePi(t)
	const { page, url, workspace } = await open(
		t,
		{},
		{
			...process.env,
			CHECKMATE_HARNESS: 'pi',
			PI_OFFLINE: '1',
			PATH: `${pi}:${process.env.PATH}`,
		}
	)
	const store = openStore(workspace)
	try {
		const context = { planId: 'coupons', record: null, planChat: true } as const
		const first = askRequest(store, 'qa', { text: 'First question', context, chatId: null, harness: 'pi' })
		const chatId = requestOf(store, first)!.conversation
		setRequestState(store, first, 'answered', { reply: 'First reply.' })
		const second = askRequest(store, 'qa', { text: 'Second question', context, chatId, harness: 'pi' })
		setRequestState(store, second, 'answered', { reply: 'Second reply.' })
		const other = askRequest(store, 'qa', { text: 'Other chat', context, chatId: null, harness: 'pi' })
		setRequestState(store, other, 'answered', { reply: 'Another reply.' })

		const focused = async (selector: string) =>
			page.waitForFunction((value) => document.activeElement?.matches(value), selector)
		await page.goto(url('/plans/coupons?view=needs'))
		await focused('[data-target="needs"]')
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('ArrowDown')
		await focused('[data-target="chats"]')
		await page.keyboard.press('ArrowRight')
		await page.waitForURL(url('/plans/coupons?view=all&chat=list'))
		await focused('[data-key="chat:new"]')
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('ArrowDown')
		await focused(`[data-key="chat:${chatId}"]`)
		await page.keyboard.press('Escape')
		await focused('[data-target="chats"]')
		await page.keyboard.press('ArrowRight')
		await focused(`[data-key="chat:${chatId}"]`)
		await page.keyboard.press('Enter')
		await focused(`[data-chat-turn][data-key="request:${second}"]`)
		await page.keyboard.press('ArrowUp')
		await focused(`[data-chat-turn][data-key="request:${first}"]`)
		await page.keyboard.press('ArrowRight')
		await page.waitForURL(url(`/chats/${chatId}/messages/${first}`))
		await page.keyboard.press('ArrowLeft')
		await focused(`[data-chat-turn][data-key="request:${first}"]`)
		await page.keyboard.press('ArrowLeft')
		await focused(`[data-key="chat:${chatId}"]`)
		await page.keyboard.press('ArrowLeft')
		await focused('[data-target="chats"]')
		await page.keyboard.press('ArrowRight')
		await focused(`[data-key="chat:${chatId}"]`)

		await page.setViewportSize({ width: 1440, height: 900 })
		await page.keyboard.press('Enter')
		await focused(`[data-chat-turn][data-key="request:${second}"]`)
		const sidebar = page.getByRole('complementary', { name: 'Conversations' })
		const otherChat = sidebar.getByRole('link', { name: /Other chat/ })
		const thread = page.getByRole('region', { name: 'Current conversation' })
		const [left, right] = await Promise.all([sidebar.boundingBox(), thread.boundingBox()])
		assert.equal(left!.x + left!.width, right!.x)
		assert.equal(left!.y, right!.y)
		const [listHeader, threadHeader] = await Promise.all([
			sidebar.locator('.chat-sidebar-header').boundingBox(),
			thread.locator('.chat-thread-header').boundingBox(),
		])
		assert.equal(listHeader!.y + listHeader!.height, threadHeader!.y + threadHeader!.height)
		assert.equal(await sidebar.locator('[aria-current="page"]').getAttribute('data-key'), `chat:${chatId}`)
		await otherChat.focus()
		await page.keyboard.press('ArrowDown')
		await focused(`[data-key="chat:${chatId}"]`)
		await page.keyboard.press('ArrowUp')
		await page.keyboard.press('Enter')
		await thread.getByText('Another reply.', { exact: true }).waitFor()

		await page.setViewportSize({ width: 390, height: 844 })
		assert.equal(await sidebar.isVisible(), false)
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
		await page.getByRole('link', { name: 'All chats', exact: true }).click()
		await otherChat.waitFor()
	} finally {
		closeStore(store)
	}
})

test('a draft typed while sending becomes the next message in the same chat', browserTest, async (t) => {
	const pi = fakePi(t)
	const { page, url, workspace } = await open(
		t,
		{},
		{
			...process.env,
			CHECKMATE_HARNESS: 'pi',
			PI_OFFLINE: '1',
			PATH: `${pi}:${process.env.PATH}`,
		}
	)
	const store = openStore(workspace)
	const first = askRequest(store, 'qa', {
		text: 'First message',
		context: { planId: null, record: null },
		chatId: null,
		harness: 'pi',
	})
	const chatId = requestOf(store, first)!.conversation
	setRequestState(store, first, 'answered', { reply: 'First reply.' })
	closeStore(store)

	const posted = Promise.withResolvers<void>()
	const resume = Promise.withResolvers<void>()
	await page.route('**/turns', async (route) => {
		posted.resolve()
		await resume.promise
		await route.continue()
	})
	try {
		await page.goto(url(`/chats/${chatId}`))
		const text = page.getByLabel('Message', { exact: true })
		await text.fill('Send this')
		await page.keyboard.press('Control+Enter')
		await posted.promise
		await text.fill('Keep the next draft')
		resume.resolve()
		await page.getByText('Pi reply.', { exact: true }).waitFor()
		assert.equal(await text.inputValue(), 'Keep the next draft')
		assert.equal(await page.getByText('Send this', { exact: true }).count(), 1)
	} finally {
		resume.resolve()
	}
})

test(
	'Find opens a default result without adding a Back stop and Escape dismisses a pending send',
	browserTest,
	async (t) => {
		const pi = fakePi(t)
		const { page, url, workspace } = await open(
			t,
			{},
			{
				...process.env,
				CHECKMATE_HARNESS: 'pi',
				PI_OFFLINE: '1',
				PATH: `${pi}:${process.env.PATH}`,
			}
		)
		const plan = /\/plans\/coupons\?/
		const find = page.locator('[data-find]')
		const input = find.locator('[data-find-input]')
		await page.goto(url('/log'))
		await page.goto(url('/plans/coupons'))
		await page.keyboard.press('/')
		await input.fill('coupons')
		await page.keyboard.press('Escape')
		await find.waitFor({ state: 'hidden' })
		await page.waitForFunction(() => !history.state?.layer)
		await page.keyboard.press('/')
		await input.fill('')
		await find.locator('a[href="/activity"][aria-selected="true"]').waitFor()
		await page.keyboard.press('Enter')
		await page.waitForURL(url('/activity'))
		await page.goBack()
		await page.waitForURL(plan)
		await page.goBack()
		await page.waitForURL(/\/log/)

		const held = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const completed = page.waitForResponse((response) => response.url().includes('/chats/') && response.ok())
		await page.route('**/requests', async (route) => {
			held.resolve()
			await release.promise
			await route.continue()
		})
		try {
			await page.keyboard.press('/')
			await input.fill('zebra query outside the record')
			await find.locator('[data-find-ask]').click()
			await held.promise
			await page.keyboard.press('Escape')
			await find.waitFor({ state: 'hidden' })
			release.resolve()
			await completed
			assert.match(page.url(), /\/log/)
			const store = openStore(workspace)
			try {
				assert.equal(requestOf(store, 'R1')?.text, 'zebra query outside the record')
			} finally {
				closeStore(store)
			}
		} finally {
			release.resolve()
		}
	}
)

test('plan and global chat lists show newly reported costs without reloading', browserTest, async (t) => {
	const app = await open(t)
	const globalChats = await app.page.context().newPage()
	await Promise.all([app.page.goto(app.url('/plans/coupons?chat=list')), globalChats.goto(app.url('/chats'))])
	await Promise.all([app.page, globalChats].map((page) => page.getByText('No chats yet.').waitFor()))
	const store = openStore(app.workspace)
	try {
		const id = askRequest(store, 'qa', {
			text: 'Check the coupon plan',
			context: { planId: 'coupons', record: null, planChat: true },
			chatId: null,
			harness: 'pi',
		})
		setRequestState(store, id, 'running')
		const rows = [app.page, globalChats].map((page) => page.getByRole('link', { name: /Check the coupon plan/ }))
		await Promise.all(rows.map((row) => row.getByText('Unknown').waitFor()))
		assert.equal(await rows[0].locator('[data-status="running"]').count(), 1)
		setRequestState(store, id, 'answered', { reply: 'Checked.', costUsd: 0.67, costScope: 'turn' })
		await Promise.all(rows.map((row) => row.getByText('$0.67', { exact: true }).waitFor()))
		assert.equal(await rows[0].locator('[data-status="answered"]').count(), 0)
		await Promise.all(rows.map((row) => row.getByText('1 unread', { exact: true }).waitFor()))
		await rows[0].click()
		await app.page.getByText('Checked.', { exact: true }).waitFor()
		await globalChats.getByText('1 unread', { exact: true }).waitFor({ state: 'detached' })
	} finally {
		closeStore(store)
	}
})

test('a plan chat renders Markdown and opens the linked question and run', browserTest, async (t) => {
	const { page, url, workspace } = await open(t, { viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
	const question = '/plans/coupons?view=all&item=q%3Ak1%2FQ4'
	const run = '/runs/run-7'
	const evidence = '/explorations/x-11/claims/k1/D1/evidence/0'
	const reading = openStore(workspace)
	const id = askRequest(reading, 'qa', {
		text: 'Which checks need my attention?',
		context: { planId: 'coupons', record: null, planChat: true },
		chatId: null,
		harness: 'pi',
	})
	const address = url(`/plans/coupons?chat=${requestOf(reading, id)!.conversation}`)
	try {
		setRequestState(reading, id, 'answered', {
			reply: [
				'### Items to review',
				'',
				`- **Read** [question k1/Q4](${question}).`,
				`  - Check [run 7](${run}).`,
				'- Inspect `coupon_status`.',
				'',
				'| Check | Status |',
				'| --- | ---: |',
				'| Coupons | Ready |',
				'',
				'```text',
				'long output '.repeat(25),
				'```',
				'',
				`![Coupon evidence](${evidence})`,
				'![External image](https://images.example.com/coupon.png)',
				'[Unsafe link](javascript:alert%281%29)',
				'<img src=x onerror="window.hit=1">',
			].join('\n'),
		})
	} finally {
		closeStore(reading)
	}
	const externalRequests: string[] = []
	page.on('request', (request) => {
		if (request.url().startsWith('https://images.example.com/')) externalRequests.push(request.url())
	})
	await page.goto(address)
	const reply = page.locator('.chat-markdown')
	await reply.getByRole('heading', { name: 'Items to review' }).waitFor()
	assert.equal(await reply.locator('ul ul li').textContent(), 'Check run 7.')
	assert.equal(await reply.locator('strong').textContent(), 'Read')
	assert.equal(await reply.locator('p code, li code').textContent(), 'coupon_status')
	const status = reply.getByRole('cell', { name: 'Ready' })
	assert.equal(await status.isVisible(), true)
	assert.equal(await status.evaluate((el) => getComputedStyle(el).textAlign), 'right')
	assert.match((await reply.locator('pre code').textContent()) ?? '', /long output/)
	await page.waitForFunction(
		() => document.querySelector<HTMLImageElement>('img[alt="Coupon evidence"]')?.naturalWidth
	)
	assert.equal(await reply.locator('img').count(), 1)
	assert.equal(await reply.getByRole('link', { name: 'External image' }).count(), 1)
	assert.equal(await reply.getByRole('link', { name: 'Unsafe link' }).count(), 0)
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
	const history = page.locator('[data-chat-history]')
	assert(await history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2))
	assert.deepEqual(externalRequests, [])
	await reply.getByRole('link', { name: 'question k1/Q4' }).click()
	await page.waitForURL(url(question))
	await page.locator('[data-drawer]').waitFor()
	await page.goto(address)
	await reply.getByRole('link', { name: 'run 7' }).click()
	await page.waitForURL(url(run))
	await page.getByRole('heading', { name: 'run-7', exact: true }).waitFor()
})
