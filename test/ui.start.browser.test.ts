import type { TestContext } from 'node:test'
import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { explorationEvents } from '../plugin/src/explorations.ts'
import { running } from '../plugin/src/explorers.ts'
import { targetList, targetRevision } from '../plugin/src/targets.ts'
import { launchWith, openIn, browserTest, stop } from './browser.ts'
import { directory, plan, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'

test.before(() => launchWith(() => {}))
test.after(stop)

async function application(t: TestContext) {
	const server = createServer((_, res) => res.end('ok'))
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

async function setup(t: TestContext, seed: 'nothing' | 'target' | 'targets' | 'plan', options = {}) {
	const workspace = realpathSync(directory(t))
	const opened = store(t, workspace)
	if (seed !== 'nothing') target(opened)
	if (seed === 'targets') target(opened, { targetId: 'other-local' } as never)
	if (seed === 'plan') plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, { rules: '!sleep', explorer: '!sleep' })
	const env = { ...process.env, ...fake.env, CHECKMATE_ACTOR: undefined }
	const opening = await openIn(t, workspace, options, env)
	const read = <T>(view: (reading: ReturnType<typeof openStore>) => T) => {
		const reading = openStore(workspace)
		try {
			return view(reading)
		} finally {
			closeStore(reading)
		}
	}
	t.after(() => {
		const pids = read((reading) =>
			reading.db
				.prepare("SELECT detail FROM exploration_events WHERE step IN ('supervisor', 'child')")
				.all()
				.map((row) => JSON.parse(String(row.detail)).pid as number)
		)
		for (const pid of pids) if (running(pid)) process.kill(-pid, 'SIGKILL')
	})
	return { ...opening, read }
}

const focused = (page: Page) =>
	page.evaluate(() => {
		const element = document.activeElement as HTMLElement
		return element.id || (element as HTMLInputElement).name || element.textContent?.trim() || element.tagName
	})

const field = (page: Page, name: string) => page.locator(`form[data-page-form] [name="${name}"]`)
const alert = (page: Page, name: string) => page.locator(`form[data-page-form] [role="alert"][data-field="${name}"]`)

test('a person sets up the first target with the keys alone', browserTest, async (t) => {
	const app = await application(t)
	const { page, url, read } = await setup(t, 'nothing')
	await page.goto(url('/'))
	assert.equal(await focused(page), 'setup-url')
	assert(await page.locator('[data-assumed]').isHidden())
	await page.keyboard.type(app)
	await page.locator('[data-assumed]:not([hidden]) [data-assumed-list] dt').first().waitFor()
	const lines = await page.locator('[data-assumed-list] dt').allTextContents()
	assert.deepEqual(lines, ['Instance', 'Entry point', 'Capabilities', 'Operations', 'Reset', 'Authentication'])
	const values = await page.locator('[data-assumed-list] dd').allTextContents()
	assert.equal(values[0], 'local')
	assert.match(values[2], /^(browser,)?http \((playwright-cli is on PATH|no browser tool on PATH)\)$/)
	assert.equal(values[4], 'none')
	assert.equal(await field(page, 'target').inputValue(), app.replace('http://', '').replace(/[.:]/g, '-'))
	assert.equal(await field(page, 'operations').first().isChecked(), true)
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'setup-target')
	await page.keyboard.press('Control+A')
	await page.keyboard.type('shop')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'setup-environment')
	await page.keyboard.type('staging')
	await page.keyboard.press('ArrowDown')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).name), 'operations')
	await page.keyboard.press('2')
	assert.equal(await field(page, 'operations').nth(1).isChecked(), true)
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'EnterSet up the target')
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/new\?target=shop$/)
	read((reading) => {
		assert.deepEqual(
			targetList(reading).map((item) => item.targetId),
			['shop']
		)
		assert.deepEqual(targetRevision(reading, 'shop').profile.allowedOperations, ['read_only'])
		assert.match(String(reading.db.prepare('SELECT body FROM instances').get()!.body), /"environment":"staging"/)
	})
	assert.equal(await page.locator('main h1').textContent(), 'New change')
})

