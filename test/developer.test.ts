import test from 'node:test'
import assert from 'node:assert/strict'
import { developerText } from '../plugin/src/developer.ts'
import { patchPlan } from '../plugin/src/plans.ts'
import { closeStore, openStore } from '../plugin/src/store.ts'
import { startUi } from '../plugin/src/ui/server.ts'
import { actor, directory } from './support.ts'
import { call } from './actions.ts'
import { seedNotes } from './notes.ts'

const separator = `\n\n${'-'.repeat(40)}\n\n`
const first = [
	'The title is lost after a save',
	'Severity: high',
	'Rule: R1 A note keeps its title after a save.',
	'Steps:',
	'1. Open the notes.',
	'2. Do the thing for D1.',
	'Expected: The title is lost after a save does not happen.',
	'Actual: The title is lost after a save happens.',
	'State: b1 new; b2 still present',
	'Evidence: k1-D1.txt',
].join('\n')
const second = [
	'A deleted note stays in the list',
	'Severity: critical',
	'Rule: R2 A deleted note leaves the list.',
	'Steps:',
	'1. Open the notes.',
	'2. Do the thing for D2.',
	'Expected: A deleted note stays in the list does not happen.',
	'Actual: A deleted note stays in the list happens.',
	'State: b1 new; b2 fixed',
	'Evidence: k1-D2.txt',
].join('\n')

test('the text for the developer has the title, the severity, the rule, the steps, the states, and the evidence files', (t) => {
	const workspace = directory(t)
	seedNotes(workspace)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	assert.equal(developerText(store, 'notes', ['k1/D1']), first)
	assert.equal(developerText(store, 'notes', ['k1/D1', 'k1/D2']), `${first}${separator}${second}`)
	assert.equal(developerText(store, 'notes', []), '')
	assert.throws(() => developerText(store, 'notes', ['k1/D9']), /Unknown defect k1\/D9 of plan notes\./)
})

test('a defect of a rule that is gone says so', (t) => {
	const workspace = directory(t)
	seedNotes(workspace)
	const store = openStore(workspace)
	t.after(() => closeStore(store))
	patchPlan(store, actor, { reference: 'notes', patch: { requirements: { R3: null } } })
	assert.match(developerText(store, 'notes', ['k1/D3']), /\nRule: R3 is not a rule of the plan now\.\n/)
})

test('the page serves the same text, and refuses an unknown defect', async (t) => {
	const workspace = directory(t)
	seedNotes(workspace)
	const ui = await startUi({ workspace })
	t.after(() => ui.close())
	const served = await call(ui, '/plans/notes/defects.txt?claim=k1%2FD1&claim=k1%2FD2')
	assert.equal(served.status, 200)
	assert.equal(served.headers['content-type'], 'text/plain; charset=utf-8')
	assert.equal(served.body, `${first}${separator}${second}`)
	assert.equal((await call(ui, '/plans/notes/defects.txt?claim=k1%2FD9')).status, 404)
})
