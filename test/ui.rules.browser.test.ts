import type { Page } from 'playwright-core'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { planRules } from '../plugin/src/rules.ts'
import { launchWith, open, browserTest, stop } from './browser.ts'
import { check, measure } from './layout.ts'
import { seedNotes } from './notes.ts'

test.before(() => launchWith(seedNotes))
test.after(stop)

function rulesOf(workspace: string) {
	const store = openStore(workspace)
	try {
		return planRules(store, 'notes').rules
	} finally {
		closeStore(store)
	}
}

const rows = (page: Page) => page.locator('[data-panel="rules"] [data-row]')
const focusedKey = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key)
const toast = (page: Page, text: string | RegExp) => page.locator('[data-toast]', { hasText: text }).waitFor()

async function onFirstRule(page: Page, url: (path: string) => string) {
	await page.goto(url('/plans/notes?view=rules&focus=list'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
	assert.equal(await focusedKey(page), 'rule:R1')
}

test('a person edits, refuses, adds, and removes a rule with the keys alone', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await onFirstRule(page, url)
	assert.equal(await rows(page).count(), 3)

	await page.keyboard.press('1')
	const edit = page.locator('dialog[data-act-dialog="rule-edit"]')
	await edit.waitFor()
	assert.equal(await edit.locator('[data-act-title]').textContent(), 'Edit rule R1')
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'text')
	assert.equal(await edit.locator('input[name="text"]').inputValue(), 'A note keeps its title after a save.')
	assert.equal(await edit.locator('input[name="area"]:checked').inputValue(), 'Saving')
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type('   ')
	await page.keyboard.press('Enter')
	await edit.locator('[data-refusal]', { hasText: 'Write the text of the rule.' }).waitFor()
	assert(await edit.evaluate((dialog: HTMLDialogElement) => dialog.open))
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'text')
	assert.equal(rulesOf(workspace)[0].text, 'A note keeps its title after a save.')
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type('A note keeps its title.')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('2')
	assert.equal(await edit.locator('input[name="area"]:checked').inputValue(), 'Deleting')
	await page.keyboard.press('Enter')
	await toast(page, 'Changed rule R1')
	assert.deepEqual(rulesOf(workspace)[0], {
		id: 'R1',
		text: 'A note keeps its title.',
		source: 'notes.md#save',
		area: 'Deleting',
	})
	assert.match((await rows(page).first().textContent()) ?? '', /A note keeps its title\./)
	assert.equal(await page.locator('[data-nav][data-target="rule:R1"]').getAttribute('data-in-area'), 'Deleting')

	await onFirstRule(page, url)
	await page.keyboard.press('ArrowUp')
	assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Add a rule…')
	await page.keyboard.press('Enter')
	const add = page.locator('dialog[data-act-dialog="rule-add"]')
	await add.waitFor()
	assert.equal(await add.locator('[data-act-title]').textContent(), 'Add a rule to notes')
	await page.keyboard.type('A note can be pinned.')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('2')
	assert.equal(await add.locator('input[name="area"]:checked').inputValue(), 'Saving')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowDown')
	await page.keyboard.type('ticket 9')
	await page.keyboard.press('Enter')
	await toast(page, 'Added rule R4')
	assert.deepEqual(rulesOf(workspace)[3], {
		id: 'R4',
		text: 'A note can be pinned.',
		source: 'ticket 9',
		area: 'Saving',
	})
	assert.equal(await page.locator('[data-nav][data-target="rules"] .sp-ncount').textContent(), '4')

	await onFirstRule(page, url)
	await page.keyboard.press('ArrowDown')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focusedKey(page), 'rule:R3')
	await page.keyboard.press('2')
	const confirm = page.locator('dialog[data-confirm][open]')
	await confirm.waitFor()
	assert.equal(await confirm.locator('[data-confirm-title]').textContent(), 'Remove rule R3?')
	assert.match(
		(await confirm.locator('[data-confirm-text]').textContent()) ?? '',
		/1 item cites it\. It moves to Outside the rules/
	)
	await page.keyboard.press('Escape')
	await confirm.waitFor({ state: 'hidden' })
	assert.equal(await focusedKey(page), 'rule:R3')
	await page.waitForFunction(() => !window.history.state?.layer)
	assert.equal(rulesOf(workspace).length, 4)
	await page.keyboard.press('2')
	await confirm.waitFor()
	await page.keyboard.press('Enter')
	await toast(page, 'Removed rule R3. 1 item that cited it shows under Outside the rules.')
	assert.deepEqual(
		rulesOf(workspace).map((rule) => rule.id),
		['R1', 'R2', 'R4']
	)
	assert.equal(await page.locator('[data-nav][data-target="rules"] .sp-ncount').textContent(), '3')
	await page.goto(url('/plans/notes?view=rule%3Aoutside'))
	await page.locator('[data-panel="rule:outside"] [data-key="c:k1/D3"]').waitFor()
})