test('a person sets up the first target with the pointer', browserTest, async (t) => {
	const app = await application(t)
	const { page, url, read } = await setup(t, 'nothing')
	await page.goto(url('/'))
	await page.locator('#setup-url').fill(app)
	await page.locator('[data-assumed]:not([hidden])').waitFor()
	await page.getByRole('button', { name: /Set up the target/ }).click()
	await page.waitForURL(/\/new\?target=/)
	read((reading) =>
		assert.deepEqual(targetRevision(reading, targetList(reading)[0].targetId).profile.allowedOperations, [
			'any_test_operation',
		])
	)
})

test(
	'an address that does not answer is refused in the form with the sentence of the engine',
	browserTest,
	async (t) => {
		const { page, url, read } = await setup(t, 'nothing')
		await page.goto(url('/'))
		await page.waitForFunction(() =>
			document.activeElement?.matches('input[type="url"], input[type="text"], input:not([type])')
		)
		await page.keyboard.type('http://127.0.0.1:1')
		await page.locator('[data-assumed]:not([hidden])').waitFor()
		await page.keyboard.press('Enter')
		await alert(page, 'url').waitFor()
		assert.match(
			(await alert(page, 'url').textContent()) ?? '',
			/The application did not answer at http:\/\/127\.0\.0\.1:1\./
		)
		assert.equal(await focused(page), 'setup-url')
		assert.equal(page.url(), url('/'))
		assert.equal(await field(page, 'url').inputValue(), 'http://127.0.0.1:1')
		read((reading) => assert.equal(targetList(reading).length, 0))
	}
)

test(
	'an address that is not local has no default, and asks once more in a dialog that names it',
	browserTest,
	async (t) => {
		const { page, url, read } = await setup(t, 'nothing')
		await page.goto(url('/'))
		await page.waitForFunction(() =>
			document.activeElement?.matches('input[type="url"], input[type="text"], input:not([type])')
		)
		await page.keyboard.type('http://shop.example.invalid')
		await page.locator('[data-assumed]:not([hidden])').waitFor()
		assert.equal(await page.locator('input[name="operations"]:checked').count(), 0)
		assert.match(
			(await page.locator('[data-operations-help]').textContent()) ?? '',
			/shop\.example\.invalid is not a local address\. Choose Yes or No\./
		)
		await page.keyboard.press('Enter')
		await page.locator('dialog[data-confirm][open]').waitFor()
		assert.match(
			(await page.locator('[data-confirm-text]').textContent()) ?? '',
			/shop\.example\.invalid is not a local address/
		)
		await page.keyboard.press('Escape')
		await page.locator('dialog[data-confirm]').waitFor({ state: 'hidden' })
		await page.waitForFunction(() => !window.history.state?.layer)
		assert.equal(await focused(page), 'setup-url')
		assert.equal(await alert(page, 'operations').count(), 0)
		read((reading) =>
			assert.equal(reading.db.prepare("SELECT count(*) AS n FROM operations WHERE command = 'setup'").get()!.n, 0)
		)
		await page.keyboard.press('Enter')
		await page.locator('dialog[data-confirm][open]').waitFor()
		await page.keyboard.press('Enter')
		await alert(page, 'operations').waitFor()
		assert.match(
			(await alert(page, 'operations').textContent()) ?? '',
			/Choose whether testers may change data there\./
		)
		assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).name), 'operations')
		await page.keyboard.press('1')
		await page.keyboard.press('ArrowUp')
		await page.keyboard.press('ArrowUp')
		await page.keyboard.press('ArrowUp')
		await page.keyboard.press('ArrowUp')
		assert.equal(await focused(page), 'setup-url')
		await page.keyboard.press('Enter')
		await page.locator('dialog[data-confirm][open]').waitFor()
		await page.keyboard.press('1')
		await alert(page, 'url').waitFor()
		assert.match(
			(await alert(page, 'url').textContent()) ?? '',
			/did not answer at http:\/\/shop\.example\.invalid\./
		)
		assert.equal(await focused(page), 'setup-url')
	}
)

