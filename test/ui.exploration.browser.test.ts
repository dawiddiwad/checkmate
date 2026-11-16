import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openPlan, openStore } from '../plugin/src/index.ts'
import { mergedQuestions } from '../plugin/src/views.ts'
import { agent } from '../scripts/ui-demo.ts'
import { launch, open, skip, stop } from './browser.ts'
import { coupon, done, ended, launched, openTest, report, stacks } from './explorations.ts'

test.before(launch)
test.after(stop)

test(
	'a plan without a revision leads to the live view, which updates to the merged items that the plan page answers',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await open(t)
		const store = openStore(workspace)
		t.after(() => closeStore(store))
		openPlan(store, agent, {
			planId: 'basket',
			target: 'shop-local@1',
			request: { objective: 'Test the basket.', context: { sources: ['brief://basket'] } },
		})
		openTest(store, 'basket', 'x-1', 'b1', 'local')
		launched(store, 'x-1', 'a1')
		launched(store, 'x-1', 'a2')
		ended(store, 'x-1', 'a1', [coupon, stacks])

		await page.goto(url('/plans'))
		await page.getByRole('link', { name: 'basket', exact: true }).click()
		await page.waitForURL(/\/plans\/basket$/)
		await page.getByRole('heading', { name: 'basket', exact: true }).waitFor()
		await page.getByText('No stored tests yet.').waitFor()
		assert.equal(await page.getByText(coupon.question).count(), 0)
		await page.getByRole('link', { name: 'Open the live view' }).click()
		await page.waitForURL(/\/explorations\/x-1$/)
		await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
		await page.locator('[data-key="explorer:a2"]', { hasText: 'running' }).waitFor()
		await page.locator('[data-key="raw:a1/Q1"]', { hasText: 'question, not merged' }).waitFor()

		ended(store, 'x-1', 'a2', [])
		report(store, 'x-1', 'a1', '# Report of a1\n')
		done(store, 'x-1')
		await page.locator('[data-key="question:a1/Q1"]').waitFor()
		assert.equal(await page.locator('[data-key="unmerged"]').count(), 0)
		await page.getByRole('link', { name: 'report.md' }).waitFor()

		await page.getByRole('link', { name: 'basket', exact: true }).click()
		await page.waitForURL(/\/plans\/basket$/)
		await page.locator('[data-key="claim:a1/D1"]').waitFor()
		await page.locator('[data-key="question:a1/Q1"] a').click()
		await page.waitForURL(/\/explorations\/x-1\/questions\/a1\/Q1#answer$/)
		await page.getByLabel('Answer', { exact: true }).fill('No. A coupon does not apply to a sale item.')
		await page.getByLabel(/^Source/).fill('brief://basket#coupons')
		await page.getByLabel('Rationale').fill('The brief says so.')
		await page.getByRole('button', { name: 'Record answer' }).click()
		await page.getByRole('status').filter({ hasText: 'Answered basket · a1/Q1' }).waitFor()
		assert.deepEqual(
			mergedQuestions(store, 'basket').map((question) => [question.id, question.answer]),
			[['a1/Q1', 'No. A coupon does not apply to a sale item.']]
		)
	}
)
