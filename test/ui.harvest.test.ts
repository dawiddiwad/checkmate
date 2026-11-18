import type { TestContext } from 'node:test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { startUi } from '../plugin/src/ui/server.ts'
import { planRevision } from '../plugin/src/plans.ts'
import { planRules } from '../plugin/src/rules.ts'
import { ruleMap } from '../plugin/src/rulemap.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { actor, directory } from './support.ts'
import { call, token } from './actions.ts'
import { addExploration, seedStorable } from './notes.ts'

async function fixture(t: TestContext, overrides = {}) {
	const workspace = directory(t)
	seedStorable(workspace, overrides)
	const ui = await startUi({ workspace })
	t.after(() => ui.close())
	const as = { Cookie: `checkmate_actor=${actor}` }
	const post = async (path: string, form: Record<string, string> = {}) =>
		call(ui, path, { csrf: token((await call(ui, '/plans/notes')).body), ...form }, as)
	const read = <T>(view: (store: ReturnType<typeof openStore>) => T) => {
		const reading = openStore(workspace)
		try {
			return view(reading)
		} finally {
			closeStore(reading)
		}
	}
	return { ui, post, read, workspace, as }
}

const toast = (reply: { headers: Record<string, unknown> }) =>
	decodeURIComponent(
		String([reply.headers['set-cookie']].flat().find((line) => String(line).startsWith('checkmate_toast')))
	)

const panelOf = (page: string, view: string) => {
	const rest = page.slice(page.indexOf(`data-panel="${view}"`))
	return rest.slice(0, rest.indexOf('</section>'))
}

const operations = (read: Awaited<ReturnType<typeof fixture>>['read']) =>
	read((reading) => reading.db.prepare("SELECT count(*) AS n FROM operations WHERE command = 'harvest'").get()!.n)

test('the action row of All items and of the rules shows the count, and the dialog says what happens', async (t) => {
	const { ui } = await fixture(t)
	for (const view of ['all', 'rules']) {
		const page = await call(ui, `/plans/notes?view=${view}`)
		const panel = page.body.slice(page.body.indexOf(`data-panel="${view}"`))
		assert(panel.slice(0, panel.indexOf('</section>')).includes('Store 4 defects as tests…'), view)
	}
	const needs = await call(ui, '/plans/notes?view=needs')
	const panel = needs.body.slice(needs.body.indexOf('data-panel="needs"'))
	assert(!panel.slice(0, panel.indexOf('</section>')).includes('as tests…'))
	const dialog = needs.body.slice(needs.body.indexOf('data-act-dialog="store"'))
	const text = dialog.slice(0, dialog.indexOf('</dialog>')).replace(/\s+/g, ' ')
	assert(text.includes('Store 4 defects as tests'))
	assert(
		text.includes(
			'Checkmate stores each defect as a test of this plan and attaches it to the rule that the defect cites. The rules, areas and marks of the plan stay the same. A defect with no rule gets a new rule HRn. Later tests of this plan may run the stored tests. The stored tests wait for the approval of the plan.'
		)
	)
})

test('a plan without an approval policy has no sentence about the approval', async (t) => {
	const { ui } = await fixture(t, { approvals: { plan: 'none', result: 'none' } })
	const page = await call(ui, '/plans/notes?view=all')
	const dialog = page.body.slice(page.body.indexOf('data-act-dialog="store"'))
	const text = dialog.slice(0, dialog.indexOf('</dialog>')).replace(/\s+/g, ' ')
	assert(text.includes('Later tests of this plan may run the stored tests.'))
	assert(!text.includes('approval of the plan'))
})

test('a store attaches each defect to its rule, and leaves the rules, the areas, and the marks as they were', async (t) => {
	const { ui, post, read } = await fixture(t)
	const before = read((reading) => {
		const map = ruleMap(reading, 'notes')
		return { areas: map.areas, rows: map.rows.map((row) => ({ rule: row.rule, cells: row.cells })) }
	})
	const stored = await post('/plans/notes/harvest', { view: 'rules' })
	assert.equal(stored.status, 303)
	assert.equal(stored.headers.location, '/plans/notes?view=rules')
	assert.match(toast(stored), /^checkmate_toast=Stored 4 defects as tests: H1 → R1, H2 → R2, H3 → R3, H4 → HR1;/)
	assert.equal(operations(read), 2)
	const { plan, origin } = read((reading) => ({
		plan: planRevision(reading, 'notes').plan,
		origin: planRules(reading, 'notes').origin,
	}))
	assert.equal(origin, 'harvested')
	assert.deepEqual(
		plan.tests.map((test) => [test.id, test.requirementIds[0]]),
		[
			['H1', 'R1'],
			['H2', 'R2'],
			['H3', 'R3'],
			['H4', 'HR1'],
		]
	)
	const after = read((reading) => {
		const map = ruleMap(reading, 'notes')
		return { areas: map.areas, rows: map.rows.map((row) => ({ rule: row.rule, cells: row.cells })) }
	})
	assert.deepEqual(after.areas.slice(0, before.areas.length), before.areas)
	assert.deepEqual(
		after.areas.slice(before.areas.length).map((area) => [area.label, area.ruleIds]),
		[['Rules', ['HR1']]]
	)
	assert.deepEqual(
		after.rows.filter((row) => before.rows.some((item) => item.rule.id === row.rule.id)),
		before.rows
	)
	const page = await call(ui, '/plans/notes?view=rules')
	assert(!page.body.includes('as tests…'))
	assert(!page.body.includes('data-act-dialog="store"'))
	assert(page.body.includes('4 of 5 rules have a stored test.'))
	const rows = panelOf(page.body, 'rules')
	assert.equal(rows.match(/<span class="sp-c-meta ell"[^>]*>1 stored test · /g)?.length, 4)
	assert.equal(rows.match(/<span>Edit in the plan editor<\/span>/g)?.length, 4)
	assert(page.body.includes('href="/plans/notes@1/edit"'))
	const tests = await call(ui, '/plans/notes@1')
	assert.match(tests.body, /id="H4"[\s\S]*?Requirements[\s\S]*?href="#HR1"/)
})

