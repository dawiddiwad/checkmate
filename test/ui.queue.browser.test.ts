import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { mergedClaims, needsYou } from '../plugin/src/views.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { focusedKey, launchWith, open, skip, stop } from './browser.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

async function fits(page: Page, path: string) {
	for (const colorScheme of ['light', 'dark'] as const)
		for (const width of [1440, 900]) {
			await page.setViewportSize({ width, height: 900 })
			await page.emulateMedia({ colorScheme })
			await page.goto(path)
			await page.locator('main').waitFor()
			const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
			assert(wide <= 0, `${path} scrolls ${wide} px sideways at ${width} in ${colorScheme}`)
			const clipped = await page.evaluate(
				() =>
					[...document.querySelectorAll('main pre')].filter((pre) => pre.scrollWidth > pre.clientWidth + 1)
						.length
			)
			assert.equal(clipped, 0, `${path} clips a preformatted block at ${width}`)
		}
	await page.setViewportSize({ width: 1440, height: 900 })
}

const selected = (page: Page) => page.locator('[data-queue]').getAttribute('data-selected')

async function sent(page: Page, before: string | null) {
	await page.waitForFunction(
		(key) => document.querySelector('[data-queue]')?.getAttribute('data-selected') !== key,
		before
	)
}

async function atTop(page: Page) {
	assert.equal(await page.evaluate(() => window.scrollY), 0)
	assert(await page.locator('.q-detail .q-crumbs').isVisible())
}

test(
	'Needs you decides claims, questions, plans, and results by key and by mouse without a page load',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await open(t)
		const store = openStore(workspace)
		t.after(() => closeStore(store))
		await fits(page, url('/?item=claim%3Acheckout%3Aa1%2FD1'))
		const items = needsYou(store).items
		const claims = items.filter((item) => item.kind === 'claim')
		const questions = items.filter((item) => item.kind === 'question' && item.group === 'blocking')
		let loads = 0
		page.on('load', () => loads++)
		await page.goto(url('/'))
		await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
		assert.equal(await focusedKey(page), items[0].key)
		await page.keyboard.press('j')
		await page.waitForURL((address) => address.searchParams.get('item') === items[1].key)
		await page.keyboard.press('k')
		await page.waitForURL((address) => address.searchParams.get('item') === items[0].key)

		let before = await selected(page)
		await page.keyboard.press('c')
		await page.keyboard.type('Card and bank transfer only.')
		await page.keyboard.press('Control+Enter')
		await page
			.getByRole('status')
			.filter({ hasText: `Answered ${questions[0].planId} · ${questions[0].id}` })
			.waitFor()
		await sent(page, before)
		await atTop(page)

		before = await selected(page)
		await page.keyboard.press('d')
		await sent(page, before)
		assert.equal(await page.locator(`[data-key="${questions[1].key}"]`).count(), 0)

		await page.getByText('Add source and reason').click()
		await page.getByText('Accept assumption').click()
		await page.getByLabel('Answer', { exact: true }).fill('Yes, for all customers.')
		before = await selected(page)
		await page.getByRole('button', { name: 'Record answer' }).click()
		await sent(page, before)
		assert(await page.locator('details[data-more]').evaluate((details) => (details as HTMLDetailsElement).open))

		await page.locator(`[data-key="${claims[0].key}"]`).click()
		await page.waitForURL((address) => address.searchParams.get('item') === claims[0].key)
		await page.locator(`[data-key="${claims[0].key}"]`).focus()
		before = await selected(page)
		await page.keyboard.press('a')
		await page
			.getByRole('status')
			.filter({ hasText: `Accepted ${claims[0].planId} · ${claims[0].id}` })
			.waitFor()
		await sent(page, before)
		await atTop(page)
		assert.equal(await focusedKey(page), claims[1].key)

		await page.keyboard.press('r')
		assert.equal(await page.evaluate(() => document.activeElement?.id), 'rationale')
		await page.keyboard.type('Intended behaviour.')
		before = await selected(page)
		await page.keyboard.press('Control+Enter')
		await sent(page, before)
		assert.equal(mergedClaims(store, claims[1].planId).find((item) => item.id === claims[1].id)?.state, 'rejected')

		before = await selected(page)
		await page.getByRole('button', { name: /^Reject/ }).click()
		assert.equal(await selected(page), before)
		assert.equal(await page.evaluate(() => document.activeElement?.id), 'rationale')
		await page.getByRole('button', { name: /^Accept as a defect/ }).click()
		await sent(page, before)

		const plan = items.find((item) => item.kind === 'plan')!
		await page.locator(`[data-key="${plan.key}"]`).click()
		await page.getByLabel('Rationale').fill('The tests cover the request.')
		await page.getByRole('button', { name: `Approve ${plan.id}` }).click()
		before = await selected(page)
		await page.getByRole('button', { name: 'Confirm approval' }).click()
		await page
			.getByRole('status')
			.filter({ hasText: `Approved ${plan.id}` })
			.waitFor()
		await sent(page, before)

		const result = items.find((item) => item.kind === 'result')!
		await page.locator(`[data-key="${result.key}"]`).click()
		await page.locator(`[data-key="${result.key}"]`).focus()
		await page.keyboard.press('a')
		await page.keyboard.type('The defects are known.')
		await page.keyboard.press('Control+Enter')
		await page.getByText('Confirm acceptance').waitFor()
		before = await selected(page)
		await page.keyboard.press('Control+Enter')
		await page
			.getByRole('status')
			.filter({ hasText: `Accepted ${result.id}` })
			.waitFor()
		await sent(page, before)
		assert.equal(loads, 1)
	}
)

