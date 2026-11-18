import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { seedVolume } from '../scripts/ui-volume.ts'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { decideClaim } from '../plugin/src/journal.ts'
import { answerGap } from '../plugin/src/plans.ts'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { asking, bash, openOf, seedHistory, waitOpen } from './permissions.ts'
import { addRequestActivity, askRequest, recordRequestEvent, setRequestState } from '../plugin/src/requests.ts'

test.before(() => launchWith(seedVolume))

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}
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
	'/plans/account@7/edit',
	'/settings/targets',
	'/explorations/x-1?item=explorer%3Aa1',
	'/plans/basket/request',
	'/plans/checkout@2/gaps/G2',
	'/actor',
	'/activity',
	'/activity?size=25&page=1',
	'/explorations/x-14',
	'/explorations/x-14?item=explorer%3Aa1',
	'/explorations/x-15',
	'/explorations/x-17',
	'/explorations/x-16',
	'/settings/claude',
	'/plans/login',
	'/plans/account',
	'/new',
	'/setup',
]

function measure(narrow: boolean) {
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
			const prose = [...(target.parentElement?.childNodes ?? [])].some(
				(node) => node.nodeType === 3 && node.textContent!.trim().length > 2
			)
			if (target.matches('a') && prose) continue
			const box = (target.matches('[type=checkbox], [type=radio]') && target.closest('label')) || target
			const { width, height } = box.getBoundingClientRect()
			if (width < 39.5 || height < 39.5) problems.push(`${name(target)} is ${width}x${height} px`)
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
		browserTest,
		async (t) => {
			const { page, url } = await open(t)
			for (const width of [1440, 900, 400])
				for (const path of pages) await check(page, url(path), width, colorScheme)
		}
	)

const longCommand =
	`cd /home/user/projects/checkmate-demo/a/very/long/absolute/path/to/the/application/under/test && ${'curl -sS -i -X POST -H "Content-Type: application/json" -d \'{"name":"x"}\' http://127.0.0.1:9911/api/notes?page=1 && '.repeat(3)}echo done`.slice(
		0,
		400
	)

const asked = [
	[
		'a1',
		bash(
			longCommand,
			'curl -sS *',
			'/home/user/projects/checkmate-demo/a/very/long/absolute/path/to/the/application'
		),
	],
	[
		'a2',
		{
			tool_name: 'Write',
			tool_input: {
				file_path: '/work/app/notes.txt',
				content: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'),
			},
			cwd: '/work/app',
			permission_suggestions: [],
		},
	],
	[
		'a1',
		{
			tool_name: 'Edit',
			tool_input: {
				file_path: '/work/app/src/app.js',
				old_string: 'const total = 1',
				new_string: 'const total = 2',
			},
			cwd: '/work/app',
		},
	],
	['merge', { tool_name: 'WebFetch', tool_input: { url: 'http://127.0.0.1:9911/', prompt: 'x' }, cwd: '/work/app' }],
	['a2', bash('npm view left-pad')],
] as const

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`permission requests line up at 1440, 900, and 400 in the ${colorScheme} theme`,
		{ ...browserTest, timeout: 120_000 },
		async (t) => {
			const { page, url, workspace, ui } = await open(t)
			asked.forEach(([who, body]) => void asking(ui, workspace, 'x-14', who, body))
			await waitOpen(workspace, asked.length)
			seedHistory(workspace, 'x-14', 'a1', ['echo one'])
			seedHistory(workspace, 'x-14', 'a1', ['echo two'], 'dawid', 'allow-tool')
			assert.equal(openOf(workspace)[0].id, 'P1')
			const paths = [
				'/plans/login?view=needs&focus=list',
				'/explorations/x-14',
				'/explorations/x-14?requests=1',
				'/permissions/x-14/P1',
				'/permissions/x-14/P2',
				'/permissions/x-14/P3',
				'/permissions/x-14/P4',
				'/permissions/x-14/P5',
				'/permissions/x-14/P6?view=history',
			]
			for (const width of [1440, 900, 400])
				for (const path of paths) await check(page, url(path), width, colorScheme)
		}
	)