const ticket = (workspace: string, name = 'docs/Checkout Ticket.md') => {
	mkdirSync(join(workspace, 'docs'), { recursive: true })
	writeFileSync(join(workspace, name), '# Checkout\nAC1 A coupon gives 10 percent.\n')
}

test('a person starts the first test from a ticket file with the keys alone', browserTest, async (t) => {
	const { page, url, read, workspace } = await setup(t, 'target')
	ticket(workspace)
	await page.goto(url('/'))
	assert.equal(await page.locator('main h1').textContent(), 'New change')
	assert.equal(await focused(page), 'change-file')
	await page.keyboard.type('docs/Checkout Ticket.md')
	assert.equal(await field(page, 'plan').inputValue(), 'checkout-ticket')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-text')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-plan')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-build')
	await page.keyboard.press('ArrowDown')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), 'normal')
	await page.keyboard.press('1')
	assert.equal(await field(page, 'level').first().isChecked(), true)
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-rules')
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/explorations\/x-1$/)
	read((reading) => {
		assert.deepEqual(
			JSON.parse(String(reading.db.prepare('SELECT body FROM plan_requests').get()!.body)).context.sources,
			['docs/Checkout Ticket.md']
		)
		const start = explorationEvents(reading, 'x-1').find((item) => item.step === 'start')!
		assert.deepEqual([start.detail.level, start.detail.allow], ['smoke', ['Read', 'Bash']])
	})
	await page.locator('.sp-strip').waitFor()
})

test(
	'a pasted ticket gives its first line as the name of the plan and is kept in .checkmate/sources',
	browserTest,
	async (t) => {
		const { page, url, workspace, read } = await setup(t, 'target')
		await page.goto(url('/new'))
		await page.locator('#change-text').fill('Fix the cart total!\nAC1 Totals include shipping.')
		assert.equal(await field(page, 'plan').inputValue(), 'fix-the-cart-total')
		await field(page, 'plan').fill('cart')
		await page.locator('#change-text').fill('Fix the cart total!\nAC1 Totals include shipping.\nMore.')
		assert.equal(await field(page, 'plan').inputValue(), 'cart')
		await page.getByRole('button', { name: /Start the test/ }).click()
		await page.waitForURL(/\/explorations\/x-1$/)
		assert.equal(
			readFileSync(join(workspace, '.checkmate', 'sources', 'cart.md'), 'utf8'),
			'Fix the cart total!\nAC1 Totals include shipping.\nMore.\n'
		)
		read((reading) =>
			assert.match(
				String(reading.db.prepare('SELECT body FROM plan_requests').get()!.body),
				/\.checkmate\/sources\/cart\.md/
			)
		)
	}
)

test('the refusals of the new change show at their field and keep the draft', browserTest, async (t) => {
	const { page, url, read } = await setup(t, 'target')
	await page.goto(url('/new'))
	await page.keyboard.press('Enter')
	await alert(page, 'file').waitFor()
	assert.match(
		(await alert(page, 'file').textContent()) ?? '',
		/Give the ticket: the path of a file in the workspace, or the pasted text\./
	)
	assert.equal(await focused(page), 'change-file')
	await page.keyboard.type('../elsewhere.md')
	await page.keyboard.press('Enter')
	await page.waitForFunction(() =>
		/outside the workspace/.test(document.querySelector('[data-field="file"]')?.textContent ?? '')
	)
	assert.equal(await alert(page, 'file').count(), 1)
	assert.equal(await focused(page), 'change-file')
	await page.locator('#change-file').fill('docs/missing.md')
	await page.keyboard.press('Enter')
	await page.waitForFunction(() =>
		/does not exist/.test(document.querySelector('[data-field="file"]')?.textContent ?? '')
	)
	assert.equal(await field(page, 'plan').inputValue(), 'missing')
	assert.equal(page.url(), url('/new'))
	read((reading) => assert.equal(reading.db.prepare('SELECT count(*) AS n FROM plan_requests').get()!.n, 0))
	await field(page, 'rules').fill('')
	await page.locator('#change-file').fill('')
	await page.locator('#change-text').fill('A ticket')
	await page.locator('#change-plan').fill('a-ticket')
	await page.keyboard.press('Control+Enter')
	await alert(page, 'rules').waitFor()
	assert.match(
		(await alert(page, 'rules').textContent()) ?? '',
		/Give the tool rules of the explorers and the verifier/
	)
	assert.equal(await focused(page), 'change-rules')
})

