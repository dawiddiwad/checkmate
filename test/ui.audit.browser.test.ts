import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { closeStore, openStore, planDetail } from '../plugin/src/index.ts'
import { answerGap } from '../plugin/src/plans.ts'
import { mergedClaims, mergedQuestions, runList } from '../plugin/src/views.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { event } from './explorations.ts'
import { launchWith, open, skip, stop } from './browser.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}

const highlighted = (page: Page) =>
	page.evaluate(() => {
		const row = document.querySelector('.hl') as HTMLElement | null
		return row?.dataset.key ?? row?.dataset.target ?? null
	})
const toast = (page: Page, text: string | RegExp) => page.locator('.toast').filter({ hasText: text }).waitFor()
const live = (page: Page) => page.locator('[data-live]', { hasText: 'Live' }).waitFor()
const overlap = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

test('a plan page has one h1, the plan name as a heading, and no navigator row is a heading', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	const headings = () =>
		page.evaluate(() => ({
			h1: [...document.querySelectorAll('h1')].map((heading) => heading.textContent!.trim()),
			plan: [...document.querySelectorAll('h2')].some(
				(heading) => heading.textContent!.trim() === 'Plan coupons'
			),
			navigator: document.querySelectorAll('[data-nav] :is(h1, h2, h3), [data-nav]:is(h1, h2, h3)').length,
		}))
	assert.deepEqual(await headings(), { h1: ['Needs you'], plan: true, navigator: 0 })
	await page.keyboard.press('ArrowLeft')
	await page.keyboard.press('ArrowDown')
	assert.deepEqual((await headings()).h1, ['All items'])
})

for (const [width, height] of [
	[900, 900],
	[900, 500],
	[760, 900],
	[400, 900],
] as const)
	test(`a growing selection strip never covers the highlighted row at ${width}x${height}`, { skip }, async (t) => {
		const { page, url } = await open(t, { viewport: { width, height } })
		await page.goto(url('/plans/coupons?view=all&focus=list&at=c%3Ak1%2FD7'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		for (let step = 0; step < 9; step++) await page.keyboard.press('ArrowDown')
		await page.keyboard.press('Space')
		await page.keyboard.press('Shift+ArrowDown')
		await page.keyboard.press('Shift+ArrowDown')
		await page.waitForTimeout(150)
		const covered = await page.evaluate(() => {
			const row = document.querySelector('.hl')!.getBoundingClientRect()
			const strip = document.querySelector('[data-bulk]:not([hidden])')!.getBoundingClientRect()
			return Math.max(0, Math.min(row.bottom, strip.bottom) - Math.max(row.top, strip.top))
		})
		assert.equal(covered, 0)
	})

test('the toast gives way to a tall selection strip, and the strip shows its count', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 400, height: 500 } })
	await page.goto(url('/plans/coupons?view=all&focus=list&at=q%3Ak1%2FQ8'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('3')
	await toast(page, 'Deferred')
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	for (let step = 0; step < 3; step++) {
		await page.keyboard.press('Space')
		await page.keyboard.press('ArrowDown')
	}
	await page.locator('[data-bulk]').getByText('3 selected').waitFor()
	const boxes = await page.evaluate(() => {
		const strip = document.querySelector('[data-bulk]:not([hidden])')!.getBoundingClientRect()
		const note = document.querySelector('.toast') as HTMLElement | null
		return { strip: strip.toJSON(), note: note && !note.hidden ? note.getBoundingClientRect().toJSON() : null }
	})
	if (boxes.note) assert.equal(overlap(boxes.strip, boxes.note), 0)
	assert.ok(await page.locator('[data-bulk]').getByText('3 selected').isVisible())
})

test('Right on a tester opens it and keeps the highlight on that tester', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/explorations/x-1'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const first = await highlighted(page)
	await page.keyboard.press('ArrowDown')
	const second = await highlighted(page)
	assert.notEqual(first, second)
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(/item=/)
	await page.waitForFunction((key) => document.querySelector('.hl')?.getAttribute('data-key') === key, second)
})

