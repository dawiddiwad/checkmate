import type { TestContext } from 'node:test'
import type { Browser, BrowserContextOptions } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'
import { human, seedDemo } from '../scripts/ui-demo.ts'
import { closeStore, openStore, planDetail } from '../plugin/src/index.ts'
import { directory, root } from './support.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const skip = executablePath ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
const run = promisify(execFile)
let browser: Browser | undefined

test.before(async () => {
	if (executablePath) browser = await chromium.launch({ executablePath })
})
test.after(async () => {
	await browser?.close()
})

async function open(t: TestContext, options: BrowserContextOptions = {}) {
	const workspace = directory(t)
	seedDemo(workspace)
	const ui = await startUi({ workspace })
	const context = await browser!.newContext({ viewport: { width: 1280, height: 900 }, ...options })
	context.setDefaultTimeout(5000)
	await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
	t.after(async () => {
		await context.close()
		await ui.close()
	})
	const page = await context.newPage()
	const url = (path: string) => new URL(path, ui.url).href
	return { workspace, ui, page, url }
}

function checkmate(workspace: string, args: string[]) {
	return run(process.execPath, [
		join(root, 'plugin/dist/checkmate.js'),
		...args,
		'--workspace',
		workspace,
		'--actor',
		'worker',
	])
}

function approval(workspace: string, planId: string) {
	const store = openStore(workspace)
	try {
		return planDetail(store, planId).approval
	} finally {
		closeStore(store)
	}
}

const focusedKey = (page: Awaited<ReturnType<typeof open>>['page']) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key ?? null)

test('the inbox works from the keyboard', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	assert.equal(await focusedKey(page), 'gap:checkout:G2')
	await page.keyboard.press('j')
	assert.equal(await focusedKey(page), 'gap:checkout:G4')
	await page.keyboard.press('j')
	assert.equal(await focusedKey(page), 'plan:search@1')
	await page.keyboard.press('j')
	assert.equal(await focusedKey(page), 'run:run-7')
	await page.keyboard.press('k')
	await page.keyboard.press('?')
	await page.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor()
	await page.keyboard.press('Escape')
	await page.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor({ state: 'hidden' })
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/plans\/search@1#decide$/)
	await page.goto(url('/plans'))
	await page.keyboard.press('/')
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'q')
})

test('a gap answer goes from the form to the next inbox item', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/'))
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/plans\/checkout@2\/gaps\/G2#answer$/)
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
	await page.waitForURL(/\/plans\/checkout@2\/gaps\/G4#answer$/)
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

test('a run page updates live and keeps typed text', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/runs/run-8'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.locator('[data-key="T1.A2"] .obs', { hasText: 'No result yet.' }).waitFor()
	const evidence = join(workspace, '.checkmate', 'tmp', 'run-8')
	mkdirSync(evidence, { recursive: true })
	writeFileSync(join(evidence, 'cookie.txt'), 'Set-Cookie: sid=x; HttpOnly\n')
	await checkmate(workspace, [
		'run',
		'check',
		'run-8',
		'T1',
		'A2',
		'--result',
		'passed',
		'--observed',
		'HttpOnly flag present',
		'--evidence',
		'.checkmate/tmp/run-8/cookie.txt',
	])
	await page.locator('[data-key="T1.A2"]', { hasText: 'HttpOnly flag present' }).waitFor({ timeout: 2000 })
	await page.locator('[aria-live="polite"]', { hasText: 'T1.A2 passed' }).waitFor({ state: 'attached' })
	await page.goto(url('/runs/run-7'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.getByLabel('Rationale').fill('Half-written rationale')
	await checkmate(workspace, ['result', 'accept', 'run-7', '--rationale', 'Accepted elsewhere.'])
	await page.locator('[data-region="state"]', { hasText: 'accepted' }).waitFor({ timeout: 2000 })
	await page.locator('.banner', { hasText: 'run-7 has a new result. Review it before you decide.' }).waitFor()
	assert.equal(await page.getByLabel('Rationale').inputValue(), 'Half-written rationale')
	assert.match(page.url(), /\/runs\/run-7$/)
})

test('dark mode follows the system and the header toggle overrides it', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.emulateMedia({ colorScheme: 'dark' })
	await page.goto(url('/runs/run-7'))
	const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
	assert.equal(await background(), 'rgb(18, 23, 21)')
	await page.getByRole('button', { name: /^Theme: system/ }).click()
	assert.equal(await background(), 'rgb(246, 247, 245)')
	await page.reload()
	assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
})

test('forms work with JavaScript disabled', { skip }, async (t) => {
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
})

test('list filters, sorting, and pages update in place and keep the URL', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/log'))
	await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1))
	const marker = () => page.evaluate(() => (window as unknown as { marker?: number }).marker)
	assert(!(await page.getByRole('button', { name: 'Filter' }).isVisible()))
	const count = page.locator('[data-list-count]')
	await count.filter({ hasText: /^Showing 1–25 of \d+ operations$/ }).waitFor()
	await page.getByRole('link', { name: 'Next ›' }).click()
	await page.waitForURL(/\/log\?page=2$/)
	await count.filter({ hasText: /^Showing 26–50/ }).waitFor()
	await page.getByLabel('Rows per page').selectOption('50')
	await page.waitForURL(/\/log\?size=50$/)
	await page.getByLabel('Search operations').pressSequentially('approve')
	await page.waitForURL(/\/log\?q=approve&size=50$/)
	await count.filter({ hasText: /^Showing 1–\d+ of \d+ operations$/ }).waitFor()
	const commands = await page.locator('tbody tr td:nth-child(3) .mono').allTextContents()
	assert(commands.length > 0 && commands.every((command) => command === 'plan approve'))
	assert.equal(await page.getByLabel('Search operations').evaluate((input) => input === document.activeElement), true)
	await page.getByLabel('Actor').selectOption('qa-lead')
	await page.waitForURL(/actor=qa-lead/)
	await page.getByRole('link', { name: /^Actor/ }).click()
	await page.waitForURL(/sort=actor&dir=asc/)
	await page.locator('th[aria-sort="ascending"]', { hasText: 'Actor' }).waitFor()
	await page.goBack()
	await page.waitForURL(/\/log\?q=approve&actor=qa-lead&size=50$/)
	await page.locator('th[aria-sort="descending"]', { hasText: 'Time' }).waitFor()
	await page.getByRole('link', { name: 'Clear' }).click()
	await page.waitForURL(/\/log$/)
	assert.equal(await page.getByLabel('Search operations').inputValue(), '')
	assert.equal(await page.getByLabel('Actor').inputValue(), '')
	assert.equal(await page.getByLabel('Rows per page').inputValue(), '25')
	assert.equal(await marker(), 1)
	await page.goto(url('/plans'))
	await page.getByLabel('Search plans').fill('login')
	await page.waitForURL(/\/plans\?q=login$/)
	await page.locator('[data-list-count]', { hasText: 'Showing 1–1 of 1 plan' }).waitFor()
})

