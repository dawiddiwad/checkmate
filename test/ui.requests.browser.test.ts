import type { TestContext } from 'node:test'
import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { addRequestActivity, allRequests, askRequest, requestOf, setRequestState } from '../plugin/src/requests.ts'
import { openPermissions } from '../plugin/src/permissions.ts'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { fakeClaude } from './claude.ts'
import type { FakeReplies } from './claude.ts'
import { endProcessesIn, waitFor } from './actions.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

async function prepare(t: TestContext, replies: FakeReplies, size = { width: 1440, height: 900 }) {
	const fake = fakeClaude(t, replies)
	const app = await open(t, { viewport: size }, { ...process.env, ...fake.env })
	t.after(() => endProcessesIn(app.workspace))
	const read = <T>(view: (reading: ReturnType<typeof openStore>) => T) => {
		const reading = openStore(app.workspace)
		try {
			return view(reading)
		} finally {
			closeStore(reading)
		}
	}
	const state = (id: string, wanted: string) =>
		waitFor(`${id} is ${wanted}`, () => read((reading) => requestOf(reading, id))?.state === wanted)
	const count = () => read((reading) => allRequests(reading).length)
	return { ...app, ...fake, read, state, count }
}

const onRow = (page: Page) => page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
const onRecord = (page: Page) => page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
const hanging = { tools: [{ name: 'Bash', input: { command: 'npm test' } }], hang: true }

async function askByKeys(page: Page, text: string) {
	await page.keyboard.press('/')
	await page.locator('[data-find]').waitFor()
	await page.keyboard.type(text)
	await page.locator('[data-find-ask][aria-selected="true"]').waitFor()
	await page.locator('[data-find-ask]').click()
	await page.waitForURL(/\/chats\/[^/]+$/).catch(async (error) => {
		throw new Error(`${error.message}: ${await page.locator('[data-find-error]').textContent()}`)
	})
	return 'R1'
}

test('a chat shows activity and can stop the active turn', browserTest, async (t) => {
	const { page, url, state } = await prepare(t, { request: hanging })
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await askByKeys(page, 'why does D3 fail')
	await state('R1', 'running')
	await page.locator('.chat-assistant summary').first().click()
	await page.locator('.sp-activity li').first().waitFor()
	await page.getByRole('button', { name: 'Stop', exact: true }).click()
	await state('R1', 'stopped')
	await page.locator('.chat-assistant [data-status="stopped"]').waitFor()
})

test(
	'the old replies address opens Chats, where unread conversations can be opened by keyboard',
	browserTest,
	async (t) => {
		const { page, url, state, ask } = await prepareWithAsks(t)
		await ask(['zzz one', 'zzz two'])
		await state('R1', 'answered')
		await state('R2', 'answered')
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		const bar = page.locator('[data-region="replies-link"]')
		await bar.waitFor()
		assert.match((await bar.textContent()) ?? '', /2 unread/)
		assert.equal(await bar.getAttribute('href'), '/chats')
		await page.goto(url('/requests'))
		await page.waitForURL(url('/chats'))
		const conversations = page.locator('.chat-list-item')
		assert.equal(await conversations.count(), 2)
		assert.match((await conversations.first().textContent()) ?? '', /zzz two/)
		assert.equal(await page.getByText('1 unread', { exact: true }).count(), 2)
		await conversations.first().focus()
		await page.keyboard.press('Enter')
		await page.waitForURL(/\/chats\/[^/]+$/)
		await page.getByText('Reply to zzz two.', { exact: true }).waitFor()
		await page.goBack()
		await page.waitForURL(url('/chats'))
		await page.waitForFunction(() => document.querySelectorAll('.chat-list .chat-unread').length === 1)
	}
)

async function prepareWithAsks(t: TestContext) {
	const app = await prepare(t, { request: { result: 'Reply to one question.' } })
	const ask = async (texts: string[]) => {
		for (const [index, text] of texts.entries()) {
			app.reply({ request: { result: `Reply to ${text}.` } })
			await app.page.goto(app.url('/plans/coupons?view=all&focus=list'))
			await app.page.evaluate(async (message) => {
				const csrf = document.querySelector<HTMLInputElement>('[name="csrf"]')!.value
				await fetch('/requests', {
					method: 'POST',
					body: new URLSearchParams({ csrf, text: message, chat: '1' }),
				})
			}, text)
			await app.state(`R${index + 1}`, 'answered')
		}
	}
	return { ...app, ask }
}

