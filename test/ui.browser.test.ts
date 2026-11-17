import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore, planDetail } from '../plugin/src/index.ts'
import { human } from '../scripts/ui-demo.ts'
import { approval, launch, open, skip, stop } from './browser.ts'

test.before(launch)
test.after(stop)

test('the shortcuts panel opens by key and a #decide or #answer link focuses its form', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/inbox'))
	await page.waitForURL(url('/'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.keyboard.press('?')
	await page.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor()
	await page.keyboard.press('Escape')
	await page.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor({ state: 'hidden' })
	await page.goto(url('/plans'))
	await page.keyboard.press('/')
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'q')
	await page.goto(url('/plans/search@1#decide'))
	await page.waitForFunction(() => document.activeElement?.id === 'rationale')
	await page.waitForTimeout(300)
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'rationale')
	await page.goto(url('/plans/checkout@2/gaps/G2#answer'))
	await page.waitForFunction(() => document.activeElement?.closest('#answer') !== null)
	await page.waitForTimeout(300)
	assert(await page.evaluate(() => document.activeElement?.closest('#answer') !== null))
	await page.goto(url('/runs/run-7'))
	await page.evaluate(() => (location.hash = '#decide'))
	await page.waitForFunction(() => document.activeElement?.id === 'rationale')
})

test('a gap answer goes from the form to Needs you', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/checkout@2/gaps/G2#answer'))
	const record = page.getByRole('button', { name: 'Record answer' })
	assert(await record.isDisabled())
	assert(await page.getByLabel(/^Source/).isVisible())
	await page.getByText('Defer', { exact: true }).click()
	assert(!(await page.getByLabel(/^Source/).isVisible()))
	await page.getByText(/Defer moves the gap out of this scope/).waitFor()
	await page.getByLabel('Answer', { exact: true }).fill('Refunds are out of scope for this release.')
	assert(await record.isDisabled())
	await page.getByLabel('Rationale').fill('Product owner moved refunds to the next release.')
	assert(await record.isEnabled())
	await record.click()
	await page.waitForURL(url('/'))
	await page.getByRole('status').filter({ hasText: 'Answered checkout · G2' }).waitFor()
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	assert.deepEqual(
		planDetail(store, 'checkout').pendingDecisions.map((item) => [item.gapId, item.kind, item.actor]),
		[['G2', 'defer', human]]
	)
})

test('approval confirms in place without a modal', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	let dialogs = 0
	page.on('dialog', () => dialogs++)
	await page.goto(url('/plans/search@1'))
	const approve = page.getByRole('button', { name: 'Approve search@1' })
	assert(await approve.isDisabled())
	await page.getByLabel('Rationale').fill('Both tests have clear checks.')
	await approve.click()
	await page.getByText('Approve search@1. Runs can then use this revision.').waitFor()
	assert.equal(new URL(page.url()).pathname, '/plans/search@1')
	assert.equal(approval(workspace, 'search').state, 'pending')
	await page.getByRole('button', { name: 'Back' }).click()
	await approve.click()
	await page.getByRole('button', { name: 'Confirm approval' }).click()
	await page.getByRole('status').filter({ hasText: 'Approved search@1' }).waitFor()
	assert.equal(approval(workspace, 'search').state, 'approved')
	assert.equal(dialogs, 0)
})

test('forms and list filters work with JavaScript disabled', { skip }, async (t) => {
	const { page, url, workspace } = await open(t, { javaScriptEnabled: false })
	await page.goto(url('/plans/search@1'))
	await page.getByLabel('Rationale').fill('Reviewed without scripts.')
	await page.getByRole('button', { name: 'Approve search@1' }).click()
	await page.getByRole('button', { name: 'Confirm approval' }).click()
	await page.getByRole('status').filter({ hasText: 'Approved search@1' }).waitFor()
	assert.equal(approval(workspace, 'search').state, 'approved')
	await page.goto(url('/plans/checkout@2/gaps/G2'))
	await page.getByText('Accept assumption', { exact: true }).click()
	await page.getByLabel('Answer', { exact: true }).fill('Delivered orders refund for 14 days.')
	await page.getByLabel('Rationale').fill('Matches the policy draft.')
	await page.getByRole('button', { name: 'Record answer' }).click()
	await page.getByRole('status').filter({ hasText: 'Answered checkout · G2' }).waitFor()
	await page.goto(url('/runs'))
	await page.getByLabel('Status').selectOption('started')
	await page.getByRole('button', { name: 'Filter' }).click()
	await page.waitForURL(/\/runs\?.*status=started/)
	assert.deepEqual(
		await page
			.locator('[data-key^="run:"]')
			.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.key)),
		['run:run-8']
	)
	await page.getByLabel('Sort by').selectOption('run')
	await page.getByLabel('Order').selectOption('asc')
	await page.getByRole('button', { name: 'Filter' }).click()
	await page.waitForURL(/\/runs\?.*status=started.*sort=run&dir=asc/)
})

