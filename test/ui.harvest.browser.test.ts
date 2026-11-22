import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { harvestExploration } from '../plugin/src/harvest.ts'
import { planRevision } from '../plugin/src/plans.ts'
import { planRules } from '../plugin/src/rules.ts'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { check, measure } from './layout.ts'
import { actor } from './support.ts'
import { addExploration, seedStorable } from './notes.ts'
import { watchRefreshes } from './refresh.ts'

test.before(() => launchWith(seedStorable))
test.after(stop)

function read<T>(workspace: string, view: (store: ReturnType<typeof openStore>) => T) {
	const store = openStore(workspace)
	try {
		return view(store)
	} finally {
		closeStore(store)
	}
}

const testIds = (workspace: string) =>
	read(workspace, (store) => {
		try {
			return planRevision(store, 'notes').plan.tests.map((item) => item.id)
		} catch {
			return []
		}
	})

const storeAll = (workspace: string) =>
	read(workspace, (store) => {
		for (const explorationId of ['x-1', 'x-3'])
			harvestExploration(store, actor, { explorationId, observations: false })
	})

const toast = (page: Page, text: string | RegExp) => page.locator('[data-toast]', { hasText: text }).waitFor()
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent?.trim())
const storeButton = (page: Page) => page.locator('[data-panel]:not([hidden]) [data-actions] [data-act="store"]')
const dialog = (page: Page) => page.locator('dialog[data-act-dialog="store"]')
const writes = (workspace: string) =>
	read(
		workspace,
		(store) => store.db.prepare("SELECT count(*) AS n FROM operations WHERE command = 'harvest'").get()!.n
	)

const navigator = (page: Page) =>
	page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('[data-nav]')].map((row) => [
				(row as HTMLElement).dataset.target,
				row.textContent!.replace(/\s+/g, ' ').trim(),
			])
		)
	)

async function onList(page: Page, url: (path: string) => string, path: string) {
	await page.goto(url(path))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
}

async function storedLikeBefore(page: Page, before: Record<string, string>) {
	const after = await navigator(page)
	const added = new Set(['rules', 'rule:HR1', 'area:Rules'])
	for (const [target, text] of Object.entries(before))
		if (!added.has(target) && !['needs', 'all', 'plan'].includes(target)) assert.equal(after[target], text, target)
	assert.equal(before.plan, 'Plan request')
	assert.equal(after.plan, 'Plan @1')
	assert.equal(before.needs, 'Needs you1')
	assert.equal(after.needs, 'Needs you2')
	assert.equal(before.all, 'All items5')
	assert.equal(after.all, 'All items6')
	assert.equal(await page.locator('[data-panel="needs"] .sp-gh', { hasText: 'Approvals' }).count(), 1)
	assert.deepEqual(
		Object.keys(after).filter((target) => !(target in before)),
		['area:Rules', 'rule:HR1']
	)
	assert.match(after.rules, /5$/)
}

async function testsListed(page: Page, url: (path: string) => string, ids: Array<[string, string]>) {
	await page.goto(url('/plans/notes@1'))
	for (const [id, rule] of ids)
		assert.match(
			(await page.locator(`article#${id}`).textContent())!.replace(/\s+/g, ' '),
			new RegExp(`Requirements ${rule}\\b`),
			id
		)
}

test('a person stores the defects as tests with the keys alone', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await onList(page, url, '/plans/notes?view=all&focus=list')
	const before = await navigator(page)
	await page.keyboard.press('ArrowUp')
	assert.equal(await focusedText(page), 'Test build…')
	await page.keyboard.press('ArrowRight')
	assert.equal(await focusedText(page), 'Store 4 defects as tests…')
	await page.keyboard.press('Enter')
	await dialog(page).waitFor()
	assert.equal(await dialog(page).locator('[data-act-title]').textContent(), 'Store 4 defects as tests')
	assert.equal(await focusedText(page), '1Store 4 tests')
	assert.match(await dialog(page).locator('.sp-sub').innerText(), /attaches it to the rule that the defect cites/)
	assert.match(
		await dialog(page).locator('.sp-sub').innerText(),
		/The stored tests wait for the approval of the plan\.$/
	)
	await page.waitForFunction(() => window.history.state?.layer === 'act')
	await page.keyboard.press('Escape')
	await dialog(page).waitFor({ state: 'hidden' })
	await page.waitForFunction(() => !window.history.state?.layer)
	assert.equal(await focusedText(page), 'Store 4 defects as tests…')
	assert.equal(writes(workspace), 0)
	await page.keyboard.press('Enter')
	await dialog(page).waitFor()
	await page.keyboard.press('1')
	await toast(page, 'Stored 4 defects as tests: H1 → R1, H2 → R2, H3 → R3, H4 → HR1')
	assert.deepEqual(testIds(workspace), ['H1', 'H2', 'H3', 'H4'])
	assert.equal(await storeButton(page).count(), 0)
	await storedLikeBefore(page, before)
	await testsListed(page, url, [
		['H1', 'R1'],
		['H2', 'R2'],
		['H3', 'R3'],
		['H4', 'HR1'],
	])
})

