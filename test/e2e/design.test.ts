import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { startUi } from '../../plugin/src/ui/server.ts'
import { human, seedDemo } from '../../scripts/ui-demo.ts'
import { directory, root } from '../support.ts'
import { boxes, measure, overflow } from './design-geometry.ts'

const steadyRendering = [
	'--force-color-profile=srgb',
	'--disable-gpu',
	'--disable-partial-raster',
	'--disable-skia-runtime-opts',
	'--disable-lcd-text',
	'--font-render-hinting=none',
]
const css = readFileSync(join(root, 'plugin/src/ui/assets/style.css'), 'utf8')
const screens = join(root, 'test/e2e/screens', process.platform)
const actual = join(root, 'test/e2e/screens/actual', process.platform)
const pages = [
	'/',
	'/plans/checkout',
	'/plans/checkout?view=needs&item=g%3AG2',
	'/plans/checkout@2',
	'/plans/checkout@2/edit',
	'/plans/checkout@2/gaps/G2',
	'/plans/account@7',
	'/runs',
	'/runs/run-7',
	'/log',
	'/activity',
	'/inbox',
	'/chats',
	'/requests',
	'/settings/targets',
	'/settings/targets/shop-local',
	'/settings/harness',
	'/new',
	'/design',
]
const views = [
	{ width: 1440, scale: 1 },
	{ width: 820, scale: 1 },
	{ width: 390, scale: 1 },
	{ width: 1440, scale: 2 },
]

let ui: Awaited<ReturnType<typeof startUi>>
let browser: Browser | undefined

test.before(async () => {
	const workspace = directory()
	seedDemo(workspace)
	ui = await startUi({ workspace })
	browser = await chromium.launch({ args: steadyRendering })
})

test.after(async () => {
	await browser?.close()
	await ui?.close()
})

async function open(on: Browser, width: number, scheme: 'light' | 'dark' = 'light', scale = 1) {
	const context = await on.newContext({
		viewport: { width, height: 900 },
		deviceScaleFactor: scale,
		colorScheme: scheme,
		reducedMotion: 'reduce',
	})
	await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
	return context
}

async function visit(page: Page, path: string) {
	await page.goto(new URL(path, ui.url).href)
	await page.locator('[data-live]:not([hidden])').waitFor()
	await page.evaluate(() => document.fonts.ready)
}

function tokenBlock() {
	const start = css.indexOf(':root {')
	const end = css.indexOf('\n}', start)
	return { start, end, names: [...css.slice(start, end).matchAll(/^\t(--[a-z0-9-]+):/gm)].map((match) => match[1]) }
}

test('style sheet values outside the token block come from tokens', () => {
	const { start, end, names } = tokenBlock()
	assert.deepEqual(
		names.filter((name, index) => names.indexOf(name) !== index),
		[],
		'each token is declared once'
	)
	const local = [...css.matchAll(/^\t+(--[a-z0-9-]+):/gm)].map((match) => match[1])
	const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))]
	const runtime = ['--dock-h', '--bulk-h', '--say-h', '--title-pad', '--glyph', '--glyph-closed', '--pitch', '--rows']
	assert.deepEqual(
		used.filter((name) => !names.includes(name) && !local.includes(name) && !runtime.includes(name)),
		[],
		'every var() names a token'
	)
	const rest = (css.slice(0, start) + css.slice(end)).replace(/@font-face \{[^}]*\}/g, '')
	const tokenized =
		/^\s*(padding|margin|gap|row-gap|column-gap|font|font-size|line-height|letter-spacing|font-weight|color|background-color|border-color|border-radius|outline-offset|box-shadow|transition|animation|z-index|width|min-width|max-width|height|min-height|max-height|flex|flex-basis|grid-template-columns|grid-template-rows|top|right|bottom|left|inset)(-[a-z-]+)?:/
	const art =
		/^\.(mark|dot|glyph|g-[a-z]+|sr-only)\b|kbd \.glyph|\.sb-kt|\.sb-all|details\.fold > summary::before|::-webkit|\.sp-seg-o input/
	const stray: string[] = []
	let selector = ''
	for (const line of rest.split('\n')) {
		if (/\{$/.test(line)) selector = line.trim()
		if (!tokenized.test(line) || art.test(selector)) continue
		const value = line.replace(/env\([^)]*\)/g, '').replace(/\b[01]px\b/g, '')
		if (/(\d*\.?\d+(px|rem|em)\b|#[0-9a-f]{3,8}\b|rgba?\(|z-index: \d)/i.test(value))
			stray.push(`${selector} ${line.trim()}`)
	}
	assert.deepEqual(stray, [])
})

