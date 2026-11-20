import { piAuthenticationHint } from '../plugin/src/sessions.ts'
import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationState, running } from '../plugin/src/explorers.ts'
import { explorationEvents, openExploration } from '../plugin/src/explorations.ts'
import { focusedKey, launchWith, openIn, browserTest, stop } from './browser.ts'
import { endProcessesIn, postAs, waitFor, workspaceWithFake } from './actions.ts'
import { done, event, launch, launched, openTest, report } from './explorations.ts'
import { human } from '../scripts/ui-demo.ts'
import { watchRefreshes } from './refresh.ts'

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
	t.after(() => endProcessesIn(base.workspace))
	const opened = await openIn(t, base.workspace, {}, base.env)
	const alive = () => {
		const { supervisor, children } = base.pids('x-1')
		return [supervisor, ...children].filter((pid): pid is number => pid !== undefined)
	}
	return { ...base, ...opened, alive }
}

const state = (read: ReturnType<typeof workspaceWithFake>['read'], id: string) =>
	read((reading) => explorationState(explorationEvents(reading, id)))

test('a person starts, watches, and stops a test with the keys alone', browserTest, async (t) => {
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
	assert.equal(await focused(page), 'act-test-rules')
	assert.equal(await page.locator('#act-test-rules').inputValue(), 'Read Bash')
	assert.equal(await page.locator('label[for="act-test-rules"]').textContent(), 'Testers may use without asking')
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
	assert.equal(await focused(page), 'Models by tester')
	for (let i = 0; i < 4 && (await focused(page)) !== 'EnterStart the test'; i++)
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
	assert.match((await page.locator('.sp-nav [data-target="testers"]').textContent()) ?? '', /Testers · stopped/)
})