test(
	'a live update keeps the highlight on the same row on the testers, run, runs, and log pages',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await open(t)
		const poke = () =>
			read(workspace, (store) => {
				event(store, 'x-9', {
					step: 'turn',
					explorer: 'r1',
					status: 'completed',
					detail: { activity: 'poked' },
				})
				answerGap(store, 'qa-lead', {
					planId: 'coupons',
					gapId: 'k1/Q10',
					kind: 'defer',
					value: 'Later.',
					rationale: 'Poke.',
				})
			})
		for (const path of ['/explorations/x-9', '/runs/run-7', '/runs', '/log']) {
			await page.goto(url(path))
			await live(page)
			await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
			await page.keyboard.press('ArrowDown')
			await page.keyboard.press('ArrowDown')
			const key = await highlighted(page)
			const before = await page.evaluate(() => document.body.innerHTML.length)
			poke()
			await page.waitForFunction((length) => document.body.innerHTML.length !== length, before).catch(() => {})
			await page.waitForTimeout(400)
			assert.equal(await highlighted(page), key, path)
			assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-key')), key, path)
		}
	}
)

test('forced colours show the highlight in system colours and draw the key glyphs', { skip }, async (t) => {
	const { page, url } = await open(t, { forcedColors: 'active' })
	await page.goto(url('/plans/coupons?view=all&focus=list&at=c%3Ak1%2FD10'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const look = await page.evaluate(() => {
		const style = (element: Element) => getComputedStyle(element).backgroundColor
		const row = document.querySelector('.hl')!
		const other = [...document.querySelectorAll('[data-panel]:not([hidden]) [data-row]:not(.hl)')][1]
		const glyph = document.querySelector('[data-hints] .glyph')!
		return { row: style(row), other: style(other), glyph: style(glyph), text: getComputedStyle(glyph).color }
	})
	assert.notEqual(look.row, look.other)
	assert.notEqual(look.glyph, 'rgba(0, 0, 0, 0)')
})

test('a printed record shows the record alone in dark text on white', { skip }, async (t) => {
	const { page, url } = await open(t, { colorScheme: 'dark' })
	await page.goto(url('/plans/coupons?view=all&item=c%3Ak1%2FD4'))
	await page.emulateMedia({ media: 'print' })
	const printed = await page.evaluate(() => ({
		title: getComputedStyle(document.querySelector('.sp-dhead h2')!).color,
		ground: getComputedStyle(document.querySelector('.sp-drawer')!).backgroundColor,
		hidden: ['.top', '.statusbar', '.sp-nav', '[data-panel]:not([hidden])'].map(
			(selector) => (document.querySelector(selector) as HTMLElement).offsetHeight
		),
		files: [...document.querySelectorAll('.sp-file')].map((file) => (file as HTMLElement).innerText.trim()),
	}))
	assert.equal(printed.title, 'rgb(0, 0, 0)')
	assert.equal(printed.ground, 'rgb(255, 255, 255)')
	assert.deepEqual(printed.hidden, [0, 0, 0, 0])
	assert.ok(printed.files.some((file) => file.includes('k1-D4.png')))
})

test('a long name is refused, and a name at the limit stays inside the top bar', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/actor?back=%2F'))
	assert.equal(await page.locator('#actor-name').getAttribute('maxlength'), '64')
	const refused = await page.request.post(url('/actor'), {
		form: { csrf: await page.locator('input[name=csrf]').first().inputValue(), actor: 'a'.repeat(300), back: '/' },
		maxRedirects: 0,
	})
	assert.equal(refused.status(), 422)
	await page.locator('#actor-name').fill('n'.repeat(64))
	await page.keyboard.press('Enter')
	await page.waitForURL(url('/'))
	const top = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		title: document.querySelector('.who .actor')!.getAttribute('title'),
	}))
	assert.ok(top.width <= 1280)
	assert.ok(top.title!.startsWith('n'.repeat(64)))
})

test('saving the editor without a change records no revision', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const before = read(workspace, (store) => planDetail(store, 'account').latestRevision)
	await page.goto(url('/plans/account@7/edit'))
	await page.locator('[data-edit-form] button.primary').first().click()
	await toast(page, 'No changes')
	assert.equal(
		read(workspace, (store) => planDetail(store, 'account').latestRevision),
		before
	)
	assert.match(page.url(), /\/plans\/account@7$/)
})

