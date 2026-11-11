import type { Page } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'
import { human, seedDemo } from './ui-demo.ts'

const output = process.argv[2]
const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
if (!output || !executablePath) {
	console.error('Usage: CHECKMATE_BROWSER_EXECUTABLE=<chrome> node scripts/ui-screenshots.ts <output directory>')
	process.exit(1)
}

const directory = resolve(output)
mkdirSync(directory, { recursive: true })
const workspace = mkdtempSync(join(tmpdir(), 'checkmate-ui-demo-'))
seedDemo(workspace)
const ui = await startUi({ workspace })
const browser = await chromium.launch({ executablePath })

async function open(scheme: 'light' | 'dark', width: number, height = 900) {
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 2,
		colorScheme: scheme,
		reducedMotion: 'reduce',
	})
	await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
	return context.newPage()
}

async function shot(page: Page, path: string, name: string, fullPage = true) {
	await page.goto(new URL(path, ui.url).href)
	await page.locator('[data-live]:not([hidden])').waitFor()
	await page.evaluate(() => document.fonts.ready)
	await page.screenshot({ path: join(directory, `${name}.png`), fullPage })
	console.log(join(directory, `${name}.png`))
}

try {
	const page = await open('light', 1280)
	await shot(page, '/', 'inbox')
	await shot(page, '/plans', 'plans')
	await shot(page, '/plans/checkout@2', 'plan-detail')
	await shot(page, '/plans/account@7', 'plan-history')
	await shot(page, '/plans/checkout@2/edit', 'plan-edit')
	await shot(page, '/plans/checkout@2/gaps/G2', 'gap-answer')
	await shot(page, '/runs', 'runs')
	await shot(page, '/runs/run-7', 'run-detail')
	await page.goto(new URL('/runs/run-7', ui.url).href)
	await page.locator('#rationale').fill('The failure is the known stacking defect. Release is blocked by F1.')
	await page.getByRole('button', { name: 'Accept run-7' }).click()
	await page.screenshot({ path: join(directory, 'run-confirm.png'), fullPage: false })
	console.log(join(directory, 'run-confirm.png'))
	await shot(page, '/log', 'log')
	await page.goto(new URL('/runs/run-7', ui.url).href)
	await page.getByText('Download report').click()
	await page.screenshot({ path: join(directory, 'run-download.png'), fullPage: false })
	console.log(join(directory, 'run-download.png'))
	const phone = await open('light', 390, 844)
	await shot(phone, '/runs/run-7', 'run-phone')
	await shot(phone, '/plans', 'plans-phone')
	await shot(phone, '/plans/search@1/edit', 'plan-edit-phone')
	const dark = await open('dark', 1280)
	await shot(dark, '/', 'inbox-dark')
	await shot(dark, '/runs/run-7', 'run-dark')
} finally {
	await browser.close()
	await ui.close()
	rmSync(workspace, { recursive: true, force: true })
}