test('a plan edit saves in place and records the actor', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/search@1'))
	await page.getByRole('link', { name: 'Edit plan' }).click()
	await page.getByText('Edits change this revision in place.').waitFor()
	await page.getByText('Saving as qa-lead.').first().waitFor()
	await page.locator('#edit-T2').getByLabel('Title').fill('Helpful empty state')
	await page.getByRole('checkbox', { name: 'T2 covers S1' }).check()
	await page.getByRole('button', { name: 'Save changes' }).first().click()
	await page.waitForURL(/\/plans\/search@1$/)
	await page.getByRole('status').filter({ hasText: 'Saved search@1 in place' }).waitFor()
	await page.getByRole('heading', { name: 'Helpful empty state' }).waitFor()
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	assert.deepEqual(planDetail(store, 'search').plan.tests[1].requirementIds, ['S1', 'S2'])
})

test('the plan editor shows a long check in full at phone width', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 390, height: 844 } })
	await page.goto(url('/plans/search@1/edit'))
	const check = page.locator('#edit-T1 textarea[name$=".check"]').first()
	await check.fill(
		'The result list shows every product whose name or description contains the query, in relevance order.'
	)
	const size = await check.evaluate((area) => ({ client: area.clientHeight, scroll: area.scrollHeight }))
	assert(size.client >= size.scroll, JSON.stringify(size))
	assert(size.client > 40, JSON.stringify(size))
})

test('Bring into plan on the run page adds the run gap to the plan', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/runs/run-7?item=gap%3AG4'))
	await page.getByRole('button', { name: 'Bring into plan' }).click()
	await page.getByRole('status').filter({ hasText: 'Brought G4 into checkout@3' }).waitFor()
	await page.getByRole('link', { name: 'checkout@3' }).first().waitFor()
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	assert(planDetail(store, 'checkout').plan.gaps.some((gap) => gap.id === 'G4'))
})

test('the evidence viewer keeps focus inside and Esc gives it back', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/runs/run-7?item=test%3AT1'))
	await page.locator('[data-key="T1.A1"] summary').click()
	const link = page.locator('a[data-view]:visible').first()
	await link.focus()
	await page.keyboard.press('Enter')
	const viewer = page.getByRole('dialog', { name: 'Evidence viewer' })
	await viewer.waitFor()
	assert.equal(await viewer.getAttribute('aria-modal'), 'true')
	assert.equal(await page.evaluate(() => document.querySelector('main')?.inert), true)
	const inside = () => page.evaluate(() => document.querySelector('[data-viewer]')?.contains(document.activeElement))
	for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
		await page.keyboard.press(key)
		assert(await inside(), key)
	}
	await page.keyboard.press('Escape')
	await viewer.waitFor({ state: 'hidden' })
	assert.equal(await page.evaluate(() => document.querySelector('main')?.inert), false)
	assert(await link.evaluate((element) => element === document.activeElement))
})

test('the JSON editor shows the reason field when the JSON removes a test', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/checkout@2/edit'))
	await page.getByText('Edit as JSON').click()
	const reason = page.getByLabel('Reason for removal')
	assert(!(await reason.isVisible()))
	const json = page.getByLabel('Plan candidate JSON')
	const candidate = JSON.parse(await json.inputValue())
	candidate.tests = candidate.tests.filter((test: { id: string }) => test.id !== 'T3')
	await json.fill(JSON.stringify(candidate, null, 2))
	await reason.waitFor()
	await page.getByText('The edit removes T3.').waitFor()
	await reason.fill('The refund flow moves to the next release.')
	await page.locator('details.edit-json').getByRole('button', { name: 'Save as checkout@3' }).click()
	await page.waitForURL(/\/plans\/checkout@3$/)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	assert.equal(
		planDetail(store, 'checkout').plan.removals?.[0].rationale,
		'The refund flow moves to the next release.'
	)
})