test('an empty field gets one plain sentence next to it, and the focus', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/account@7/edit'))
	const field = page.locator('[name="r0.text"]')
	await field.fill('   ')
	await page.locator('[data-edit-form] button.primary').first().click()
	await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'r0.text')
	const alert = await page.evaluate(() => {
		const message = document.querySelector('.form-error[role=alert]')!
		return {
			text: message.textContent!.trim(),
			beside: message.closest('.field-group')?.contains(document.querySelector('[name="r0.text"]')) ?? false,
			invalid: document.querySelector('[name="r0.text"]')!.getAttribute('aria-invalid'),
		}
	})
	assert.match(alert.text, /^Fill in \w+ Text\. It cannot be empty\.$/)
	assert.equal(alert.beside, true)
	assert.equal(alert.invalid, 'true')
	assert.doesNotMatch(await page.content(), /must NOT have|plan-candidate\//)

	await page.goto(url('/settings/targets/shop-local'))
	await page.locator('#instance-id').fill('uat')
	const entry = page.locator('[name^="entry."]').first()
	await entry.fill('   ')
	await page.getByRole('button', { name: 'Add instance' }).click()
	await page.waitForFunction(() => document.activeElement?.getAttribute('name')?.startsWith('entry.'))
	const message = (await page.locator('.form-error[role=alert]').textContent())!.trim()
	assert.match(message, /^Fill in \S+\. It cannot be empty\.$/)
	assert.doesNotMatch(await page.content(), /must NOT have|instance\/entries/)
})

test('typed text survives Esc and Left, and the editor asks before it drops changes', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&item=c%3Ak1%2FD12'))
	await page.keyboard.press('2')
	await page.waitForFunction(() => document.activeElement?.id === 'reject-text')
	await page.keyboard.type('A reason I do not want to lose.')
	await page.keyboard.press('Escape')
	await page.keyboard.press('Escape')
	await page.waitForURL((address) => !address.searchParams.has('item'))
	await page.goto(url('/plans/coupons?view=needs&item=c%3Ak1%2FD12'))
	assert.equal(await page.locator('#reject-text').inputValue(), 'A reason I do not want to lose.')
	await page.getByText('Draft kept.').first().waitFor({ state: 'attached' })

	await page.goto(url('/plans/account@7/edit'))
	await page.locator('[name="t0.title"]').fill('A changed title')
	await page.locator('[name="t0.title"]').press('Escape')
	await page.keyboard.press('ArrowLeft')
	const dialog = page.locator('dialog[data-confirm]', { hasText: 'Leave the editor?' })
	await dialog.waitFor()
	await page.keyboard.press('Escape')
	await dialog.waitFor({ state: 'hidden' })
	assert.match(page.url(), /\/edit$/)
	await page.keyboard.press('ArrowLeft')
	await dialog.waitFor()
	await dialog.getByRole('button', { name: 'Leave and lose the changes' }).click()
	await page.waitForURL(/\/plans\/account@7$/)
})

test('the address follows the editor to the newer revision after a save conflict', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/account@7/edit'))
	const other = await page.context().newPage()
	await other.goto(url('/plans/account@7/edit'))
	await other.locator('[name="t0.title"]').fill('Changed in another tab')
	await other.locator('[data-edit-form] button.primary').first().click()
	await other.waitForURL(/account@8$/)
	await page.locator('[name="t0.title"]').fill('Changed here')
	await page.locator('[data-edit-form] button.primary').first().click()
	await page.getByText(/changed after you opened the editor/).waitFor()
	await page.waitForURL(/\/plans\/account@8\/edit$/)
})

test('Esc closes the retire confirmation first, and focus lands on what an action concerned', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/settings/targets/shop-local'))
	await page.locator('#instance-local summary').focus()
	await page.keyboard.press('Enter')
	await page.keyboard.press('Escape')
	assert.match(page.url(), /\/settings\/targets\/shop-local/)
	assert.equal(
		await page.locator('#instance-local details').evaluate((details) => (details as HTMLDetailsElement).open),
		false
	)
	await page.locator('#instance-id').fill('uat')
	for (const field of await page.locator('[name^="entry."]').all()) await field.fill('https://uat.shop.example')
	await page.getByRole('button', { name: 'Add instance' }).click()
	await toast(page, 'Added instance uat')
	assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#instance-uat'))), true)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('Space')
	await page.getByRole('button', { name: /Clear the selection/ }).click()
	assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-row].hl')), true)
})

test('plan sections show their open state, Right opens one and Left closes it', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/checkout@2'))
	const id = await page.locator('details.fold:not([open]) > summary h2').first().getAttribute('id')
	const summary = page.locator(`details.fold:has(> summary #${id}) > summary`)
	const mark = await summary.evaluate((element) => getComputedStyle(element, '::before').width)
	assert.equal(mark, '12px')
	await summary.focus()
	await page.keyboard.press('ArrowRight')
	assert.equal(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open), true)
	await page.keyboard.press('ArrowLeft')
	assert.equal(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open), false)
	assert.match(page.url(), /checkout@2$/)
})

