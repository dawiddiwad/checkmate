import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { startUi } from '../cli/src/ui/server.ts'
import { begin, plan, ready, store } from './support.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const skip = executablePath ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'

test('list filters, sort, page size, pagination and clear update without a reload', { skip }, async (t) => {
	const opened = store(t)
	ready(opened)
	for (let index = 0; index < 30; index++) {
		plan(opened, `plan-${String(index).padStart(2, '0')}`)
		begin(opened, `run-${String(index).padStart(2, '0')}`, ['T1'], `release-${index}`)
	}
	const ui = await startUi({ workspace: opened.workspace })
	const browser = await chromium.launch({ executablePath })
	const page = await browser.newPage()
	page.setDefaultTimeout(5000)
	t.after(async () => {
		await page.close()
		await browser.close()
		await ui.close()
	})
	await page.goto(new URL('/plans', ui.url).href)
	await page.evaluate(() => {
		document.body.dataset.testNavigation = 'kept'
	})
	assert.equal(await page.locator('tbody tr').count(), 25)
	await page.locator('#q').fill('plan-')
	await page.waitForURL(/q=plan-/)
	await page.getByRole('link', { name: 'Next', exact: true }).click()
	await page.waitForURL(/page=2/)
	assert.equal(await page.locator('tbody tr').count(), 5)
	assert.equal(await page.locator('#q').inputValue(), 'plan-')
	await page.getByLabel('Rows', { exact: true }).selectOption('50')
	await page.waitForURL(/size=50/)
	assert.equal(new URL(page.url()).searchParams.get('page'), null)
	assert.equal(await page.locator('tbody tr').count(), 30)
	await page.getByRole('link', { name: 'Sort updated oldest first' }).click()
	await page.waitForURL(/order=asc/)
	assert.equal(await page.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending')
	assert.equal(await page.locator('#q').inputValue(), 'plan-')
	assert.equal(await page.locator('#size').inputValue(), '50')
	await page.getByRole('link', { name: 'Clear', exact: true }).click()
	await page.waitForURL(/\/plans$/)
	assert.equal(await page.locator('#q').inputValue(), '')
	assert.equal(await page.locator('#size').inputValue(), '25')
	assert.equal(await page.locator('tbody tr').count(), 25)
	await page.locator('#q').fill('APPROVED')
	await page.waitForURL(/q=APPROVED/)
	assert.equal(await page.locator('tbody tr').count(), 1)
	assert.equal(await page.locator('tbody tr').getAttribute('data-key'), 'plan:checkout')
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'q')
	await page.locator('#show').selectOption('awaiting_approval')
	await page.waitForURL(/show=awaiting_approval/)
	assert.equal(await page.locator('tbody tr').count(), 0)
	assert.equal(await page.locator('body').getAttribute('data-test-navigation'), 'kept')

	await page.goto(new URL('/runs', ui.url).href)
	await page.locator('#q').fill('release-29')
	await page.waitForURL(/q=release-29/)
	assert.equal(await page.locator('tbody tr').count(), 1)
	assert.equal(await page.locator('tbody tr').getAttribute('data-key'), 'run:run-29')
	await page.locator('#status').selectOption('pending')
	await page.waitForURL(/status=pending/)
	assert.equal(await page.locator('tbody tr').count(), 0)
	await page.getByRole('link', { name: 'Clear', exact: true }).click()
	await page.waitForURL(/\/runs$/)
	assert.equal(await page.locator('tbody tr').count(), 25)

	await page.goto(new URL('/log', ui.url).href)
	await page.locator('#q').fill('plan save')
	await page.waitForURL(/q=plan\+save/)
	assert.equal(await page.locator('tbody tr').count(), 25)
	assert.match(await page.locator('tbody tr').first().innerText(), /plan save/)
	await page.getByLabel('Rows', { exact: true }).selectOption('100')
	await page.waitForURL(/size=100/)
	assert.equal(await page.locator('tbody tr').count(), 31)
	await page.getByRole('link', { name: 'Sort time oldest first' }).click()
	await page.waitForURL(/order=asc/)
	assert.equal(await page.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending')
})
