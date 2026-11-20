import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { mergedClaims, mergedQuestions, operationLog } from '../plugin/src/views.ts'
import { decideClaim } from '../plugin/src/journal.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { open, browserTest, stop, launchWith } from './browser.ts'
import { done, ended, launched, openTest, stacks } from './explorations.ts'
import { evidenceFile } from './support.ts'
import { fakeClaude } from './claude.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

test('plan chats preserve the review view through new chat and browser back', browserTest, async (t) => {
	const fake = fakeClaude(t, { request: { result: 'Plan reply.' } })
	const { page, url } = await open(t, {}, { ...process.env, ...fake.env, CHECKMATE_HARNESS: 'claude' })
	const review = url('/plans/coupons?view=all')
	const summary = await page.context().newPage()
	await summary.goto(review)
	await page.goto(review)
	await page.getByRole('treeitem', { name: 'Plan chats' }).click()
	await page.waitForURL(url('/plans/coupons?view=all&chat=list'))
	await page.getByRole('link', { name: 'New chat' }).click()
	await page.waitForURL(url('/plans/coupons?view=all&newChat=1'))
	await page.getByLabel('Message', { exact: true }).fill('Explain the checks')
	await page.getByRole('button', { name: 'Send', exact: true }).click()
	await page.getByText('Plan reply.', { exact: true }).waitFor()
	const conversation = page.url()
	assert.match(conversation, /\/plans\/coupons\?view=all&chat=[0-9a-f-]+$/)
	await summary
		.locator('[data-panel="all"]')
		.getByText(/Total cost \$0\.06/)
		.waitFor()
	await page.goBack()
	await page.waitForURL(url('/plans/coupons?view=all&newChat=1'))
	await page.getByRole('link', { name: 'Plan', exact: true }).click()
	await page.waitForURL(review)
	await page.getByRole('heading', { name: 'All items', exact: true }).waitFor()
	await page.goto(conversation)
	await page.keyboard.press('/')
	await page.locator('[data-find-input]').fill('Which check comes next?')
	await page.locator('[data-find-ask]').click()
	await page.getByText('Which check comes next?', { exact: true }).waitFor()
	assert.equal(page.url(), conversation)
})

test('review lists expose row controls and hide decorative separators from the plan tree', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/'))
	const plans = page.getByRole('list', { name: 'Plans', exact: true })
	await plans
		.getByRole('listitem')
		.filter({ hasText: 'New change' })
		.getByRole('link', { name: /New change/ })
		.waitFor()

	await page.goto(url('/plans/coupons?view=needs'))
	const tree = page.getByRole('tree', { name: 'Views of coupons' })
	assert.equal(await tree.getByRole('separator').count(), 0)
	await page.locator('[data-panel="needs"]').getByRole('listitem').first().getByRole('checkbox').waitFor()

	await page.goto(url('/activity'))
	const activity = page.getByRole('list', { name: 'Runs and chat messages' })
	await activity.getByRole('listitem').getByRole('button', { name: 'Stop…' }).waitFor()
})

async function fits(page: Page, path: string) {
	for (const colorScheme of ['light', 'dark'] as const)
		for (const width of [1440, 900]) {
			await page.setViewportSize({ width, height: 900 })
			await page.emulateMedia({ colorScheme })
			await page.goto(path)
			await page.locator('main').waitFor()
			const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
			assert(wide <= 0, `${path} scrolls ${wide} px sideways at ${width} in ${colorScheme}`)
			const clipped = await page.evaluate(
				() =>
					[...document.querySelectorAll('main pre')].filter((pre) => pre.scrollWidth > pre.clientWidth + 1)
						.length
			)
			assert.equal(clipped, 0, `${path} clips a preformatted block at ${width}`)
			const small = await page.evaluate(() =>
				[...document.querySelectorAll('body *')]
					.filter((element) =>
						[...element.childNodes].some((node) => node.nodeType === 3 && node.textContent!.trim())
					)
					.filter((element) => (element as HTMLElement).offsetParent !== null)
					.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12)
					.map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
			)
			assert.deepEqual(small, [], `${path} has text below 12 px at ${width}`)
		}
	await page.setViewportSize({ width: 1440, height: 900 })
}

const highlighted = (page: Page) =>
	page.evaluate(() => ({
		key:
			document
				.querySelector('.hl[data-row], .hl[data-nav], .hl[data-sub], .hl[data-vfile]')
				?.getAttribute('data-key') ??
			document.querySelector('.hl[data-nav]')?.getAttribute('data-target') ??
			null,
		focus:
			(document.activeElement as HTMLElement | null)?.dataset.key ??
			(document.activeElement as HTMLElement | null)?.dataset.target ??
			null,
	}))

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}