test('the coverage boxes have a 24 px hit area, and the requirement column reads left', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/account@7/edit'))
	const box = await page
		.locator('[name=cover]')
		.first()
		.evaluate((input) => {
			const hit = input.closest('label')!.getBoundingClientRect()
			const head = getComputedStyle(document.querySelector('.matrix thead th')!)
			const cell = getComputedStyle(document.querySelector('.matrix tbody th')!)
			return [Math.min(hit.width, hit.height), head.textAlign, cell.textAlign, cell.textTransform]
		})
	assert.ok((box[0] as number) >= 24)
	assert.deepEqual(box.slice(1), ['left', 'left', 'none'])
})

test('no page scrolls sideways at 320 px', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 320, height: 640 } })
	for (const path of [
		'/',
		'/plans/coupons?view=needs&focus=list',
		'/plans/coupons?view=all&item=c%3Ak1%2FD1',
		'/runs',
		'/log',
		'/plans/checkout@2',
		'/plans/account@7/edit',
		'/settings/targets/shop-local',
		'/runs/run-7',
		'/explorations/x-9',
	]) {
		await page.goto(url(path))
		assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 320, path)
		const keys = await page.locator('[data-hints] [data-cap="?"]').boundingBox()
		assert.ok(keys && keys.x + keys.width <= 320, `${path}: ? Keys is cut`)
	}
})

test(
	'Up and Down cross the pages of a list, the status bar names the page, and Left goes to page 1',
	{ skip },
	async (t) => {
		const { page, url } = await open(t)
		await page.goto(url('/log?page=2'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		assert.match((await page.locator('.sb-where').textContent())!, /page 2 of \d+/)
		const rows = await page.locator('[data-row]').count()
		for (let step = 1; step < rows; step++) await page.keyboard.press('ArrowDown')
		await page.keyboard.press('ArrowDown')
		await page.waitForURL(/page=3/)
		await page.waitForFunction(() => document.activeElement === document.querySelector('[data-row]'))
		await page.keyboard.press('ArrowUp')
		await page.waitForURL(/page=2/)
		await page.waitForFunction(() => {
			const all = document.querySelectorAll('[data-row]')
			return document.activeElement === all[all.length - 1]
		})
		await page.keyboard.press('ArrowLeft')
		await page.waitForURL((address) => address.pathname === '/log' && !address.searchParams.has('page'))
		await page.goto(url('/log?page=99'))
		assert.match(page.url(), /page=\d+$/)
		assert.doesNotMatch(page.url(), /page=99/)
		const statuses = await page.locator('#filter-status option').allTextContents()
		assert.ok(
			statuses.every((label) => !label.includes('_')),
			statuses.join()
		)
		const clear = await page
			.locator('[data-list-clear]')
			.first()
			.evaluate((link) => getComputedStyle(link).borderTopColor)
		assert.notEqual(clear, 'rgba(0, 0, 0, 0)')
	}
)

async function states(page: Page, selector: string) {
	const target = page.locator(selector).first()
	await target.scrollIntoViewIfNeeded()
	const read = () =>
		target.evaluate((element) => {
			const style = getComputedStyle(element)
			return [
				style.backgroundColor,
				style.color,
				style.borderTopColor,
				style.textDecorationThickness,
				style.filter,
			].join()
		})
	await page.mouse.move(0, 0)
	const rest = await read()
	await target.hover()
	const hover = await read()
	await page.mouse.down()
	const pressed = await read()
	await page.mouse.up()
	return { rest, hover, pressed }
}

test('a real pointer shows hover and pressed states on every kind of control', { skip }, async (t) => {
	const { page, url } = await open(t)
	const cases: Array<[string, string, boolean]> = [
		['/plans/account@7/edit', '[data-edit-form] button.primary', true],
		['/settings/targets/shop-local', 'form[action$="/instances"] button.primary', true],
		['/plans/coupons?view=all', '[data-panel="all"] [data-row]:not(.hl)', true],
		['/plans/coupons?view=all', '[data-panel="all"] [data-row]:not(.hl) .sp-c-cb', true],
		['/runs', '[data-row]:not(.hl)', true],
		['/runs/run-7', '[data-row]:not(.hl)', true],
		['/explorations/x-1', '[data-row]:not(.hl)', true],
		['/log', 'td a, .l-rows a.mono', false],
		['/', '[data-region="nav-count"]', true],
		['/', '[data-hints] [data-cap="?"]', true],
		['/plans/account@7/edit', '.cell-check', true],
		['/plans/checkout@2', 'nav.chips a', true],
	]
	for (const [path, selector, hover] of cases) {
		await page.goto(url(path))
		await page.evaluate(() => document.addEventListener('click', (event) => event.preventDefault(), true))
		const seen = await states(page, selector)
		if (hover) assert.notEqual(seen.hover, seen.rest, `${selector} hover`)
		assert.notEqual(seen.pressed, seen.hover, `${selector} pressed`)
	}
})

test('Esc from the testers view returns to the Testers row of the plan', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/explorations/x-9'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/plans\/checkout/)
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-target') === 'testers')
})

test(
	'a decision inside a record opens the next record that waits, and a hand-over keeps its record',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await open(t)
		await page.goto(url('/plans/coupons?view=needs&item=c%3Ak1%2FD10'))
		await page.waitForFunction(() => document.activeElement?.matches('.sp-dhead'))
		await page.keyboard.press('1')
		await page.waitForURL((address) => address.searchParams.get('item') === 'c:k1/D12')
		await page.waitForFunction(() => document.activeElement?.matches('.sp-dhead'))
		assert.equal(
			read(workspace, (store) => mergedClaims(store, 'coupons').find((claim) => claim.id === 'k1/D10')!.state),
			'accepted'
		)

		await page.goto(url('/plans/coupons?view=all&focus=list&at=c%3Ak1%2FD9'))
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D9')
		await page.keyboard.press('1')
		await page.keyboard.type('the payments team')
		await page.keyboard.press('Enter')
		await page.locator('[data-undo]').waitFor()
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D9')
	}
)

