import type { Page } from 'playwright-core'
import assert from 'node:assert/strict'

export function measure(narrow: boolean) {
	const problems: string[] = []
	const shown = (element: Element) => {
		const box = element.getBoundingClientRect()
		return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'
	}
	const labelled = (element: Element) => getComputedStyle(element, '::before').content.startsWith('"')
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
		if (element.querySelector('.glyph') || labelled(element)) continue
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
		const dx = labelled(element.parentElement!)
			? 0
			: Math.abs(box.left + box.width / 2 - (outer.left + outer.width / 2))
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
		'.sp-btn, .btn, .sb-btn, summary, input:not([type=hidden]), textarea, select, .sp-mk[data-mark]'
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
			'a[href], button, summary, input:not([type=hidden]), select, textarea, .sp-c-cb, [data-nav]'
		)) {
			if (
				!shown(target) ||
				target.closest('dialog:not([open]), .sr-only') ||
				target.matches('.sp-c-title, .skip')
			)
				continue
			const siblings = [...(target.parentElement?.childNodes ?? [])]
			const words = (nodes: ChildNode[]) =>
				nodes.some((node) => node.nodeType === 3 && node.textContent!.trim().length > 2)
			const at = siblings.indexOf(target)
			if (target.matches('a') && words(siblings.slice(0, at)) && words(siblings.slice(at + 1))) continue
			target.scrollIntoView({ block: 'center', inline: 'center' })
			const spot = target.getBoundingClientRect()
			const hit = document.elementFromPoint(spot.left + spot.width / 2, spot.top + spot.height / 2)
			const label = hit?.closest('label') as HTMLLabelElement | null
			const inLabel = label?.control === target
			if (!hit || !(target.contains(hit) || inLabel)) continue
			const box = target.matches('[type=checkbox], [type=radio]') && inLabel ? label! : target
			const { width, height } = box.getBoundingClientRect()
			if (width < 39.5 || height < 39.5)
				problems.push(`${name(target)} "${target.textContent!.trim().slice(0, 30)}" is ${width}x${height} px`)
		}
	return problems
}

export async function check(page: Page, path: string, width: number, colorScheme: 'light' | 'dark', only = /./) {
	await page.setViewportSize({ width, height: 900 })
	await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
	await page.goto(path)
	await page.evaluate(() => document.fonts.ready)
	await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
	const problems = (await page.evaluate(measure, width <= 760)).filter((problem) => only.test(problem))
	assert.deepEqual(problems, [], `${path} at ${width} in ${colorScheme}`)
}