function decisions(workspace: string) {
	return read(workspace, (store) => operationLog(store, { limit: 1000 }).map((row) => row.command)).filter(
		(command) => ['claim accept', 'claim reject', 'gap answer'].includes(command)
	).length
}

async function listRows(page: Page) {
	return page
		.locator('[data-panel]:not([hidden]) [data-row]')
		.evaluateAll((rows) =>
			rows.filter((row) => !(row as HTMLElement).hidden).map((row) => (row as HTMLElement).dataset.key!)
		)
}

test(
	'the keys walk home, navigator, list, record, and viewer, and Left or Esc goes back one level',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		await page.goto(url('/'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		const plans = await page
			.locator('[data-row]')
			.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.key))
		assert.equal((await highlighted(page)).key, plans[0])
		for (let step = 0; step < plans.indexOf('plan:coupons'); step++) await page.keyboard.press('ArrowDown')
		assert.equal((await highlighted(page)).key, 'plan:coupons')
		await page.keyboard.press('ArrowRight')
		await page.waitForURL(/\/plans\/coupons/)
		await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
		assert.deepEqual(await highlighted(page), { key: 'needs', focus: 'needs' })
		await page.keyboard.press('ArrowDown')
		assert.equal((await highlighted(page)).key, 'all')
		assert.equal(await page.locator('[data-panel="all"]').isVisible(), true)
		await page.keyboard.press('Enter')
		const row = (await highlighted(page)).key!
		assert.match(row, /^[cq]:/)
		assert.deepEqual(await highlighted(page), { key: row, focus: row })
		await page.keyboard.press('ArrowRight')
		await page.waitForURL((address) => address.searchParams.get('item') === row)
		await page.locator('[data-drawer]').waitFor()
		assert.equal(await page.evaluate(() => document.activeElement?.matches('.sp-dhead')), true)
		await page.keyboard.press('Escape')
		await page.waitForURL((address) => !address.searchParams.has('item'))
		await page.waitForFunction((key) => document.activeElement?.getAttribute('data-key') === key, row)
		await page.keyboard.press('ArrowLeft')
		await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
		assert.equal((await highlighted(page)).key, 'all')
		await page.keyboard.press('Escape')
		await page.waitForURL(url('/?at=plan%3Acoupons'))
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'plan:coupons')
		for (const key of ['j', 'k', 'a', 'r', 'x', 'd', 'g', 'c', 'Backspace', 'Delete', 'Home', 'End', 'PageDown']) {
			const before = page.url()
			await page.keyboard.press(key)
			assert.equal(page.url(), before, key)
		}
	}
)

test('Down then 1 in the same tick decides the new row, never the previous one', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const first = (await highlighted(page)).key!
	const keys = await listRows(page)
	const second = keys[keys.indexOf(first) + 1]
	assert.match(first, /^c:/)
	assert.match(second, /^c:/)
	await page.evaluate(() => {
		const target = document.activeElement!
		for (const key of ['ArrowDown', '1'])
			target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
	})
	await page
		.getByRole('status')
		.filter({ hasText: `Accepted coupons · ${second.slice(2)}` })
		.waitFor()
	const claims = read(workspace, (store) => mergedClaims(store, 'coupons'))
	assert.equal(claims.find((claim) => claim.id === second.slice(2))!.state, 'accepted')
	assert.notEqual(claims.find((claim) => claim.id === first.slice(2))!.state, 'accepted')
})

test(
	'numbers decide by key, one decision for each press, and the next waiting row takes the highlight',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		const before = decisions(workspace)
		await page.goto(url('/plans/coupons?view=needs&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		for (let done = 0; done < 3; done++) {
			const key = (await highlighted(page)).key!
			await page.keyboard.press(key.startsWith('c:') ? '1' : '3')
			await page.waitForURL((address) => address.searchParams.get('at') !== key)
			await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
			assert(!(await listRows(page)).includes(key), key)
		}
		assert.equal(decisions(workspace), before + 3)
		const key = (await highlighted(page)).key!
		await page.keyboard.press('2')
		await page.waitForFunction(() => document.activeElement?.matches('[data-extra]:not([hidden]) textarea'))
		await page.keyboard.type('Only until 23:59 in the shop time zone.')
		await page.keyboard.press('Escape')
		await page.waitForFunction((wanted) => document.activeElement?.getAttribute('data-key') === wanted, key)
		await page.keyboard.press('2')
		assert.equal(
			await page.locator('[data-extra]:not([hidden]) textarea').inputValue(),
			'Only until 23:59 in the shop time zone.'
		)
		await page.keyboard.press('Shift+Enter')
		await page.keyboard.type('Also for a coupon of a partner shop.')
		await page.keyboard.press('Enter')
		await page
			.getByRole('status')
			.filter({ hasText: `${key.slice(2)}` })
			.waitFor()
		const answer = read(
			workspace,
			(store) => mergedQuestions(store, 'coupons').find((item) => `q:${item.id}` === key)!.answer
		)
		assert.equal(answer, 'Only until 23:59 in the shop time zone.\nAlso for a coupon of a partner shop.')
	}
)

