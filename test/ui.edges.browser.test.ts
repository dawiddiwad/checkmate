import test from 'node:test'
import assert from 'node:assert/strict'
import { seedEdges } from '../scripts/ui-volume.ts'
import { launchWith, open, skip, stop } from './browser.ts'

test.before(() => launchWith(seedEdges))
test.after(stop)

const widths = [1440, 1240, 1100, 900, 760, 600, 400]
const pages = [
	'/',
	'/plans/empty0',
	'/plans/odd1?view=all&focus=list',
	'/plans/odd1?view=all&item=c%3Az1%2FD2',
	'/plans/odd1?view=all&item=c%3Az1%2FD4',
	'/plans/odd1?view=all&item=q%3Az1%2FQ1',
	'/plans/odd1?view=all&item=q%3Az1%2FQ2',
	'/plans/odd1?view=area%3AArea%20label%20with%20exactly%20forty%20characters',
	'/plans/odd1/request',
]

test('long, empty, and hostile content stays inside every page at every width', { skip }, async (t) => {
	const { page, url } = await open(t)
	for (const width of widths) {
		await page.setViewportSize({ width, height: 800 })
		for (const path of pages) {
			await page.goto(url(path))
			const seen = await page.evaluate(() => ({
				wide: document.documentElement.scrollWidth,
				script: (window as unknown as { __xss?: number }).__xss ?? null,
				h1: document.querySelectorAll('h1').length,
			}))
			assert.deepEqual(seen, { wide: width, script: null, h1: 1 }, `${path} at ${width}`)
		}
	}
})

test(
	'rows of 300-character titles keep one height, and the 40-character area keeps its full name in a title',
	{ skip },
	async (t) => {
		const { page, url } = await open(t)
		for (const width of [1440, 760, 400]) {
			await page.setViewportSize({ width, height: 800 })
			await page.goto(url('/plans/odd1?view=all&focus=list'))
			await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
			const heights = await page
				.locator('[data-panel="all"] [data-row]')
				.evaluateAll((rows) => [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))])
			assert.equal(heights.length, 1, `${width}: ${heights.join(', ')}`)
		}
		await page.setViewportSize({ width: 1440, height: 800 })
		const area = await page
			.locator('[data-nav][aria-expanded] .sp-ntx')
			.first()
			.evaluate((label) => ({
				title: label.getAttribute('title') ?? label.closest('[title]')?.getAttribute('title'),
			}))
		assert.equal(area.title, 'Area label with exactly forty characters')
	}
)

test('the markup in a title shows as text, and the empty plan says what to do next', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/odd1?view=all&item=c%3Az1%2FD2'))
	assert.match((await page.locator('#record-title').textContent())!, /\*\*bold\*\* _it_ \[link\]\(javascript:/)
	assert.equal(await page.locator('#record-title a, #record-title script, #record-title img').count(), 0)
	await page.goto(url('/plans/empty0'))
	assert.ok((await page.locator('.sp-empty, .empty').count()) > 0)
})