test('list filters work with JavaScript disabled', { skip }, async (t) => {
	const { page, url } = await open(t, { javaScriptEnabled: false })
	await page.goto(url('/runs'))
	await page.getByLabel('Status').selectOption('started')
	await page.getByRole('button', { name: 'Filter' }).click()
	await page.waitForURL(/\/runs\?.*status=started/)
	assert.deepEqual(await page.locator('tbody tr td:first-child').allTextContents(), ['run-8'])
	await page.getByRole('link', { name: 'Run', exact: true }).click()
	await page.waitForURL(/\/runs\?status=started&sort=run&dir=asc$/)
})

test('the plan page folds closed gaps and loads the full history on demand', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/checkout@2'))
	const closed = page.locator('#G1 details')
	assert.equal(await closed.evaluate((details) => (details as HTMLDetailsElement).open), false)
	assert(Number(await page.locator('#G1 summary').evaluate((summary) => getComputedStyle(summary).opacity)) < 1)
	await page.locator('#G1 summary').click()
	await page.locator('#G1 .gap-b').waitFor()
	await page.locator('#runs').scrollIntoViewIfNeeded()
	await page.locator('[data-region="plan-runs"] a', { hasText: 'run-7' }).waitFor()
	await page.goto(url('/plans/account@7'))
	const entries = page.locator('[data-history] ol.history > li')
	assert.equal(await entries.count(), 6)
	assert.equal(await page.locator('[data-history] details[open]').count(), 1)
	await page.getByText('Show full history · 1 earlier revision').click()
	await page.locator('[data-history] summary', { hasText: 'account@1' }).waitFor()
	assert.equal(await entries.count(), 7)
	assert.equal(new URL(page.url()).search, '')
	await page.reload()
	assert.equal(await entries.count(), 6)
})

test('a finished run downloads its report', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/runs/run-7'))
	await page.getByText('Download report').click()
	await page.getByText(/print to PDF/).waitFor()
	const waiting = page.waitForEvent('download')
	await page.getByRole('link', { name: /^HTML/ }).click()
	const file = await waiting
	assert.equal(file.suggestedFilename(), 'run-7-report.html')
	await page.keyboard.press('Escape')
	assert.equal(await page.locator('details[data-menu]').evaluate((menu) => (menu as HTMLDetailsElement).open), false)
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

test('a filtered list updates live', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans?q=search'))
	await page.locator('[data-live]', { hasText: '● Live' }).waitFor()
	await page.locator('tr[data-key="plan:search"]', { hasText: 'pending' }).waitFor()
	await checkmate(workspace, ['plan', 'approve', 'search@1', '--rationale', 'Approved elsewhere.'])
	await page.locator('tr[data-key="plan:search"]', { hasText: 'approved' }).waitFor({ timeout: 2000 })
	assert.match(page.url(), /\/plans\?q=search$/)
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
	await page.goto(url('/runs/run-7'))
	await page.getByRole('button', { name: 'Bring into plan' }).click()
	await page.waitForURL(/\/runs\/run-7#G4$/)
	await page.getByRole('status').filter({ hasText: 'Brought G4 into checkout@3' }).waitFor()
	await page.getByRole('link', { name: 'checkout@3' }).first().waitFor()
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	assert(planDetail(store, 'checkout').plan.gaps.some((gap) => gap.id === 'G4'))
})