test('a person edits, adds, and removes a rule with the pointer', browserTest, async (t) => {
	const { page, url, workspace } = await open(t)
	await page.goto(url('/plans/notes?view=rules'))
	await page.locator('[data-panel="rules"] [data-key="rule:R2"] .sp-c-title').click()
	await page.locator('h1[data-view-title]', { hasText: 'R2' }).waitFor()
	await page.getByRole('button', { name: 'Edit rule R2' }).click()
	const edit = page.locator('dialog[data-act-dialog="rule-edit"]')
	await edit.waitFor()
	await edit.locator('input[name="text"]').fill('A deleted note leaves the list at once.')
	await edit.locator('input[name="newArea"]').fill('Lists')
	await edit.getByRole('button', { name: 'Save the rule' }).click()
	await toast(page, 'Changed rule R2')
	assert.deepEqual(rulesOf(workspace)[1], {
		id: 'R2',
		text: 'A deleted note leaves the list at once.',
		source: 'notes.md#delete',
		area: 'Lists',
	})
	await page.goto(url('/plans/notes?view=rules'))
	await page.getByRole('button', { name: 'Add a rule…' }).click()
	const add = page.locator('dialog[data-act-dialog="rule-add"]')
	await add.locator('input[name="text"]').fill('A note can be pinned.')
	await add.locator('label', { hasText: 'Lists' }).click()
	await add.getByRole('button', { name: 'Save the rule' }).click()
	await toast(page, 'Added rule R4')
	assert.equal(rulesOf(workspace)[3].source, 'Added in the review UI.')
	await page.goto(url('/plans/notes?view=rule%3AR3'))
	await page.getByRole('button', { name: 'Remove rule R3' }).click()
	await page.locator('dialog[data-confirm][open]').getByRole('button', { name: 'Remove R3' }).click()
	await toast(page, 'Removed rule R3.')
	assert.deepEqual(
		rulesOf(workspace).map((rule) => rule.id),
		['R1', 'R2', 'R4']
	)
	await page.goto(url('/plans/notes?view=rule%3AR1'))
	await page.getByRole('button', { name: 'Remove rule R1' }).click()
	await page.locator('dialog[data-confirm][open]').getByRole('button', { name: 'Cancel' }).click()
	assert.equal(rulesOf(workspace).length, 3)

	await page.getByRole('button', { name: 'Remove rule R1' }).click()
	const confirm = page.locator('dialog[data-confirm][open]')
	await page.keyboard.press('Tab')
	assert(await confirm.locator('[data-confirm-no]').evaluate((button) => button === document.activeElement))
	await page.keyboard.press('Enter')
	await confirm.waitFor({ state: 'hidden' })
	assert.equal(
		await page.locator('dialog[data-confirm]').evaluate((dialog: HTMLDialogElement) => dialog.returnValue),
		'no'
	)
	assert.equal(rulesOf(workspace).length, 3)
})

async function defectRows(page: Page, url: (path: string) => string) {
	await page.goto(url('/plans/notes?view=all&focus=list&at=c%3Ak1%2FD2'))
	await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
}

const writes = (workspace: string) => {
	const store = openStore(workspace)
	try {
		return store.db.prepare('SELECT count(*) AS n FROM operations').get()!.n
	} finally {
		closeStore(store)
	}
}

test('a person copies one defect and a selection for the developer with the keys alone', browserTest, async (t) => {
	const { page, url, workspace } = await open(t, { permissions: ['clipboard-read', 'clipboard-write'] })
	const before = writes(workspace)
	await defectRows(page, url)
	assert.equal(await focusedKey(page), 'c:k1/D2')
	await page.keyboard.press('2')
	await toast(page, 'Copied 1 defect')
	const one = await page.evaluate(() => navigator.clipboard.readText())
	assert.match(
		one,
		/^A deleted note stays in the list\nSeverity: critical\nRule: R2 A deleted note leaves the list\.\n/
	)
	assert.match(one, /\nState: b1 new; b2 fixed\nEvidence: k1-D2\.txt$/)
	assert.equal(await page.locator('dialog[open]').count(), 0)
	await page.keyboard.press('Shift+ArrowDown')
	await page.keyboard.press('Shift+ArrowDown')
	await page.locator('[data-bulk]:not([hidden])').waitFor()
	assert.equal(await page.locator('[data-bulk-action="copy"]').textContent(), '2Copy 3 defects for the developer')
	await page.keyboard.press('2')
	await toast(page, 'Copied 3 defects')
	const three = await page.evaluate(() => navigator.clipboard.readText())
	assert.equal(three.split('\n\n----------------------------------------\n\n').length, 3)
	assert.equal(await page.locator('dialog[open]').count(), 0)
	assert.equal(await page.locator('[data-panel="all"] [data-row].sel').count(), 3)
	assert.equal(await page.locator('[data-bulk]:not([hidden])').count(), 1)
	assert.equal(writes(workspace), before)
})

