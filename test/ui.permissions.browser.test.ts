import type { TestContext } from 'node:test'
import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closePermission, decidePermission } from '../plugin/src/permissions.ts'
import { closeStore, openStore } from '../plugin/src/index.ts'
import { openExploration } from '../plugin/src/explorations.ts'
import { seedVolume } from '../scripts/ui-volume.ts'
import { launchWith, open, browserTest, stop, focusedKey } from './browser.ts'
import { event, launch as launchEvent, launched } from './explorations.ts'
import {
	allOf,
	asking,
	bash,
	kindRuleBody,
	openOf,
	permissionsOf,
	plainBody,
	seedHistory,
	toolRule,
	waitOpen,
} from './permissions.ts'

test.before(() => launchWith(seedVolume))
test.after(stop)

const rule = 'curl -sS *'

const testers = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']

async function prepare(t: TestContext) {
	const app = await open(t, { viewport: { width: 1440, height: 560 } })
	const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { detached: true, stdio: 'ignore' })
	t.after(() => {
		try {
			process.kill(-sleeper.pid!, 'SIGKILL')
		} catch {}
	})
	const store = openStore(app.workspace)
	openExploration(store, 'checkmate', { planId: 'coupons', build: 'b9', explorationId: 'x-31', instance: 'local' })
	event(store, 'x-31', { step: 'start', detail: launchEvent })
	event(store, 'x-31', { step: 'supervisor', detail: { pid: sleeper.pid } })
	for (const who of testers) launched(store, 'x-31', who)
	closeStore(store)
	const ask = (who: string, body: object = bash('curl -sS http://127.0.0.1:9911/', rule)) =>
		asking(app.ui, app.workspace, 'x-31', who, body)
	return { ...app, ask }
}

const count = (page: Awaited<ReturnType<typeof prepare>>['page']) =>
	page.locator('[data-region="permissions-link"]').textContent()