test('layers are declared from the bottom to the top', () => {
	const values = [...css.matchAll(/^\t--z-[a-z]+: (\d+);/gm)].map((match) => Number(match[1]))
	assert.ok(values.length >= 8)
	assert.deepEqual(
		values,
		[...values].sort((a, b) => a - b)
	)
})

test('every page sits on the 4px rows, centres its small parts, and lines up its columns', async () => {
	const found: string[] = []
	for (const view of views) {
		const context = await open(browser!, view.width, 'light', view.scale)
		const page = await context.newPage()
		for (const path of pages) {
			await visit(page, path)
			const problems = await page.evaluate(measure)
			for (const [kind, list] of Object.entries(problems))
				for (const problem of list) found.push(`${path} @${view.width}x${view.scale} ${kind}: ${problem}`)
		}
		await context.close()
	}
	assert.deepEqual(found, [])
})

test('light and dark have the same geometry', async () => {
	for (const path of ['/', '/plans/checkout?view=needs&item=g%3AG2', '/runs/run-7', '/design']) {
		const shapes: Record<string, number[][]> = {}
		for (const scheme of ['light', 'dark'] as const) {
			const context = await open(browser!, 1440, scheme)
			const page = await context.newPage()
			await visit(page, path)
			shapes[scheme] = await page.evaluate(boxes, '.app *, .top *, .statusbar *')
			await context.close()
		}
		assert.deepEqual(shapes.dark, shapes.light, path)
	}
})

test('hover, focus, active, selected and disabled do not move or resize a box', async () => {
	const context = await open(browser!, 1440)
	const page = await context.newPage()
	await visit(page, '/design')
	const samples = await page.evaluate(() =>
		[...document.querySelectorAll('[data-block] .ds-state')].map((state) => {
			const part = state.querySelector(':scope > :not(.ds-cap)')
			const box = part?.getBoundingClientRect()
			return {
				look: part ? [...part.classList].filter((name) => !name.startsWith('is-')).join('.') : '',
				text: part?.textContent?.trim() ?? '',
				state: part?.matches('.is-hover, .is-focus, .is-active, [disabled]') ?? false,
				size: box ? [box.width, box.height] : [],
			}
		})
	)
	for (const sample of samples.filter((item) => item.state)) {
		const plain = samples.find((item) => !item.state && item.look === sample.look && item.text === sample.text)
		if (plain) assert.deepEqual(sample.size, plain.size, `${sample.look} "${sample.text}"`)
	}
	await visit(page, '/plans/checkout')
	const row = page.locator('.sp-list .sp-row').nth(1)
	const before = await row.evaluate((element) =>
		[element, ...element.querySelectorAll('*')].map((part) => JSON.stringify(part.getBoundingClientRect()))
	)
	await row.hover()
	const after = await row.evaluate((element) =>
		[element, ...element.querySelectorAll('*')].map((part) => JSON.stringify(part.getBoundingClientRect()))
	)
	assert.deepEqual(after, before)
	await visit(page, '/runs/run-7')
	const button = page.locator('.decision .sp-btn').first()
	const place = () =>
		button.evaluate((element) => {
			const box = element.getBoundingClientRect()
			return [box.left, box.top + scrollY, box.width, box.height]
		})
	const resting = await place()
	await button.focus()
	await page.keyboard.press('Shift+Tab')
	await page.keyboard.press('Tab')
	assert.deepEqual(await place(), resting)
	await button.hover()
	assert.deepEqual(await place(), resting)
	await context.close()
})

