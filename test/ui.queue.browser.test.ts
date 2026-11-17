import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { mergedClaims, needsYou, operationLog } from '../plugin/src/views.ts'
import { decideClaim } from '../plugin/src/journal.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { checkmate, focusedKey, launchWith, open, skip, stop } from './browser.ts'

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
			const small = await page.evaluate(() =>
				[...document.querySelectorAll('body *')]
					.filter((element) =>
						[...element.childNodes].some((node) => node.nodeType === 3 && node.textContent!.trim())
					)
					.filter((element) => (element as HTMLElement).offsetParent !== null)
					.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12)
					.map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
			)
			assert.deepEqual(small, [], `${path} has text below 12 px at ${width}`)
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

test(
	'the exploration page shows explorers and phases, keeps the selection while it updates, and opens files',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await open(t)
		await fits(page, url('/explorations/x-9'))
		await fits(page, url('/explorations/x-1?item=explorer%3Aa1'))
		await fits(page, url('/explorations/x-6?item=phase%3Arecord'))
		let loads = 0
		page.on('load', () => loads++)
		await page.goto(url('/explorations/x-9'))
		await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
		await page.locator('[data-key="raw:r1/D1"]', { hasText: 'defect, not merged' }).waitFor()
		await page.locator('[data-key="explorer:r1"]').click()
		await page.locator('.q-detail .q-h', { hasText: 'Explorer r1' }).waitFor()
		assert.equal(new URL(page.url()).searchParams.get('item'), 'explorer:r1')
		await page.keyboard.press('j')
		await page.locator('.q-detail .q-h', { hasText: 'Explorer r2' }).waitFor()
		assert.equal(new URL(page.url()).searchParams.get('item'), 'explorer:r2')
		await checkmate(workspace, [
			'explore',
			'done',
			'x-9',
			'r1',
			'test',
			'--agent',
			'agent-r1',
			'--activity',
			'Tested the coupons.',
		])
		await page.locator('[data-key="explorer:r1"]', { hasText: 'test: Tested the coupons.' }).waitFor()
		assert.equal(await selected(page), 'explorer:r2')
		assert.equal(await page.locator('.q-detail .q-h').textContent(), 'Explorer r2')
		assert.equal(loads, 1)

		await page.goto(url('/explorations/x-1?item=explorer%3Aa1'))
		await page.getByRole('link', { name: 'View report.md' }).click()
		const viewer = page.getByRole('dialog', { name: 'Evidence viewer' })
		await viewer.locator('[data-viewer-text]', { hasText: '# Report of a1' }).waitFor()
		assert.match((await viewer.locator('[data-viewer-download]').getAttribute('href'))!, /report\.md\?download=1$/)
		await page.keyboard.press('w')
		assert(await viewer.locator('[data-viewer-text].nowrap').isVisible())
		await page.keyboard.press('Escape')
		await viewer.waitFor({ state: 'hidden' })
		await page.getByRole('link', { name: 'View a1-D1.png' }).first().click()
		await viewer.locator('[data-viewer-image]').waitFor()
		await page.keyboard.press('+')
		await viewer.locator('[data-viewer-scale]', { hasText: '100 %' }).waitFor()
		await page.getByRole('button', { name: 'Zoom in' }).click()
		await viewer.locator('[data-viewer-scale]', { hasText: '150 %' }).waitFor()
		await page.getByRole('button', { name: 'Fit', exact: true }).click()
		await viewer.locator('[data-viewer-scale]', { hasText: 'Fit' }).waitFor()
		await page.keyboard.press('Escape')
		await viewer.waitFor({ state: 'hidden' })

		await page.goto(url('/plans/checkout@2'))
		await page.getByRole('link', { name: 'Open the live view' }).click()
		await page.locator('[data-key="phase:merge"]').click()
		await page.locator('.q-detail .q-h', { hasText: 'Phase merge' }).waitFor()
		await page.getByRole('link', { name: '← Back' }).click()
		await page.waitForURL(/\/plans\/checkout@2$/)
		await page.setViewportSize({ width: 760, height: 900 })
		await page.goto(url('/explorations/x-1?item=summary'))
		await page.getByText('Download report').click()
		const menu = await page.locator('.menu-list').boundingBox()
		assert(menu && menu.x >= 0 && menu.x + menu.width <= 760, JSON.stringify(menu))
	}
)