test('every option works by mouse, and a click then an arrow moves from the clicked row', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=all'))
	await page.locator('[data-nav][data-target="needs"]').click()
	assert.deepEqual(await highlighted(page), { key: 'needs', focus: 'needs' })
	await page.keyboard.press('ArrowDown')
	assert.deepEqual(await highlighted(page), { key: 'all', focus: 'all' })
	await page.locator('[data-panel="all"] [data-row][data-key^="c:"][data-needs]').first().click()
	await page.waitForURL((address) => address.searchParams.has('item'))
	const key = new URL(page.url()).searchParams.get('item')!
	await page.locator('[data-drawer] .sp-dhead [data-option]', { hasText: 'No' }).click()
	await page.locator('[data-drawer] #reject-text').waitFor()
	await page.locator('[data-drawer] #reject-text').fill('Sale items are excluded on purpose.')
	await page.locator('[data-drawer]').getByRole('button', { name: 'Reject' }).click()
	await page
		.getByRole('status')
		.filter({ hasText: `Rejected coupons · ${key.slice(2)}` })
		.waitFor()
	assert.equal(
		read(workspace, (store) => mergedClaims(store, 'coupons').find((item) => `c:${item.id}` === key)!.state),
		'rejected'
	)
	const hover = await page.locator('.sb-btn[data-keys-open]').evaluate((button) => getComputedStyle(button).cursor)
	assert.equal(hover, 'pointer')
	await page.locator('.sb-btn[data-keys-open]').click()
	await page.getByRole('heading', { name: 'Keys' }).waitFor()
	await page.getByRole('button', { name: /Close/ }).click()
})

test('Browser Back equals Left, and Forward redoes the Right', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
	await page.keyboard.press('ArrowRight')
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const row = (await highlighted(page)).key!
	await page.keyboard.press('ArrowRight')
	await page.waitForURL((address) => address.searchParams.get('item') === row)
	await page.goBack()
	await page.waitForURL((address) => !address.searchParams.has('item'))
	await page.waitForFunction((key) => document.activeElement?.getAttribute('data-key') === key, row)
	await page.goBack()
	await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
	await page.goForward()
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	assert.equal((await highlighted(page)).key, row)
})

test('returning from a record keeps the eligible selected rows in the review list', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const first = (await highlighted(page)).key!
	assert.match(first, /^c:/)
	const picked = () => page.locator('[data-panel="needs"]').getByRole('checkbox', { checked: true }).all()
	const names = async () => Promise.all((await picked()).map((box) => box.getAttribute('aria-label')))
	await page.keyboard.press('Space')
	await page.keyboard.press('Shift+ArrowDown')
	const checked = await names()
	assert.equal(checked.length, 2)
	const strip = page.getByRole('group', { name: 'Selection', exact: true })
	for (const back of [
		() => page.goBack(),
		() => page.keyboard.press('Escape'),
		() => page.getByRole('link', { name: /Close/ }).click(),
	]) {
		await page.keyboard.press('Enter')
		await page.locator('[data-drawer]').waitFor()
		await back()
		await page.waitForURL((address) => !address.searchParams.has('item'))
		await strip.getByText('2 selected').waitFor()
		assert.deepEqual(await names(), checked)
	}
	await page.keyboard.press('Enter')
	await page.locator('[data-drawer]').waitFor()
	read(workspace, (store) =>
		decideClaim(store, 'qa-lead', {
			planId: 'coupons',
			claimId: first.slice(2),
			verdict: 'approved',
			rationale: 'Accepted in another session.',
		})
	)
	await page.getByRole('link', { name: /Close/ }).click()
	await strip.getByText('1 selected').waitFor()
	assert.deepEqual(await names(), [checked[1]])
	await page.keyboard.press('Escape')
	assert.equal((await names()).length, 0)
})

