import test from 'node:test'
import assert from 'node:assert/strict'
import { seedVolume } from '../scripts/ui-volume.ts'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { saveModels } from '../plugin/src/settings.ts'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { check, measure } from './layout.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

const pages = [
	'/',
	'/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ4',
	'/plans/coupons?view=all&focus=list',
	'/plans/coupons?view=area%3ACodes',
	'/plans/coupons?view=all&item=c%3Ak1%2FD1',
	'/plans/checkout?view=needs&focus=list',
	'/explorations/x-9',
	'/runs/run-7',
	'/runs',
	'/log',
	'/plans/checkout@2',
	'/plans/checkout@2/edit',
	'/settings/targets/shop-local',
	'/runs/run-7?item=finding%3AF1',
	'/plans/account@7/edit',
	'/settings/targets',
	'/explorations/x-1?item=explorer%3Aa1',
	'/plans/basket/request',
	'/plans/checkout@2/gaps/G2',
	'/actor',
	'/activity',
	'/activity?size=25&page=1',
	'/explorations/x-14',
	'/explorations/x-14?item=explorer%3Aa1',
	'/explorations/x-15',
	'/explorations/x-17',
	'/explorations/x-16',
	'/settings/harness',
	'/plans/login',
	'/plans/account',
	'/new',
	'/setup',
]

test('all pages fit at a narrow touch width', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const path of pages) await check(page, url(path), 400, 'light')
})

test('wide keyboard navigation and contrast remain usable', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const path of pages) await check(page, url(path), 1440, 'dark')

	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await page.locator('[data-panel]:not([hidden]) [data-act="test"]').first().click()
	await page.locator('dialog[open]').waitFor()
	assert.deepEqual(await page.evaluate(measure, false), [])
	await page.route('**/*.css', async (route) => {
		const response = await route.fetch()
		const css = await response.text()
		await route.fulfill({ response, body: `${css}\n.sp-row > * { color: rgb(120, 120, 120) !important; }` })
	})
	await page.reload()
	assert((await page.evaluate(measure, false)).some((problem) => problem.includes('contrast')))
	await page.unroute('**/*.css')

	await page.goto(url('/plans/coupons?view=all&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const boxes = () =>
		page.evaluate(() =>
			(() => {
				const list = document.querySelector('[data-panel]:not([hidden]) .sp-list')!.getBoundingClientRect()
				return [...document.querySelectorAll('[data-panel]:not([hidden]) [data-row]')].map((row) => {
					const box = row.getBoundingClientRect()
					return `${(box.top - list.top).toFixed(1)}:${box.height.toFixed(1)}`
				})
			})()
		)
	const first = await boxes()
	for (let step = 0; step < 20; step++) {
		await page.keyboard.press('ArrowDown')
		assert.deepEqual(await boxes(), first, `after ${step + 1} ArrowDown keys`)
	}
})

test('coding harness choice is available and saved from Settings', browserTest, async (t) => {
	const { page, url } = await open(t, {}, { ...process.env, CHECKMATE_HARNESS: undefined })
	await page.goto(url('/settings/harness'))
	await page.getByLabel('Program for this workspace').selectOption('pi')
	await page.getByRole('button', { name: 'Save the program' }).click()
	assert.equal(await page.getByLabel('Program for this workspace').inputValue(), 'pi')
	assert.match((await page.locator('#harness-program').locator('..').textContent()) ?? '', /Pi/)
	await page.reload()
	assert.equal(await page.getByLabel('Program for this workspace').inputValue(), 'pi')
})

test('model choices are searchable, preserve unavailable values, and retry discovery', browserTest, async (t) => {
	const { page, url, workspace } = await open(t, {}, { ...process.env, CHECKMATE_HARNESS: undefined })
	const store = openStore(workspace)
	try {
		saveModels(store, 'qa-lead', 'claude', 'sonnet', 'retired')
	} finally {
		closeStore(store)
	}
	let fail = false
	await page.route('**/settings/harness/models?*', (route) =>
		route.fulfill(
			fail
				? { status: 503, json: { error: 'Could not load models. Try again.' } }
				: {
						json: {
							models: [
								{ value: 'sonnet', label: 'Sonnet', effortLevels: ['low', 'medium', 'high'] },
								{ value: 'opus', label: 'Opus', effortLevels: ['low', 'high', 'max'] },
								{ value: 'haiku', label: 'Haiku' },
							],
						},
					}
		)
	)
	await page.goto(url('/settings/harness'))
	await page.getByText('3 models available.', { exact: false }).waitFor()
	assert.equal(await page.getByLabel('Model for testers').inputValue(), 'retired')
	assert.equal(await page.getByLabel('Model for chats').inputValue(), 'sonnet')
	assert.equal(await page.getByLabel('Reasoning effort for testers').isVisible(), false)
	assert.equal(
		await page.getByLabel('Reasoning effort for chats').locator('option:checked').textContent(),
		'Default (medium)'
	)
	assert.match(
		(await page.locator('[data-model-unavailable="tester-model"]').textContent()) ?? '',
		/not in the current list/
	)
	await page.getByLabel('Filter models').fill('opus')
	assert.equal(await page.locator('#tester-model option[value="retired"]').count(), 1)
	await page.getByLabel('Model for testers').selectOption('opus')
	const effort = page.getByLabel('Reasoning effort for testers')
	assert.equal(await effort.locator('option[value="medium"]').count(), 0)
	await effort.selectOption('max')
	await page.getByLabel('Filter models').fill('haiku')
	await page.getByLabel('Model for chats').selectOption('haiku')
	await page.getByRole('button', { name: 'Save models' }).click()
	assert.equal(await page.getByLabel('Model for testers').inputValue(), 'opus')
	assert.equal(await page.getByLabel('Model for chats').inputValue(), 'haiku')
	assert.equal(await page.getByLabel('Reasoning effort for chats').isVisible(), false)
	await effort.waitFor({ state: 'visible' })
	assert.equal(await effort.inputValue(), 'max')
	fail = true
	await page.getByRole('button', { name: 'Refresh models' }).click()
	await page.getByText('Could not load models. Try again.').waitFor()
	assert.equal(await page.getByLabel('Model for testers').inputValue(), 'opus')
	fail = false
	await page.getByRole('button', { name: 'Refresh models' }).click()
	await page.getByText('3 models available.', { exact: false }).waitFor()
})