test('the draft of the new change survives Esc, a reload, and a visit to New target', browserTest, async (t) => {
	const { page, url } = await setup(t, 'targets')
	await page.goto(url('/new'))
	assert.equal(await page.locator('select[name="target"]').count(), 1)
	await page.locator('#change-file').fill('docs/draft.md')
	await page.locator('#change-text').fill('Line one\nLine two')
	await field(page, 'build').fill('my-build')
	await page.locator('#change-file').focus()
	await page.keyboard.press('Escape')
	assert.equal(await page.evaluate(() => document.activeElement === document.body), true)
	await page.reload()
	assert.equal(await page.locator('#change-file').inputValue(), 'docs/draft.md')
	assert.equal(await page.locator('#change-text').inputValue(), 'Line one\nLine two')
	assert.equal(await field(page, 'build').inputValue(), 'my-build')
	await page.getByRole('link', { name: 'New target' }).click()
	await page.waitForURL(/\/setup$/)
	await page.keyboard.press('Escape')
	await page.keyboard.press('Escape')
	await page.waitForURL(/\/new$/)
	assert.equal(await page.locator('#change-file').inputValue(), 'docs/draft.md')
	assert.equal(await field(page, 'build').inputValue(), 'my-build')
})

test('Up and Down move the caret to the first or last line of a text before they leave it', browserTest, async (t) => {
	const { page, url } = await setup(t, 'target')
	await page.goto(url('/new'))
	await page.locator('#change-text').fill('one\ntwo\nthree')
	await page.locator('#change-text').focus()
	await page.keyboard.press('Control+Home')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-text')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-text')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focused(page), 'change-plan')
	await page.keyboard.press('ArrowUp')
	assert.equal(await focused(page), 'change-text')
	await page.keyboard.press('Control+End')
	await page.keyboard.press('ArrowUp')
	await page.keyboard.press('ArrowUp')
	assert.equal(await focused(page), 'change-text')
	await page.keyboard.press('ArrowUp')
	assert.equal(await focused(page), 'change-file')
})

test('home shows a row for a new change after the plans, and the keys open it', browserTest, async (t) => {
	const { page, url } = await setup(t, 'plan')
	await page.goto(url('/'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	await page.keyboard.press('ArrowDown')
	assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.key), 'new:change')
	await page.keyboard.press('1')
	await page.waitForURL(/\/new$/)
	await page.keyboard.press('Escape')
	await page.keyboard.press('Escape')
	await page.waitForURL(url('/'))
})

test('the find bar lists New change and New target', browserTest, async (t) => {
	const { page, url } = await setup(t, 'plan')
	await page.goto(url('/'))
	await page.locator('[data-live]', { hasText: 'Live' }).waitFor()
	await page.keyboard.press('/')
	await page.keyboard.type('new')
	await page.locator('[data-find-results] li').first().waitFor()
	const found = await page.locator('[data-find-results] li').allTextContents()
	assert(found.some((text) => /New change/.test(text)) && found.some((text) => /New target/.test(text)))
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('Enter')
	await page.waitForURL(/\/new$/)
})