test('a deferred question keeps Right and Different and can be answered', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ4'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'q:k1/Q4')
	await page.keyboard.press('3')
	await toast(page, 'Deferred')
	await page.goto(url('/plans/coupons?view=all&focus=list&at=q%3Ak1%2FQ4'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'q:k1/Q4')
	const options = await page.locator('.hl [data-option]').allTextContents()
	assert.deepEqual(
		options.map((text) => text.replace(/\s+/g, '')),
		['1Right', '2Different']
	)
	await page.keyboard.press('1')
	await toast(page, 'Answered')
	assert.equal(
		read(workspace, (store) => mergedQuestions(store, 'coupons').find((item) => item.id === 'k1/Q4')!.decision),
		'accept_assumption'
	)
})

test('a rejected finding is labelled Rejected only', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=all&item=c%3Ak1%2FD8'))
	assert.deepEqual(
		(await page.locator('.sp-dhead .sp-pills .sp-pill').allTextContents()).map((text) => text.trim()),
		['Rejected']
	)
})

test('the toast of a decision shows even right after a hand-over', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=all&focus=list&at=c%3Ak1%2FD9'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D9')
	await page.keyboard.press('1')
	await page.keyboard.type('the payments team')
	await page.keyboard.press('Enter')
	await page.locator('[data-undo]').waitFor()
	await page.goto(url('/plans/coupons?view=needs&focus=list&at=q%3Ak1%2FQ3'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'q:k1/Q3')
	await page.keyboard.press('1')
	await toast(page, 'Answered coupons · k1/Q3')
})

for (const [scale, width, height] of [
	[3, 480, 300],
	[4, 360, 225],
] as const)
	test(`at device scale ${scale} the top of the highlighted row stays in view`, { skip }, async (t) => {
		const { page, url } = await open(t, { viewport: { width, height }, deviceScaleFactor: scale })
		for (const path of ['/', '/plans/coupons?view=needs&focus=list']) {
			await page.goto(url(path))
			await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
			for (let step = 0; step < 4; step++) {
				await page.keyboard.press('ArrowDown')
				const place = await page.evaluate(() => {
					const row = document.querySelector('.hl')!.getBoundingClientRect()
					const top = document.querySelector('.top')!.getBoundingClientRect().bottom
					const bar = document.querySelector('.statusbar')!.getBoundingClientRect().top
					return { row: row.top, top, bar }
				})
				assert.ok(place.row >= place.top - 0.5 && place.row < place.bar, `${path} ${JSON.stringify(place)}`)
			}
		}
	})

