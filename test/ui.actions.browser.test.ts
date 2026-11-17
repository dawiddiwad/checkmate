import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationState, running } from '../plugin/src/explorers.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { focusedKey, launchWith, openIn, skip, stop } from './browser.ts'
import { postAs, waitFor, workspaceWithFake } from './actions.ts'
import { done, event, launched, openTest, report } from './explorations.ts'
import { human } from '../scripts/ui-demo.ts'

test.before(() => launchWith(() => {}))
test.after(stop)

const stacks = { kind: 'defect', title: 'Coupon stacks', severity: 'high', expected: '450', actual: '400' }
const sleeping = { explorer: 'Studied.', tester: '!sleep' }

const focused = (page: Page) =>
	page.evaluate(() => {
		const element = document.activeElement as HTMLElement
		return element.id || element.dataset.key || element.textContent?.trim() || element.tagName
	})

async function setup(t: Parameters<typeof workspaceWithFake>[0], replies: Parameters<typeof workspaceWithFake>[1]) {
	const base = workspaceWithFake(t, replies)
	const opened = await openIn(t, base.workspace, {}, base.env)
	const alive = () => {
		const { supervisor, children } = base.pids('x-1')
		return [supervisor, ...children].filter((pid): pid is number => pid !== undefined)
	}
	t.after(() => {
		for (const pid of alive()) if (running(pid)) process.kill(-pid, 'SIGKILL')
	})
	return { ...base, ...opened, alive }
}

const state = (read: ReturnType<typeof workspaceWithFake>['read'], id: string) =>
	read((reading) => explorationState(explorationEvents(reading, id)))

test('a person starts, watches, and stops a test with the keys alone', { skip }, async (t) => {
	const { page, url, read, alive } = await setup(t, sleeping)
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.keyboard.press('ArrowRight')
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('ArrowUp')
	assert.equal(await focused(page), 'Test build…')
	await page.keyboard.press('Enter')
	await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
	assert.equal(await focused(page), 'act-test-build')
	await page.keyboard.press('Control+A')
	await page.keyboard.type('b1')
	await page.keyboard.press('ArrowDown')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'normal')
	await page.keyboard.press('1')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'smoke')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'More')
	await page.keyboard.press('ArrowRight')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'act-test-since')
	await page.keyboard.press('Escape')
	assert(await page.locator('dialog[data-act-dialog="test"]').evaluate((dialog: HTMLDialogElement) => dialog.open))
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'EnterStart the test')
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/explorations\/x-1$/)

	await page.locator('.sp-strip [aria-current="step"]').waitFor()
	await page.waitForFunction(() =>
		document.querySelector('.sp-strip [aria-current="step"]')?.textContent?.includes('test')
	)
	assert.equal(await page.locator('.sp-strip [aria-current]').count(), 1)
	assert.deepEqual(await page.locator('.sp-strip [data-phase]').allTextContents(), [
		'study',
		'test',
		'record',
		'merge',
		'check',
	])
	const first = await page.locator('[data-region="exploration-state"] [data-since]').textContent()
	await page.waitForFunction(
		(before) => document.querySelector('[data-region="exploration-state"] [data-since]')?.textContent !== before,
		first
	)
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
	for (let step = 0; step < 6 && (await focused(page)) !== 'Stop the test…'; step++)
		await page.keyboard.press('ArrowUp')
	assert.equal(await focused(page), 'Stop the test…')
	await page.keyboard.press('Enter')
	await page.locator('dialog[data-act-dialog="stop-x-1"][open]').waitFor()
	assert.match((await page.locator('dialog[open] .sp-sub').textContent()) ?? '', /test of checkout, build b1/)
	await page.keyboard.type('wrong build')
	const pids = alive()
	assert(pids.some(running))
	await page.keyboard.press('Enter')
	await page.getByText(`Stopped by ${human}`).waitFor()
	assert.match((await page.locator('[data-region="exploration-banner"]').textContent()) ?? '', /: wrong build\./)
	assert.match(
		(await page.locator('[data-region="exploration-banner"]').textContent()) ?? '',
		/work folder \.checkmate\/work\/x-1/
	)
	await page.getByRole('button', { name: 'Test build… again' }).waitFor()
	assert.equal(await page.locator('.sp-strip').count(), 0)
	assert.equal(state(read, 'x-1'), 'stopped')
	assert(pids.every((pid) => !running(pid)))

	await page
		.getByRole('navigation', { name: 'Status bar' })
		.or(page.locator('.statusbar'))
		.getByRole('link', { name: 'Activity', exact: true })
		.click()
	await page.waitForURL(/\/activity$/)
	const row = page.locator('[data-key="run:x-1"]')
	assert.match((await row.textContent()) ?? '', /stopped/)
	assert.doesNotMatch((await page.locator('[data-region="activity-link"]').textContent()) ?? '', /running/)
	await page.goto(url('/'))
	assert.match((await page.locator('[data-key="plan:checkout"]').textContent()) ?? '', /stopped/)
	assert.doesNotMatch((await page.locator('[data-key="plan:checkout"]').textContent()) ?? '', /Testing/)
	await page.goto(url('/plans/checkout'))
	assert.match((await page.locator('.sp-nav [data-target="testers"]').textContent()) ?? '', /Testers\s*stopped/)
})