test(
	'a person cancels, stores with the pointer, and stores only the new defects the second time',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		await page.goto(url('/plans/notes?view=rules'))
		await page.getByRole('button', { name: 'Store 4 defects as tests…' }).click()
		await dialog(page).getByRole('button', { name: 'Cancel' }).click()
		await dialog(page).waitFor({ state: 'hidden' })
		assert.equal(await focusedText(page), 'Store 4 defects as tests…')
		assert.equal(writes(workspace), 0)
		await page.getByRole('button', { name: 'Store 4 defects as tests…' }).click()
		await dialog(page).getByRole('button', { name: 'Store 4 tests' }).click()
		await toast(page, 'Stored 4 defects as tests: H1 → R1, H2 → R2, H3 → R3, H4 → HR1')
		assert.match(page.url(), /view=rules/)
		assert.equal(
			await page.locator('[data-panel="rules"] .sp-sub').first().textContent(),
			'4 of 5 rules have a stored test. The tester derived these rules from the sources. Edit the rules that have no stored test here, or with checkmate plan edit notes --patch. Edit the others in the plan editor.'
		)
		assert.equal(await storeButton(page).count(), 0)
		read(workspace, (store) => addExploration(store, 'x-4', 'b4', 'D5', 'R4'))
		await page.goto(url('/plans/notes?view=all'))
		await page.getByRole('button', { name: 'Store 1 defect as tests…' }).click()
		assert.equal(await dialog(page).locator('[data-act-title]').textContent(), 'Store 1 defect as tests')
		await dialog(page).getByRole('button', { name: 'Store 1 test' }).click()
		await toast(page, 'Stored 1 defect as tests: H5 → R4')
		assert.deepEqual(testIds(workspace), ['H1', 'H2', 'H3', 'H4', 'H5'])
		assert.equal(await storeButton(page).count(), 0)
	}
)

test('a long toast is cut and keeps its full text in the title', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	read(workspace, (store) => {
		for (let n = 5; n < 14; n++) addExploration(store, `x-${n}`, `b${n}`, `D${n}`, n % 2 ? 'R1' : 'R2')
	})
	await page.goto(url('/plans/notes?view=all'))
	await page.getByRole('button', { name: 'Store 13 defects as tests…' }).click()
	await dialog(page).getByRole('button', { name: 'Store 13 tests' }).click()
	const note = page.locator('[data-toast]')
	await note.waitFor()
	assert((await note.textContent())!.endsWith('…'))
	assert.match((await note.getAttribute('title'))!, /^Stored 13 defects as tests: H1 → R1,.*H13 → R1$/)
})

test(
	'a rule with a stored test offers the plan editor, and a rule without one keeps its edit',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		storeAll(workspace)
		await onList(page, url, '/plans/notes?view=rules&focus=list')
		assert.equal(
			(await page.locator('[data-panel="rules"] [data-key="rule:R1"] .sp-c-meta').textContent())!.startsWith(
				'1 stored test · '
			),
			true
		)
		assert.equal(
			await page.locator('[data-panel="rules"] [data-key="rule:R4"] .sp-c-meta').textContent(),
			'notes.md#pin'
		)
		assert.equal(
			await page.locator('[data-panel="rules"] [data-key="rule:HR1"] .sp-c-meta').textContent(),
			'1 stored test · exploration:x-3/k1/D4'
		)
		assert.equal(await page.locator('[data-nav][data-target="rule:HR1"]').getAttribute('data-in-area'), 'Rules')
		assert.equal(await page.locator('[data-panel="rules"] [data-key="rule:R1"] [data-option]').count(), 1)
		await page.keyboard.press('1')
		await page.waitForURL(/\/plans\/notes@1\/edit$/)

		await onList(page, url, '/plans/notes?view=rules&focus=list')
		for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowDown')
		assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-key')), 'rule:R4')
		await page.keyboard.press('1')
		const edit = page.locator('dialog[data-act-dialog="rule-edit"]')
		await edit.waitFor()
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.type('A note can be pinned to the top.')
		await page.keyboard.press('Enter')
		await toast(page, 'Changed rule R4')
		assert.equal(
			read(workspace, (store) => planRules(store, 'notes')).rules[3].text,
			'A note can be pinned to the top.'
		)
		assert.equal(read(workspace, (store) => planRules(store, 'notes')).origin, 'harvested')
	}
)