test('a second store adds only the defects that are not stored', async (t) => {
	const { ui, post, read, workspace } = await fixture(t)
	await post('/plans/notes/harvest')
	const writing = openStore(workspace)
	try {
		addExploration(writing, 'x-4', 'b4', 'D5', 'R4')
	} finally {
		closeStore(writing)
	}
	const page = await call(ui, '/plans/notes?view=all')
	assert(page.body.includes('Store 1 defect as tests…'))
	const stored = await post('/plans/notes/harvest')
	assert.match(toast(stored), /Stored 1 defect as tests: H5 → R4;/)
	assert.deepEqual(
		read((reading) => planRevision(reading, 'notes').plan.tests.map((test) => test.id)),
		['H1', 'H2', 'H3', 'H4', 'H5']
	)
	const nothing = await post('/plans/notes/harvest')
	assert.equal(nothing.status, 422)
	assert.match(nothing.body, /Every defect of notes is stored as a test already\. Nothing is left to store\./)
	assert.equal(operations(read), 3)
})

test('a rule without a stored test keeps its edit, and a rule with one shows the refusal of the engine', async (t) => {
	const { post, read } = await fixture(t)
	await post('/plans/notes/harvest')
	const refused = await post('/plans/notes/rules/R1', { text: 'A note keeps its title.', area: 'Saving' })
	assert.equal(refused.status, 422)
	assert.match(
		refused.body,
		/Rule R1 has a stored test, so it belongs to revision 1\. Correct it with checkmate plan edit notes@1 --patch\./
	)
	const removed = await post('/plans/notes/rules/R2/remove')
	assert.equal(removed.status, 422)
	assert.match(removed.body, /Rule R2 has a stored test/)
	const changed = await post('/plans/notes/rules/R4', { text: 'A note can be pinned to the top.', area: 'Saving' })
	assert.equal(changed.status, 303)
	assert.match(toast(changed), /Changed rule R4/)
	const added = await post('/plans/notes/rules', { text: 'A note can be shared.', area: 'Saving' })
	assert.match(toast(added), /Added rule R5/)
	const rules = read((reading) => planRules(reading, 'notes'))
	assert.equal(rules.origin, 'harvested')
	assert.deepEqual(
		rules.rules.map((rule) => rule.id),
		['R1', 'R2', 'R3', 'R4', 'R5', 'HR1']
	)
	assert.equal(rules.rules[3].text, 'A note can be pinned to the top.')
})

test('a rule view and a rule row show the stored tests, and a rule without one offers the edit', async (t) => {
	const { ui, post } = await fixture(t)
	await post('/plans/notes/harvest')
	const page = await call(ui, '/plans/notes?view=rule%3AR1')
	assert.match(page.body, /<span class="sp-pill"[^>]*>1 stored test<\/span>/)
	assert(page.body.includes('Edit R1 in the plan editor'))
	assert(!page.body.includes('title="Edit the text and the area of R1"'))
	const free = await call(ui, '/plans/notes?view=rule%3AR4')
	assert(!panelOf(free.body, 'rule:R4').includes('stored test'))
	assert(panelOf(free.body, 'rule:R4').includes('title="Edit the text and the area of R4"'))
})

test('the store route refuses a foreign origin and a missing token, and stores nothing', async (t) => {
	const { ui, read } = await fixture(t)
	const form = { csrf: token((await call(ui, '/plans/notes')).body) }
	const origin = `http://127.0.0.1:${new URL(ui.url).port}`
	const foreign = await call(ui, '/plans/notes/harvest', form, {
		Cookie: `checkmate_actor=${actor}`,
		Origin: 'http://evil.test',
	})
	assert.equal(foreign.status, 403)
	const missing = await call(
		ui,
		'/plans/notes/harvest',
		{ csrf: '' },
		{ Cookie: `checkmate_actor=${actor}`, Origin: origin }
	)
	assert.equal(missing.status, 403)
	assert.equal(operations(read), 0)
})

test('a store refuses when the count that the dialog showed is not the count now', async (t) => {
	const { post, read } = await fixture(t)
	const refused = await post('/plans/notes/harvest', { count: '3' })
	assert.equal(refused.status, 422)
	assert.match(refused.body, /4 defects can be stored now, not 3\. Nothing is stored\./)
	assert.equal(operations(read), 0)
	const stored = await post('/plans/notes/harvest', { count: '4' })
	assert.equal(stored.status, 303)
})
