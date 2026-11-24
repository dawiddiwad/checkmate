import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { human, seedDemo } from './ui-demo.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { openTest, launched, ended, done } from '../test/explorations.ts'

const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
if (!executablePath) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to Chromium.')
const workspace = mkdtempSync(join(tmpdir(), 'checkmate-docs-ui-'))
const output = join(process.cwd(), 'docs/media/ui')
mkdirSync(output, { recursive: true })
seedDemo(workspace)
const store = openStore(workspace)
try {
	openTest(store, 'checkout', 'exploration-1', 'fixture-build-2', 'local')
	launched(store, 'exploration-1', 'a1')
	ended(store, 'exploration-1', 'a1', [{ kind: 'note', text: 'Checked the checkout quote.' }])
	done(store, 'exploration-1')
} finally {
	closeStore(store)
}
const server = spawn(
	process.execPath,
	['plugin/dist/checkmate.js', 'ui', '--port', '0', '--json', '--workspace', workspace],
	{
		cwd: process.cwd(),
		stdio: ['ignore', 'pipe', 'inherit'],
	}
)
try {
	const [chunk] = (await once(server.stdout, 'data')) as [Buffer]
	const url = JSON.parse(chunk.toString().split('\n')[0]).url as string
	if (!url) throw Error('UI did not return a URL.')
	const browser = await chromium.launch({ executablePath })
	try {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			deviceScaleFactor: 1,
			colorScheme: 'dark',
			reducedMotion: 'reduce',
		})
		await context.addCookies([{ name: 'checkmate_actor', value: human, url }])
		const page = await context.newPage()
		await page.goto(new URL('/plans/checkout', url).href)
		await page.locator('[data-live]:not([hidden])').waitFor()
		await page.getByText('Which orders can a customer refund', { exact: false }).first().click()
		await page.locator('[data-drawer]').waitFor()
		await page.evaluate(() => document.fonts.ready)
		await page.screenshot({ path: join(output, 'review.png') })
		await page.locator('[data-drawer] textarea').first().fill('Refunds are available within 14 days of delivery.')
		await page.screenshot({ path: join(output, 'answer.png') })
		await page.goto(new URL('/activity', url).href)
		await page.locator('[data-live]:not([hidden])').waitFor()
		await page.evaluate(() => document.fonts.ready)
		await page.screenshot({ path: join(output, 'activity.png'), clip: { x: 0, y: 0, width: 1440, height: 270 } })
		await context.close()
	} finally {
		await browser.close()
	}
} finally {
	const closed = once(server, 'exit')
	server.kill('SIGTERM')
	await closed
	rmSync(workspace, { recursive: true, force: true })
}