test('a person starts a test, stops one tester, and stops the test with the pointer', browserTest, async (t) => {
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

test('a dialog closes with a message when the tester that it names ends', browserTest, async (t) => {
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

test('a run whose supervisor dies shows as interrupted, and no place says running', browserTest, async (t) => {
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
	assert.match(await page.locator('.statusbar [data-region="activity-link"]').innerText(), /^Activity · 1 running$/i)
	process.kill(pids('x-1').supervisor!, 'SIGKILL')
	await page.getByText('The run was interrupted: the supervisor stopped before the end.').waitFor()
	assert.equal(state(read, 'x-1'), 'interrupted')
	assert.equal(await page.locator('main h1').textContent(), 'Testers')
	assert.match(
		(await page.locator('[data-region="exploration-head"] .sp-sub').textContent()) ?? '',
		/started .*, ended .*, took \d+/
	)
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
	browserTest,
	async (t) => {
		const { page, url, ui, pids, read } = await setup(t, sleeping)
		assert.equal(
			(await postAs(ui, human, '/plans/checkout/test', { build: 'b1', level: 'smoke', rules: 'Read Bash' }))
				.status,
			303
		)
		await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
		assert.equal((await postAs(ui, human, '/explorations/x-1/stop', { reason: 'first' })).status, 303)
		await waitFor('the stop ends', () =>
			read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'stop-end'))
		)
		assert.equal(
			(await postAs(ui, human, '/plans/checkout/test', { build: 'b2', level: 'smoke', rules: 'Read Bash' }))
				.status,
			303
		)
		await waitFor('the second test sleeps', () => pids('x-2').children.length === 2)
		await page.goto(url('/activity'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('ArrowDown')
		assert.equal(await focusedKey(page), 'run:x-1')
		await page.locator('.hl [data-act="test"]').waitFor()
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
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'run:x-1')
		await page.keyboard.press('1')
		await page.locator('dialog[open]').waitFor()
		await page.goBack()
		await page.locator('dialog[open]').waitFor({ state: 'detached' })
		assert.match(page.url(), /\/activity$/)
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'run:x-1')
		await page.keyboard.press('ArrowUp')
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'run:x-2')
		assert.equal(await focusedKey(page), 'run:x-2')
		await page.keyboard.press('1')
		const stopping = page.locator('dialog[data-act-dialog="stop-x-2"][open]')
		await stopping.waitFor()
		await stopping.getByRole('button', { name: /Stop the test/ }).click()
		await page.waitForURL(/\/explorations\/x-2$/)
	}
)

async function activityOnStoppedRun(t: Parameters<typeof setup>[0]) {
	const app = await setup(t, sleeping)
	const { page, url, ui, pids, read } = app
	const started = (build: string) =>
		postAs(ui, human, '/plans/checkout/test', { build, level: 'smoke', rules: 'Read Bash' })
	assert.equal((await started('b1')).status, 303)
	await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
	assert.equal((await postAs(ui, human, '/explorations/x-1/stop', { reason: 'first' })).status, 303)
	await waitFor('the stop ends', () =>
		read((reading) => explorationEvents(reading, 'x-1').some((item) => item.step === 'stop-end'))
	)
	assert.equal((await started('b2')).status, 303)
	await waitFor('the second test sleeps', () => pids('x-2').children.length === 2)
	const watched = await watchRefreshes(page)
	await page.goto(url('/activity'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('ArrowDown')
	assert.equal(await focusedKey(page), 'run:x-1')
	await page.locator('.hl [data-act="test"]').waitFor()
	return { ...app, watched }
}

test('a refresh that lands while a dialog is open keeps the highlight on its row', browserTest, async (t) => {
	const { page, ui, watched } = await activityOnStoppedRun(t)
	await page.keyboard.press('1')
	await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
	watched.hold()
	assert.equal((await postAs(ui, human, '/explorations/x-2/stop', { reason: 'second' })).status, 303)
	await watched.arrived()
	await watched.release()
	assert.equal(await page.locator('.hl[data-row]').getAttribute('data-key'), 'run:x-1')
	await page.keyboard.press('Escape')
	await page.keyboard.press('Escape')
	await page.locator('dialog[open]').waitFor({ state: 'detached' })
	await page.keyboard.press('1')
	await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
})

test(
	'a dialog that opens again before its close event keeps one history entry and the focus',
	browserTest,
	async (t) => {
		const { page } = await activityOnStoppedRun(t)
		await page.keyboard.press('1')
		await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
		await page.evaluate(() => {
			const press = (key: string) =>
				document.activeElement!.dispatchEvent(
					new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
				)
			press('Escape')
			press('Escape')
			press('1')
		})
		await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
		assert.equal(await page.evaluate(() => window.history.state?.layer), 'act')
		await page.keyboard.press('Escape')
		await page.keyboard.press('Escape')
		await page.locator('dialog[open]').waitFor({ state: 'detached' })
		await page.waitForFunction(() => !window.history.state?.layer)
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'run:x-1')
	}
)

test('a close event that comes late does not take the focus from the row that was moved to', browserTest, async (t) => {
	const { page } = await activityOnStoppedRun(t)
	await page.keyboard.press('1')
	await page.locator('dialog[data-act-dialog="test"][open]').waitFor()
	await page.evaluate(() => {
		const press = (key: string) =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
			)
		press('Escape')
		press('Escape')
		press('ArrowUp')
	})
	await page.waitForFunction(() => new Promise((done) => requestAnimationFrame(() => done(true))))
	assert.equal(await focusedKey(page), 'run:x-2')
})

test(
	'the failure of a run says what went wrong and what to do next, in the view and in Activity',
	browserTest,
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
		openTest(seeded, 'checkout', 'x-5', 'b5')
		done(seeded, 'x-5', 'failed', {
			reason: 'Host authentication: no session could log in.',
			hint: piAuthenticationHint,
		})
		closeStore(seeded)
		const expected: Array<[string, RegExp]> = [
			[
				'x-1',
				/Claude Code was not found: no claude program is on PATH\. Install Claude Code, or add the folder of claude to PATH\. Then test again\./,
			],
			['x-2', /Claude Code is not signed in on this computer\. Run claude and log in\. Then test again\./],
			['x-3', /A tester did not end in 900 seconds\. Checkmate stopped it\. Test again with the level smoke/],
			['x-5', /Pi could not sign in to its provider/],
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

test('Test the answers asks first, names the count, and opens the Testers view', browserTest, async (t) => {
	const { page, url, read, ui } = await setup(t, {
		explorer: 'Tested.',
		recorder: [stacks, { kind: 'question', id: 'Q1', question: 'Can a coupon apply to a sale item?' }],
		merger: [],
		follower: 'Tested the answers.',
	})
	assert.equal(
		(await postAs(ui, human, '/plans/checkout/test', { build: 'b1', level: 'smoke', rules: 'Read Bash' })).status,
		303
	)
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

test('a live update keeps the focus on the action that has it', browserTest, async (t) => {
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

test(
	'an empty rules field is refused inside the dialog, at the field, with the focus there',
	browserTest,
	async (t) => {
		const { page, url, read } = await setup(t, sleeping)
		await page.goto(url('/plans/checkout'))
		await page.getByRole('button', { name: 'Test build…' }).click()
		const dialog = page.locator('dialog[data-act-dialog="test"]')
		await dialog.waitFor()
		await page.locator('#act-test-build').fill('b1')
		await page.locator('#act-test-rules').fill('')
		await page.keyboard.press('Enter')
		const message = dialog.locator('#act-test-rules + [role="alert"], #act-test-rules-help + [role="alert"]')
		await message.waitFor()
		assert.match((await message.textContent())!, /Give the tool rules of the explorers and the verifier/)
		assert.equal(await focused(page), 'act-test-rules')
		assert(await dialog.evaluate((element: HTMLDialogElement) => element.open))
		assert.equal(await page.locator('#act-test-build').inputValue(), 'b1')
		assert.equal(
			read((reading) => reading.db.prepare('SELECT COUNT(*) AS n FROM explorations').get()!.n),
			0
		)
		await page.locator('#act-test-rules').fill('Read')
		await page.keyboard.press('Enter')
		await page.waitForURL(/\/explorations\/x-1$/)
		assert.deepEqual(
			read((reading) => explorationEvents(reading, 'x-1').find((item) => item.step === 'start')!.detail.allow),
			['Read']
		)
	}
)

test(
	'a row that cannot show its options lists them in the detail, and the number keys act there',
	browserTest,
	async (t) => {
		const { page, url, ui, pids } = await setup(t, sleeping)
		await page.setViewportSize({ width: 400, height: 800 })
		const started = await postAs(ui, human, '/plans/checkout/test', { build: 'b1', level: 'smoke', rules: 'Read' })
		assert.equal(started.status, 303)
		await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
		await page.goto(url('/explorations/x-1'))
		await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
		const crowd = () =>
			page.evaluate(() => {
				for (const label of document.querySelectorAll('.sp-c-opts .sp-btn > span'))
					label.textContent += ' with a very long label'.repeat(60)
				window.dispatchEvent(new Event('resize'))
			})
		const many = () => page.locator('[data-row].hl').evaluate((row) => row.classList.contains('many'))
		await page.keyboard.press('ArrowRight')
		await page.waitForFunction(() => document.activeElement?.matches('[data-row].hl'))
		await crowd()
		assert(await many())
		const options = page.locator('[data-region="exploration-detail"] [data-option]')
		assert.deepEqual(await options.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))), [
			'1: Stop tester a1',
		])
		await page.keyboard.press('1')
		await page.locator('dialog[data-act-dialog^="stop-x-1-a"][open]').waitFor()
		await page.keyboard.press('Escape')
		await page.goto(url('/explorations/x-1'))
		const overview = page.locator('[data-region="exploration-detail"]')
		assert.equal(await overview.getByRole('button', { name: 'Stop…' }).getAttribute('title'), 'Stop the test')
	}
)

test('a banner that appears above the highlighted row does not move the row on screen', browserTest, async (t) => {
	const { page, url, ui, pids } = await setup(t, sleeping)
	await page.setViewportSize({ width: 1280, height: 360 })
	assert.equal(
		(await postAs(ui, human, '/plans/checkout/test', { build: 'b1', level: 'smoke', rules: 'Read Bash' })).status,
		303
	)
	await waitFor('the test turn sleeps', () => pids('x-1').children.length === 2)
	const watched = await watchRefreshes(page)
	await page.goto(url('/explorations/x-1'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.locator('[data-key="explorer:a1"]', { hasText: 'Running' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('.hl[data-row]'))
	for (let step = 0; step < 12; step++) await page.keyboard.press('ArrowDown')
	await page.waitForFunction(() => window.scrollY > 0)
	const topOf = () => page.evaluate(() => document.querySelector('.hl[data-row]')!.getBoundingClientRect().top)
	const before = await topOf()
	await page.evaluate(() => {
		const probe = window as unknown as { tops: number[] }
		probe.tops = []
		const frame = () => {
			probe.tops.push(document.querySelector('.hl[data-row]')?.getBoundingClientRect().top ?? -1)
			requestAnimationFrame(frame)
		}
		frame()
	})
	watched.hold()
	assert.equal((await postAs(ui, human, '/explorations/x-1/stop', { reason: 'first' })).status, 303)
	await watched.arrived()
	await watched.release()
	await page.getByText(`Stopped by ${human}`).waitFor()
	const tops = await page.evaluate(() => (window as unknown as { tops: number[] }).tops)
	assert(
		tops.every((top) => Math.abs(top - before) <= 1),
		`the highlighted row was at ${before} and then at ${[...new Set(tops.map(Math.round))]}`
	)
})

test('a person selects different tester models and keeps them when the level changes', browserTest, async (t) => {
	const { page, url, read, pids } = await setup(t, sleeping)
	await page.route('**/settings/harness/models?*', (route) =>
		route.fulfill({
			json: {
				models: [
					{ value: 'haiku', label: 'Haiku' },
					{ value: 'sonnet', label: 'Sonnet', effortLevels: ['medium', 'high'] },
				],
			},
		})
	)
	await page.goto(url('/plans/checkout'))
	await page.locator('[data-panel]:not([hidden]) [data-act="test"]').click()
	const dialog = page.locator('dialog[data-act-dialog="test"][open]')
	await dialog.locator('[data-tester-models] summary').click()
	await dialog.getByText('2 models available.').waitFor()
	await dialog.getByLabel('Tester a1', { exact: true }).waitFor({ state: 'visible' })
	await page.waitForFunction(() => !(document.querySelector('[name="testerModel.a1"]') as HTMLSelectElement).disabled)
	await dialog.getByLabel('Tester a1', { exact: true }).focus()
	await page.keyboard.press('ArrowDown')
	assert.equal(await dialog.getByLabel('Tester a1', { exact: true }).inputValue(), 'haiku')
	await dialog.getByLabel('Tester a2', { exact: true }).selectOption('sonnet')
	assert.equal(await dialog.getByLabel('Reasoning effort for tester a1', { exact: true }).isVisible(), false)
	const effort = dialog.getByLabel('Reasoning effort for tester a2', { exact: true })
	assert.equal(await effort.locator('option:checked').textContent(), 'Default (medium)')
	await effort.selectOption('high')
	await dialog.locator('[data-tester-models] summary').click()
	await dialog.locator('label', { hasText: 'smoke' }).click()
	await page.waitForFunction(() => (document.querySelector('[name="testerModel.a2"]') as HTMLSelectElement).disabled)
	await dialog.locator('label', { hasText: 'normal' }).click()
	await page.waitForFunction(() => !(document.querySelector('[name="testerModel.a2"]') as HTMLSelectElement).disabled)
	await dialog.locator('[data-tester-models] summary').click()
	assert.equal(await dialog.getByLabel('Tester a1', { exact: true }).inputValue(), 'haiku')
	assert.equal(await dialog.getByLabel('Tester a2', { exact: true }).inputValue(), 'sonnet')
	assert.equal(await effort.inputValue(), 'high')
	await dialog.locator('input[name="build"]').fill('b-models')
	await dialog.getByRole('button', { name: /Start the test/ }).click()
	await page.waitForURL(/\/explorations\/x-1$/)
	await waitFor('both testers start', () => pids('x-1').children.length >= 2)
	const start = read((store) => explorationEvents(store, 'x-1').find((event) => event.step === 'start'))
	assert.deepEqual(start?.detail.testerModels, { a1: 'haiku', a2: 'sonnet' })
	assert.deepEqual(start?.detail.testerEfforts, { a2: 'high' })
})

test('new change offers tester models and starts with both selections', browserTest, async (t) => {
	const { page, url, read } = await setup(t, sleeping)
	await page.route('**/settings/harness/models?*', (route) =>
		route.fulfill({
			json: {
				models: [
					{ value: 'haiku', label: 'Haiku' },
					{ value: 'sonnet', label: 'Sonnet' },
				],
			},
		})
	)
	await page.goto(url('/new'))
	const form = page.locator('form[data-page-form]')
	await form.locator('[data-tester-models] summary').click()
	await form.getByText('2 models available.').waitFor()
	await form.getByLabel('Tester a1', { exact: true }).selectOption('haiku')
	await form.getByLabel('Tester a2', { exact: true }).selectOption('sonnet')
	await form.locator('[name="text"]').fill('Check the checkout.')
	await form.locator('[name="plan"]').fill('new-model-run')
	await form.locator('[name="build"]').fill('b1')
	await form.getByRole('button', { name: 'Start the test' }).click()
	await page.waitForURL(/\/explorations\/x-1$/)
	const start = read((store) => explorationEvents(store, 'x-1').find((event) => event.step === 'start'))
	assert.deepEqual(start?.detail.testerModels, { a1: 'haiku', a2: 'sonnet' })
})

test('a failed Pi tester shows the provider error in the run and its detail', browserTest, async (t) => {
	const { page, url, workspace } = await setup(t, {})
	const store = openStore(workspace)
	openExploration(store, human, { planId: 'checkout', build: 'b1', explorationId: 'x-2' })
	event(store, 'x-2', {
		step: 'start',
		detail: { ...launch, context: { harness: 'pi', claudeArgs: [], hiddenPlugin: null } },
	})
	launched(store, 'x-2', 'a1')
	event(store, 'x-2', {
		step: 'end',
		explorer: 'a1',
		status: 'operational_error',
		detail: {
			reason: 'pi ended with an error: 401: {"message":"API key expired","api_key":"secret-value"}',
		},
	})
	done(store, 'x-2', 'failed', { reason: 'No explorer session was recorded.' })
	closeStore(store)
	await page.goto(url('/explorations/x-2'))
	assert.match((await page.locator('[data-key="run-ended"]').textContent()) ?? '', /HTTP 401/)
	await page.locator('[data-key="explorer:a1"]').click()
	await page.waitForURL(/item=explorer%3Aa1/)
	assert.match((await page.locator('main').textContent()) ?? '', /API key expired/i)
	assert.doesNotMatch((await page.locator('main').textContent()) ?? '', /secret-value/)
})

test('reported costs are visible on plan cards, exploration and history at narrow widths', browserTest, async (t) => {
	const { page, url, workspace } = await setup(t, {})
	const store = openStore(workspace)
	for (const [id, cost] of [
		['x-1', 0.12],
		['x-2', 0],
		['x-3', null],
		['x-4', 123.45],
	] as const) {
		openExploration(store, human, { planId: 'checkout', build: id, explorationId: id })
		event(store, id, { step: 'start', detail: { ...launch, explorers: 1 } })
		launched(store, id, 'a1')
		event(store, id, {
			step: 'end',
			explorer: 'a1',
			status: 'completed',
			detail: cost === null ? {} : { costUsd: cost },
		})
		if (id === 'x-1') event(store, id, { step: 'record', explorer: 'a1', status: 'completed', detail: {} })
		done(store, id)
	}
	closeStore(store)
	for (const width of [1280, 400]) {
		await page.setViewportSize({ width, height: 900 })
		await page.goto(url('/'))
		assert.match(
			(await page.locator('[data-key="plan:checkout"]').textContent()) ?? '',
			/Total cost \$123\.57 \(partial\)/
		)
		await page.goto(url('/explorations/x-1'))
		assert.match(
			(await page.locator('[data-region="exploration-state"]').textContent()) ?? '',
			/Total cost \$0\.12 \(partial\)/
		)
		await page.goto(url('/explorations/x-2'))
		assert.match(
			(await page.locator('[data-region="exploration-state"]').textContent()) ?? '',
			/Total cost \$0\.00/
		)
		await page.goto(url('/explorations/x-3'))
		assert.match(
			(await page.locator('[data-region="exploration-state"]').textContent()) ?? '',
			/Total cost Unknown/
		)
		await page.goto(url('/plans/checkout@1'))
		await page.locator('details[data-open-key="section:explorations"] > summary').click()
		const history = page.locator('details[data-open-key="section:explorations"] table')
		assert.match(
			(await history.locator('tr[data-key="exploration:x-1"]').textContent()) ?? '',
			/\$0\.12 \(partial\)/
		)
		assert.match((await history.locator('tr[data-key="exploration:x-2"]').textContent()) ?? '', /\$0\.00/)
		assert.match((await history.locator('tr[data-key="exploration:x-3"]').textContent()) ?? '', /Unknown/)
		const cost = history.locator('tr[data-key="exploration:x-4"] td[title="Reported exploration cost"]')
		assert.equal((await cost.textContent())?.trim(), '$123.45')
		const fits = await cost.evaluate((cell) => {
			const range = document.createRange()
			range.selectNodeContents(cell)
			const lines = [...range.getClientRects()].filter((rect) => rect.width > 0)
			const bounds = cell.getBoundingClientRect()
			return lines.length === 1 && lines[0].left >= bounds.left && lines[0].right <= bounds.right
		})
		assert.equal(fits, true, `cost fits on one line at ${width}px`)
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
		assert.equal(overflow, false)
	}
})