test(
	'Space and Shift with the arrows select rows, Shift+Up shrinks the range, and Esc clears it',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		await page.goto(url('/plans/coupons?view=needs&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		const picked = () => page.locator('[data-panel="needs"] [data-row].sel').count()
		await page.keyboard.press('Space')
		assert.equal(await picked(), 1)
		await page.keyboard.press('Space')
		assert.equal(await picked(), 0)
		await page.keyboard.press('Shift+ArrowDown')
		await page.keyboard.press('Shift+ArrowDown')
		await page.keyboard.press('Shift+ArrowDown')
		assert.equal(await picked(), 4)
		await page.keyboard.press('Shift+ArrowUp')
		assert.equal(await picked(), 3)
		assert.equal(await page.locator('[data-panel="needs"] [data-row].sel [data-pick-box]:checked').count(), 3)
		await page.keyboard.press('Escape')
		assert.equal(await picked(), 0)
		assert.match(page.url(), /focus=list/)
	}
)

test(
	'the navigator expands an area, chooses a build by number, and keeps the highlight in view',
	browserTest,
	async (t) => {
		const { page, url } = await open(t, { viewport: { width: 1440, height: 640 } })
		await page.goto(url('/plans/coupons'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
		while ((await highlighted(page)).key !== 'area:Codes') await page.keyboard.press('ArrowDown')
		assert.equal(await page.locator('[data-panel="area:Codes"]').isVisible(), true)
		const expanded = () => page.locator('[data-nav][data-target="area:Codes"]').getAttribute('aria-expanded')
		if ((await expanded()) === 'true') await page.keyboard.press('ArrowLeft')
		assert.equal(await expanded(), 'false')
		await page.keyboard.press('ArrowRight')
		assert.equal(await expanded(), 'true')
		await page.locator('[data-navigator] .sp-nhead kbd').first().waitFor()
		const all = (await listRows(page)).length
		await page.keyboard.press('3')
		const third = (await listRows(page)).length
		assert(third < all, `${third} of ${all}`)
		await page.keyboard.press('3')
		assert.equal((await listRows(page)).length, all)
		await page.keyboard.press('ArrowDown')
		assert.equal((await highlighted(page)).key, 'rule:R1')
		await page.keyboard.press('ArrowLeft')
		assert.equal(await expanded(), 'false')
		assert.equal((await highlighted(page)).key, 'area:Codes')
		for (let step = 0; step < 30; step++) await page.keyboard.press('ArrowDown')
		const box = await page.evaluate(() => {
			const row = document.querySelector('.hl[data-nav]')!.getBoundingClientRect()
			const nav = document.querySelector('[data-navigator]')!.getBoundingClientRect()
			return { top: row.top, bottom: row.bottom, navTop: nav.top, navBottom: nav.bottom }
		})
		assert(box.top >= box.navTop && box.bottom <= box.navBottom, JSON.stringify(box))
	}
)

test('the highlighted row stays clear of the top bar and the status bar after long runs', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/checkout?view=all&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const clear = () =>
		page.evaluate(() => {
			const row = document.querySelector('.hl[data-row]')!.getBoundingClientRect()
			const top = document.querySelector('.top')!.getBoundingClientRect().bottom
			const bottom = document.querySelector('.statusbar')!.getBoundingClientRect().top
			return row.top >= top && row.bottom <= bottom ? null : { row: [row.top, row.bottom], top, bottom }
		})
	for (let step = 0; step < 60; step++) await page.keyboard.press('ArrowDown')
	assert.equal(await clear(), null)
	for (let step = 0; step < 60; step++) await page.keyboard.press('ArrowUp')
	assert.equal(await clear(), null)
})

test('a form sent while the UI is stopped keeps the text and says that nothing is recorded', browserTest, async (t) => {
	const { page, url, ui } = await open(t)
	await page.goto(url('/plans/coupons?item=q%3Ak1%2FQ3'))
	await page.locator('[data-drawer] #answer-text').fill('Until the end of the day.')
	await ui.close()
	await page.locator('[data-drawer]').getByRole('button', { name: 'Send the answer' }).click()
	await page
		.locator('[data-drawer] [role="alert"]', {
			hasText: 'Checkmate did not answer. Nothing is recorded, and your text is kept.',
		})
		.waitFor()
	assert.equal(await page.locator('#answer-text').inputValue(), 'Until the end of the day.')
})

test('All items finds a defect and shows its evidence in two clicks', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/checkout?view=all'))
	await page.locator('[data-panel="all"] [data-key="c:a1/D1"]').click()
	await page.locator('[data-drawer] [data-sub][data-label="a1-D1.png"]').click()
	await page.waitForURL(/file=0/)
	await page.locator('.sp-viewer img[src$="/claims/a1/D1/evidence/0"]').waitFor()
	await page.keyboard.press('ArrowDown')
	await page.locator('[data-vfig="1"]').waitFor()
	assert.match(page.url(), /file=1/)
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL((address) => !address.searchParams.has('file'))
	await page.locator('[data-drawer]').waitFor()
})

test('HTML evidence renders in an isolated preview and still downloads', browserTest, async (t) => {
	const { page, url, workspace } = await open(t, { colorScheme: 'dark' })
	const name = 'capture.html'
	const source = Buffer.from(
		`\uFEFF<!doctype html>
		<style>h1 { color: rgb(15, 30, 45) }</style>
		<h1>Captured result</h1>
		<script>document.querySelector('h1').textContent = 'Script ran'</script>
		<img src="/assets/favicon.svg?from-evidence" alt="">`,
		'utf16le'
	)
	const store = openStore(workspace)
	try {
		openTest(store, 'checkout', 'x-html', 'html-build', 'local')
		launched(store, 'x-html', 'h1')
		ended(store, 'x-html', 'h1', [{ ...stacks, evidence: [evidenceFile(store, 'x-html', name, source)] }])
		done(store, 'x-html')
	} finally {
		closeStore(store)
	}
	let imageServed = false
	page.on('response', (response) => {
		if (response.url().endsWith('?from-evidence')) imageServed = true
	})
	await page.goto(url('/plans/checkout?view=all&item=c%3Ah1%2FD1&file=0'))
	const iframe = page.getByTitle(`Preview of ${name}`)
	const heading = iframe.contentFrame().getByRole('heading', { name: 'Captured result' })
	await heading.waitFor()
	assert.equal(await heading.evaluate((element) => getComputedStyle(element).color), 'rgb(15, 30, 45)')
	const body = iframe.contentFrame().locator('body')
	assert.equal(await body.evaluate((element) => getComputedStyle(element).color), 'rgb(255, 255, 255)')
	const light = page.waitForEvent('framenavigated', (frame) => frame.url().endsWith('preview=1&theme=light'))
	await page.locator('[data-theme-form] button').click()
	await light
	assert.equal(await body.evaluate((element) => getComputedStyle(element).color), 'rgb(0, 0, 0)')
	assert.equal(await heading.evaluate((element) => getComputedStyle(element).color), 'rgb(15, 30, 45)')
	assert.equal(await iframe.evaluate((element) => (element as HTMLIFrameElement).contentDocument), null)
	const image = iframe.contentFrame().locator('img')
	assert.equal(await image.evaluate((element: HTMLImageElement) => element.naturalWidth), 0)
	assert.equal(imageServed, false)
	const waiting = page.waitForEvent('download')
	await page.locator('[data-vfig="0"]').getByRole('link', { name: 'Download' }).click()
	const download = await waiting
	assert.equal(download.suggestedFilename(), name)
	assert.deepEqual(await readFile(await download.path()), source)
})

test('on a narrow window the record covers the list and Esc goes back to the row', browserTest, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 400, height: 800 } })
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const options = await page
		.locator('.hl[data-row] [data-option]')
		.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)))
	assert(options.length > 0 && options.every((height) => height >= 40), JSON.stringify(options))
	const row = (await highlighted(page)).key!
	await page.keyboard.press('Enter')
	await page.locator('[data-drawer]').waitFor()
	const drawer = await page.locator('[data-drawer]').boundingBox()
	assert.equal(Math.round(drawer!.width), 400)
	await page.keyboard.press('Escape')
	await page.waitForFunction((key) => document.activeElement?.getAttribute('data-key') === key, row)
})