test('the run page lists tests, findings, and gaps, and accepts the result from the overview', { skip }, async (t) => {
	const { page, url } = await open(t)
	await fits(page, url('/runs/run-7'))
	await fits(page, url('/runs/run-7?item=test%3AT2'))
	await fits(page, url('/runs/run-7?item=coverage'))
	let loads = 0
	page.on('load', () => loads++)
	await page.goto(url('/runs/run-7'))
	await page.locator('[data-key="finding:F1"]').click()
	await page.locator('.q-detail .finding').waitFor()
	await page.locator('.q-detail .finding a[data-queue-go]').first().click()
	await page.waitForURL(/item=test%3AT2#T2\.A2$/)
	await page.locator('[data-key="T2.A2"]').waitFor()
	await page.keyboard.press('k')
	await page.waitForURL((address) => address.searchParams.get('item') === 'test:T1')
	await page.locator('[data-key="summary"]').click()
	await page.locator('[data-key="summary"]').focus()
	await page.keyboard.press('a')
	await page.keyboard.type('The defects are known.')
	await page.keyboard.press('Control+Enter')
	await page.getByText('Confirm acceptance').waitFor()
	await page.keyboard.press('Control+Enter')
	await page.getByRole('status').filter({ hasText: 'Accepted run-7' }).waitFor()
	await page.locator('[data-region="state"]', { hasText: 'accepted' }).waitFor()
	assert.match(page.url(), /\/runs\/run-7$/)
	assert.equal(loads, 1)
})

test('a fast repeated key records one decision for each item', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	const decisions = () =>
		operationLog(store, { limit: 1000 }).filter((row) => ['claim accept', 'gap answer'].includes(row.command))
	const before = decisions().length
	const claim = needsYou(store).items.find((item) => item.kind === 'claim')!
	await page.route('**/explorations/**', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 300))
		await route.continue()
	})
	await page.goto(url(`/?item=${encodeURIComponent(claim.key)}`))
	await page.keyboard.press('a')
	await page.keyboard.press('a')
	await page.keyboard.press('a')
	await page
		.getByRole('status')
		.filter({ hasText: `Accepted ${claim.planId} · ${claim.id}` })
		.waitFor()
	await page.waitForTimeout(800)
	assert.equal(decisions().length, before + 1)
})

test('a stale tab names the first decision and keeps the typed text', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	const claim = needsYou(store).items.find((item) => item.kind === 'claim')!
	await page.route('**/events*', (route) => route.abort())
	await page.goto(url(`/?item=${encodeURIComponent(claim.key)}`))
	decideClaim(store, 'other-oracle', {
		planId: claim.planId,
		claimId: claim.id,
		verdict: 'approved',
		rationale: 'Seen in tab A.',
	})
	await page.getByLabel(/^Reason/).fill('Rejecting in the stale tab.')
	await page.getByRole('button', { name: /^Reject/ }).click()
	await page.locator('.q-detail', { hasText: `${claim.id} was accepted by other-oracle.` }).waitFor()
	await page.locator('.q-detail blockquote', { hasText: 'Rejecting in the stale tab.' }).waitFor()
})

test('a form sent while the UI is stopped keeps the text and sends again later', { skip }, async (t) => {
	const { page, url, ui, workspace } = await open(t)
	await page.goto(url('/'))
	await page.getByLabel('Answer', { exact: true }).fill('Card and bank transfer only.')
	await ui.close()
	await page.getByRole('button', { name: 'Record answer' }).click()
	await page.getByRole('alert').filter({ hasText: 'Checkmate did not answer.' }).waitFor()
	assert.equal(await page.getByLabel('Answer', { exact: true }).inputValue(), 'Card and bank transfer only.')
	const again = await startUi({ workspace, port: Number(new URL(ui.url).port) })
	t.after(() => again.close())
	await page.getByRole('button', { name: 'Record answer' }).click()
	await page
		.getByRole('status')
		.filter({ hasText: /^Answered / })
		.waitFor()
})