test('a person copies a defect from its record with the pointer', browserTest, async (t) => {
	const { page, url } = await open(t, { permissions: ['clipboard-read', 'clipboard-write'] })
	await page.goto(url('/plans/notes?view=all&item=c%3Ak1%2FD1'))
	await page.locator('[data-drawer] .sp-dhead').getByRole('button', { name: 'Copy for the developer' }).click()
	await toast(page, 'Copied 1 defect')
	assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^The title is lost after a save\n/)
})

for (const [name, script] of [
	[
		'refuses the write',
		() =>
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: () => Promise.reject(new Error('no')) },
			}),
	],
	['is missing', () => Object.defineProperty(navigator, 'clipboard', { value: undefined })],
] as const)
	test(`when the clipboard ${name}, a panel shows the selected text`, browserTest, async (t) => {
		const { page, url } = await open(t)
		await page.addInitScript(script)
		await defectRows(page, url)
		await page.keyboard.press('2')
		const panel = page.locator('dialog[data-act-dialog="copy"][open]')
		await panel.waitFor()
		assert.equal(await page.evaluate(() => window.history.state?.layer), 'act')
		assert.equal(await panel.locator('[data-copy-title]').textContent(), 'Copy 1 defect')
		assert.match(
			(await panel.locator('.sp-sub').textContent()) ?? '',
			/^Checkmate cannot use the clipboard here: copy the selected text with Ctrl\+C or Cmd\+C\.$/
		)
		const selected = await panel.locator('textarea').evaluate((area: HTMLTextAreaElement) => ({
			text: area.value,
			all: area.selectionStart === 0 && area.selectionEnd === area.value.length,
			focus: document.activeElement === area,
			readonly: area.readOnly,
		}))
		assert.match(selected.text, /^A deleted note stays in the list\nSeverity: critical\n/)
		assert(selected.all && selected.focus && selected.readonly)
		await page.keyboard.press('Escape')
		await page.keyboard.press('Escape')
		await panel.waitFor({ state: 'hidden' })
		assert.equal(await focusedKey(page), 'c:k1/D2')
		await page.waitForFunction(() => !window.history.state?.layer)
		await page.keyboard.press('2')
		await panel.waitFor()
		await panel.getByRole('button', { name: 'Close' }).click()
		await panel.waitFor({ state: 'hidden' })
	})

test(
	'the rule dialogs, the remove question, and the copy panel open and close 20 times in a row',
	{ ...browserTest, timeout: 180_000 },
	async (t) => {
		const { page, url } = await open(t)
		await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }))
		const cdp = await page.context().newCDPSession(page)
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
		const cycle = async (name: string, start: string, key: string, shown: string, steps: number) => {
			await page.goto(url(start))
			await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
			const address = page.url()
			for (let round = 0; round < 20; round++) {
				await page.keyboard.press(key)
				await page
					.locator(shown)
					.waitFor({ timeout: 3000 })
					.catch(() => assert.fail(`${name} did not open in round ${round}`))
				await page.waitForFunction(() => Boolean(window.history.state?.layer), null, { timeout: 3000 })
				for (let step = 0; step < steps && (await page.locator(shown).isVisible()); step++)
					await page.keyboard.press('Escape')
				await page.locator(shown).waitFor({ state: 'hidden', timeout: 3000 })
				await page.waitForFunction(() => !window.history.state?.layer, null, { timeout: 3000 })
				assert.equal(page.url(), address, `${name} round ${round}`)
			}
		}
		await cycle(
			'rule edit',
			'/plans/notes?view=rules&focus=list',
			'1',
			'dialog[data-act-dialog="rule-edit"][open]',
			3
		)
		await cycle('rule remove', '/plans/notes?view=rules&focus=list', '2', 'dialog[data-confirm][open]', 1)
		await cycle(
			'copy panel',
			'/plans/notes?view=all&focus=list&at=c%3Ak1%2FD2',
			'2',
			'dialog[data-act-dialog="copy"][open]',
			3
		)
	}
)