test(
	'options 1 and 2 of a long command are fully visible at 1440 by 900, and the folder breaks at slashes',
	browserTest,
	async (t) => {
		const { page, url, workspace, ui } = await open(t, { viewport: { width: 1440, height: 900 } })
		void asking(ui, workspace, 'x-14', 'a1', asked[0][1])
		await waitOpen(workspace, 1)
		await page.goto(url('/permissions/x-14/P1'))
		await page.evaluate(() => document.fonts.ready)
		const placed = await page.evaluate(() => {
			const bottom = (index: number) => {
				const item = document.querySelectorAll('.sp-optlist li')[index].getBoundingClientRect()
				return item.bottom
			}
			return {
				first: bottom(0),
				second: bottom(1),
				room: document.querySelector('.statusbar')!.getBoundingClientRect().top,
			}
		})
		assert(
			placed.second <= placed.room,
			`option 2 ends at ${placed.second}, the status bar starts at ${placed.room}`
		)
		assert((await page.locator('.sp-ask-title').innerText()).length < 60)
		const details = await page.evaluate(() => {
			const folder = document.querySelector('dd.path')!.getBoundingClientRect()
			const label = document.querySelector('.facts dt')!.getBoundingClientRect()
			return { lines: Math.round(folder.height / 20), sameRow: Math.abs(folder.top - label.top) < 24 }
		})
		assert(details.lines <= 3, `the folder takes ${details.lines} lines`)
	}
)

function seedRequests(workspace: string) {
	const reading = openStore(workspace)
	try {
		const context = { planId: 'coupons', record: { kind: 'defect', id: 'k1/D1' } }
		const long = 'checkout/'.repeat(30)
		const running = askRequest(reading, 'qa-lead', { text: `why does D3 fail? ${long}`, context })
		setRequestState(reading, running, 'running')
		for (const line of ['Read: src/checkout/total.ts', `Bash: node ${long}${long}`, 'Grep: express fee'])
			addRequestActivity(reading, running, line)
		const answered = askRequest(reading, 'qa-lead', {
			text: 'hand over all high defects\nto the cart team',
			context,
		})
		setRequestState(reading, answered, 'answered', {
			reply: `Handed over 2 defects to the cart team. ${long}\n\n- k1/D1 (high)\n- k1/D2 (high)\n\nD9 stays, it is medium.`,
			costUsd: 0.31,
			denials: ['Bash: rm -rf build', `Write: ${long}`],
			changes: [
				{
					text: 'handed over coupons/k1/D1, coupons/k1/D2',
					command: 'claim handoff',
					subject: 'coupons',
					at: '2026-11-18T10:00:00.000Z',
					href: '/plans/coupons',
				},
				{
					text: 'answered coupons/Q4',
					command: 'gap answer',
					subject: 'coupons',
					at: '2026-11-18T10:00:01.000Z',
					href: '/plans/coupons',
				},
			],
		})
		const failed = askRequest(reading, 'qa-lead', { text: 'explain D10', context: { planId: null, record: null } })
		setRequestState(reading, failed, 'failed', {
			reason: [
				'claude ended without a reply.',
				...Array.from({ length: 20 }, (_, i) => `stack line ${i + 1} ${long}`),
			].join('\n'),
		})
		const unread = askRequest(reading, 'qa-lead', { text: 'and D4?', context })
		setRequestState(reading, unread, 'answered', { reply: 'D4 passes.', costUsd: 0.04, changes: [] })
		recordRequestEvent(
			reading,
			running,
			{ step: 'session', status: 'started', detail: { sessionId: 's' } },
			{ subjects: [] }
		)
	} finally {
		closeStore(reading)
	}
}

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`the request page and the replies list line up at 1440, 900, and 400 in the ${colorScheme} theme`,
		{ ...browserTest, timeout: 120_000 },
		async (t) => {
			const { page, url, workspace } = await open(t)
			seedRequests(workspace)
			const paths = ['/requests', '/requests/R1', '/requests/R2', '/requests/R3', '/requests', '/activity']
			for (const width of [1440, 900, 400])
				for (const path of paths) await check(page, url(path), width, colorScheme)
		}
	)

const widths = [1440, 1240, 1100, 900, 760, 600, 400]