test('the plan page opens what needs the person and folds the rest', browserTest, async (t) => {
	const { page, url } = await open(t)
	await fits(page, url('/plans/checkout@2'))
	await fits(page, url('/plans/basket/request'))
	await page.goto(url('/plans/checkout@2'))
	const unfolded = (id: string) =>
		page.locator(`details.fold:has(#${id})`).evaluate((details) => (details as HTMLDetailsElement).open)
	assert.equal(await unfolded('claims'), true)
	assert.equal(await unfolded('questions'), true)
	assert.equal(await unfolded('tests'), false)
	assert.equal(await unfolded('history'), false)
	await page.getByRole('link', { name: /^Tests/ }).click()
	await page.locator('details.fold[open]:has(#tests)').waitFor()
	await page.locator('[data-region="claims"] a.mono').first().click()
	await page.waitForURL(/\/plans\/checkout\?view=all&item=c%3A/)
	await page.locator('[data-drawer]').waitFor()
	await page.goBack()
	await page.waitForURL(/\/plans\/checkout@2/)
	await page.getByRole('link', { name: /Decide \d+ items in Needs you/ }).click()
	await page.waitForURL(/\/plans\/checkout\?view=needs/)
})

test('every page in a plan fits, and Esc goes to its parent', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const path of [
		'/explorations/x-1',
		'/runs/run-7',
		'/plans/checkout?item=c%3Aa1%2FD1',
		'/plans/checkout@2/gaps/G2',
	])
		await fits(page, url(path))
	await page.goto(url('/runs/run-7?item=test%3AT2'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/runs\/run-7$/)
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/plans\/checkout@2$/)
})

