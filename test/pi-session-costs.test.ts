import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { addEvent, explorationEvents, openExploration } from '../plugin/src/explorations.ts'
import { recoverPiCosts } from '../plugin/src/pi-session-costs.ts'
import { completed, write } from '../plugin/src/store.ts'
import { actor, directory, plan, store, target } from './support.ts'

test('older Pi runs recover only their own messages and keep costs after the sessions are gone', async (t) => {
	const db = store(t)
	target(db)
	plan(db)
	openExploration(db, actor, { planId: 'checkout', build: 'b1', explorationId: 'x-costs' })
	const log = (step: string, at: string, explorer: string | null, detail: Record<string, unknown>) =>
		write(db, { actor, command: step, subject: 'x-costs', input: null }, (operationId) => {
			addEvent(db, 'x-costs', { step, explorer, status: 'completed', detail }, operationId, at)
			return { reply: completed('x-costs'), subjects: [] }
		})
	const time = (second: number) => new Date(second * 1000).toISOString()
	const tester = randomUUID()
	const recorder = randomUUID()
	const missing = randomUUID()
	const foreign = randomUUID()
	log('start', time(1), null, { context: { harness: 'pi' } })
	log('end', time(4), 'a1', { session: tester })
	log('end', time(4), 'a2', { session: missing })
	log('record', time(6), 'a1', { session: tester, recorder })
	log('verify', time(8), null, { session: foreign })
	log('done', time(9), null, {})
	log('follow', time(10), null, {})
	log('follow-turn', time(12), 'a1', { session: tester })

	const sessions = directory(t)
	const file = (id: string) => 'stamp_' + id + '.jsonl'
	const header = (id: string) => ({ type: 'session', id, cwd: realpathSync(db.workspace) })
	const message = (id: string, second: number, total?: number) => ({
		type: 'message',
		id,
		timestamp: time(second),
		message: { role: 'assistant', usage: { cost: { total } } },
	})
	const save = (id: string, entries: object[]) =>
		writeFileSync(join(sessions, file(id)), entries.map((entry) => JSON.stringify(entry)).join('\n'))
	const shared = message('first', 2, 0.25)
	save(tester, [
		header(tester),
		shared,
		message('unreported', 3),
		message('outside', 7, 15),
		message('follow', 11, 0),
	])
	save(recorder, [
		{ ...header(recorder), parentSession: join(sessions, file(tester)) },
		shared,
		message('record', 5, 0.125),
	])
	save(foreign, [{ ...header(foreign), cwd: directory(t) }, message('foreign', 7, 1)])
	const env = { PI_CODING_AGENT_SESSION_DIR: sessions }
	await Promise.all([recoverPiCosts(db, env), recoverPiCosts(db, env)])
	await recoverPiCosts(db, { PI_CODING_AGENT_SESSION_DIR: directory(t) })
	const results = explorationEvents(db, 'x-costs').filter((e) =>
		['end', 'record', 'verify', 'follow-turn'].includes(e.step)
	)
	assert.deepEqual(
		results.map((e) => [e.detail.costUsd, e.detail.costPartial]),
		[
			[0.25, true],
			[undefined, undefined],
			[0.125, undefined],
			[undefined, undefined],
			[0, undefined],
		]
	)
	assert.equal(db.db.prepare('SELECT count(*) AS n FROM exploration_event_costs').get()?.n, 3)
})
