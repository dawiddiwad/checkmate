import type { TestContext } from 'node:test'
import type { Browser, BrowserContextOptions } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { evidenceDirectory } from '../plugin/src/runs.ts'
import { startUi } from '../cli/src/ui/server.ts'
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
	await page.waitForURL(/\/plans\/search@1#decide$/)
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
	const evidence = evidenceDirectory('run-8', workspace)
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
		join(evidence, 'cookie.txt'),
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
