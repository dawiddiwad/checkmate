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