test('a failed turn shows the reason and retries inside the same chat', browserTest, async (t) => {
	const { page, url, state, reply } = await prepare(t, { request: '!crash' })
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await onRow(page)
	await askByKeys(page, 'this will fail')
	await state('R1', 'failed')
	const chat = page.url()
	await page.goto(url('/requests/R1'))
	await onRecord(page)
	assert.match((await page.locator('[data-key="failure"]').textContent()) ?? '', /claude ended without a reply\./)
	assert.match((await page.locator('[data-key="failure"] pre').textContent()) ?? '', /stack line 30/)
	assert.deepEqual(
		await page
			.locator('.sp-options [data-option]')
			.allTextContents()
			.then((all) => all.map((text) => text.replace(/\s+/g, ' ').trim())),
		['1Ask again']
	)
	reply({ request: { result: 'Retried successfully.' } })
	await page.getByRole('button', { name: /Ask again/ }).click()
	await page.waitForURL(chat)
	await page.getByText('Retried successfully.', { exact: true }).waitFor()
	assert.equal(await page.locator('.chat-turn').count(), 2)
})

test('a permission prompt is answered from the message details', browserTest, async (t) => {
	const asking = { name: 'Bash', input: { command: 'npm view left-pad' }, rule: 'npm view *' }
	const { page, url, state, read } = await prepare(t, { request: { ask: [asking], result: 'Looked it up.' } })
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await onRow(page)
	await askByKeys(page, 'look up the package')
	const details = page.url() + '/messages/R1'
	const count = page.locator('[data-region="permissions-link"]')
	await count.waitFor()
	assert.equal((await count.textContent())?.trim(), '1 permission')
	await page.goto(details)
	await onRecord(page)
	const waits = page.locator('[data-key="waits"]')
	await waits.waitFor()
	assert.match((await waits.textContent()) ?? '', /This turn is waiting for permission/)
	await waits.locator('a').click()
	await page.waitForURL(/\/permissions\/R1\/P1/)
	await onRecord(page)
	assert.match((await page.locator('h1').textContent()) ?? '', /Chat message R1 asks to run a command/)
	assert.match((await page.locator('.sp-options').textContent()) ?? '', /for this chat/)
	assert.deepEqual(await page.locator('.sp-options [data-option] kbd').allTextContents(), [
		'1',
		'2',
		'3',
		'4',
		'5',
		'6',
	])
	await page.keyboard.press('1')
	await state('R1', 'answered')
	assert.equal(read((reading) => openPermissions(reading)).length, 0)
	await page.waitForURL(details)
	await page.locator('[data-key="reply"]').waitFor()
})

test('text from the model with markup shows as text', browserTest, async (t) => {
	const { page, url, state } = await prepare(t, {
		request: { result: '<b>bold</b> <img src=x onerror="window.hit=1"> and <script>window.hit=2</script>' },
	})
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await onRow(page)
	await askByKeys(page, '<i>question</i>')
	await state('R1', 'answered')
	await page.goto(url('/requests/R1'))
	await page.locator('[data-key="reply"]').waitFor()
	assert.equal(
		await page.locator('[data-key="reply"] b, [data-key="reply"] img, [data-key="reply"] script').count(),
		0
	)
	assert.match((await page.locator('[data-key="reply"]').textContent()) ?? '', /<b>bold<\/b> <img src=x/)
	assert.equal(await page.locator('[data-key="asked"] i').count(), 0)
	assert.equal(await page.evaluate(() => (window as unknown as { hit?: number }).hit), undefined)
})

