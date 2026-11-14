import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const names = ['roles', 'life', 'run']
const browser = await chromium.launch({
	executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
	headless: true,
})
try {
	const page = await browser.newPage({ viewport: { width: 960, height: 800 }, deviceScaleFactor: 2 })
	await page.goto(pathToFileURL(join(process.cwd(), 'docs/media/diagrams.html')).href)
	await page.evaluate(() => document.fonts.ready)
	for (const name of names) {
		const path = `docs/img/${name}.png`
		await page.locator(`#${name}`).screenshot({ path })
		console.log(`Rendered ${path}.`)
	}
} finally {
	await browser.close()
}