test('a person starts a test, stops one tester, and stops the test with the pointer', { skip }, async (t) => {
	const { page, url, read, pids } = await setup(t, sleeping)
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.locator('[data-panel]:not([hidden]) [data-act="test"]').click()
	const dialog = page.locator('dialog[data-act-dialog="test"]')
	await dialog.waitFor()
	assert.match(await dialog.locator('input[name="build"]').inputValue(), /^(\w{7,}|local-\d{8}-\d{4})$/)
	assert.equal(await dialog.locator('input[name="level"]:checked').inputValue(), 'normal')
	assert.equal(await dialog.locator('details[data-more]').evaluate((fold: HTMLDetailsElement) => fold.open), false)
	await dialog.locator('input[name="build"]').fill('b2')
	await dialog.locator('label', { hasText: 'normal' }).click()
	await dialog.getByRole('button', { name: /Start the test/ }).click()
	await page.waitForURL(/\/explorations\/x-1$/)
	await waitFor('both testers sleep', () => pids('x-1').children.length >= 4)
	await page.locator('[data-key="explorer:a1"]', { hasText: 'Running' }).waitFor()

	await page.locator('[data-key="explorer:a1"]').click()
	await page.waitForURL(/item=explorer%3Aa1/)
	await page.locator('.sp-optlist').getByRole('button', { name: 'Stop' }).click()
	const tester = page.locator('dialog[data-act-dialog="stop-x-1-a1"]')
	await tester.waitFor()
	assert.match(
		((await tester.textContent()) ?? '').replace(/\s+/g, ' '),
		/Stop tester a1 of checkout, build b2\? The other testers go on\./
	)
	await tester.getByRole('button', { name: /Stop tester a1/ }).click()
	await page.waitForURL(/\/explorations\/x-1$/)
	await page.locator('[data-key="explorer:a1"]', { hasText: 'Stopped' }).waitFor()
	await page.locator('[data-key="explorer:a2"]', { hasText: 'Running' }).waitFor()
	assert.equal(state(read, 'x-1'), 'testing')

	await page.getByRole('button', { name: 'Stop the test…' }).click()
	await page.locator('dialog[data-act-dialog="stop-x-1"] input[name="reason"]').fill('done looking')
	await page.locator('dialog[data-act-dialog="stop-x-1"]').getByRole('button', { name: 'Stop the test' }).click()
	await page.getByText(`Stopped by ${human}`).waitFor()
	assert.equal(state(read, 'x-1'), 'stopped')
	assert(pids('x-1').children.every((pid) => !running(pid)))
})

test('a dialog closes with a message when the tester that it names ends', { skip }, async (t) => {
	const { page, url, read, pids } = await setup(t, sleeping)
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-panel]:not([hidden]) [data-act="test"]').click()
	await page.locator('dialog[data-act-dialog="test"] label', { hasText: 'smoke' }).click()
	await page
		.locator('dialog[data-act-dialog="test"]')
		.getByRole('button', { name: /Start the test/ })
		.click()
	await page.waitForURL(/\/explorations\/x-1$/)
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
	await page.locator('[data-key="explorer:a1"]', { hasText: 'Running' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
	while ((await focusedKey(page)) !== 'explorer:a1') await page.keyboard.press('ArrowUp')
	await page.keyboard.press('1')
	const dialog = page.locator('dialog[data-act-dialog="stop-x-1-a1"]')
	await dialog.waitFor()
	assert.match((await dialog.textContent()) ?? '', /Stop tester a1/)
	const { children } = pids('x-1')
	process.kill(-children[1], 'SIGKILL')
	await page.locator('dialog[open]').waitFor({ state: 'detached' })
	await page.waitForFunction(
		() =>
			document.querySelector('[data-say]')?.textContent === 'Tester a1 has finished. Nothing was stopped.' ||
			document.querySelector('[data-say-strip]')?.textContent === 'Tester a1 has finished. Nothing was stopped.'
	)
	await waitFor('the run ends', () => state(read, 'x-1') === 'failed')
	assert.equal(await focusedKey(page), 'explorer:a1')
	await page.getByRole('button', { name: 'Test build… again' }).waitFor()
})

test('a run whose supervisor dies shows as interrupted, and no place says running', { skip }, async (t) => {
	const { page, url, read, pids } = await setup(t, sleeping)
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-panel]:not([hidden]) [data-act="test"]').click()
	await page.locator('dialog[data-act-dialog="test"] label', { hasText: 'smoke' }).click()
	await page
		.locator('dialog[data-act-dialog="test"]')
		.getByRole('button', { name: /Start the test/ })
		.click()
	await page.waitForURL(/\/explorations\/x-1$/)
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
	await page.locator('.sp-strip').waitFor()
	assert.match((await page.locator('.statusbar').textContent()) ?? '', /1 running/)
	process.kill(pids('x-1').supervisor!, 'SIGKILL')
	await page.getByText('The run was interrupted: the supervisor stopped before the end.').waitFor()
	assert.equal(state(read, 'x-1'), 'interrupted')
	assert.equal(await page.locator('.sp-strip').count(), 0)
	await page.getByRole('button', { name: 'Test build… again' }).waitFor()
	assert.doesNotMatch((await page.locator('.statusbar').textContent()) ?? '', /running/)
	await page.goto(url('/activity'))
	assert.match((await page.locator('[data-key="run:x-1"]').textContent()) ?? '', /interrupted/)
	await page.goto(url('/'))
	assert.match((await page.locator('[data-key="plan:checkout"]').textContent()) ?? '', /interrupted/)
	await page.goto(url('/plans/checkout'))
	assert.match((await page.locator('.sp-nav [data-target="testers"]').textContent()) ?? '', /interrupted/)
})

