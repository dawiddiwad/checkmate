import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationStatus } from '../plugin/src/explorers.ts'
import { addInstance } from '../plugin/src/targets.ts'
import { launchWith, openIn, browserTest, stop } from './browser.ts'
import { endProcessesIn, waitFor, workspaceWithFake } from './actions.ts'
import { actor } from './support.ts'

test.before(() => launchWith(() => {}))
test.after(stop)

const stacks = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }

test('a person names the instance of a test with the keys alone', browserTest, async (t) => {
	const base = workspaceWithFake(t, { explorer: 'Tested.', recorder: [stacks], merger: [] })
	t.after(() => endProcessesIn(base.workspace))
	const opened = openStore(base.workspace)
	addInstance(opened, actor, {
		targetId: 'checkout-local',
		instanceId: 'staging',
		instance: { entries: { web: 'http://127.0.0.1:4173/staging' }, environment: 'staging' },
	})
	closeStore(opened)
	const { page, url } = await openIn(t, base.workspace, {}, base.env)
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.getByRole('button', { name: 'Test build…' }).click()
	await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
	await page.keyboard.type('b1')
	await page.keyboard.press('Enter')
	const refusal = page.locator('dialog[open] [role="alert"][data-refusal]')
	await refusal.waitFor()
	assert.match((await refusal.textContent()) ?? '', /Choose the instance: local or staging\./)
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'local')
	await page.keyboard.press('2')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'staging')
	await page.keyboard.press('ArrowDown')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'normal')
	await page.keyboard.press('1')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'smoke')
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/explorations\/x-1$/)
	await waitFor('the run ends', () => base.read((reading) => explorationStatus(reading, 'x-1').state === 'completed'))
	assert.equal(
		base.read((reading) => explorationStatus(reading, 'x-1').instanceId),
		'staging'
	)
})
