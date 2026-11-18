import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { startUi } from '../plugin/src/ui/server.ts'
import { patchPlan } from '../plugin/src/plans.ts'
import { planRules } from '../plugin/src/rules.ts'
import { ruleMap } from '../plugin/src/rulemap.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { actor, directory, plan, store, target } from './support.ts'
import { call, token } from './actions.ts'
import { seedNotes } from './notes.ts'

async function fixture(t: TestContext) {
	const workspace = directory(t)
	seedNotes(workspace)
	const ui = await startUi({ workspace })
	t.after(() => ui.close())
	const as = { Cookie: `checkmate_actor=${actor}` }
	const post = async (path: string, form: Record<string, string> = {}) =>
		call(ui, path, { csrf: token((await call(ui, '/plans/notes')).body), ...form }, as)
	const rules = () => {
		const reading = openStore(workspace)
		try {
			return planRules(reading, 'notes')
		} finally {
			closeStore(reading)
		}
	}
	return { ui, post, rules, workspace, as }
}

const panelOf = (page: string) => {
	const start = page.indexOf('data-panel="rule:outside"')
	const rest = page.slice(start)
	return rest.slice(0, rest.search(/<section\s+class="sp-panel"/))
}

const toast = (reply: { headers: Record<string, unknown> }) =>
	decodeURIComponent(
		String([reply.headers['set-cookie']].flat().find((line) => String(line).startsWith('checkmate_toast')))
	)

test('a derived rule changes its text and its area through the same patch as the command line', async (t) => {
	const { post, rules } = await fixture(t)
	const changed = await post('/plans/notes/rules/R1', { text: 'A note keeps its title.', area: 'Saving' })
	assert.equal(changed.status, 303)
	assert.equal(changed.headers.location, '/plans/notes?view=rules')
	assert.match(toast(changed), /Changed rule R1/)
	assert.deepEqual(rules().rules[0], {
		id: 'R1',
		text: 'A note keeps its title.',
		source: 'notes.md#save',
		area: 'Saving',
	})
	assert.equal(rules().origin, 'corrected')
	await post('/plans/notes/rules/R3', {
		text: 'A title has at most 200 characters.',
		area: 'Saving',
		newArea: 'Limits',
	})
	assert.equal(rules().rules[2].area, 'Limits')
})

test('a new rule gets the next free ID, the given area, and a source that says where it came from', async (t) => {
	const { post, rules } = await fixture(t)
	const added = await post('/plans/notes/rules', {
		text: 'A note can be pinned.',
		area: 'Saving',
		newArea: 'Pinning',
	})
	assert.equal(added.status, 303)
	assert.match(toast(added), /Added rule R4/)
	assert.deepEqual(rules().rules[3], {
		id: 'R4',
		text: 'A note can be pinned.',
		source: 'Added in the review UI.',
		area: 'Pinning',
	})
	await post('/plans/notes/rules', { text: 'A note can be shared.', area: 'Saving', source: 'ticket SHOP-9' })
	assert.equal(rules().rules[4].source, 'ticket SHOP-9')
	const page = await call((await fixture(t)).ui, '/plans/notes?view=rules')
	assert.equal(page.status, 200)
})

test('a removed rule leaves the list, and the items that cited it show under Outside the rules', async (t) => {
	const { ui, post, rules, workspace } = await fixture(t)
	const before = await call(ui, '/plans/notes?view=rule%3Aoutside')
	assert(!panelOf(before.body).includes('data-key="c:k1/D3"'))
	const removed = await post('/plans/notes/rules/R3/remove')
	assert.equal(removed.status, 303)
	assert.match(toast(removed), /Removed rule R3\. 1 item that cited it shows under Outside the rules\./)
	assert.deepEqual(
		rules().rules.map((rule) => rule.id),
		['R1', 'R2']
	)
	const page = await call(ui, '/plans/notes?view=rule%3Aoutside')
	assert(panelOf(page.body).includes('data-key="c:k1/D3"'))
	const reading = openStore(workspace)
	try {
		const row = ruleMap(reading, 'notes').rows.find((each) => each.rule.id === 'outside')!
		assert.equal(row.cells[0].status, 'failed')
		assert.equal(row.cells[0].claims.length, 1)
	} finally {
		closeStore(reading)
	}
})