test('Back closes the find bar, the key list, a dialog, or an open area, and nothing else', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const address = page.url()
	await page.keyboard.press('/')
	await page.getByRole('dialog', { name: 'Find' }).waitFor()
	await page.waitForFunction(() => Boolean(window.history.state?.layer || window.history.state?.area))
	await page.goBack()
	await page.getByRole('dialog', { name: 'Find' }).waitFor({ state: 'hidden' })
	assert.equal(page.url(), address)
	await page.keyboard.press('?')
	await page.locator('[data-keys]').waitFor()
	await page.waitForFunction(() => Boolean(window.history.state?.layer || window.history.state?.area))
	await page.goBack()
	await page.locator('[data-keys]').waitFor({ state: 'hidden' })
	assert.equal(page.url(), address)
	await page.keyboard.press('Space')
	await page.keyboard.press('Shift+ArrowDown')
	const selected = page.url()
	await page.keyboard.press('1')
	const confirm = page.locator('dialog[data-confirm]')
	await confirm.waitFor()
	await page.waitForFunction(() => Boolean(window.history.state?.layer || window.history.state?.area))
	await page.goBack()
	await confirm.waitFor({ state: 'hidden' })
	assert.equal(page.url(), selected)
	await page.goto(url('/plans/coupons?view=needs'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
	while ((await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))) === null)
		await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowRight')
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded')), 'true')
	const here = page.url()
	await page.waitForFunction(() => Boolean(window.history.state?.layer || window.history.state?.area))
	await page.goBack()
	await page.waitForFunction(() => document.querySelector('[data-nav][aria-expanded="true"]') === null)
	assert.equal(page.url(), here)
})

test('a paused tester says how long it has been paused', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	read(workspace, (store) => event(store, 'x-9', { step: 'pause', detail: { reason: 'Waiting for the host.' } }))
	await page.goto(url('/explorations/x-9'))
	assert.match(await page.content(), /paused for\s*<span data-since="[^"]+">\d/)
})

test('the zoom label is not live, and pages without evidence have no viewer', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/plans/coupons?view=needs'))
	assert.equal(await page.locator('[data-viewer]').count(), 0)
	await page.goto(url('/runs/run-7'))
	assert.equal(await page.locator('[data-viewer-scale][aria-live]').count(), 0)
})

test('the navigator strip stays pinned at 900 px and its marks name their build', { skip }, async (t) => {
	const { page, url } = await open(t, { viewport: { width: 900, height: 600 } })
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	for (let step = 0; step < 9; step++) await page.keyboard.press('ArrowDown')
	const place = await page.evaluate(() => ({
		strip: document.querySelector('.sp-nav')!.getBoundingClientRect().toJSON(),
		top: document.querySelector('.top')!.getBoundingClientRect().bottom,
		row: document.querySelector('.hl')!.getBoundingClientRect().top,
		label: getComputedStyle(document.querySelector('.sp-nav .sp-mk[data-mark]')!, '::before').content,
	}))
	assert.equal(Math.round(place.strip.top), Math.round(place.top))
	assert.ok(place.row >= place.strip.bottom)
	assert.match(place.label, /B\d/)
	for (let step = 0; step < 9; step++) await page.keyboard.press('ArrowUp')
	await page.keyboard.press('ArrowLeft')
	for (let step = 0; step < 8; step++) {
		await page.keyboard.press('ArrowDown')
		const seen = await page.evaluate(() => {
			const row = document.querySelector('.sp-nav .hl')!.getBoundingClientRect()
			const strip = document.querySelector('.sp-nav')!.getBoundingClientRect()
			return row.left >= strip.left - 0.5 && row.right <= strip.right + 0.5
		})
		assert.ok(seen, `step ${step}`)
	}
})

test('a run is rejected with a reason from the keyboard', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/runs/run-7#decide'))
	await page.locator('#rationale').fill('The report misses the refund check.')
	await page.getByRole('button', { name: 'Reject', exact: true }).click()
	await page.getByRole('button', { name: 'Confirm rejection' }).click()
	await toast(page, /Rejected run-7/)
	assert.equal(
		read(workspace, (store) => runList(store).find((run) => run.runId === 'run-7')!.acceptance),
		'rejected'
	)
})

test('a plan is approved through the two-step decision', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/search@1#decide'))
	await page.locator('#rationale').fill('The plan covers the search rules.')
	await page.getByRole('button', { name: 'Approve search@1' }).click()
	await page.getByRole('button', { name: 'Confirm approval' }).click()
	await toast(page, 'Approved search@1')
	assert.equal(
		read(workspace, (store) => planDetail(store, 'search').approval.state),
		'approved'
	)
})