test('no row moves when the highlight moves through 20 rows, at every width', browserTest, async (t) => {
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

test('the status bar buttons keep their place, and the hints fit, at every width', browserTest, async (t) => {
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

test('the options of the highlighted row stay inside the row with the fallback font', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.route('**/assets/fonts/*.woff2', (route) => route.abort())
	for (const width of [1440, 1100, 760, 400])
		for (const path of [pages[1], pages[2], pages[5]]) await check(page, url(path), width, 'dark')
})

function covered() {
	const docked = ['[data-bulk]:not([hidden])', '[data-say-strip]:not([hidden])', '.toast']
		.map((selector) => document.querySelector(selector))
		.filter((element): element is HTMLElement => Boolean(element) && (element as HTMLElement).offsetHeight > 0)
		.map((element) => element.getBoundingClientRect())
	const hits = (element: Element) => {
		const box = element.getBoundingClientRect()
		if (!box.height) return false
		return docked.some(
			(dock) =>
				Math.min(box.bottom, dock.bottom) - Math.max(box.top, dock.top) > 0.5 &&
				Math.min(box.right, dock.right) - Math.max(box.left, dock.left) > 0.5
		)
	}
	const problems: string[] = []
	if (docked.length === 0) problems.push('nothing is docked')
	const highlighted = document.querySelector('.hl[data-row]')
	if (highlighted && hits(highlighted)) problems.push(`highlight ${highlighted.getAttribute('data-key')}`)
	const parts = document.querySelectorAll('[data-nav], [data-panel]:not([hidden]) :is([data-row], .sp-gh)')
	for (const part of parts) {
		part.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		if (hits(part))
			problems.push(
				`${part.getAttribute('data-key') ?? part.getAttribute('data-target') ?? part.textContent?.trim()}`
			)
	}
	return problems
}

const docks = [
	[1440, 900],
	[1440, 500],
	[900, 700],
	[760, 700],
	[400, 700],
] as const

test('the selection strip covers no part of either pane, at every size', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const [width, height] of docks) {
		await page.setViewportSize({ width, height })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('Space')
		await page.locator('[data-bulk]:not([hidden])').waitFor()
		const rows = await page.locator('[data-panel="all"] [data-row]').count()
		for (let step = 0; step < rows; step++) {
			await page.keyboard.press('ArrowDown')
			assert.deepEqual(await page.evaluate(covered), [], `${width}x${height} step ${step}`)
		}
	}
})

test('the toast covers no part of either pane, at every size', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const [width, height] of docks) {
		await page.setViewportSize({ width, height })
		await page.goto(url('/plans/coupons?view=all&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.evaluate(() => {
			const note = document.createElement('div')
			note.className = 'toast'
			note.setAttribute('role', 'status')
			note.textContent = 'Accepted coupons · k1/D10'
			document.body.append(note)
			window.dispatchEvent(new Event('resize'))
		})
		const rows = await page.locator('[data-panel="all"] [data-row]').count()
		for (let step = 0; step < rows; step++) {
			await page.keyboard.press('ArrowDown')
			assert.deepEqual(await page.evaluate(covered), [], `${width}x${height} step ${step}`)
		}
	}
})

test('a status message is read in full at every width, and the key hints make room for it', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const items: Array<[number, string, string]> = [
		[1440, 'c', 'k1/D10'],
		[1240, 'c', 'k1/D12'],
		[1100, 'q', 'k1/Q3'],
		[900, 'q', 'k1/Q4'],
		[760, 'q', 'k1/Q6'],
		[600, 'q', 'k1/Q7'],
		[400, 'q', 'k1/Q8'],
	]
	for (const [width, kind, id] of items) {
		await page.setViewportSize({ width, height: 700 })
		await page.goto(url(`/plans/coupons?view=needs&focus=list&at=${kind}%3A${encodeURIComponent(id)}`))
		await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
		await page.waitForFunction((key) => document.activeElement?.getAttribute('data-key') === key, `${kind}:${id}`)
		read(workspace, (store) =>
			kind === 'c'
				? decideClaim(store, 'qa-lead', {
						planId: 'coupons',
						claimId: id,
						verdict: 'approved',
						rationale: 'Elsewhere.',
					})
				: answerGap(store, 'qa-lead', {
						planId: 'coupons',
						gapId: id,
						kind: 'defer',
						value: 'Later.',
						rationale: 'Elsewhere.',
					})
		)
		await page.waitForFunction(
			(key) =>
				document.activeElement?.matches('[data-row]') &&
				document.activeElement.getAttribute('data-key') !== key,
			`${kind}:${id}`
		)
		await page.keyboard.press('1')
		const message = await page.evaluate(() => {
			const say = document.querySelector('[data-say]') as HTMLElement
			const strip = document.querySelector('[data-say-strip]') as HTMLElement
			const shown = [say, strip].find(
				(element) => !element.hidden && element.offsetWidth > 0 && element.textContent
			)
			const hints = document.querySelector('[data-hints]') as HTMLElement
			return {
				text: shown?.textContent ?? '',
				clipped: shown
					? shown.scrollWidth > shown.clientWidth + 0.5 || shown.scrollHeight > shown.clientHeight + 0.5
					: true,
				hintsClipped: hints.scrollWidth > hints.clientWidth + 0.5,
				keys: Boolean(hints.querySelector('[data-cap="?"]:not([hidden])')),
			}
		})
		assert.match(
			message.text,
			new RegExp(`^Nothing is recorded\\. ${id} was (decided|answered) in another session\\.`),
			`${width}`
		)
		assert.equal(message.clipped, false, `${width}: the message is cut`)
		assert.equal(message.hintsClipped, false, `${width}: a hint is cut`)
		assert.equal(message.keys, true, `${width}: ? Keys is gone`)
		assert.deepEqual(await page.evaluate(covered), [], `${width}: the message covers the panes`)
	}
})