test(
	'the run page lists tests, findings, and gaps, and accepts the result from the overview',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		await fits(page, url('/runs/run-7'))
		await fits(page, url('/runs/run-7?item=test%3AT2'))
		await fits(page, url('/runs/run-7?item=coverage'))
		await page.goto(url('/runs/run-7'))
		await page.locator('[data-key="finding:F1"]').click()
		await page.waitForURL(/item=finding%3AF1/)
		await page.locator('.q-detail .finding a[data-go]').first().click()
		await page.waitForURL(/item=test%3AT2#T2\.A2$/)
		await page.locator('[data-key="T2.A2"]').waitFor()
		await page.keyboard.press('ArrowUp')
		assert.equal((await highlighted(page)).key, 'test:T1')
		await page.goto(url('/runs/run-7'))
		await page.locator('#rationale').fill('The defects are known.')
		await page.locator('[data-choose] button').first().click()
		await page.getByText('Confirm acceptance').waitFor()
		await page.keyboard.press('Control+Enter')
		await page.getByRole('status').filter({ hasText: 'Accepted run-7' }).waitFor()
		await page.locator('[data-region="state"]', { hasText: 'accepted' }).waitFor()
	}
)

async function menusInside(page: Awaited<ReturnType<typeof open>>['page'], path: string) {
	const menus = page.locator('details[data-menu]:visible > summary')
	const count = await menus.count()
	assert(count > 0, `${path}: no menu`)
	for (let index = 0; index < count; index++) {
		await menus.nth(index).click()
		await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
		const wrong = await page.evaluate(() => {
			const width = window.innerWidth
			const list = document.querySelector('details[data-menu][open] .menu-list')!
			return [list, ...list.querySelectorAll('*')]
				.filter((element) => {
					const box = element.getBoundingClientRect()
					return box.left < 0 || box.right > width || element.scrollWidth > element.clientWidth + 1
				})
				.map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
		})
		assert.deepEqual(wrong, [], `${path} at ${page.viewportSize()?.width}px`)
		await page.keyboard.press('Escape')
	}
}

test('every menu opens inside the window from 1440px to 390px', browserTest, async (t) => {
	const { page, url } = await open(t)
	for (const width of [1440, 760, 600, 390]) {
		await page.setViewportSize({ width, height: 900 })
		for (const path of ['/plans/checkout@2', '/runs/run-7?item=summary', '/explorations/x-1?item=summary']) {
			await page.goto(url(path))
			await menusInside(page, path)
		}
	}
})

test('the exploration report menu opens above the status bar when the trigger is near it', browserTest, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 390, height: 480 } })
	await page.goto(url('/explorations/x-1?item=summary'))
	const summary = page.getByText('Download report', { exact: true })
	await summary.evaluate((element) => element.scrollIntoView({ block: 'end' }))
	await summary.click()
	await page.waitForFunction(() => {
		const menu = document.querySelector('main details[data-menu][open]')
		if (!menu) return false
		const list = menu.querySelector('.menu-list')!.getBoundingClientRect()
		const top = document.querySelector('.top')!.getBoundingClientRect().bottom
		const bottom = document.querySelector('.statusbar')!.getBoundingClientRect().top
		return list.top >= top && list.bottom <= Math.min(bottom, menu.getBoundingClientRect().top)
	})
	const waiting = page.waitForEvent('download')
	await page.getByRole('link', { name: /^Markdown/ }).click()
	assert.equal((await waiting).suggestedFilename(), 'x-1-report.md')
})

test('a decision from another tab after the page loaded is refused and names the first', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const key = (await highlighted(page)).key!
	const accepted = () =>
		read(workspace, (store) => mergedClaims(store, 'coupons').filter((claim) => claim.state === 'accepted').length)
	const before = accepted()
	read(workspace, (store) =>
		decideClaim(store, 'qa-lead', {
			planId: 'coupons',
			claimId: key.slice(2),
			verdict: 'approved',
			rationale: 'Elsewhere.',
		})
	)
	await page.keyboard.press('1')
	const id = key.slice(2)
	await page
		.getByText(
			new RegExp(
				`^(${id} was accepted by qa-lead\\.|Nothing is recorded\\. ${id} was decided in another session\\.)`
			)
		)
		.waitFor()
	assert.equal(accepted(), before + 1)
})

function within(promise: Promise<void>, what: string) {
	return Promise.race([
		promise,
		new Promise<void>((_, fail) => setTimeout(() => fail(new Error(`${what} did not happen`)), 5000)),
	])
}

test('a live update that lands while a decision is sent does not lose the refusal', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	let releaseRefresh = () => {}
	let releasePost = () => {}
	let held = false
	let posted = false
	const refreshHeld = new Promise<void>((done) =>
		page.route('**/plans/coupons?**', async (route) => {
			if (held || route.request().resourceType() !== 'fetch') return route.continue()
			held = true
			done()
			await new Promise<void>((release) => (releaseRefresh = release))
			await route.continue()
		})
	)
	const postHeld = new Promise<void>((done) =>
		page.route('**/claims/**', async (route) => {
			if (posted || route.request().method() !== 'POST') return route.continue()
			posted = true
			done()
			await new Promise<void>((release) => (releasePost = release))
			await route.continue()
		})
	)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const key = (await highlighted(page)).key!
	read(workspace, (store) =>
		decideClaim(store, 'qa-lead', {
			planId: 'coupons',
			claimId: key.slice(2),
			verdict: 'approved',
			rationale: 'Elsewhere.',
		})
	)
	await within(refreshHeld, 'the live refresh')
	await page.keyboard.press('1')
	await within(postHeld, 'the decision request')
	releaseRefresh()
	await page.waitForTimeout(300)
	releasePost()
	await page.getByText(`${key.slice(2)} was accepted by qa-lead.`).waitFor()
})