test('no page is wider than the window, and nothing passes its right edge', async () => {
	const found: string[] = []
	for (const width of [390, 820, 1440]) {
		const context = await open(browser!, width)
		const page = await context.newPage()
		for (const path of pages) {
			await visit(page, path)
			for (const problem of await page.evaluate(overflow)) found.push(`${path} @${width}: ${problem}`)
		}
		await context.close()
	}
	assert.deepEqual(found, [])
})

test('the top bar, status bar, menus and nav strip stack above the page and the drawer', async () => {
	const at = (page: Page, x: number, y: number, selector: string) =>
		page.evaluate(([px, py, sel]) => !!document.elementFromPoint(px, py)?.closest(sel), [x, y, selector] as const)
	const wide = await open(browser!, 1440)
	const page = await wide.newPage()
	await visit(page, '/plans/checkout?view=needs&item=g%3AG2')
	const drawer = await page.locator('.sp-drawer').boundingBox()
	assert.ok(drawer)
	const x = drawer.x + drawer.width / 2
	assert.ok(await at(page, x, drawer.y + 24, '.sp-drawer'), 'drawer over the page')
	assert.ok(await at(page, x, 24, '.top'), 'top bar over the drawer')
	assert.ok(await at(page, x, 900 - 16, '.statusbar'), 'status bar over the drawer')
	await visit(page, '/runs/run-7')
	await page.locator('details.menu > summary').first().click()
	await page.locator('details.menu[open] .menu-list a').first().waitFor()
	const onTop = await page.evaluate(async () => {
		await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
		const box = document.querySelector('details.menu[open] .menu-list a')!.getBoundingClientRect()
		return !!document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.menu-list')
	})
	assert.ok(onTop, 'menu over the page')
	await wide.close()
	const narrow = await open(browser!, 820)
	const tablet = await narrow.newPage()
	await tablet.setViewportSize({ width: 820, height: 480 })
	await visit(tablet, '/plans/checkout')
	await tablet.evaluate(() => scrollTo(0, 200))
	await tablet.waitForFunction(() => scrollY > 0)
	const strip = await tablet.locator('.sp-nav').boundingBox()
	assert.ok(strip)
	assert.ok(await at(tablet, 200, strip.y + strip.height / 2, '.sp-nav'), 'nav strip over the scrolled list')
	await narrow.close()
})

test('the reference page shows the real tokens and components', async () => {
	const context = await open(browser!, 1440)
	const page = await context.newPage()
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await visit(page, '/design')
	assert.ok(await page.locator('code', { hasText: /^--accent$/ }).count())
	assert.ok((await page.locator('[data-block]').count()) >= 25)
	const hover = await page
		.locator('.sp-btn.is-hover')
		.first()
		.evaluate((element) => getComputedStyle(element).backgroundColor)
	const plain = await page
		.locator('.sp-btn:not(.pri, .is-hover, .is-focus, .is-active)')
		.first()
		.evaluate((element) => getComputedStyle(element).backgroundColor)
	assert.notEqual(hover, plain)
	await page.getByRole('button', { name: 'Grid overlay' }).click()
	assert.equal(await page.locator('html[data-grid]').count(), 1)
	assert.deepEqual(errors, [])
	await context.close()
})