test(
	'a request joins the end of its group while the highlight stays on its record, and the status bar counts it',
	browserTest,
	async (t) => {
		const { page, url, ask, workspace } = await prepare(t)
		await page.goto(url('/plans/coupons?view=needs&focus=list'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('ArrowDown')
		const key = await focusedKey(page)
		const top = await page.locator('.hl[data-row]').evaluate((row) => row.getBoundingClientRect().top)
		assert.equal(await page.locator('[data-region="permissions-link"]').isHidden(), true)
		const first = ask('a1')
		await page.locator('[data-panel="needs"] [data-key="perm:x-31/P1"]').waitFor()
		assert.equal((await count(page))?.trim(), '1 permission')
		assert.equal(await focusedKey(page), key)
		const after = await page.locator('.hl[data-row]').evaluate((row) => row.getBoundingClientRect().top)
		assert(Math.abs(after - top) < 2, `the highlighted row moved from ${top} to ${after}`)
		const second = ask('a2')
		await page.locator('[data-panel="needs"] [data-key="perm:x-31/P2"]').waitFor()
		assert.equal((await count(page))?.trim(), '2 permissions')
		assert.equal(await focusedKey(page), key)
		const rows = await page
			.locator('[data-panel="needs"] [data-key^="perm:"]')
			.evaluateAll((list) => list.map((row) => row.getAttribute('data-key')))
		assert.deepEqual(rows, ['perm:x-31/P1', 'perm:x-31/P2'])
		assert.match(
			(await page.locator('[data-panel="needs"] .sp-gh').first().textContent()) ?? '',
			/^\s*Permission requests\s*2/
		)
		const row = page.locator('[data-key="perm:x-31/P1"]')
		assert.match(
			(await row.textContent()) ?? '',
			/ASKS\s+x-31\/P1\s+Tester a1 asks to run: curl -sS http:\/\/127\.0\.0\.1:9911\//
		)
		assert.match((await row.locator('.sp-c-meta').textContent()) ?? '', /waits \d+ s/)
		await waitOpen(workspace, 2)
		void first
		void second
	}
)

type Prepared = Awaited<ReturnType<typeof prepare>>

const toast = (page: Page) => page.locator('[data-toast]')

async function saying(page: Page, pattern: RegExp) {
	await page.waitForFunction(
		(source) =>
			new RegExp(source).test(
				[...document.querySelectorAll('[data-say], [data-say-strip]')]
					.map((element) => element.textContent)
					.join('')
			),
		pattern.source
	)
}

async function answeredBy(
	{ workspace }: Prepared,
	explorationId: string,
	requestId: string,
	decision: string,
	reason?: string
) {
	permissionsOf(workspace, (reading) =>
		decidePermission(reading, 'ops', { explorationId, requestId, decision, reason }, () => {})
	)
}

const flows: Array<[string, string, (rule: string, person: string) => string]> = [
	['allow', 'Allow once', () => plainBody('{"behavior":"allow"}')],
	['allow-kind', 'Allow this command for this test', (rule) => kindRuleBody(rule, 'session')],
	[
		'allow-tool',
		'Allow every Write call for this test',
		() => plainBody(`{"behavior":"allow","updatedPermissions":[${toolRule('Write')}]}`),
	],
	['always', 'Always allow this command in this project', (rule) => kindRuleBody(rule, 'localSettings')],
	['deny', 'Deny…', () => plainBody('{"behavior":"deny","message":"Not on this site."}')],
	[
		'stop',
		'Stop tester',
		(_rule, person) => plainBody(`{"behavior":"deny","message":"Stopped by ${person}.","interrupt":true}`),
	],
]

for (const mode of ['keys', 'pointer'] as const)
	test(`each option of the record answers the held request, by ${mode}`, browserTest, async (t) => {
		const app = await prepare(t)
		const { page, url, workspace, ask } = app
		const person = await page
			.context()
			.cookies()
			.then((list) => list.find((item) => item.name === 'checkmate_actor')!.value)
		for (const [index, [decision, label, body]] of flows.entries()) {
			const number = index + 1
			const who = testers[index]
			const command = `curl -sS -m 5 http://127.0.0.1:9911/${mode}-${decision}`
			const unique = `curl -sS ${mode}-${decision} *`
			const held =
				decision === 'allow-tool'
					? ask(who, {
							tool_name: 'Write',
							tool_input: { file_path: `/work/app/${mode}.txt`, content: 'x' },
							cwd: '/work/app',
							permission_suggestions: [
								{
									type: 'addRules',
									rules: [{ toolName: 'Write', ruleContent: `/work/app/${mode}.txt` }],
									behavior: 'allow',
									destination: 'localSettings',
								},
							],
						})
					: ask(who, bash(command, unique))
			await waitOpen(workspace, 1)
			const id = openOf(workspace)[0].id
			await page.goto(url(`/permissions/x-31/${id}`))
			await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
			const options = page.locator('.sp-options [data-option]')
			assert.equal(await options.count(), 6)
			if (mode === 'keys') {
				await page.keyboard.press(String(number))
				if (decision === 'deny') {
					await page.waitForFunction(() => document.activeElement?.id === 'deny-text')
					await page.keyboard.type('Not on this site.')
					await page.keyboard.press('Enter')
				}
				if (decision === 'stop') {
					await page.locator('dialog[data-confirm][open]').waitFor()
					await page.keyboard.press('Enter')
				}
			} else {
				await options.nth(index).click()
				if (decision === 'deny') {
					await page.locator('#deny-text').fill('Not on this site.')
					await page.getByRole('button', { name: 'Deny', exact: true }).click()
				}
				if (decision === 'stop') {
					await page.locator('dialog[data-confirm][open]').waitFor()
					await page.locator('[data-confirm-yes]').click()
				}
			}
			const answer = await held
			assert.equal(answer.body, body(unique, person), `${mode} ${label}`)
			await page.waitForURL(url('/activity'))
			await toast(page).waitFor()
			assert.match((await toast(page).textContent()) ?? '', new RegExp(`Answered x-31/${id}: `))
			assert.equal(openOf(workspace).length, 0)
		}
		assert.deepEqual(
			allOf(workspace, 'x-31').map((item) => item.decision?.kind),
			['allow', 'allow-kind', 'allow-tool', 'always', 'deny', 'stop']
		)
	})

test('a request without a suggestion has four options, numbered one to four', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	const held = ask('a1', bash('node build.js && rm -rf dist'))
	await waitOpen(workspace, 1)
	await page.goto(url('/permissions/x-31/P1'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
	const labels = await page.locator('.sp-options [data-option] kbd').allTextContents()
	assert.deepEqual(labels, ['1', '2', '3', '4'])
	assert.deepEqual(
		await page
			.locator('.sp-options [data-option]')
			.evaluateAll((list) => list.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())),
		['1Allow once', '2Allow every Bash call for this test', '3Deny…', '4Stop tester a1…']
	)
	await page.keyboard.press('5')
	assert.deepEqual(openOf(workspace).length, 1)
	await page.keyboard.press('4')
	await page.locator('dialog[data-confirm][open]').waitFor()
	assert.match((await page.locator('[data-confirm-text]').textContent()) ?? '', /ends tester a1/)
	await page.keyboard.press('Escape')
	await page.locator('dialog[data-confirm]').waitFor({ state: 'hidden' })
	assert.equal(openOf(workspace).length, 1)
	await page.keyboard.press('1')
	assert.equal((await held).body, plainBody('{"behavior":"allow"}'))
	await page.waitForURL(url('/activity'))
})

test('the key 1 answers from a row of Needs you and from a row of the Testers view', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	const first = ask('a1')
	await waitOpen(workspace, 1)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	assert.equal(await focusedKey(page), 'perm:x-31/P1')
	const option = page.locator('.hl .sp-c-opts.asks')
	assert.match((await option.textContent())?.replace(/\s+/g, ' ').trim() ?? '', /^1Allow once more$/)
	await page.keyboard.press('1')
	assert.equal((await first).body, plainBody('{"behavior":"allow"}'))
	await toast(page).waitFor()
	assert.match((await toast(page).textContent()) ?? '', /Answered x-31\/P1: allowed once/)
	await page.locator('[data-key="perm:x-31/P1"]').waitFor({ state: 'detached' })

	const second = ask('a2')
	await waitOpen(workspace, 1)
	await page.goto(url('/explorations/x-31'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const row = page.locator('[data-key="explorer:a2"]')
	assert.match(
		(await row.textContent())?.replace(/\s+/g, ' ') ?? '',
		/Asks\s+a2\s+Asks to run: curl -sS http:\/\/127\.0\.0\.1:9911\/\s+waits/
	)
	assert.equal(await row.getAttribute('data-ask'), 'x-31/P2')
	await row.click({ position: { x: 300, y: 10 } }).catch(() => {})
	await page.goto(url('/explorations/x-31?at=explorer%3Aa2'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'explorer:a2')
	await page.keyboard.press('1')
	assert.equal((await second).body, plainBody('{"behavior":"allow"}'))
	await page.waitForFunction(
		() => document.querySelector('[data-key="explorer:a2"]')?.getAttribute('data-ask') === null
	)
	assert.equal(
		await page
			.locator('[data-key="explorer:a2"] .sp-pill')
			.first()
			.textContent()
			.then((text) => text?.trim()),
		'Running'
	)
})

test('Right and Enter open the request from a row, and Left returns to the row', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	void ask('a1')
	await waitOpen(workspace, 1)
	await page.goto(url('/explorations/x-31?at=explorer%3Aa1'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'explorer:a1')
	const entries = await page.evaluate(() => history.length)
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(/\/permissions\/x-31\/P1\?from=/)
	assert.equal(await page.evaluate(() => history.length), entries + 1)
	await page.keyboard.press('ArrowLeft')
	await page.waitForURL(url('/explorations/x-31?at=explorer%3Aa1'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'explorer:a1')
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/permissions\/x-31\/P1\?from=/)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'perm:x-31/P1')
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(/\/permissions\/x-31\/P1\?from=/)
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/plans\/coupons\?view=needs&at=perm%3Ax-31%2FP1&focus=list/)
})

test('a 1 pressed just after a live update moved the highlight records nothing', browserTest, async (t) => {
	const app = await prepare(t)
	const { page, url, workspace, ask } = app
	const first = ask('a1')
	await waitOpen(workspace, 1)
	const second = ask('a2')
	await waitOpen(workspace, 2)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'perm:x-31/P1')
	await answeredBy(app, 'x-31', 'P1', 'allow')
	await page.locator('[data-key="perm:x-31/P1"]').waitFor({ state: 'detached' })
	assert.equal(await focusedKey(page), 'perm:x-31/P2')
	await page.keyboard.press('1')
	await saying(page, /Nothing is recorded\. x-31\/P1 was answered or closed\./)
	assert.equal(openOf(workspace).length, 1)
	await page.keyboard.press('1')
	assert.equal((await second).body, plainBody('{"behavior":"allow"}'))
	await first
	await toast(page).waitFor()

	const third = ask('a3')
	await waitOpen(workspace, 1)
	await page.goto(url('/explorations/x-31?at=explorer%3Aa3'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-ask') === 'x-31/P3')
	await answeredBy(app, 'x-31', 'P3', 'deny', 'No.')
	await third
	const fourth = ask('a3')
	await page.waitForFunction(
		() => document.querySelector('[data-key="explorer:a3"]')?.getAttribute('data-ask') === 'x-31/P4'
	)
	await waitOpen(workspace, 1)
	await page.keyboard.press('1')
	await saying(page, /Nothing is recorded\. The request of a3 changed\./)
	assert.equal(openOf(workspace).length, 1)
	await page.keyboard.press('1')
	assert.equal((await fourth).body, plainBody('{"behavior":"allow"}'))
	await toast(page).waitFor()
})

test('a denial without a reason is refused in place, and the typed text stays', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	const held = ask('a1')
	await waitOpen(workspace, 1)
	await page.goto(url('/permissions/x-31/P1'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
	assert.equal(await page.locator('[data-extra="deny"]').isHidden(), true)
	await page.keyboard.press('5')
	await page.waitForFunction(() => document.activeElement?.id === 'deny-text')
	await page.keyboard.press('Enter')
	const alert = page.locator('#deny [role="alert"]')
	await alert.waitFor()
	assert.match((await alert.textContent()) ?? '', /Write the text first/)
	await page.keyboard.type('   ')
	await page.getByRole('button', { name: 'Deny', exact: true }).click()
	await page.waitForFunction(() =>
		document.querySelector('#deny [role="alert"]')?.textContent?.includes('A denial needs a reason')
	)
	assert.match(page.url(), /\/permissions\/x-31\/P1$/)
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'deny-text')
	assert.equal(await page.locator('#deny-text').inputValue(), '   ')
	assert.equal(openOf(workspace).length, 1)
	await page.keyboard.press('Escape')
	assert.equal(await page.evaluate(() => document.activeElement?.id), '')
	await page.locator('#deny-text').fill('Not today.')
	await page.keyboard.press('Control+Enter')
	assert.equal((await held).body, plainBody('{"behavior":"deny","message":"Not today."}'))
	await page.waitForURL(url('/activity'))
})

test('after an answer the next request opens in the record, with no new history entry', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	const first = ask('a1')
	await waitOpen(workspace, 1)
	const second = ask('a2')
	await waitOpen(workspace, 2)
	await page.goto(url('/plans/coupons?view=needs&focus=list'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'perm:x-31/P1')
	await page.keyboard.press('ArrowRight')
	await page.waitForURL(/\/permissions\/x-31\/P1\?from=/)
	const entries = await page.evaluate(() => history.length)
	await page.keyboard.press('1')
	await page.waitForURL(/\/permissions\/x-31\/P2\?from=/)
	assert.equal((await first).body, plainBody('{"behavior":"allow"}'))
	assert.equal(await page.evaluate(() => history.length), entries)
	await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
	await page.keyboard.press('1')
	assert.equal((await second).body, plainBody('{"behavior":"allow"}'))
	await page.waitForURL(/\/plans\/coupons\?view=needs&at=perm%3Ax-31%2FP1&focus=list/)
	assert.match((await toast(page).textContent()) ?? '', /Answered x-31\/P2: allowed once/)
})

test(
	'a request that another session or a rule answered, or that closed, shows its state and moves on',
	browserTest,
	async (t) => {
		const app = await prepare(t)
		const { page, url, workspace, ask } = app
		const first = ask('a1')
		await waitOpen(workspace, 1)
		const second = ask('a2')
		await waitOpen(workspace, 2)
		await page.goto(url('/permissions/x-31/P1'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
		await answeredBy(app, 'x-31', 'P1', 'allow')
		await page.locator('[data-moves-on]').waitFor()
		assert.match((await page.locator('[data-key="state"]').textContent()) ?? '', /Answered .*allowed once, by ops/)
		assert.equal(await page.locator('[data-option]').count(), 0)
		await page.waitForURL(/\/permissions\/x-31\/P2$/, { timeout: 4000 })
		await first

		permissionsOf(workspace, (reading) => closePermission(reading, 'x-31', 'P2', 'timeout'))
		await page.locator('[data-moves-on]').waitFor()
		const state = (await page.locator('[data-key="state"]').textContent()) ?? ''
		assert.match(state, /Closed .*no answer in 10 minutes/)
		assert.match(state, /Claude Code denied the call/)
		await page.keyboard.press('x')
		await page.waitForURL(url('/activity'), { timeout: 1500 })
		void second

		const third = ask('a3')
		await waitOpen(workspace, 1)
		await page.goto(url('/permissions/x-31/P3'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
		permissionsOf(workspace, (reading) => closePermission(reading, 'x-31', 'P3', 'stopped'))
		await page.locator('[data-moves-on]').waitFor()
		assert.match((await page.locator('[data-key="state"]').textContent()) ?? '', /the tester or the run stopped/)
		await third
		await page.goto(url('/permissions/x-31/P3?view=history'))
		await page.locator('[data-key="state"]').waitFor()
		assert.equal(await page.locator('[data-moves-on]').count(), 0)
		assert.match(await page.locator('[data-key="state"]').innerText(), /This request has no options now\./)
	}
)

test(
	'a request of a second tester that a rule answers does not wait, and the rule shows in the Testers view',
	browserTest,
	async (t) => {
		const { page, url, workspace, ask } = await prepare(t)
		const write = (who: string, path: string) =>
			ask(who, { tool_name: 'Write', tool_input: { file_path: path, content: 'one\ntwo' }, cwd: '/work/app' })
		const first = write('a1', '/work/app/a.txt')
		await waitOpen(workspace, 1)
		await page.goto(url('/permissions/x-31/P1'))
		await page.waitForFunction(() => document.activeElement?.matches('[data-sub]'))
		assert.equal(await page.locator('.sp-options [data-option]').count(), 4)
		await page.keyboard.press('2')
		assert.equal((await first).body, plainBody(`{"behavior":"allow","updatedPermissions":[${toolRule('Write')}]}`))
		await page.waitForURL(url('/activity'))
		const second = await write('a2', '/work/app/b.txt')
		assert.equal(second.body, plainBody(`{"behavior":"allow","updatedPermissions":[${toolRule('Write')}]}`))
		assert.equal(openOf(workspace).length, 0)
		await page.goto(url('/explorations/x-31'))
		await page.locator('[data-key="rule:P1"]').waitFor()
		assert.match(
			(await page.locator('[data-key="rule:P1"]').textContent())?.replace(/\s+/g, ' ') ?? '',
			/Allowed for this test: every Write call, set by \S+ (just now|\d+ min ago)\./
		)
		const history = page.locator('[data-region="permission-history"] [data-row]')
		assert.deepEqual(await history.evaluateAll((list) => list.map((row) => row.getAttribute('data-label'))), [
			'x-31/P2',
			'x-31/P1',
		])
		assert.match(
			(await history.first().textContent())?.replace(/\s+/g, ' ') ?? '',
			/By rule\s+x-31\/P2\s+Tester a2 asks to write: b\.txt\s+allowed by rule every Write call, set by \S+/
		)
	}
)

test(
	'a selection of requests is allowed once or denied in one step, after one confirm that names the count',
	browserTest,
	async (t) => {
		const { page, url, workspace, ask } = await prepare(t)
		const held = [ask('a1'), ask('a2'), ask('a3')]
		await waitOpen(workspace, 3)
		await page.goto(url('/plans/coupons?view=needs&focus=list'))
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'perm:x-31/P1')
		await page.keyboard.press('Shift+ArrowDown')
		await page.keyboard.press('Shift+ArrowDown')
		await page.locator('[data-bulk]:not([hidden])').waitFor()
		const buttons = await page
			.locator('[data-bulk-action]:not([hidden])')
			.evaluateAll((list) => list.map((button) => button.textContent?.replace(/\s+/g, ' ').trim()))
		assert.deepEqual(buttons, ['1Allow once (3)', '2Deny… (3)', '3Clear the selection'])
		await page.keyboard.press('2')
		await page.locator('dialog[data-confirm][open]').waitFor()
		assert.match((await page.locator('[data-confirm-text]').textContent()) ?? '', /Deny 3 requests\?/)
		await page.keyboard.press('Enter')
		assert.equal(
			await page.locator('dialog[data-confirm]').evaluate((dialog: HTMLDialogElement) => dialog.open),
			true
		)
		await page.keyboard.type('Not now.')
		await page.keyboard.press('Enter')
		for (const reply of await Promise.all(held))
			assert.equal(reply.body, plainBody('{"behavior":"deny","message":"Not now."}'))
		await toast(page).waitFor()
		assert.match((await toast(page).textContent()) ?? '', /Denied: 3 requests\./)

		const more = [ask('a4'), ask('a5')]
		await waitOpen(workspace, 2)
		await page.goto(url('/plans/coupons?view=needs&focus=list&at=perm%3Ax-31%2FP4'))
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'perm:x-31/P4')
		await page.keyboard.press('Space')
		await page.keyboard.press('Shift+ArrowDown')
		await page.locator('[data-bulk]:not([hidden])').waitFor()
		await page.keyboard.press('1')
		await page.locator('dialog[data-confirm][open]').waitFor()
		assert.match((await page.locator('[data-confirm-text]').textContent()) ?? '', /Allow 2 requests once\?/)
		await page.locator('[data-confirm-yes]').click()
		for (const reply of await Promise.all(more)) assert.equal(reply.body, plainBody('{"behavior":"allow"}'))
		assert.deepEqual(
			allOf(workspace, 'x-31').map((item) => item.decision?.kind),
			['deny', 'deny', 'deny', 'allow', 'allow']
		)
		await toast(page).waitFor()
	}
)

test('/permissions opens the first open request, or Activity when none is open', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	await page.goto(url('/permissions'))
	await page.waitForURL(url('/activity'))
	void ask('a1')
	void ask('a2')
	await waitOpen(workspace, 2)
	await page.goto(url('/log'))
	await page.locator('[data-region="permissions-link"]').click()
	await page.waitForURL(url('/permissions/x-31/P1?from=%2Flog'))
	await page.keyboard.press('Escape')
	await page.waitForURL(url('/log'))
})

test('the Activity row of a run says that it waits for permission requests', browserTest, async (t) => {
	const { page, url, workspace, ask } = await prepare(t)
	void ask('a1')
	void ask('a2')
	await waitOpen(workspace, 2)
	await page.goto(url('/activity'))
	const row = page.locator('[data-key="run:x-31"]')
	assert.match((await row.locator('.sp-c-title').textContent()) ?? '', /waits for you: 2 permission requests/)
	assert.match((await page.locator('[data-region="permissions-link"]').textContent()) ?? '', /2 permissions/)
})

test('the history of a run lists its requests, newest first, in pages', browserTest, async (t) => {
	const { page, url, workspace } = await prepare(t)
	seedHistory(
		workspace,
		'x-31',
		'a1',
		Array.from({ length: 21 }, (_, index) => `echo ${index + 1}`)
	)
	await page.goto(url('/explorations/x-31'))
	const fold = page.locator('details[data-open-key="section:permission-history"]')
	assert.equal(await fold.evaluate((details: HTMLDetailsElement) => details.open), false)
	assert.match(
		(await fold.locator('summary').textContent())?.replace(/\s+/g, ' ').trim() ?? '',
		/^Permission requests 21$/
	)
	await fold.locator('summary').click()
	assert.equal(await fold.evaluate((details: HTMLDetailsElement) => details.open), true)
	await page.goto(url('/explorations/x-31?requests=1'))
	const rows = page.locator('details[data-open-key="section:permission-history"] [data-row]')
	assert.equal(await rows.count(), 20)
	assert.equal(await rows.first().getAttribute('data-label'), 'x-31/P21')
	assert.match(
		(await rows.first().textContent())?.replace(/\s+/g, ' ') ?? '',
		/Allowed\s+x-31\/P21\s+Tester a1 asks to run: echo 21\s+allowed once, by dawid/
	)
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	const total = await page.locator('[data-row]').count()
	for (let step = 0; step < total; step++) await page.keyboard.press('ArrowDown')
	await page.waitForURL(/\/explorations\/x-31\?requests=2/)
	assert.equal(await page.locator('details[data-open-key="section:permission-history"] [data-row]').count(), 1)
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key')?.startsWith('request:'))
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/permissions\/x-31\/P1\?from=.*&view=history/)
	assert.equal(await page.locator('[data-moves-on]').count(), 0)
	assert.match((await page.locator('[data-key="state"]').textContent()) ?? '', /Answered .*allowed once, by dawid/)
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/explorations\/x-31\?requests=2/)
})