test('a number key after a live update moved the highlight records nothing and says why', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const key = (await highlighted(page)).key!
	read(workspace, (store) =>
		decideClaim(store, 'qa-lead', {
			planId: 'coupons',
			claimId: key.slice(2),
			verdict: 'approved',
			rationale: 'Elsewhere.',
		})
	)
	await page.getByText(`${key.slice(2)} was decided in another session.`).waitFor()
	const next = (await highlighted(page)).key!
	assert.notEqual(next, key)
	await page.keyboard.press('1')
	await page.getByText(`Nothing is recorded. ${key.slice(2)} was decided in another session.`).waitFor()
	assert.equal(await page.locator('.toast').count(), 0)
	const state = () =>
		read(workspace, (store) => mergedClaims(store, 'coupons').find((claim) => `c:${claim.id}` === next)!.state)
	assert.equal(state(), 'suspected')
	await page.keyboard.press('1')
	await page
		.getByRole('status')
		.filter({ hasText: `Accepted coupons · ${next.slice(2)}` })
		.waitFor()
	assert.equal(state(), 'accepted')
})

test(
	'numbers act on a selection, an action on several records asks first, and cancel keeps the selection',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		await page.goto(url('/plans/coupons?view=needs&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('Shift+ArrowDown')
		const keys = await page
			.locator('[data-panel="needs"] [data-row].sel')
			.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.key!))
		assert.deepEqual(keys.length, 2)
		const bar = page.locator('[data-bulk]')
		await bar.getByText('2 selected').waitFor()
		assert.deepEqual(await bar.locator('[data-bulk-action]:visible kbd').allTextContents(), ['1', '2'])
		assert.equal(
			(await bar.locator('[data-bulk-action]:visible').last().textContent())?.trim(),
			'2Clear the selection'
		)
		await page.keyboard.press('1')
		const dialog = page.getByRole('dialog', { name: 'Accept as defects' })
		await dialog.getByText('Accept 2 findings as defects?').waitFor()
		await page.keyboard.press('Escape')
		await dialog.waitFor({ state: 'hidden' })
		const message = page.locator('[data-say], [data-say-strip]')
		await message.filter({ hasText: 'Nothing is recorded. The selection stays.' }).waitFor()
		assert.equal(await page.locator('[data-panel="needs"] [data-row].sel').count(), 2)
		await page.keyboard.press('1')
		await dialog.waitFor()
		await page.route('**/bulk', (route) => route.abort())
		await page.keyboard.press('Enter')
		await message.filter({ hasText: 'Checkmate did not answer.' }).waitFor()
		assert.equal(await page.locator('[data-panel="needs"] [data-row].sel').count(), 2)
		await page.unroute('**/bulk')
		await bar.locator('[data-bulk-action="accept"]').click()
		await dialog.waitFor()
		await page.keyboard.press('Enter')
		await page.getByRole('status').filter({ hasText: 'Accepted 2 claims' }).waitFor()
		assert.equal(await page.locator('[data-panel="needs"] [data-row].sel').count(), 0)
		const claims = read(workspace, (store) => mergedClaims(store, 'coupons'))
		for (const key of keys) assert.equal(claims.find((claim) => `c:${claim.id}` === key)!.state, 'accepted', key)
	}
)

test('canceling and immediately reopening a bulk confirmation submits only once', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('Shift+ArrowDown')
	const dialog = page.getByRole('dialog', { name: 'Accept as defects' })
	const message = page.locator('[data-say], [data-say-strip]')
	let posts = 0
	await page.route('**/bulk', (route) => {
		assert.equal(route.request().method(), 'POST')
		posts++
		return route.abort()
	})
	await page.keyboard.press('1')
	await dialog.waitFor()
	await page.evaluate(() => {
		for (const key of ['Escape', '1'])
			document.activeElement?.dispatchEvent(
				new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
			)
	})
	await message.filter({ hasText: 'Nothing is recorded. The selection stays.' }).waitFor()
	await dialog.waitFor()
	await page.keyboard.press('Enter')
	await message.filter({ hasText: 'Checkmate did not answer.' }).waitFor()
	assert.equal(posts, 1)
	await page.getByRole('group', { name: 'Selection', exact: true }).getByText('2 selected').waitFor()
})

