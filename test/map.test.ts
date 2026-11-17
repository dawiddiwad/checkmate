import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOrder, journal } from '../plugin/src/journal.ts'
import { plan, store, target } from './support.ts'
import { entries, openTest } from './explorations.ts'

test('builds keep the order in which a plan first tested them, not the order of the entries', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	openTest(opened, 'checkout', 'x-1', 'b1')
	openTest(opened, 'checkout', 'x-2', 'b2')
	openTest(opened, 'checkout', 'x-3', 'b1')
	entries(opened, 'x-2', 'a1', [{ kind: 'note', text: 'Tested b2 first.' }])
	entries(opened, 'x-1', 'a1', [{ kind: 'note', text: 'Recorded b1 later.' }])
	assert.deepEqual(
		buildOrder(opened, 'checkout').map((item) => item.build),
		['b1', 'b2']
	)
	assert.deepEqual(journal(opened, 'checkout').builds, ['b1', 'b2'])
})