test('the queue keeps drafts, moves at once, has one Tab stop, and checks an empty answer', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	const items = needsYou(store).items
	const detailKey = () => page.locator('[data-region="queue-detail"]').getAttribute('data-key')
	const shows = (key: string) =>
		page.waitForFunction(
			(wanted) => document.querySelector('[data-region="queue-detail"]')?.getAttribute('data-key') === wanted,
			`detail:${key}`
		)
	await page.goto(url('/'))
	const stops = await page
		.locator('[data-queue-link]')
		.evaluateAll((rows) => rows.filter((row) => (row as HTMLElement).tabIndex === 0).length)
	assert.equal(stops, 1)
	await page.locator('[data-queue-link][aria-current="true"]').focus()
	await page.keyboard.press('Tab')
	assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-queue-link]')), false)

	let posts = 0
	page.on('request', (request) => {
		if (request.method() === 'POST') posts++
	})
	await page.getByText('Accept assumption').click()
	await page.getByRole('button', { name: 'Record answer' }).click()
	assert.equal(posts, 0)
	assert.equal(await page.locator('#value:invalid').count(), 1)

	await page.getByLabel('Answer', { exact: true }).fill('Draft for the first item.')
	await page.locator('[data-queue-link][aria-current="true"]').focus()
	await page.keyboard.press('j')
	await shows(items[1].key)
	await page.keyboard.press('k')
	await shows(items[0].key)
	assert.equal(await page.getByLabel('Answer', { exact: true }).inputValue(), 'Draft for the first item.')
	await page.reload()
	assert.equal(await page.getByLabel('Answer', { exact: true }).inputValue(), 'Draft for the first item.')

	let loads = 0
	page.on('request', (request) => {
		if (request.method() === 'GET' && new URL(request.url()).searchParams.has('item')) loads++
	})
	await page.locator('[data-queue-link][aria-current="true"]').focus()
	for (let step = 0; step < 20; step++) await page.keyboard.press('j')
	assert.equal(new URL(page.url()).searchParams.get('item'), items[20].key)
	await shows(items[20].key)
	assert(loads <= 2, `${loads} loads`)
	assert.equal(await detailKey(), `detail:${items[20].key}`)

	await page.setViewportSize({ width: 700, height: 900 })
	await page.goto(url(`/?item=${encodeURIComponent(items[12].key)}`))
	await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Needs you' }).click()
	await page.locator('.q-list').waitFor()
	assert.equal(await selected(page), items[12].key)
	const box = await page.locator('[data-queue-link][aria-current="true"]').boundingBox()
	assert(box && box.y >= 0 && box.y + box.height <= 900, JSON.stringify(box))
})

test('x and shift x select several items, and one confirm records them all', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	const items = needsYou(store).items
	await fits(page, url(`/?pick=${encodeURIComponent(items[0].key)}&pick=${encodeURIComponent(items[6].key)}`))
	await fits(page, url(`/claims?pick=${encodeURIComponent(items[6].key)}`))
	let loads = 0
	page.on('load', () => loads++)
	await page.goto(url('/'))
	await page.locator('[data-queue-link][aria-current="true"]').focus()
	await page.keyboard.press('x')
	await page.locator('.q-detail', { hasText: '1 item selected' }).waitFor()
	await page.keyboard.press('j')
	await page.keyboard.press('j')
	await page.keyboard.press('Shift+X')
	await page.locator('.q-detail', { hasText: '3 items selected' }).waitFor()
	await page.getByRole('button', { name: 'Review 3 answers' }).click()
	await page.locator('.q-detail', { hasText: 'This records Defer for 3 questions' }).waitFor()
	await page.keyboard.press('Control+Enter')
	await page.getByRole('status').filter({ hasText: 'Deferred 3 questions' }).waitFor()
	for (const item of items.slice(0, 3))
		assert.equal(
			needsYou(store).items.some((entry) => entry.key === item.key),
			false,
			item.key
		)

	assert.equal(loads, 1)
	await page.getByRole('link', { name: 'Claims', exact: true }).click()
	await page.getByLabel('State').selectOption('suspected')
	const boxes = page.locator('[data-pick]')
	await boxes.nth(0).click()
	await page.locator('.q-detail', { hasText: '1 item selected' }).waitFor()
	await boxes.nth(2).click({ modifiers: ['Shift'] })
	await page.locator('.q-detail', { hasText: '3 items selected' }).waitFor()
	await page.getByRole('button', { name: 'Reject 3 claims' }).click()
	await page.getByRole('alert').filter({ hasText: 'Write a short reason for the reject.' }).waitFor()
	await page.getByLabel(/^Reason for 3 claims/).fill('Known and intended.')
	await page.getByRole('button', { name: 'Reject 3 claims' }).click()
	await page.locator('.q-detail', { hasText: 'This records Reject for 3 claims' }).waitFor()
	await page.getByRole('button', { name: 'Reject 3 claims' }).click()
	await page.getByRole('status').filter({ hasText: 'Rejected 3 claims' }).waitFor()
	assert.equal(loads, 2)
})

test('Plans, Runs, and Log fit at 900 and 1440 in both themes', { skip }, async (t) => {
	const { page, url } = await open(t)
	for (const path of ['/plans', '/runs', '/log', '/log?sort=actor&dir=asc&size=100', '/plans?q=nothing'])
		await fits(page, url(path))
})