test(
	'a rule that gets a stored test while its dialog is open shows the refusal inside the dialog',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		storeAll(workspace)
		await page.goto(url('/plans/notes?view=rule%3AR4'))
		await page.getByRole('button', { name: 'Edit rule R4' }).click()
		const edit = page.locator('dialog[data-act-dialog="rule-edit"]')
		await edit.waitFor()
		read(workspace, (store) => {
			addExploration(store, 'x-4', 'b4', 'D5', 'R4')
			harvestExploration(store, actor, { explorationId: 'x-4', observations: false })
		})
		await edit.locator('input[name="text"]').fill('A note can be pinned to the top.')
		await edit.getByRole('button', { name: 'Save the rule' }).click()
		await edit
			.locator('[data-refusal]', { hasText: 'Rule R4 has a stored test, so it belongs to revision 1.' })
			.waitFor()
		assert(await edit.evaluate((element: HTMLDialogElement) => element.open))
		assert.equal(read(workspace, (store) => planRules(store, 'notes')).rules[3].text, 'A note can be pinned.')
	}
)

test('a live update never closes the store dialog or moves its focus', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const watched = await watchRefreshes(page)
	await page.goto(url('/plans/notes?view=all'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.getByRole('button', { name: 'Store 4 defects as tests…' }).click()
	await dialog(page).waitFor()
	watched.hold()
	read(workspace, (store) => addExploration(store, 'x-4', 'b4', 'D5', 'R4'))
	await watched.arrived()
	await watched.release()
	assert(await dialog(page).evaluate((element: HTMLDialogElement) => element.open))
	assert.equal(await focusedText(page), '1Store 4 tests')
	await page.keyboard.press('1')
	await dialog(page)
		.locator('[data-refusal]', { hasText: '5 defects can be stored now, not 4. Nothing is stored.' })
		.waitFor()
	assert(await dialog(page).evaluate((element: HTMLDialogElement) => element.open))
	assert.equal(writes(workspace), 0)
})

test('the store dialog and changed rows fit at narrow and wide sizes', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	for (const [width, colorScheme] of [
		[400, 'light'],
		[1440, 'dark'],
	] as const) {
		await page.setViewportSize({ width, height: 900 })
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
		for (const view of ['all', 'rules']) {
			await page.goto(url(`/plans/notes?view=${view}`))
			await page.evaluate(() => document.fonts.ready)
			await page.getByRole('button', { name: 'Store 4 defects as tests…' }).click()
			await page.locator('dialog[open]').waitFor()
			assert.deepEqual(await page.evaluate(measure, width <= 760), [], `${view} dialog at ${width}`)
			const box = await page.locator('dialog[open]').boundingBox()
			assert(box && box.x >= 0 && box.x + box.width <= width + 0.5, `dialog fits ${width}`)
			await page.keyboard.press('Escape')
			await page.locator('dialog[open]').waitFor({ state: 'hidden' })
			await page.waitForFunction(() => !window.history.state?.layer)
		}
	}
	storeAll(workspace)
	for (const [width, colorScheme] of [
		[400, 'light'],
		[1440, 'dark'],
	] as const)
		for (const path of [
			'/plans/notes?view=all',
			'/plans/notes?view=rules&focus=list',
			'/plans/notes?view=rules&focus=list&at=rule%3AR1',
			'/plans/notes?view=rule%3AR1',
			'/plans/notes?view=rule%3AR4',
			'/plans/notes?view=rule%3AHR1',
		])
			await check(page, url(path), width, colorScheme)
})
