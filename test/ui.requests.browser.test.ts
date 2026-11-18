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

async function closeFind(page: Page) {
	await page.keyboard.press('Escape')
	await page.locator('[data-find]').waitFor({ state: 'hidden' })
	await page.waitForFunction(() => !window.history.state?.layer)
}

async function askByKeys(page: Page, text: string) {
	await page.keyboard.press('/')
	await page.locator('[data-find]').waitFor()
	await page.keyboard.type(text)
	await page.locator('[data-find-ask][aria-selected="true"]').waitFor()
	await page.keyboard.press('Enter')
	await page.locator('[data-find-asking]:not([hidden])').waitFor()
	return (await page.locator('[data-find-asking]').textContent())!.replace('Asking… ', '')
}

test(
	'by keys: ask from the find bar, watch the activity, stop, read the reply, follow up, ask again, start over',
	browserTest,
	async (t) => {
		const { page, url, state, count, read, called, reply } = await prepare(t, { request: hanging })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await onRow(page)
		const first = await askByKeys(page, 'why does D3 fail')
		assert.equal(first, 'R1')
		assert.equal(await page.locator('[data-find-results]').isHidden(), true)
		await state('R1', 'running')
		await page.keyboard.press('Enter')
		assert.equal(count(), 1)
		await closeFind(page)
		assert.equal(new URL(page.url()).pathname, '/plans/coupons')
		const link = page.locator('[data-region="request-link"]')
		await link.waitFor()
		assert.match((await link.textContent()) ?? '', /Request R1 · running/)
		assert.equal(
			read((reading) => requestOf(reading, 'R1')!.context.planId),
			'coupons'
		)
		await link.focus()
		await page.keyboard.press('Enter')
		await page.waitForURL(url('/requests/R1'))
		await onRecord(page)
		await page.locator('.sp-activity li').first().waitFor()
		assert.match((await page.locator('.sp-activity li').first().textContent()) ?? '', /Bash: npm test/)
		assert.match((await page.locator('.sp-dhead').textContent()) ?? '', /running/)
		reply({ request: { result: 'D3 fails because the fee is added first.\n\n- fee\n- coupon', cost: 0.07 } })
		await page.keyboard.press('1')
		await page.locator('dialog[data-confirm][open]').waitFor()
		assert.match((await page.locator('[data-confirm-title]').textContent()) ?? '', /Stop request R1\?/)
		await page.keyboard.press('Enter')
		await state('R1', 'stopped')
		await page.locator('[data-toast]').waitFor()
		await onRecord(page)
		await page.locator('.sp-dhead [data-status="stopped"]').waitFor()
		assert.deepEqual(await page.locator('.sp-options [data-option] kbd').allTextContents(), ['1', '2', '3'])
		await page.keyboard.press('2')
		await page.waitForURL(url('/requests/R2'))
		await state('R2', 'answered')
		await page.locator('[data-key="reply"] li').first().waitFor()
		assert.match(
			(await page.locator('[data-key="reply"]').textContent()) ?? '',
			/D3 fails because the fee is added first\./
		)
		assert.match((await page.locator('[data-key="took"]').textContent()) ?? '', /Cost \$0\.07\./)
		assert.equal(await page.locator('.sp-options [data-option] kbd').count(), 3)
		await page.keyboard.press('1')
		await page.locator('[data-find]').waitFor()
		assert.equal(await page.locator('[data-find-input]').getAttribute('placeholder'), 'Ask a follow-up')
		await page.keyboard.type('and D4?')
		await page.locator('[data-find-ask][aria-selected="true"]').waitFor()
		assert.equal(await page.locator('[data-find-results] li').count(), 1)
		await page.keyboard.press('Enter')
		await page.locator('[data-find-asking]:not([hidden])').waitFor()
		assert.equal((await page.locator('[data-find-asking]').textContent())?.trim(), 'Asking… R3')
		await closeFind(page)
		await state('R3', 'answered')
		assert.deepEqual(
			read((reading) => requestOf(reading, 'R3')!.context),
			{ planId: null, record: { kind: 'request', id: 'R2' } }
		)
		await page.locator('[data-region="replies-link"]').waitFor()
		assert.match((await page.locator('[data-region="replies-link"]').textContent()) ?? '', /1 reply/)
		assert.equal(await page.locator('[data-region="replies-link"]').getAttribute('href'), '/requests/R3')
		called()
		await page.keyboard.press('3')
		await page.locator('[data-toast]').waitFor()
		await page.keyboard.press('/')
		await page.keyboard.type('after the new start')
		await page.locator('[data-find-ask][aria-selected="true"]').waitFor()
		await page.keyboard.press('Enter')
		await page.locator('[data-find-asking]:not([hidden])').waitFor()
		await state('R4', 'answered')
		const [last] = called()
		assert(last.args.includes('--session-id') && !last.args.includes('--resume'))
	}
)