test('a refusal comes back at the field and records nothing', async (t) => {
	const { post, rules, workspace } = await fixture(t)
	const operations = () => {
		const reading = openStore(workspace)
		try {
			return reading.db
				.prepare("SELECT count(*) AS n FROM operations WHERE command = 'plan edit' AND status = 'completed'")
				.get()!.n
		} finally {
			closeStore(reading)
		}
	}
	const refusals: Array<[string, Record<string, string>, string, RegExp]> = [
		['/plans/notes/rules/R1', { text: ' ', area: 'Saving' }, 'text', /Write the text/],
		['/plans/notes/rules/R1', { text: 'x', area: ' ' }, 'area', /Name the area/],
		[
			'/plans/notes/rules/R1',
			{ text: 'x', area: 'a', newArea: 'a'.repeat(41) },
			'newArea',
			/more than 40 characters/,
		],
		['/plans/notes/rules/R9', { text: 'x', area: 'Saving' }, '', /no rule R9/],
		['/plans/notes/rules/R9/remove', {}, '', /Cannot remove unknown rule R9/],
	]
	for (const [path, form, field, message] of refusals) {
		const refused = await post(path, form)
		assert.equal(refused.status, 422, path)
		assert.match(refused.body, message)
		assert.equal(refused.body.includes(`data-field="${field}"`), field !== '', path)
	}
	for (let n = 1; n <= 7; n++)
		await post('/plans/notes/rules', { text: `Rule ${n}.`, area: 'Saving', newArea: `Area ${n}` })
	const tenth = await post('/plans/notes/rules', { text: 'One more.', area: 'Saving', newArea: 'Area 8' })
	assert.equal(tenth.status, 422)
	assert.match(tenth.body, /The rules have 10 areas\. Use at most 9 areas/)
	assert.equal(rules().rules.length, 10)
	assert.equal(operations(), 7)
})

test('the last rule cannot be removed', async (t) => {
	const { post, rules, ui } = await fixture(t)
	await post('/plans/notes/rules/R2/remove')
	await post('/plans/notes/rules/R3/remove')
	const last = await post('/plans/notes/rules/R1/remove')
	assert.equal(last.status, 422)
	assert.match(last.body, /Keep at least one rule of plan notes\./)
	assert.equal(rules().rules.length, 1)
	const page = await call(ui, '/plans/notes?view=rules')
	assert.match(page.body, /data-ask-yes="Remove R1"[^>]*disabled/)
})

test('the rules of a plan with a revision, or from a request, keep their editor and show no rule options', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const ui = await startUi({ workspace })
	t.after(() => ui.close())
	const page = await call(ui, '/plans/checkout?view=rules')
	assert(page.body.includes('Edit the rules'))
	assert(!page.body.includes('data-act="rule-edit"'))
	assert(!page.body.includes('data-act="rule-add"'))
	const refused = await call(
		ui,
		'/plans/checkout/rules/R1',
		{ csrf: token(page.body), text: 'x', area: 'y' },
		{ Cookie: `checkmate_actor=${actor}` }
	)
	assert.equal(refused.status, 422)
	assert.match(refused.body, /do not come from the sources/)
})

test('the page of a plan with derived rules offers the edit, the remove, and the add', async (t) => {
	const { ui } = await fixture(t)
	const page = await call(ui, '/plans/notes?view=rules')
	assert.equal(page.body.match(/data-option\s+data-act="rule-edit"/g)?.length, 3)
	assert.equal(page.body.match(/data-option\s+data-ask-title="Remove rule R\d\?"/g)?.length, 3)
	assert.equal(page.body.match(/data-act="rule-edit"/g)?.length, 6)
	assert.equal(page.body.match(/data-ask-title="Remove rule R\d\?"/g)?.length, 6)
	assert(page.body.includes('data-act="rule-add"'))
	assert(page.body.includes('Edit them here, or with checkmate plan edit notes --patch.'))
})

test('the three rule routes refuse a foreign origin and a missing token, and record nothing', async (t) => {
	const { ui, workspace } = await fixture(t)
	const form = { csrf: token((await call(ui, '/plans/notes')).body), text: 'x', area: 'Saving' }
	const origin = `http://127.0.0.1:${new URL(ui.url).port}`
	for (const path of ['/plans/notes/rules', '/plans/notes/rules/R1', '/plans/notes/rules/R1/remove']) {
		const foreign = await call(ui, path, form, { Cookie: `checkmate_actor=${actor}`, Origin: 'http://evil.test' })
		assert.equal(foreign.status, 403, path)
		const missing = await call(
			ui,
			path,
			{ ...form, csrf: '' },
			{ Cookie: `checkmate_actor=${actor}`, Origin: origin }
		)
		assert.equal(missing.status, 403, path)
	}
	const reading = openStore(workspace)
	try {
		assert.equal(reading.db.prepare("SELECT count(*) AS n FROM operations WHERE command = 'plan edit'").get()!.n, 0)
	} finally {
		closeStore(reading)
	}
})

test('the patch refuses an area of 41 characters, a blank text, and ten areas, also from the command line', async (t) => {
	const { workspace } = await fixture(t)
	const opened = openStore(workspace)
	t.after(() => closeStore(opened))
	assert.throws(
		() =>
			patchPlan(opened, actor, { reference: 'notes', patch: { requirements: { R1: { area: 'a'.repeat(41) } } } }),
		/area must NOT have more than 40 characters/
	)
	assert.throws(
		() => patchPlan(opened, actor, { reference: 'notes', patch: { requirements: { R1: { text: ' ' } } } }),
		/The rule R1 needs text/
	)
	const many = Object.fromEntries(
		Array.from({ length: 8 }, (_, index) => [`R${index + 4}`, { text: 'x', source: 's', area: `Area ${index}` }])
	)
	assert.throws(() => patchPlan(opened, actor, { reference: 'notes', patch: { requirements: many } }), /10 areas/)
})