test(
	'the find bar offers the ask row for text that matches nothing, and only then selects it',
	browserTest,
	async (t) => {
		const { page, url } = await prepare(t, { request: 'Done.' })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await onRow(page)
		await page.keyboard.press('/')
		await page.keyboard.type('coupons')
		await page.locator('[data-find-ask]', { hasText: 'Ask Checkmate: coupons' }).waitFor()
		assert.equal(
			await page
				.locator('[data-find-results] a[aria-selected="true"]')
				.evaluate((link) => link.hasAttribute('data-find-ask')),
			false
		)
		const rows = await page.locator('[data-find-results] li').count()
		assert(rows > 2, `${rows} rows`)
		for (let step = 1; step < rows; step++) await page.keyboard.press('ArrowDown')
		assert.equal(
			await page
				.locator('[data-find-results] a[aria-selected="true"]')
				.evaluate((link) => link.hasAttribute('data-find-ask')),
			true
		)
		assert.equal((await page.locator('[data-find-enter]').textContent())?.trim(), 'Ask')
		assert.match(
			(await page.locator('[data-find-note]').textContent()) ?? '',
			/starts Claude Code on this computer/
		)
		await page.keyboard.press('Escape')
		await page.keyboard.press('/')
		await page.locator('[data-find-input]').fill('chats')
		await page.locator('[data-find-results] a[href="/chats"]:not([data-find-ask])').waitFor()
	}
)

test(
	'the stop dialog and the follow-up find bar of the message details open and close 20 times in a row',
	browserTest,
	async (t) => {
		const { page, url, state } = await prepare(t, { request: hanging })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await onRow(page)
		await askByKeys(page, 'stay running')
		await state('R1', 'running')
		await page.goto(page.url() + '/messages/R1')
		await onRecord(page)
		const address = page.url()
		for (let round = 0; round < 20; round++) {
			await page.keyboard.press('1')
			await page.locator('dialog[data-confirm][open]').waitFor()
			await page.keyboard.press('Escape')
			await page.locator('dialog[data-confirm]').waitFor({ state: 'hidden' })
			await page.waitForFunction(() => !window.history.state?.layer)
			assert.equal(page.url(), address, `round ${round}`)
		}
		assert.equal((await page.locator('[data-region="request-link"]').textContent())?.trim(), 'Chat · working')
		await page.keyboard.press('1')
		await page.locator('dialog[data-confirm][open]').waitFor()
		await page.keyboard.press('Enter')
		await state('R1', 'stopped')
		await page.locator('[data-toast]').waitFor()
		await onRecord(page)
		await page.locator('.sp-options [data-ask-follow]').waitFor()
		for (let round = 0; round < 20; round++) {
			await page.keyboard.press('1')
			await page.locator('[data-find][open]').waitFor()
			await page.keyboard.press('Escape')
			await page.locator('[data-find]').waitFor({ state: 'hidden' })
			await page
				.waitForFunction(() => !window.history.state?.layer, null, { timeout: 2000 })
				.catch(() => assert.fail(`follow-up round ${round}: ${JSON.stringify([page.url(), address])}`))
			assert.equal(page.url(), address, `follow-up round ${round}`)
		}
	}
)

test(
	'message details keep their highlight and its keys while the activity and the state change live',
	browserTest,
	async (t) => {
		const { page, url, read } = await prepare(t, {})
		const id = read((reading) =>
			askRequest(reading, 'qa-lead', { text: 'watch me', context: { planId: null, record: null } })
		)
		read((reading) => setRequestState(reading, id, 'running'))
		await page.goto(url(`/requests/${id}`))
		await onRecord(page)
		const keep = async (what: string) => {
			assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-sub].hl')), true, what)
		}
		read((reading) => addRequestActivity(reading, id, 'Bash: one'))
		await page.locator('.sp-activity li').waitFor()
		await keep('after the first line')
		read((reading) => addRequestActivity(reading, id, 'Bash: two'))
		await page.locator('.sp-activity li').nth(1).waitFor()
		assert.deepEqual(await page.locator('.sp-activity li').allTextContents(), ['Bash: one', 'Bash: two'])
		await keep('after the second line')
		read((reading) => setRequestState(reading, id, 'answered', { reply: 'Done.', changes: [] }))
		await page.locator('[data-key="reply"]').waitFor()
		await keep('after the reply')
		assert.deepEqual(await page.locator('.sp-options [data-option] kbd').allTextContents(), ['1', '2'])
		await page.keyboard.press('1')
		await page.locator('[data-find][open]').waitFor()
		await page.keyboard.press('Escape')
	}
)