test('on a narrow window the list and the item take turns, and the breadcrumb goes back', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 700, height: 900 } })
	await page.goto(url('/'))
	const detail = page.locator('.q-detail')
	assert(!(await detail.isVisible()))
	await page.locator('[data-queue-link]').nth(2).click()
	await page.locator('.q-detail .q-h').waitFor()
	assert(!(await page.locator('.q-list').isVisible()))
	await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Needs you' }).click()
	await page.locator('.q-list').waitFor()
	assert(!(await detail.isVisible()))
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})

test('the claims list finds a defect of last week and shows its evidence in two clicks', { skip }, async (t) => {
	const { page, url } = await open(t)
	await fits(page, url('/claims?item=claim%3Acheckout%3Aa1%2FD1'))
	await page.goto(url('/'))
	let loads = 0
	page.on('load', () => loads++)
	await page.getByRole('link', { name: 'Claims', exact: true }).click()
	await page.getByLabel('Found').selectOption('7')
	await page.getByLabel('Search the claims').fill('visible focus')
	await page.waitForURL((address) => address.searchParams.get('q') === 'visible focus')
	const row = page.locator('[data-queue-link]').first()
	await row.click()
	await page.locator('.q-detail .ev').first().waitFor()
	assert.equal(loads, 1)
	assert.match(page.url(), /since=7/)
	await page.goBack()
	await page.waitForURL((address) => !address.searchParams.has('item'))
	await page.getByLabel('State').selectOption('suspected')
	await page.locator('[data-queue-link]').first().click()
	const key = await selected(page)
	await page.getByRole('button', { name: /^Accept as a defect/ }).click()
	await page
		.getByRole('status')
		.filter({ hasText: /^Accepted / })
		.waitFor()
	await sent(page, key)
	assert.equal(await page.locator(`[data-key="${key}"]`).count(), 0)
	await page.getByLabel('State').selectOption('accepted')
	await page.locator(`[data-key="${key}"]`).click()
	await page.locator('.q-detail', { hasText: 'Decision' }).waitFor()
})

test('the plan page opens what needs the person and folds the rest', { skip }, async (t) => {
	const { page, url } = await open(t)
	await fits(page, url('/plans/checkout@2'))
	await fits(page, url('/plans/basket@1'))
	await page.goto(url('/plans/checkout@2'))
	const unfolded = (id: string) =>
		page.locator(`details.fold:has(#${id})`).evaluate((details) => (details as HTMLDetailsElement).open)
	assert.equal(await unfolded('claims'), true)
	assert.equal(await unfolded('questions'), true)
	assert.equal(await unfolded('tests'), false)
	assert.equal(await unfolded('history'), false)
	await page.getByRole('link', { name: /^Tests/ }).click()
	assert.equal(await unfolded('tests'), true)
	await page.locator('[data-region="claims"] a.mono[href^="/claims"]').first().click()
	await page.waitForURL(/\/claims\?plan=checkout&item=/)
	await page.locator('.q-detail .q-h').waitFor()
	await page.goBack()
	await page.waitForURL(/\/plans\/checkout@2/)
	await page.getByRole('link', { name: /Decide \d+ items in Needs you/ }).click()
	await page.waitForURL(/\/\?plan=checkout/)
})

test('old pages have a breadcrumb, and Back returns to the list where the person was', { skip }, async (t) => {
	const { page, url } = await open(t)
	for (const path of [
		'/explorations/x-1',
		'/runs/run-7',
		'/explorations/x-1/claims/a1/D1',
		'/plans/checkout@2/gaps/G2',
	])
		await fits(page, url(path))
	await page.goto(url('/?plan=checkout&item=claim%3Acheckout%3Aa1%2FD1'))
	await page.getByRole('link', { name: 'Open full page' }).click()
	await page.waitForURL(/\/explorations\/x-1\/claims\/a1\/D1$/)
	await page.getByRole('link', { name: '← Back' }).click()
	await page.waitForURL((address) => address.searchParams.get('item') === 'claim:checkout:a1/D1')
	assert.equal(new URL(page.url()).searchParams.get('plan'), 'checkout')
})
