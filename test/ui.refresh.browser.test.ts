import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { answerGap } from '../plugin/src/plans.ts'
import { decideClaim } from '../plugin/src/journal.ts'
import { mergedClaims } from '../plugin/src/views.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { open, browserTest, stop, launchWith, focusedKey } from './browser.ts'
import { watchRefreshes } from './refresh.ts'

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

function deferElsewhere(workspace: string, gapId: string) {
	read(workspace, (store) =>
		answerGap(store, 'qa-lead', {
			planId: 'coupons',
			gapId,
			kind: 'defer',
			value: 'Later.',
			rationale: 'Elsewhere.',
		})
	)
}

function decideElsewhere(workspace: string, claimId: string) {
	read(workspace, (store) =>
		decideClaim(store, 'qa-lead', { planId: 'coupons', claimId, verdict: 'approved', rationale: 'Elsewhere.' })
	)
}

const stateOf = (workspace: string, claimId: string) =>
	read(workspace, (store) => mergedClaims(store, 'coupons').find((claim) => claim.id === claimId)!.state)

async function watchedList(page: Page, url: (path: string) => string) {
	const watched = await watchRefreshes(page)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'c:k1/D10')
	return watched
}

test('a refresh never replaces a field that has focus, and the caret stays', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const watched = await watchedList(page, url)
	watched.hold()
	decideElsewhere(workspace, 'k1/D12')
	await watched.arrived()
	await page.keyboard.press('2')
	await page.waitForFunction(() => document.activeElement?.matches('textarea'))
	await watched.release()
	await page.keyboard.type('abd')
	await page.keyboard.press('ArrowLeft')
	await page.keyboard.type('c')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).value), 'abcd')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).selectionStart), 3)
})

test('a key pressed while a refresh is held acts on the row that had the highlight then', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const watched = await watchedList(page, url)
	watched.hold()
	deferElsewhere(workspace, 'k1/Q10')
	await watched.arrived()
	await page.keyboard.press('ArrowDown')
	assert.equal(await focusedKey(page), 'c:k1/D12')
	await watched.release()
	assert.equal(await focusedKey(page), 'c:k1/D12')
	assert.equal(await page.locator('.hl[data-row]').getAttribute('data-key'), 'c:k1/D12')
	await page.keyboard.press('1')
	await page.getByRole('status').filter({ hasText: 'Accepted coupons · k1/D12' }).waitFor()
	assert.equal(stateOf(workspace, 'k1/D12'), 'accepted')
	assert.equal(stateOf(workspace, 'k1/D10'), 'suspected')
})

test('a refresh never closes or re-creates the find bar, the key panel, or a dialog', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const watched = await watchedList(page, url)
	const flows: Array<[string, string, string, () => Promise<unknown>, string, string]> = [
		[
			'find bar',
			'[data-find]',
			'[data-find-input]',
			() => page.keyboard.press('/'),
			'k1/Q10',
			'[data-key="c:k1/D10"]',
		],
		[
			'key panel',
			'[data-keys]',
			'[data-keys] button',
			() => page.keyboard.press('?'),
			'k1/Q9',
			'[data-key="c:k1/D10"]',
		],
		[
			'dialog',
			'dialog[data-act-dialog="test"]',
			'dialog[data-act-dialog="test"] input[name="build"]',
			() => page.locator('[data-panel]:not([hidden]) [data-act="test"]').click(),
			'k1/Q8',
			'[data-act="test"]',
		],
	]
	for (const [name, dialog, field, opener, gapId, back] of flows) {
		await opener()
		await page.locator(`${dialog}[open]`).waitFor()
		await page.locator(field).focus()
		if (name !== 'key panel') {
			await page.keyboard.press('Control+A')
			await page.keyboard.type('cou')
		}
		await page.locator(dialog).evaluate((element) => Object.assign(element, { kept: true }))
		watched.hold()
		deferElsewhere(workspace, gapId)
		await watched.arrived()
		if (name !== 'key panel') await page.keyboard.type('p')
		await watched.release()
		const state = await page.evaluate(
			([dialogSelector, fieldSelector]) => {
				const element = document.querySelector(dialogSelector) as HTMLDialogElement & { kept?: boolean }
				const input = document.querySelector(fieldSelector) as HTMLInputElement
				return {
					open: element.open,
					kept: element.kept === true,
					focused: document.activeElement === input,
					value: input.value,
					caret: input.selectionStart,
				}
			},
			[dialog, field]
		)
		const typed = name === 'key panel' ? {} : { value: 'coup', caret: 4 }
		assert.deepEqual(
			{ open: state.open, kept: state.kept, focused: state.focused },
			{ open: true, kept: true, focused: true },
			name
		)
		if (name !== 'key panel') assert.deepEqual({ value: state.value, caret: state.caret }, typed, name)
		for (let step = 0; step < 3 && (await page.locator(`${dialog}[open]`).count()); step++)
			await page.keyboard.press('Escape')
		await page.locator(`${dialog}[open]`).waitFor({ state: 'detached' })
		await page
			.waitForFunction(() => !window.history.state?.layer)
			.catch(() => assert.fail(`${name} left a history layer`))
		await page
			.waitForFunction((wanted) => document.activeElement?.matches(wanted), back)
			.catch(() => assert.fail(`${name} did not give the focus back to the row`))
	}
})

test('a refresh that arrives while a decision is sent is dropped', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const watched = await watchedList(page, url)
	let letPostGo = () => {}
	const posting = new Promise<void>((done) =>
		page.route('**/claims/**', async (route) => {
			if (route.request().method() !== 'POST') return route.continue()
			done()
			await new Promise<void>((release) => (letPostGo = release))
			await route.continue()
		})
	)
	watched.hold()
	decideElsewhere(workspace, 'k1/D12')
	await watched.arrived()
	await page.keyboard.press('1')
	await posting
	await watched.release()
	assert.equal(await page.locator('[data-panel="needs"] [data-key="c:k1/D12"]').count(), 1)
	letPostGo()
	await page.getByRole('status').filter({ hasText: 'Accepted coupons · k1/D10' }).waitFor()
})

test('a refresh that arrives while the page leaves is dropped', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	const watched = await watchedList(page, url)
	let letPageGo = () => {}
	const leaving = new Promise<void>((done) =>
		page.route(
			(address) => address.searchParams.has('item'),
			async (route) => {
				if (route.request().resourceType() !== 'document') return route.continue()
				done()
				await new Promise<void>((release) => (letPageGo = release))
				await route.continue()
			}
		)
	)
	watched.hold()
	deferElsewhere(workspace, 'k1/Q10')
	await watched.arrived()
	await page.keyboard.press('ArrowRight')
	await leaving
	const before = watched.replaced()
	await watched.release()
	assert.equal(watched.replaced(), before)
	letPageGo()
	await page.waitForURL(/item=/)
})
