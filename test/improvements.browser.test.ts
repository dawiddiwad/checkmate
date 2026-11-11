import type { TestContext } from 'node:test'
import type { Browser } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { startUi } from '../cli/src/ui/server.ts'
import { seedDemo } from '../scripts/ui-demo.ts'
import { closeStore, openStore, planDetail, runDetail } from '../plugin/src/index.ts'
import { editPlan } from '../plugin/src/plans.ts'
import { runResult } from '../plugin/src/runs.ts'
import { directory } from './support.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const skip = executablePath ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
let browser: Browser | undefined

test.before(async () => {
	if (executablePath) browser = await chromium.launch({ executablePath })
})
test.after(async () => {
	await browser?.close()
})

async function open(t: TestContext) {
	const workspace = directory(t)
	seedDemo(workspace)
	const ui = await startUi({ workspace })
	const context = await browser!.newContext({ viewport: { width: 1280, height: 900 } })
	context.setDefaultTimeout(5000)
	t.after(async () => {
		await context.close()
		await ui.close()
	})
	const page = await context.newPage()
	return { workspace, context, page, url: (path: string) => new URL(path, ui.url).href }
}

function read<T>(workspace: string, action: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return action(store)
	} finally {
		closeStore(store)
	}
}

function revise(workspace: string, planId: string, objective: string) {
	return read(workspace, (store) => {
		const detail = planDetail(store, planId)
		return editPlan(store, 'another-caller', {
			planId,
			expectSha256: detail.sha256,
			objective,
			requirements: detail.plan.requirements,
			tests: detail.plan.tests,
		})
	})
}

test('the editor saves a new revision without changing existing runs or accepting stale forms', { skip }, async (t) => {
	const { workspace, context, page, url } = await open(t)
	const pinned = read(workspace, (store) => runDetail(store, 'run-7'))
	const previous = read(workspace, (store) => planDetail(store, 'checkout', 2).plan)
	await page.goto(url('/plans/checkout@2/edit'))
	const stale = await context.newPage()
	await stale.goto(url('/plans/checkout@2/edit'))
	await page.getByLabel('Objective', { exact: true }).fill('Review updated checkout totals.')
	await page.locator('[name="requirement.R1.text"]').fill('A standard order has a verified 400 PLN total.')
	await page.locator('[name="test.T1.title"]').fill('Updated standard order test')
	await page.locator('[name="test.T1.requirements"]').fill('R1, R4')
	await page.locator('[name="test.T1.new.id"]').fill('A3')
	await page.locator('[name="test.T1.new.check"]').fill('The confirmation shows the promotion banner.')
	await page.getByRole('button', { name: 'Save new revision' }).click()
	await page.waitForURL(/\/plans\/checkout@3$/)
	const latest = read(workspace, (store) => planDetail(store, 'checkout'))
	assert.equal(latest.plan.objective, 'Review updated checkout totals.')
	assert.equal(latest.plan.requirements[0].text, 'A standard order has a verified 400 PLN total.')
	assert.equal(latest.plan.tests[0].title, 'Updated standard order test')
	assert.equal(latest.plan.tests[0].assertions.at(-1)?.id, 'A3')
	assert.deepEqual(latest.plan.coverage.find((row) => row.requirementId === 'R4')?.testIds, ['T1', 'T4'])
	assert.equal(latest.approval.state, 'pending')
	assert.deepEqual(
		read(workspace, (store) => planDetail(store, 'checkout', 2).plan),
		previous
	)
	assert.deepEqual(
		read(workspace, (store) => runDetail(store, 'run-7')),
		pinned
	)
	await stale.getByLabel('Objective', { exact: true }).fill('Stale overwrite attempt')
	await stale.getByRole('button', { name: 'Save new revision' }).click()
	await stale.locator('.banner', { hasText: 'Read it again before you decide.' }).waitFor()
	assert.equal(await stale.getByLabel('Objective', { exact: true }).inputValue(), 'Stale overwrite attempt')
	assert.equal(
		read(workspace, (store) => planDetail(store, 'checkout').revision),
		3
	)
})