function pixels(png: Buffer) {
	let offset = 8
	let width = 0
	let height = 0
	let type = 0
	const data: Buffer[] = []
	while (offset < png.length) {
		const length = png.readUInt32BE(offset)
		const kind = png.toString('ascii', offset + 4, offset + 8)
		const body = png.subarray(offset + 8, offset + 8 + length)
		if (kind === 'IHDR') {
			width = body.readUInt32BE(0)
			height = body.readUInt32BE(4)
			type = body[9]
		}
		if (kind === 'IDAT') data.push(body)
		offset += 12 + length
	}
	const channels = type === 6 ? 4 : 3
	const raw = inflateSync(Buffer.concat(data))
	const stride = width * channels
	const out = Buffer.alloc(height * stride)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]
		for (let x = 0; x < stride; x++) {
			const value = raw[y * (stride + 1) + 1 + x]
			const left = x >= channels ? out[y * stride + x - channels] : 0
			const up = y ? out[(y - 1) * stride + x] : 0
			const corner = y && x >= channels ? out[(y - 1) * stride + x - channels] : 0
			const guess = left + up - corner
			const near =
				Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner)
					? left
					: Math.abs(guess - up) <= Math.abs(guess - corner)
						? up
						: corner
			const add = [0, left, up, (left + up) >> 1, near][filter]
			out[y * stride + x] = (value + add) & 255
		}
	}
	return { width, height, channels, out }
}

function differ(name: string, shot: Buffer) {
	const path = join(screens, `${name}.png`)
	if (process.env.CHECKMATE_UPDATE_SCREENS) {
		mkdirSync(screens, { recursive: true })
		writeFileSync(path, shot)
		return null
	}
	const save = () => {
		mkdirSync(actual, { recursive: true })
		writeFileSync(join(actual, `${name}.png`), shot)
	}
	if (!existsSync(path)) {
		save()
		return `${name}: no baseline in ${screens}`
	}
	const expected = readFileSync(path)
	if (expected.equals(shot)) return null
	const a = pixels(expected)
	const b = pixels(shot)
	if (a.width !== b.width || a.height !== b.height) {
		save()
		return `${name}: ${b.width}x${b.height}, baseline ${a.width}x${a.height}`
	}
	let changed = 0
	for (let index = 0; index < a.out.length; index += a.channels)
		if (a.out.compare(b.out, index, index + 3, index, index + 3) !== 0) changed++
	if (!changed) return null
	save()
	return `${name}: ${changed} pixels differ`
}

async function steady(page: Page) {
	await page.evaluate(() => {
		for (const element of document.querySelectorAll('time')) element.textContent = '1 min'
		for (const element of document.querySelectorAll('[data-since]')) {
			element.removeAttribute('data-since')
			element.textContent = '1 min'
		}
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
		for (let node = walker.nextNode(); node; node = walker.nextNode())
			node.textContent = node.textContent!.replace(/\b[0-9a-f]{4}…[0-9a-f]{4}\b/g, '0000…0000')
	})
	const height = await page.evaluate(() => document.documentElement.scrollHeight)
	await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.max(900, height) })
	await page.evaluate(() => document.fonts.ready)
}

test('components and pages match the committed screenshots', async () => {
	const pinned = browser!
	const found: string[] = []
	{
		for (const scheme of ['light', 'dark'] as const) {
			let context: BrowserContext = await open(pinned, 1440, scheme)
			let page = await context.newPage()
			await visit(page, '/design')
			await steady(page)
			for (const block of await page.locator('[data-block]').all()) {
				const name = `block-${await block.getAttribute('data-block')}-${scheme}`
				const problem = differ(name, await block.screenshot({ animations: 'disabled', caret: 'hide' }))
				if (problem) found.push(problem)
			}
			await context.close()
			for (const width of [390, 820, 1440]) {
				context = await open(pinned, width, scheme)
				page = await context.newPage()
				for (const path of ['/', '/plans/checkout', '/runs/run-7']) {
					await visit(page, path)
					await steady(page)
					const name = `page${path.replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}-${width}-${scheme}`
					const problem = differ(name, await page.screenshot({ animations: 'disabled', caret: 'hide' }))
					if (problem) found.push(problem)
				}
				await context.close()
			}
		}
	}
	assert.deepEqual(found, [], `Screens differ. The new screenshots are in ${actual}.`)
})
