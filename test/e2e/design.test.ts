import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { startUi } from '../../plugin/src/ui/server.ts'
import { human, seedDemo } from '../../scripts/ui-demo.ts'
import { directory, root } from '../support.ts'

const executable = process.env.CHECKMATE_BROWSER_EXECUTABLE
const browserSkip = executable ? false : 'Set CHECKMATE_BROWSER_EXECUTABLE to a Chromium binary'
const tokenized =
	/^\s*(padding|margin|gap|row-gap|column-gap|font|font-size|line-height|letter-spacing|font-weight|color|background-color|border-color|border-radius|outline-offset|box-shadow|transition|animation)(-[a-z-]+)?:/

test('style sheet values outside the token block come from tokens', () => {
	const css = readFileSync(join(root, 'plugin/src/ui/assets/style.css'), 'utf8')
	const start = css.indexOf(':root {')
	const end = css.indexOf('\n}', start)
	const rest = (css.slice(0, start) + css.slice(end)).replace(/@font-face \{[^}]*\}/g, '')
	const stray = rest
		.split('\n')
		.filter((line) => tokenized.test(line))
		.filter((line) => /(\d*\.?\d+(px|rem|em)\b|#[0-9a-f]{3,8}\b|rgba?\()/i.test(line.replace(/env\([^)]*\)/g, '')))
	assert.deepEqual(stray, [])
})

test('the main screen and a run sit on the 4px rows and the 12 column grid', { skip: browserSkip }, async (t) => {
	const workspace = directory(t)
	seedDemo(workspace)
	const ui = await startUi({ workspace })
	const browser = await chromium.launch({ executablePath: executable })
	t.after(async () => {
		await browser.close()
		await ui.close()
	})
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
	const page = await context.newPage()
	const boxes = (selector: string) =>
		page.$$eval(selector, (elements) =>
			elements.map((element) => {
				const box = element.getBoundingClientRect()
				return { top: box.top + window.scrollY, height: box.height, left: box.left, right: box.right }
			})
		)
	await page.goto(new URL('/', ui.url).href)
	for (const box of await boxes('.sp-ct, .sp-home, .sp-h, .top')) {
		assert.equal(box.top % 4, 0, `top ${box.top} is off the 4px rows`)
		assert.equal(box.height % 4, 0, `height ${box.height} is off the 4px rows`)
	}
	await page.goto(new URL('/runs/run-7', ui.url).href)
	for (const box of await boxes('.sp-row, .sp-gh, .sp-list'))
		assert.equal(box.height % 4, 0, `height ${box.height} is off the 4px rows`)
	const column = (1440 - 2 * 16 - 11 * 16) / 12
	const [nav] = await boxes('.sp-nav')
	const [main] = await boxes('.sp-main')
	assert.equal(nav.left, 16)
	assert.ok(Math.abs(nav.right - (16 + 3 * column + 2 * 16)) < 1, `nav ends at ${nav.right}`)
	assert.ok(Math.abs(main.left - (16 + 3 * column + 3 * 16)) < 1, `main starts at ${main.left}`)
})

test('the reference page shows the real tokens and components', { skip: browserSkip }, async (t) => {
	const workspace = directory(t)
	seedDemo(workspace)
	const ui = await startUi({ workspace })
	const browser = await chromium.launch({ executablePath: executable })
	t.after(async () => {
		await browser.close()
		await ui.close()
	})
	const page = await browser.newPage()
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto(new URL('/design', ui.url).href)
	await page.getByRole('heading', { name: 'Design system' }).waitFor()
	assert.ok(await page.locator('code', { hasText: /^--accent$/ }).count())
	const swatch = await page
		.locator('.ds-swatch')
		.first()
		.evaluate((element) => getComputedStyle(element).backgroundColor)
	assert.notEqual(swatch, 'rgba(0, 0, 0, 0)')
	const hover = await page
		.locator('.sp-btn.is-hover')
		.first()
		.evaluate((element) => getComputedStyle(element).backgroundColor)
	assert.notEqual(hover, 'rgba(0, 0, 0, 0)')
	await page.getByRole('button', { name: 'Grid overlay' }).click()
	assert.equal(await page.locator('html[data-grid]').count(), 1)
	assert.deepEqual(errors, [])
})