for (const path of ['/activity', '/explorations/x-14']) {
	test(`no row of ${path} moves when the highlight moves, at every width`, browserTest, async (t) => {
		const { page, url } = await open(t)
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 })
			await page.goto(url(path))
			await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
			const boxes = () =>
				page.evaluate(() => {
					const list = document.querySelector('[data-list]')!.getBoundingClientRect()
					return [...document.querySelectorAll('[data-list] [data-row]')].map((row) => {
						const box = row.getBoundingClientRect()
						return `${(box.top - list.top).toFixed(1)}:${box.height.toFixed(1)}`
					})
				})
			const first = await boxes()
			const rows = first.length
			for (let step = 0; step < rows + 1; step++) {
				await page.keyboard.press('ArrowDown')
				assert.deepEqual(await boxes(), first, `${path} at ${width} after ${step + 1} steps`)
			}
		}
	})
}

test(
	'a row whose options do not all fit shows the number of options and no sideways scroll',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		for (const width of [1440, 900, 400]) {
			await page.setViewportSize({ width, height: 900 })
			await page.goto(url('/activity'))
			await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
			await page.evaluate(() => {
				for (const label of document.querySelectorAll('.sp-c-opts .sp-btn > span'))
					label.textContent += ' with a very long label'.repeat(60)
				window.dispatchEvent(new Event('resize'))
			})
			for (let step = 0; step < 12 && !(await page.locator('.hl[data-row] [data-option]').count()); step++)
				await page.keyboard.press('ArrowDown')
			const shown = await page.evaluate(() => {
				const row = document.querySelector('.hl[data-row]') as HTMLElement
				const more = row.querySelector('.sp-c-more') as HTMLElement
				const buttons = [...row.querySelectorAll('[data-option]')].filter(
					(button) => (button as HTMLElement).offsetWidth > 0
				)
				return {
					many: row.classList.contains('many'),
					more: more.offsetWidth > 0 ? more.textContent!.replace(/\s+/g, ' ').trim() : null,
					buttons: buttons.length,
					overflow: row.scrollWidth > row.clientWidth + 1,
					page: document.documentElement.scrollWidth > window.innerWidth,
					inside: more.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5,
				}
			})
			assert.deepEqual(
				shown,
				{ many: true, more: '1 option', buttons: 0, overflow: false, page: false, inside: true },
				`${width}`
			)
			await page.keyboard.press('1')
			await page.waitForFunction(() =>
				[...document.querySelectorAll('[data-say], [data-say-strip]')].some((element) =>
					/Open the row to see them/.test(element.textContent ?? '')
				)
			)
			assert.equal(await page.locator('dialog[open]').count(), 0)
		}
	}
)

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`the action dialogs line up and meet the contrast and tap rules in the ${colorScheme} theme`,
		browserTest,
		async (t) => {
			const { page, url } = await open(t)
			const dialogs: Array<[string, string]> = [
				['/plans/coupons', '[data-panel]:not([hidden]) [data-act="test"]'],
				['/plans/search', '[data-panel]:not([hidden]) [data-act="follow"]'],
				['/explorations/x-14', '[data-act="stop-x-14"]'],
			]
			for (const width of [1440, 900, 400])
				for (const [path, opener] of dialogs) {
					await page.setViewportSize({ width, height: 900 })
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
					await page.goto(url(path))
					await page.evaluate(() => document.fonts.ready)
					await page.locator(opener).first().click()
					await page.locator('dialog[open]').waitFor()
					const problems = await page.evaluate(measure, width <= 760)
					assert.deepEqual(problems, [], `${path} dialog at ${width} in ${colorScheme}`)
					const box = await page.locator('dialog[open]').boundingBox()
					assert(box && box.x >= 0 && box.x + box.width <= width + 0.5, `${path} dialog fits ${width}`)
				}
		}
	)

for (const colorScheme of ['dark', 'light'] as const)
	test(
		`the first-run form with its assumptions lines up at 1440, 900, and 400 in the ${colorScheme} theme`,
		browserTest,
		async (t) => {
			const { page, url } = await open(t)
			for (const width of [1440, 900, 400])
				for (const address of ['http://localhost:3000', 'http://shop.example.com']) {
					await page.setViewportSize({ width, height: 900 })
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
					await page.goto(url('/setup'))
					await page.evaluate(() => document.fonts.ready)
					await page.locator('#setup-url').fill(address)
					await page.locator('[data-assumed]:not([hidden]) [data-assumed-list] dt').first().waitFor()
					const problems = await page.evaluate(measure, width <= 760)
					assert.deepEqual(problems, [], `${address} at ${width} in ${colorScheme}`)
				}
		}
	)
