import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openPlan, openStore } from '../plugin/src/index.ts'
import { openExploration } from '../plugin/src/explorations.ts'
import { mergedQuestions } from '../plugin/src/views.ts'
import { agent } from '../scripts/ui-demo.ts'
import { checkmate, launch, open, browserTest, stop } from './browser.ts'
import { coupon, done, ended, event, launched, openTest, report, stacks } from './explorations.ts'

test.before(launch)
test.after(stop)

test('tester details show the recorded default and individual models at a narrow width', browserTest, async (t) => {
	const { page, url, workspace } = await open(t, { viewport: { width: 400, height: 800 } })
	const store = openStore(workspace)
	const defaultModel = 'test-provider/default-model'
	const individual = `test-provider/${'long-model-name-'.repeat(9)}override`
	try {
		openExploration(store, agent, { planId: 'checkout', explorationId: 'x-models', build: 'b1', instance: 'local' })
		event(store, 'x-models', {
			step: 'start',
			detail: { level: 'smoke', explorers: 2, model: defaultModel, testerModels: { a2: individual } },
		})
		launched(store, 'x-models', 'a1')
		launched(store, 'x-models', 'a2')
		done(store, 'x-models')
	} finally {
		closeStore(store)
	}
	await page.goto(url('/explorations/x-models?item=explorer:a1'))
	await page.getByText(defaultModel, { exact: true }).waitFor()
	await page.goto(url('/explorations/x-models?item=explorer:a2'))
	const model = page.getByText(individual, { exact: true })
	await model.waitFor()
	assert(
		await model.evaluate((element) => {
			const range = document.createRange()
			range.selectNodeContents(element)
			return range.getClientRects().length > 1
		})
	)
})

test(
	'a plan without a revision leads to the live view, which updates to the merged items that the plan page answers',
	browserTest,
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

		await page.goto(url('/'))
		await page.locator('[data-key="plan:basket"]').click()
		await page.waitForURL(/\/plans\/basket\?view=needs/)
		await page.getByRole('heading', { name: 'Needs you', exact: true }).waitFor()
		assert.equal(await page.getByText(coupon.question).count(), 0)
		await page.getByRole('treeitem', { name: /Testers now/ }).click()
		await page.waitForURL(/\/explorations\/x-1$/)
		await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
		await page.locator('[data-key="explorer:a2"]', { hasText: 'running' }).waitFor()
		await page.locator('[data-key="raw:a1/Q1"]', { hasText: 'question, not merged' }).waitFor()

		ended(store, 'x-1', 'a2', [])
		report(store, 'x-1', 'a1', '# Report of a1\n')
		done(store, 'x-1')
		await page.locator('[data-key="question:a1/Q1"]').waitFor()
		assert.equal(await page.locator('[data-key="unmerged"]').count(), 0)
		await page.getByRole('link', { name: 'report.md' }).waitFor()

		await page.getByRole('navigation', { name: 'Where you are' }).getByRole('link', { name: 'basket' }).click()
		await page.waitForURL(/\/plans\/basket$/)
		await page.locator('[data-panel="needs"] [data-key="c:a1/D1"]').waitFor()
		await page.locator('[data-panel="needs"] [data-key="q:a1/Q1"]').click()
		await page.waitForURL((address) => address.searchParams.get('item') === 'q:a1/Q1')
		await page
			.locator('[data-drawer]')
			.getByLabel('How it should be, in one sentence')
			.fill('No. A coupon does not apply to a sale item.')
		await page.getByRole('button', { name: 'Send the answer' }).click()
		await page.getByRole('status').filter({ hasText: 'Answered basket · a1/Q1' }).waitFor()
		assert.deepEqual(
			mergedQuestions(store, 'basket').map((question) => [question.id, question.answer]),
			[['a1/Q1', 'No. A coupon does not apply to a sale item.']]
		)
	}
)

test(
	'the live view of the session path changes without a reload when another process writes started, pause, or done',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		const cli = async (args: string[]) => JSON.parse((await checkmate(workspace, [...args, '--json'])).stdout)
		const started = await cli([
			'test',
			'basket',
			'--target',
			'shop-local',
			'--objective',
			'Test the basket.',
			'--source',
			'brief://basket',
			'--build',
			'b1',
			'--level',
			'smoke',
			'--instance',
			'local',
			'--session',
		])
		const id = started.subject as string
		await cli(['explore', 'next', id])
		await page.goto(url(`/explorations/${id}`))
		const row = page.locator('[data-key="explorer:a1"]')
		await row.filter({ hasText: 'given to the session' }).waitFor()
		const since = row.locator('[data-since]')
		const first = await since.textContent()
		await page.waitForFunction(
			(before) => document.querySelector('[data-key="explorer:a1"] [data-since]')?.textContent !== before,
			first,
			{ timeout: 3000 }
		)

		await cli(['explore', 'started', id, 'a1'])
		await row.filter({ hasText: 'running' }).waitFor({ timeout: 3000 })
		await cli(['explore', 'pause', id, '--reason', 'Asked the person about the environment.'])
		await page
			.locator('[data-key="paused"]', { hasText: 'Paused: Asked the person about the environment.' })
			.waitFor({
				timeout: 3000,
			})
		await cli(['explore', 'done', id, 'a1', 'study', '--agent', 'agent-a1', '--activity', 'Studied the basket.'])
		await row.filter({ hasText: 'study: Studied the basket.' }).waitFor({ timeout: 3000 })
		await row.filter({ hasText: 'finished' }).waitFor({ timeout: 3000 })
		await page.locator('[data-key="paused"]').waitFor({ state: 'detached' })
	}
)