test('by pointer: ask, stop with the dialog, and open the reply', browserTest, async (t) => {
	const { page, url, state, reply } = await prepare(t, { request: hanging })
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await page.locator('.sb-btn[data-find-open]').click()
	await page.locator('[data-find-input]').fill('explain D10 please')
	await page.locator('[data-find-ask]').click()
	await page.locator('[data-find-asking]:not([hidden])').waitFor()
	await closeFind(page)
	await page.locator('[data-region="request-link"]').click()
	await page.waitForURL(url('/requests/R1'))
	reply({ request: { result: 'Done by pointer.' } })
	await page.getByRole('button', { name: '1: Stop the request…' }).click()
	await page.locator('[data-confirm-yes]').click()
	await state('R1', 'stopped')
	await page.getByRole('button', { name: '2: Ask again' }).click()
	await page.waitForURL(url('/requests/R2'))
	await state('R2', 'answered')
	await page.locator('[data-key="reply"]').waitFor()
	await page.getByRole('button', { name: '1: Ask a follow-up' }).click()
	await page.locator('[data-find]').waitFor()
	await closeFind(page)
	await page.getByRole('button', { name: '3: New conversation' }).click()
	await page.locator('[data-toast]').waitFor()
})

test('two unread replies fill the list, Right opens one, Left and Back return to the list', browserTest, async (t) => {
	const { page, url, state, ask } = await prepareWithAsks(t)
	await ask(['zzz one', 'zzz two'])
	await state('R1', 'answered')
	await state('R2', 'answered')
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	const bar = page.locator('[data-region="replies-link"]')
	await bar.waitFor()
	assert.match((await bar.textContent()) ?? '', /2 replies/)
	assert.equal(await bar.getAttribute('href'), '/requests')
	await bar.click()
	await page.waitForURL(url('/requests'))
	await onRow(page)
	assert.match((await page.locator('.sp-gh').first().textContent()) ?? '', /Not read\s*2/)
	assert.deepEqual(
		await page.locator('[data-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-key'))),
		['request:R2', 'request:R1']
	)
	const first = await page.locator('[data-row]').first().textContent()
	assert.match(first ?? '', /zzz two/)
	assert.match(first ?? '', /Reply to zzz two\./)
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(url('/requests/R1'))
	await onRecord(page)
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL(url('/requests'))
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('Enter')
	await page.waitForURL(url('/requests/R1'))
	await page.goBack()
	await page.waitForURL(url('/requests'))
	assert.match((await page.locator('.sp-gh').first().textContent()) ?? '', /Not read\s*1/)
})

async function prepareWithAsks(t: TestContext) {
	const app = await prepare(t, { request: { result: 'Reply to one question.' } })
	const ask = async (texts: string[]) => {
		for (const [index, text] of texts.entries()) {
			app.reply({ request: { result: `Reply to ${text}.` } })
			await app.page.goto(app.url('/plans/coupons?view=all&focus=list'))
			await onRow(app.page)
			await app.page.keyboard.press('/')
			await app.page.keyboard.type(text)
			await app.page.locator('[data-find-ask][aria-selected="true"]').waitFor()
			await app.page.keyboard.press('Enter')
			await app.page.locator('[data-find-asking]:not([hidden])').waitFor()
			await app.state(`R${index + 1}`, 'answered')
		}
	}
	return { ...app, ask }
}

test('a failed request shows the reason and one option, Ask again', browserTest, async (t) => {
	const { page, url, state } = await prepare(t, { request: '!crash' })
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await onRow(page)
	await askByKeys(page, 'this will fail')
	await state('R1', 'failed')
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
})

test('a permission request of a request is answered from its record', browserTest, async (t) => {
	const asking = { name: 'Bash', input: { command: 'npm view left-pad' }, rule: 'npm view *' }
	const { page, url, state, read } = await prepare(t, { request: { ask: [asking], result: 'Looked it up.' } })
	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await onRow(page)
	await askByKeys(page, 'look up the package')
	await closeFind(page)
	const count = page.locator('[data-region="permissions-link"]')
	await count.waitFor()
	assert.equal((await count.textContent())?.trim(), '1 permission')
	await page.goto(url('/requests/R1'))
	await onRecord(page)
	const waits = page.locator('[data-key="waits"]')
	await waits.waitFor()
	assert.match((await waits.textContent()) ?? '', /waits for you: a permission request/)
	await waits.locator('a').click()
	await page.waitForURL(/\/permissions\/R1\/P1/)
	await onRecord(page)
	assert.match((await page.locator('h1').textContent()) ?? '', /Request R1 asks to run a command/)
	assert.match((await page.locator('.sp-options').textContent()) ?? '', /for this conversation/)
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
	await page.waitForURL(url('/requests/R1'))
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
	}
)

test(
	'the stop dialog and the follow-up find bar of the request page open and close 20 times in a row',
	browserTest,
	async (t) => {
		const { page, url, state } = await prepare(t, { request: hanging })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await onRow(page)
		await askByKeys(page, 'stay running')
		await closeFind(page)
		await state('R1', 'running')
		await page.goto(url('/requests/R1'))
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
		assert.equal((await page.locator('[data-region="request-link"]').textContent())?.trim(), 'Request R1 · running')
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
	'the request page keeps its highlight and its keys while the activity and the state change live',
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
		assert.deepEqual(await page.locator('.sp-options [data-option] kbd').allTextContents(), ['1', '2', '3'])
		await page.keyboard.press('1')
		await page.locator('[data-find][open]').waitFor()
		await page.keyboard.press('Escape')
	}
)
