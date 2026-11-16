import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { mergedClaims, needsYou } from '../plugin/src/views.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { focusedKey, launchWith, open, skip, stop } from './browser.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

test(
	'Needs you moves with j and k, and decides a claim and answers a question without a page load',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await open(t, { viewport: { width: 1440, height: 900 } })
		const store = openStore(workspace)
		t.after(() => closeStore(store))
		const items = needsYou(store).items
		const claims = items.filter((item) => item.kind === 'claim')
		const pictured = claims.findIndex((item) =>
			mergedClaims(store, item.planId)
				.find((claim) => claim.id === item.id)
				?.evidence.some((file) => 'path' in file && file.path.endsWith('.png'))
		)
		const [claim, after] = claims.slice(pictured)
		const blocking = items.filter((item) => item.group === 'blocking' && item.kind === 'question')
		let loads = 0
		page.on('load', () => loads++)
		await page.goto(url('/'))
		await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
		assert.equal(await focusedKey(page), items[0].key)
		await page.keyboard.press('j')
		await page.waitForURL((address) => address.searchParams.get('item') === items[1].key)
		assert.equal(await focusedKey(page), items[1].key)
		await page.locator('.q-h', { hasText: items[1].title }).waitFor()
		await page.keyboard.press('k')
		await page.waitForURL((address) => address.searchParams.get('item') === items[0].key)

		await page.locator(`[data-key="${claim.key}"]`).click()
		await page.waitForURL((address) => address.searchParams.get('item') === claim.key)
		await page.locator('.q-detail .ev-image img').first().waitFor()
		await page.locator(`[data-key="${claim.key}"]`).focus()
		await page.keyboard.press('r')
		assert.equal(await page.evaluate(() => document.activeElement?.id), 'rationale')
		assert(await page.locator('#verdict-rejected').isChecked())
		await page.keyboard.type('The steps do not show a defect.')
		await page.keyboard.press('Control+Enter')
		await page
			.getByRole('status')
			.filter({ hasText: `Rejected ${claim.planId} · ${claim.id}` })
			.waitFor()
		await page.waitForURL((address) => address.searchParams.get('item') === after.key)
		assert.equal(await focusedKey(page), after.key)
		assert.equal(await page.locator(`[data-key="${claim.key}"]`).count(), 0)
		assert.equal(mergedClaims(store, claim.planId).find((item) => item.id === claim.id)?.state, 'rejected')

		await page.locator(`[data-key="${blocking[0].key}"]`).click()
		await page.locator(`[data-key="${blocking[0].key}"]`).focus()
		await page.keyboard.press('s')
		assert.equal(await page.evaluate(() => document.activeElement?.id), 'value')
		await page.keyboard.type('Card and bank transfer only.')
		await page.getByLabel('Rationale').fill('The payment policy says so.')
		await page.keyboard.press('Control+Enter')
		await page
			.getByRole('status')
			.filter({ hasText: `Answered ${blocking[0].planId} · ${blocking[0].id}` })
			.waitFor()
		assert.equal(await page.locator(`[data-key="${blocking[0].key}"]`).count(), 0)
		assert.equal(loads, 1)
		assert.equal(await page.locator('[data-region="nav-count"]').textContent(), String(needsYou(store).urgent))
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