test('the evidence overlay opens by click and closes with Esc', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/runs/run-7?item=finding%3AF1'))
	await page.locator('a[data-view]').first().click()
	const viewer = page.getByRole('dialog', { name: 'Evidence viewer' })
	await viewer.waitFor()
	await page.keyboard.press('Escape')
	await viewer.waitFor({ state: 'hidden' })
})

test('the pager and the filters work with the pointer', { skip }, async (t) => {
	const { page, url } = await open(t)
	await page.goto(url('/log'))
	await page.getByRole('link', { name: 'Next ›' }).click()
	await page.waitForURL(/page=2/)
	await page.locator('#filter-status').selectOption({ index: 1 })
	await page.waitForURL(/status=/)
	await page.locator('[data-list-clear]').first().click()
	await page.waitForURL((address) => address.pathname === '/log' && !address.search)
})

test('the section Edit links open the editor at that section, and Remove explains a refusal', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/search@1'))
	await page.locator('a.h-link[href$="#edit-tests"]').click()
	await page.waitForURL(/edit#edit-tests$/)
	await page.waitForFunction(() => Boolean(document.activeElement?.closest('#edit-tests')))
	await page.goto(url('/plans/search@1'))
	const remove = page
		.locator('details')
		.filter({ has: page.locator('> summary', { hasText: 'Remove T1' }) })
		.first()
	await remove.locator('> summary').click()
	await remove.locator('textarea').fill('T1 is covered by another plan.')
	await remove.getByRole('button').last().click()
	await page.waitForURL(/search@1\/edit$/)
	await page.waitForFunction(() => document.activeElement?.matches('.form-error[role=alert]'))
	assert.match((await page.locator('.form-error[role=alert]').textContent())!, /Requirement S1 has no test or gap/)
	assert.ok(read(workspace, (store) => planDetail(store, 'search').plan.tests.some((test) => test.id === 'T1')))
})

test('the 409 and 500 pages say what happened, and Left or Esc leaves them', { skip }, async (t) => {
	const { page, url, workspace } = await open(t)
	const busy = await page.goto(url('/runs/run-8/report.json'))
	assert.equal(busy!.status(), 409)
	await page.getByRole('heading', { name: 'Report not ready' }).waitFor()
	await page.keyboard.press('Escape')
	await page.waitForURL((address) => address.pathname !== '/runs/run-8/report.json')
	const database = new DatabaseSync(join(workspace, '.checkmate', 'checkmate.db'))
	database.exec('ALTER TABLE blobs RENAME TO blobs_gone')
	database.close()
	const broken = await page.goto(url('/explorations/x-11/claims/k1/D4/evidence/0'))
	assert.equal(broken!.status(), 500)
	await page.getByRole('heading', { name: 'Something went wrong' }).waitFor()
	assert.match((await page.locator('main').textContent())!, /Checkmate could not finish the request/)
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL(url('/'))
})