test('plan details link runs and collapse resolved gaps and old history until requested', { skip }, async (t) => {
	const { workspace, page, url } = await open(t)
	for (let revision = 3; revision <= 9; revision++) revise(workspace, 'checkout', `Objective revision ${revision}`)
	await page.goto(url('/plans/checkout@9'))
	assert.equal(await page.locator('#G1 details').getAttribute('open'), null)
	assert.equal(await page.locator('#G2 details').getAttribute('open'), '')
	assert(await page.locator('#G1').evaluate((element) => element.classList.contains('gap-closed')))
	assert.equal(await page.locator('.history > li').count(), 6)
	assert.equal(await page.locator('.history details[open]').count(), 1)
	assert.match(await page.locator('.history > li').first().innerText(), /checkout@9/)
	const request = page.waitForRequest(/\/plans\/checkout@9\/history$/)
	await page.getByRole('link', { name: 'Show full history' }).click()
	await request
	await page.waitForFunction(() => document.querySelectorAll('.history > li').length === 9)
	await page.reload()
	assert.equal(await page.locator('.history > li').count(), 6)
	assert.equal(await page.locator('.history details[open]').count(), 1)
	await page.locator('[data-region="plan-runs"]').getByRole('link', { name: 'run-7', exact: true }).click()
	await page.waitForURL(/\/runs\/run-7$/)
})

test('run downloads contain the stored result and an unfinished run cannot export', { skip }, async (t) => {
	const { workspace, context, page, url } = await open(t)
	await page.goto(url('/runs/run-7'))
	const downloadEvent = page.waitForEvent('download')
	await page.getByRole('link', { name: 'Download JSON', exact: true }).click()
	const download = await downloadEvent
	assert.equal(download.suggestedFilename(), 'run-7.json')
	const stream = await download.createReadStream()
	assert(stream)
	const bytes = []
	for await (const part of stream) bytes.push(part)
	assert.deepEqual(
		JSON.parse(Buffer.concat(bytes).toString()),
		read(workspace, (store) => runResult(store, 'run-7')!.result)
	)
	const html = await context.request.get(url('/runs/run-7/report.html'))
	assert.equal(html.status(), 200)
	assert.match(html.headers()['content-disposition'], /attachment/)
	assert.match(await html.text(), /<!doctype html>/i)
	assert.match(await html.text(), /run-7/)
	assert.equal((await context.request.get(url('/runs/run-8/report.json'))).status(), 409)
})

test('a delayed live refresh cannot replace newly filtered plan rows', { skip, timeout: 15000 }, async (t) => {
	const { workspace, page, url } = await open(t)
	await page.goto(url('/plans'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	let release: (() => void) | undefined
	let intercepted: (() => void) | undefined
	const pending = new Promise<void>((resolve) => {
		intercepted = resolve
	})
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	let delayed = false
	await page.route(url('/plans'), async (route) => {
		if (delayed || route.request().resourceType() !== 'fetch') return route.continue()
		delayed = true
		const response = await route.fetch()
		intercepted!()
		await held
		await route.fulfill({ response })
	})
	t.after(() => release?.())
	revise(workspace, 'search', 'A changed objective triggers a live refresh')
	await pending
	await page.getByRole('searchbox', { name: 'Search plans' }).fill('checkout')
	await page.waitForURL(/q=checkout/)
	assert.equal(await page.locator('[data-region="plans"] tbody tr').count(), 1)
	const returned = page.waitForResponse(url('/plans'))
	release!()
	await returned
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	)
	assert.equal(await page.locator('[data-region="plans"] tbody tr').count(), 1)
	assert.match(await page.locator('[data-region="plans"] tbody tr').innerText(), /checkout/)
})
