import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { seedVolume } from '../scripts/ui-volume.ts'
import { launchWith, open, skip, stop } from './browser.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

const pages = [
	'/',
	'/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ4',
	'/plans/coupons?view=all&focus=list',
	'/plans/coupons?view=area%3ACodes',
	'/plans/coupons?view=all&item=c%3Ak1%2FD1',
	'/plans/checkout?view=needs&focus=list',
	'/explorations/x-9',
	'/runs/run-7',
	'/runs',
	'/log',
	'/plans/checkout@2',
	'/plans/checkout@2/edit',
	'/settings/targets/shop-local',
	'/runs/run-7?item=finding%3AF1',
]

function measure(narrow: boolean) {
	const problems: string[] = []
	const shown = (element: Element) => {
		const box = element.getBoundingClientRect()
		return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'
	}
	const name = (element: Element) =>
		`${element.tagName.toLowerCase()}.${[...element.classList].join('.')}${(element as HTMLElement).dataset.key ? `[${(element as HTMLElement).dataset.key}]` : ''}`
	const textBox = (element: Element) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
		let node = walker.nextNode()
		while (node && !node.textContent!.trim()) node = walker.nextNode()
		if (!node) return null
		const range = document.createRange()
		range.selectNodeContents(node)
		const rects = [...range.getClientRects()]
		return rects.length ? rects[0] : null
	}
	const spread = (values: number[]) => (values.length ? Math.max(...values) - Math.min(...values) : 0)

	if (document.documentElement.scrollWidth > window.innerWidth)
		problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${window.innerWidth}`)

	for (const list of document.querySelectorAll('.sp-list')) {
		if (!shown(list)) continue
		const rows = [...list.querySelectorAll(':scope > .sp-row')].filter(shown)
		for (const column of ['.sp-c-cb', '.sp-c-tag', '.sp-c-id', '.sp-c-title', '.sp-c-meta']) {
			const lefts = rows
				.map((row) => row.querySelector(`:scope > ${column}`))
				.filter((cell): cell is Element => Boolean(cell) && shown(cell!))
				.map((cell) => cell.getBoundingClientRect().left)
			if (spread(lefts) > 0.5) problems.push(`${column} left edges differ by ${spread(lefts).toFixed(2)} px`)
		}
		const plain = rows.filter((row) => !row.matches('.hl, .ext'))
		const heights = [...new Set(plain.map((row) => Math.round(row.getBoundingClientRect().height * 100) / 100))]
		if (heights.length > 1) problems.push(`row heights differ: ${heights.join(', ')}`)
		for (const row of rows) {
			const bottoms = ['.sp-c-tag', '.sp-c-id', '.sp-c-title', '.sp-c-meta']
				.map((column) => row.querySelector(`:scope > ${column}`))
				.filter((cell): cell is Element => Boolean(cell) && shown(cell!))
				.filter((cell) => cell.getBoundingClientRect().top < row.getBoundingClientRect().top + 36)
				.map((cell) => textBox(cell)?.bottom)
				.filter((bottom): bottom is number => bottom !== undefined)
			if (spread(bottoms) > 1) problems.push(`${name(row)} baselines differ by ${spread(bottoms).toFixed(2)} px`)
		}
	}

	for (const element of document.querySelectorAll('.sp-mk, kbd')) {
		if (!shown(element) || !element.textContent!.trim() || element.closest('dialog:not([open])')) continue
		if (element.querySelector('.glyph')) continue
		const box = element.getBoundingClientRect()
		const text = textBox(element)
		if (!text) continue
		const dx = Math.abs(text.left + text.width / 2 - (box.left + box.width / 2))
		const dy = Math.abs(text.top + text.height / 2 - (box.top + box.height / 2))
		if (dx > 0.5 || dy > 1)
			problems.push(`${name(element)} "${element.textContent}" off centre by ${dx.toFixed(2)}, ${dy.toFixed(2)}`)
	}

	for (const element of document.querySelectorAll('.sp-mk > .glyph')) {
		if (!shown(element)) continue
		const box = element.getBoundingClientRect()
		const outer = element.parentElement!.getBoundingClientRect()
		const dx = Math.abs(box.left + box.width / 2 - (outer.left + outer.width / 2))
		const dy = Math.abs(box.top + box.height / 2 - (outer.top + outer.height / 2))
		if (dx > 0.5 || dy > 0.5) problems.push(`${name(element)} off centre by ${dx.toFixed(2)}, ${dy.toFixed(2)}`)
	}
	const drawn = (document.body.innerText.match(/[✓✗●○◐≈‖↑↓←→▸▾]/g) ?? []).join('')
	if (drawn) problems.push(`marks drawn with a font: ${drawn}`)
	for (const box of document.querySelectorAll('.scroll')) {
		if (shown(box) && window.innerWidth >= 1240 && box.scrollWidth > box.clientWidth + 1)
			problems.push(`${name(box)} scrolls sideways at ${window.innerWidth}`)
	}
	const chips = [...document.querySelectorAll('.sp-nav [data-nav]')].filter(shown)
	for (let index = 1; index < chips.length; index++) {
		const before = chips[index - 1].getBoundingClientRect()
		const after = chips[index].getBoundingClientRect()
		if (before.top === after.top && after.left < before.right - 0.5)
			problems.push(`${name(chips[index])} overlaps the chip before it`)
	}
	const hints = [...document.querySelectorAll('.sb-k')].filter(shown)
	const keys = document.querySelector('[data-hints]')!.getBoundingClientRect()
	for (const hint of hints) {
		const box = hint.getBoundingClientRect()
		if (box.right > Math.min(keys.right, window.innerWidth) + 0.5 || box.left < keys.left - 0.5)
			problems.push(`hint "${hint.textContent}" is clipped`)
	}
	if (!hints.some((hint) => (hint as HTMLElement).dataset.cap === '?')) problems.push('the ? KEYS hint is missing')
	const counts = [...document.querySelectorAll('.sp-nav .sp-ncount')].filter(shown)
	const column =
		document.querySelector('.sp-nlist') &&
		getComputedStyle(document.querySelector('.sp-nlist')!).flexDirection === 'column'
	if (column && spread(counts.map((count) => count.getBoundingClientRect().right)) > 0.5)
		problems.push('navigator count right edges differ')

	for (const element of document.querySelectorAll('.sp-pill, kbd, .sp-btn > span, .sb-btn, .sp-c-id, .sp-ncount')) {
		if (!shown(element) || element.closest('dialog:not([open])')) continue
		if (element.scrollWidth > element.clientWidth + 1 && !element.closest('[title]'))
			problems.push(`${name(element)} "${element.textContent!.trim()}" overflows`)
	}
	for (const element of document.querySelectorAll('.ell')) {
		if (!shown(element)) continue
		if (
			element.scrollWidth > element.clientWidth + 1 &&
			!element.getAttribute('title') &&
			!element.closest('[title]')
		)
			problems.push(`${name(element)} is cut without its full text in a title`)
	}

	const top = document.querySelector('.top')!.getBoundingClientRect().bottom
	const bar = document.querySelector('.statusbar')!.getBoundingClientRect().top
	const drawer = document.querySelector('[data-drawer]')
	const highlight = document.querySelector('.hl[data-row], .hl[data-sub]')
	if (highlight && shown(highlight)) {
		const box = highlight.getBoundingClientRect()
		const ceiling = drawer && drawer.contains(highlight) ? drawer.getBoundingClientRect().top : top
		if (box.top < ceiling - 0.5 || box.bottom > bar + 0.5)
			problems.push(`highlight ${name(highlight)} at ${box.top}–${box.bottom} is under a bar (${ceiling}–${bar})`)
		for (const option of highlight.querySelectorAll('[data-option]')) {
			if (!shown(option)) continue
			const inner = option.getBoundingClientRect()
			if (
				inner.top < box.top - 0.5 ||
				inner.bottom > box.bottom + 0.5 ||
				inner.right > box.right + 0.5 ||
				inner.left < box.left - 0.5
			)
				problems.push(`option "${option.textContent!.trim()}" leaves the highlighted row`)
		}
	}

	const rgb = (value: string) => {
		const parts = value.match(/[\d.]+/g)!.map(Number)
		return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
	}
	const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
		const channel = (value: number) => {
			const v = value / 255
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
		}
		return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
	}
	const ratio = (a: string, b: string) => {
		const [one, two] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x)
		return (one + 0.05) / (two + 0.05)
	}
	const background = (element: Element | null): string => {
		for (let at = element; at; at = at.parentElement) {
			const value = getComputedStyle(at).backgroundColor
			if (rgb(value).a > 0) return value
		}
		return getComputedStyle(document.body).backgroundColor
	}
	const texts = document.querySelectorAll(
		'.sp-row > *, .sp-nrow > *, .sp-pill, .sp-gh, .sp-path, .sp-sub, .sb-btn, .sb-k, .sp-btn, .sp-ct *, .sp-dhead *, .sp-facts *, .q-row *'
	)
	for (const element of texts) {
		if (!shown(element) || !element.textContent!.trim() || element.closest('dialog:not([open])')) continue
		if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent!.trim())) continue
		const value = ratio(getComputedStyle(element).color, background(element))
		if (value < 4.5)
			problems.push(`${name(element)} "${element.textContent!.trim().slice(0, 30)}" contrast ${value.toFixed(2)}`)
	}
	for (const control of document.querySelectorAll(
		'.sp-btn, .btn, .sb-btn, summary, input:not([type=hidden]), textarea, select'
	)) {
		if (
			!shown(control) ||
			control.matches('.pri, .primary, [type=checkbox], [type=radio]') ||
			control.closest('.hl')
		)
			continue
		if (control.matches('summary') && control.closest('.menu, .sp-more')) continue
		const style = getComputedStyle(control)
		if (style.borderTopStyle === 'none' || rgb(style.borderTopColor).a === 0) continue
		const value = ratio(style.borderTopColor, background(control.parentElement))
		if (value < 3) problems.push(`${name(control)} border contrast ${value.toFixed(2)}`)
	}

	if (narrow)
		for (const target of document.querySelectorAll(
			'.sp-row .sp-btn, .sb-btn, .sp-ct-opts .sp-btn, .sp-dopts .sp-btn, .sp-nrow, .brand, .who .actor, .sp-c-cb, main input:not([type=hidden], [type=checkbox], [type=radio]), main select, .settings-nav a, .jump a, .plist a, .q-detail a, main summary'
		)) {
			if (!shown(target)) continue
			const height = target.getBoundingClientRect().height
			if (height < 40) problems.push(`${name(target)} is ${height} px high`)
		}
	return problems
}

async function check(page: Page, path: string, width: number, colorScheme: 'light' | 'dark') {
	await page.setViewportSize({ width, height: 900 })
	await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
	await page.goto(path)
	await page.evaluate(() => document.fonts.ready)
	await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
	const problems = await page.evaluate(measure, width <= 760)
	assert.deepEqual(problems, [], `${path} at ${width} in ${colorScheme}`)
}

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`rows, marks, keys, and colours line up at 1440, 900, and 400 in the ${colorScheme} theme`,
		{ skip },
		async (t) => {
			const { page, url } = await open(t)
			for (const width of [1440, 900, 400])
				for (const path of pages) await check(page, url(path), width, colorScheme)
		}
	)

const widths = [1440, 1240, 1100, 900, 760, 600, 400]

test('no row moves when the highlight moves through 20 rows, at every width', { skip }, async (t) => {
	const { page, url } = await open(t)
	for (const width of widths) {
		await page.setViewportSize({ width, height: 900 })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		const boxes = () =>
			page.evaluate(() => {
				const list = document.querySelector('[data-panel]:not([hidden]) .sp-list')!.getBoundingClientRect()
				return [...document.querySelectorAll('[data-panel]:not([hidden]) [data-row]')].map((row) => {
					const box = row.getBoundingClientRect()
					return `${(box.top - list.top).toFixed(1)}:${box.height.toFixed(1)}`
				})
			})
		const first = await boxes()
		for (let step = 0; step < 20; step++) {
			await page.keyboard.press('ArrowDown')
			assert.deepEqual(await boxes(), first, `${width} px after ${step + 1} steps`)
		}
	}
})

test('the status bar buttons keep their place, and the hints fit, at every width', { skip }, async (t) => {
	const { page, url } = await open(t)
	for (const width of widths) {
		await page.setViewportSize({ width, height: 800 })
		const lefts: number[] = []
		for (const path of ['/', '/plans/coupons?view=needs&focus=list', '/plans/coupons?view=all&item=c%3Ak1%2FD1']) {
			await page.goto(url(path))
			await page.evaluate(() => document.fonts.ready)
			lefts.push(await page.locator('.sb-links').evaluate((links) => links.getBoundingClientRect().left))
			const clipped = await page.evaluate(() => {
				const keys = document.querySelector('[data-hints]')!.getBoundingClientRect()
				return [...document.querySelectorAll('.sb-k')]
					.filter((hint) => (hint as HTMLElement).offsetWidth)
					.some((hint) => hint.getBoundingClientRect().right > Math.min(keys.right, window.innerWidth) + 0.5)
			})
			assert.equal(clipped, false, `${path} at ${width}`)
			assert.equal(await page.locator('.sb-k[data-cap="?"]').isVisible(), true, `${path} at ${width}`)
			assert.match((await page.locator('[data-region="nav-count"]').textContent()) ?? '', /all plans/)
		}
		assert.equal(new Set(lefts.map((left) => left.toFixed(1))).size, 1, `${width}: ${lefts.join(', ')}`)
	}
})

test('the options of the highlighted row stay inside the row with the fallback font', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.route('**/assets/fonts/*.woff2', (route) => route.abort())
	for (const width of [1440, 1100, 760, 400])
		for (const path of [pages[1], pages[2], pages[5]]) await check(page, url(path), width, 'dark')
})