test(
	'dialogs, the find bar, the key list, and reason fields open and close 20 times in a row on a slow CPU',
	{ skip },
	async (t) => {
		const { page, url } = await open(t)
		const cdp = await page.context().newCDPSession(page)
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
		const cycle = async (
			name: string,
			start: string,
			ready: () => Promise<unknown>,
			keys: [string, string],
			shown: string,
			closed: () => Promise<unknown>
		) => {
			await page.goto(url(start))
			await ready()
			const address = page.url()
			for (let round = 0; round < 20; round++) {
				await page.keyboard.press(keys[0])
				await page
					.locator(shown)
					.waitFor({ timeout: 3000 })
					.catch(() => assert.fail(`${name} did not open in round ${round}`))
				await page.keyboard.press(keys[1])
				await closed()
				await page.waitForFunction(() => !window.history.state?.layer, null, { timeout: 3000 })
				assert.equal(page.url(), address, `${name} round ${round}`)
			}
		}
		const row = () => page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		const hidden = (selector: string) => () => page.locator(selector).waitFor({ state: 'hidden', timeout: 3000 })
		await cycle(
			'key list',
			'/plans/coupons?view=needs&focus=list',
			row,
			['?', 'Escape'],
			'[data-keys]',
			hidden('[data-keys]')
		)
		await cycle(
			'find bar',
			'/plans/coupons?view=needs&focus=list',
			row,
			['/', 'Escape'],
			'[data-find]',
			hidden('[data-find]')
		)
		await cycle(
			'bulk confirm',
			'/plans/coupons?view=needs&focus=list',
			async () => {
				await row()
				await page.keyboard.press('Shift+ArrowDown')
			},
			['1', 'Escape'],
			'dialog[data-confirm]',
			hidden('dialog[data-confirm]')
		)
		await cycle(
			'hand-over reason',
			'/plans/coupons?view=all&focus=list&at=c%3Ak1%2FD9',
			() => page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D9'),
			['1', 'Escape'],
			'.hl [data-extra="handoff"]:not([hidden])',
			() => page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D9')
		)
		await cycle(
			'editor leave dialog',
			'/plans/account@7/edit',
			async () => {
				await page.locator('[name="t0.title"]').fill('A changed title')
				await page.locator('[name="t0.title"]').press('Escape')
			},
			['ArrowLeft', 'Escape'],
			'dialog[data-confirm]',
			hidden('dialog[data-confirm]')
		)
		const actions = async (
			name: string,
			start: string,
			reach: () => Promise<unknown>,
			open: string,
			dialog: string
		) => {
			await page.goto(url(start))
			await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row], [data-nav]'))
			await reach()
			const address = page.url()
			for (let round = 0; round < 20; round++) {
				await page.keyboard.press(open)
				await page
					.locator(dialog)
					.waitFor({ timeout: 3000 })
					.catch(() => assert.fail(`${name} did not open in round ${round}`))
				await page.waitForFunction(() => window.history.state?.layer === 'act', null, { timeout: 3000 })
				for (let step = 0; step < 3 && (await page.locator(dialog).isVisible()); step++)
					await page.keyboard.press('Escape')
				await page.locator(dialog).waitFor({ state: 'hidden', timeout: 3000 })
				await page.waitForFunction(() => !window.history.state?.layer, null, { timeout: 3000 })
				assert.equal(page.url(), address, `${name} round ${round}`)
			}
		}
		const toButton =
			(label: string, right = 0) =>
			async () => {
				for (let step = 0; step < 12; step++) {
					const now = await page.evaluate(() => document.activeElement?.textContent?.trim())
					if (now?.startsWith(label)) break
					await page.keyboard.press(step === 0 && right ? 'ArrowRight' : 'ArrowUp')
				}
			}
		await actions(
			'Test build',
			'/plans/coupons?view=needs&focus=list',
			toButton('Test build…'),
			'Enter',
			'dialog[data-act-dialog="test"]'
		)
		await actions(
			'Test the answers',
			'/plans/search?view=needs&focus=list',
			async () => {
				await toButton('Test build…')()
				await page.keyboard.press('ArrowRight')
			},
			'Enter',
			'dialog[data-act-dialog="follow"]'
		)
		await actions(
			'Stop the test',
			'/explorations/x-14',
			toButton('Stop the test…'),
			'Enter',
			'dialog[data-act-dialog="stop-x-14"]'
		)
		await actions(
			'Stop tester',
			'/explorations/x-14',
			async () => {
				await page.locator('[data-key="explorer:a1"]').focus()
			},
			'1',
			'dialog[data-act-dialog="stop-x-14-a1"]'
		)
		await page.goto(url('/plans/coupons?view=needs&focus=list'))
		await row()
		const start = page.url()
		for (let round = 0; round < 20; round++) {
			await page.keyboard.press('/')
			await page.locator('[data-find]').waitFor()
			await page.keyboard.press('Escape')
			await page.keyboard.press('?')
			await page.locator('[data-keys]').waitFor()
			await page.waitForFunction(() => window.history.state?.layer === 'keys', null, { timeout: 3000 })
			await page.goBack()
			await page.locator('[data-keys]').waitFor({ state: 'hidden', timeout: 3000 })
			assert.equal(page.url(), start, `find then keys round ${round}`)
		}
		await page.goto(url('/settings/targets/shop-local'))
		const summary = page.locator('#instance-local summary')
		for (let round = 0; round < 20; round++) {
			await summary.focus()
			await page.keyboard.press('Enter')
			assert.equal(
				await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open),
				true,
				`retire round ${round}`
			)
			await page.keyboard.press('Escape')
			assert.equal(
				await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open),
				false,
				`retire round ${round}`
			)
			assert.match(page.url(), /\/settings\/targets\/shop-local/)
		}
	}
)