test(
	'a second start is refused inside the dialog, which stays open and keeps focus on the field',
	{ skip },
	async (t) => {
		const { page, url, ui, pids } = await setup(t, sleeping)
		assert.equal((await postAs(ui, human, '/plans/checkout/test', { build: 'b1', level: 'smoke' })).status, 303)
		await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
		assert.equal((await postAs(ui, human, '/explorations/x-1/stop', { reason: 'first' })).status, 303)
		assert.equal((await postAs(ui, human, '/plans/checkout/test', { build: 'b2', level: 'smoke' })).status, 303)
		await page.goto(url('/activity'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('ArrowDown')
		assert.equal(await focusedKey(page), 'run:x-1')
		await page.keyboard.press('1')
		const dialog = page.locator('dialog[data-act-dialog="test"][open]')
		await dialog.waitFor()
		assert.equal(await dialog.locator('input[name="build"]').inputValue(), 'b1')
		assert.equal(await dialog.locator('input[name="level"]:checked').inputValue(), 'smoke')
		await page.keyboard.press('Enter')
		await dialog.locator('[data-act-error] [role="alert"]').waitFor()
		assert.match(
			(await dialog.locator('[data-act-error]').textContent()) ?? '',
			/A test of checkout is in progress: x-2\./
		)
		assert.equal(await dialog.locator('[data-act-error] a').getAttribute('href'), '/explorations/x-2')
		assert.equal(await focused(page), 'act-test-build')
		await page.keyboard.press('Escape')
		await page.keyboard.press('Escape')
		await page.locator('dialog[open]').waitFor({ state: 'detached' })
		assert.equal(await focusedKey(page), 'run:x-1')
		await page.keyboard.press('1')
		await page.locator('dialog[open]').waitFor()
		await page.goBack()
		await page.locator('dialog[open]').waitFor({ state: 'detached' })
		assert.match(page.url(), /\/activity$/)
		await page.keyboard.press('ArrowUp')
		assert.equal(await focusedKey(page), 'run:x-2')
		await page.keyboard.press('1')
		const stopping = page.locator('dialog[data-act-dialog="stop-x-2"][open]')
		await stopping.waitFor()
		await stopping.getByRole('button', { name: /Stop the test/ }).click()
		await page.waitForURL(/\/explorations\/x-2$/)
	}
)

test(
	'the failure of a run says what went wrong and what to do next, in the view and in Activity',
	{ skip },
	async (t) => {
		const { page, url, workspace } = await setup(t, {})
		const seeded = openStore(workspace)
		openTest(seeded, 'checkout', 'x-1', 'b1')
		launched(seeded, 'x-1', 'a1')
		done(seeded, 'x-1', 'failed', { reason: 'No claude executable on PATH. Nothing changed.' })
		openTest(seeded, 'checkout', 'x-2', 'b2')
		done(seeded, 'x-2', 'failed', { reason: 'Host authentication: no session could log in.' })
		openTest(seeded, 'checkout', 'x-3', 'b3')
		event(seeded, 'x-3', {
			step: 'end',
			explorer: 'a1',
			status: 'interrupted',
			detail: { reason: 'claude did not end in 900 seconds. Checkmate stopped it.' },
		})
		done(seeded, 'x-3', 'failed', { reason: 'No explorer session was recorded.' })
		openTest(seeded, 'checkout', 'x-4', 'b4')
		done(seeded, 'x-4', 'failed', { reason: 'The instance local did not answer.' })
		closeStore(seeded)
		const expected: Array<[string, RegExp]> = [
			[
				'x-1',
				/Claude Code was not found: no claude program is on PATH\. Install Claude Code, or add the folder of claude to PATH\. Then test again\./,
			],
			['x-2', /Claude Code is not signed in on this computer\. Run claude and log in\. Then test again\./],
			['x-3', /A tester did not end in 900 seconds\. Checkmate stopped it\. Test again with the level smoke/],
			['x-4', /The test failed: The instance local did not answer\. Read the log of the run\. Then test again\./],
		]
		for (const [id, text] of expected) {
			await page.goto(url(`/explorations/${id}`))
			const banner =
				(await page.locator('[data-region="exploration-banner"]').textContent())?.replace(/\s+/g, ' ') ?? ''
			assert.match(banner, text, id)
			assert.doesNotMatch(banner, /\[object|Error:/)
		}
		await page.goto(url('/explorations/x-2'))
		assert.match((await page.locator('[data-region="exploration-banner"]').textContent()) ?? '', /apiKeyHelper/)
		await page.goto(url('/activity'))
		for (const [id, text] of expected) {
			const title = (await page.locator(`[data-key="run:${id}"] .sp-c-title`).getAttribute('title')) ?? ''
			assert.match(title, text, id)
			assert(await page.locator(`[data-key="run:${id}"] [data-act="test"]`).count())
		}
		assert.equal(
			await page
				.locator('[data-region="activity-link"]')
				.textContent()
				.then((text) => text!.trim()),
			'Activity'
		)
	}
)

test('Test the answers asks first, names the count, and opens the Testers view', { skip }, async (t) => {
	const { page, url, read, ui } = await setup(t, {
		explorer: 'Tested.',
		recorder: [stacks, { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }],
		merger: [],
		follower: 'Tested the answers.',
	})
	assert.equal((await postAs(ui, human, '/plans/checkout/test', { build: 'b1', level: 'smoke' })).status, 303)
	await waitFor('the run completes', () => state(read, 'x-1') === 'completed')
	await page.goto(url('/plans/checkout?view=all'))
	await page.locator('[data-panel="all"] [data-key^="q:"]').first().click()
	await page.waitForURL(/item=q%3A/)
	await page.locator('[data-drawer]').getByLabel('How it should be, in one sentence').fill('No.')
	await page.getByRole('button', { name: 'Send the answer' }).click()
	await page
		.getByRole('status')
		.filter({ hasText: /^Answered/ })
		.waitFor()
	await page.goto(url('/plans/checkout'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-nav]'))
	await page.keyboard.press('ArrowRight')
	await page.keyboard.press('ArrowUp')
	assert.equal(await focused(page), 'Test build…')
	await page.keyboard.press('ArrowRight')
	assert.equal(await focused(page), 'Test the answers (1)…')
	await page.keyboard.press('Enter')
	const dialog = page.locator('dialog[data-act-dialog="follow"][open]')
	await dialog.waitFor()
	assert.match((await dialog.textContent()) ?? '', /Test the 1 answer/)
	await page.keyboard.press('2')
	await dialog.waitFor({ state: 'hidden' })
	assert.equal(await focused(page), 'Test the answers (1)…')
	assert.equal(
		read((reading) => explorationEvents(reading, 'x-1').filter((item) => item.step === 'follow').length),
		0
	)
	await page.keyboard.press('Enter')
	await dialog.waitFor()
	await page.keyboard.press('1')
	await page.waitForURL(/\/explorations\/x-1$/)
	await waitFor('the follow-up ends', () =>
		read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'followed'))
	)
	await page
		.getByRole('status')
		.filter({ hasText: 'Testing 1 answer of x-1' })
		.or(page.locator('[data-region="exploration-state"]'))
		.first()
		.waitFor()
})

test('a live update keeps the focus on the action that has it', { skip }, async (t) => {
	const { page, url, workspace } = await setup(t, {})
	const seeded = openStore(workspace)
	openTest(seeded, 'checkout', 'x-1', 'b1')
	done(seeded, 'x-1')
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.keyboard.press('ArrowRight')
	await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
	while ((await focused(page)) !== 'Test build…') await page.keyboard.press('ArrowUp')
	await page.evaluate(() => {
		;(document.querySelector('[data-actions] button[data-act]') as HTMLElement & { old?: boolean }).old = true
	})
	report(seeded, 'x-1', 'a1', '# Report of a1\n')
	closeStore(seeded)
	await page.waitForFunction(
		() =>
			!(document.querySelector('[data-actions] button[data-act]') as (HTMLElement & { old?: boolean }) | null)
				?.old
	)
	assert.equal(await focused(page), 'Test build…')
})