test(
	'the rules, the defects, and their dialogs fit at narrow and wide sizes',
	{ ...browserTest, timeout: 120_000 },
	async (t) => {
		const { page, url } = await open(t)
		await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }))
		const paths = [
			'/plans/notes?view=rules',
			'/plans/notes?view=rules&focus=list',
			'/plans/notes?view=rule%3AR1',
			'/plans/notes?view=rule%3Aoutside',
			'/plans/notes?view=all&focus=list',
			'/plans/notes?view=all&item=c%3Ak1%2FD1',
		]
		for (const [width, colorScheme] of [[400, 'light'], [1440, 'dark']] as const) {
			for (const path of paths) await check(page, url(path), width, colorScheme)
			const opened = [
				['/plans/notes?view=rules&focus=list', '1', 'dialog[data-act-dialog="rule-edit"][open]'],
				['/plans/notes?view=rules&focus=list', '2', 'dialog[data-confirm][open]'],
				['/plans/notes?view=all&focus=list&at=c%3Ak1%2FD2', '2', 'dialog[data-act-dialog="copy"][open]'],
			]
			for (const [path, key, dialog] of opened) {
				await check(page, url(path), width, colorScheme)
				await page.waitForFunction(() => document.activeElement?.matches('[data-row]'))
				await page.keyboard.press(key)
				await page.locator(dialog).waitFor()
				assert.deepEqual(
					await page.evaluate(measure, width <= 760),
					[],
					`${dialog} at ${width} in ${colorScheme}`
				)
			}
		}
	}
)

test(
	'an empty rule text shows a sentence of Checkmate at the field, not the bubble of the browser',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		await page.goto(url('/plans/notes?view=rules'))
		await page.getByRole('button', { name: 'Add a rule…' }).click()
		const add = page.locator('dialog[data-act-dialog="rule-add"]')
		await add.getByRole('button', { name: 'Save the rule' }).click()
		const message = add.locator('[data-field-error]')
		await message.waitFor()
		assert.equal(await message.textContent(), 'Write the text of the rule.')
		assert.equal(rulesOf(workspace).length, 3)
	}
)

test(
	'an area name that is too long is refused at the field with the limit, and nothing is stored',
	browserTest,
	async (t) => {
		const { page, url, workspace } = await open(t)
		await page.goto(url('/plans/notes?view=rules'))
		await page.getByRole('button', { name: 'Add a rule…' }).click()
		const add = page.locator('dialog[data-act-dialog="rule-add"]')
		await add.locator('input[name="text"]').fill('A note can be pinned.')
		const name = 'A'.repeat(54)
		await add.locator('input[name="newArea"]').fill(name)
		assert.equal(await add.locator('input[name="newArea"]').inputValue(), name)
		await add.getByRole('button', { name: 'Save the rule' }).click()
		const message = add.locator('[data-refusal][data-field="newArea"]')
		await message.waitFor()
		assert.match((await message.textContent()) ?? '', /more than 40 characters/)
		assert.equal(rulesOf(workspace).length, 3)
	}
)

const arrowDownKey = async (page: Page) => {
	await page.keyboard.press('ArrowDown')
	return focusedKey(page)
}

test('after a save the highlight and the keys are on the rule that was edited', browserTest, async (t) => {
	const { page, url } = await open(t)
	await onFirstRule(page, url)
	await page.keyboard.press('ArrowDown')
	assert.equal(await focusedKey(page), 'rule:R2')
	await page.keyboard.press('1')
	const edit = page.locator('dialog[data-act-dialog="rule-edit"]')
	await edit.waitFor()
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type('A deleted note leaves the list.')
	await page.keyboard.press('Enter')
	await toast(page, 'Changed rule R2')
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'rule:R2')
	assert.equal(await arrowDownKey(page), 'rule:R3')
})

test(
	'after Add a rule the new rule has the highlight, and after Remove the row that takes its place',
	browserTest,
	async (t) => {
		const { page, url } = await open(t)
		await onFirstRule(page, url)
		await page.keyboard.press('ArrowUp')
		await page.keyboard.press('Enter')
		const add = page.locator('dialog[data-act-dialog="rule-add"]')
		await add.waitFor()
		await page.keyboard.type('A note can be pinned.')
		await page.keyboard.press('Enter')
		await toast(page, 'Added rule R4')
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'rule:R4')
		await page.keyboard.press('ArrowUp')
		assert.equal(await focusedKey(page), 'rule:R3')
		await page.keyboard.press('ArrowUp')
		assert.equal(await focusedKey(page), 'rule:R2')
		await page.keyboard.press('2')
		await page.locator('dialog[data-confirm][open]').waitFor()
		await page.keyboard.press('Enter')
		await toast(page, 'Removed rule R2')
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'rule:R3')
		await page.keyboard.press('ArrowDown')
		assert.equal(await focusedKey(page), 'rule:R4')
		await page.keyboard.press('2')
		await page.locator('dialog[data-confirm][open]').waitFor()
		await page.keyboard.press('Enter')
		await toast(page, 'Removed rule R4')
		await page.waitForFunction(() => document.activeElement?.getAttribute('data-key') === 'rule:R3')
	}
)