test('a hand-over shows a 0 Undo note, and 0 undoes it while the note shows', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=all&at=c%3Ak1%2FD1&focus=list'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D1')
	await page.keyboard.press('0')
	await page.keyboard.press('1')
	await page.locator('[data-extra="handoff"]:not([hidden]) textarea').waitFor()
	await page.keyboard.type('the payments team')
	await page.keyboard.press('Enter')
	const note = page.locator('[data-undo]')
	await note.getByText('Handed k1/D1 over to the payments team').waitFor()
	const handed = () =>
		read(workspace, (store) => mergedClaims(store, 'coupons').find((item) => item.id === 'k1/D1')!.handoff)
	assert.equal(handed()?.to, 'the payments team')
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.route('**/plans/coupons/handoff', (route) => route.abort())
	await page.keyboard.press('0')
	await page.locator('[data-say], [data-say-strip]', { hasText: 'Checkmate did not answer.' }).waitFor()
	assert.equal(await note.isVisible(), true)
	assert.equal(handed()?.to, 'the payments team')
	await page.unroute('**/plans/coupons/handoff')
	await page.keyboard.press('0')
	await page.getByRole('status').filter({ hasText: 'k1/D1 not handed over' }).waitFor()
	assert.equal(handed(), null)
})

test(
	'the find bar moves with Up and Down, keeps Left and Right for the caret, and names how many more results exist',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		await page.goto(url('/plans/coupons'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
		await page.keyboard.press('/')
		const find = page.getByRole('dialog', { name: 'Find' })
		await find.waitFor()
		await find.getByText(/\d+ more results\./).waitFor()
		await page.keyboard.type('coupons stack')
		await find.locator('[data-find-results] a', { hasText: 'Two coupons stack on one order' }).first().waitFor()
		await page.keyboard.press('ArrowLeft')
		await page.keyboard.press('ArrowRight')
		assert(await find.isVisible())
		await page.keyboard.press('Control+k')
		assert.equal(await page.locator('dialog[open]').count(), 1)
		const first = await find.locator('[aria-selected="true"]').getAttribute('href')
		await page.keyboard.press('ArrowDown')
		const second = await find.locator('[aria-selected="true"]').getAttribute('href')
		assert.notEqual(first, second)
		await page.keyboard.press('ArrowUp')
		await page.keyboard.press('Enter')
		await page.waitForURL((address) => address.pathname + address.search === first)
		await page.locator('[data-drawer]').waitFor()
		await page.keyboard.press('Control+k')
		await find.waitFor()
		await page.keyboard.press('Escape')
		await find.waitFor({ state: 'hidden' })
	}
)

test('editing a Find query clears the selected result before the next search returns', browserTest, async (t) => {
	const { page, url } = await open(t)
	let asked = 0
	await page.route('**/requests', (route) => {
		if (route.request().method() !== 'POST') return route.continue()
		asked++
		return route.abort()
	})
	await page.goto(url('/'))
	await page.keyboard.press('/')
	const find = page.getByRole('dialog', { name: 'Find' })
	const input = find.locator('[data-find-input]')
	const selected = find.locator('[data-find-results] [aria-selected="true"]')
	const results = [
		['coupons stack', /Two coupons stack on one order/],
		['password reset link', /password reset link/i],
	] as const
	await input.fill('zzzz no matching records')
	await selected.filter({ hasText: 'Ask Checkmate' }).waitFor()

	for (const [query, expected] of results) {
		const pattern = `**/find?q=${encodeURIComponent(query)}`
		const pending = Promise.withResolvers<void>()
		await page.route(pattern, async (route) => {
			await pending.promise
			await route.continue()
		})
		try {
			await input.fill(query)
			await input.press('Enter')
			assert.equal(await input.isVisible(), true)
			assert.equal(await selected.count(), 0)
		} finally {
			pending.resolve()
		}
		await selected.filter({ hasText: expected }).waitFor()
		await page.unroute(pattern)
	}
	assert.equal(asked, 0)
	const href = await selected.getAttribute('href')
	await input.press('Enter')
	await page.waitForURL((address) => address.pathname + address.search === href)
})

test('the key list and the status bar hints come from one table', browserTest, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const hints = await page.locator('[data-hints] .sb-k kbd').allTextContents()
	await page.keyboard.press('?')
	const help = await page.locator('[data-keys] th kbd').allTextContents()
	const caps = help.join(' ')
	for (const hint of hints)
		assert(hint.match(/^1–\d$/) ? caps.includes('1') : caps.includes(hint) || hint === 'UpDown', hint)
	assert(help.includes('0'))
	assert(help.includes('Ctrl+K'))
	await page.keyboard.press('Tab')
	await page.keyboard.press('Tab')
	assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-keys]'))), true)
})
