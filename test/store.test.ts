import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
	canonical,
	closeStore,
	digest,
	execute,
	isBusy,
	openReadOnlyStore,
	openStore,
	ulid,
	write,
} from '../plugin/src/store.ts'
import { closeTest, finishRun, recordGap } from '../plugin/src/runs.ts'
import { approvePlan, editPlan, planCandidate, planRevision } from '../plugin/src/plans.ts'
import { retireInstance } from '../plugin/src/targets.ts'
import { actor, begin, check, directory, failT2, plan, ready, revised, store, target } from './support.ts'

test('opening a workspace creates the schema, WAL mode, and the version rows', (t) => {
	const opened = store(t)
	const tables = opened.db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
		.all()
		.map((row) => row.name)
	assert.deepEqual(tables, [
		'approvals',
		'assertion_results',
		'blobs',
		'decisions',
		'evidence',
		'findings',
		'instance_retirements',
		'instances',
		'meta',
		'operations',
		'outcomes',
		'plan_requests',
		'plan_revisions',
		'profiles',
		'results',
		'run_attempts',
		'run_gaps',
		'runs',
		'target_requests',
	])
	assert.equal(opened.db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal')
	assert.equal(opened.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1)
	assert.deepEqual(
		opened.db
			.prepare('SELECT key, value FROM meta ORDER BY key')
			.all()
			.map((row) => ({ ...row })),
		[
			{ key: 'contractVersion', value: 'toolkit-2' },
			{ key: 'schemaVersion', value: '3' },
		]
	)
	closeStore(opened)
	closeStore(openStore(opened.workspace))
})

test('a database with another schema version is refused', (t) => {
	const workspace = directory(t)
	closeStore(openStore(workspace))
	const db = new DatabaseSync(join(workspace, '.checkmate', 'checkmate.db'))
	db.exec('DROP TRIGGER meta_update')
	db.exec("UPDATE meta SET value = '1' WHERE key = 'schemaVersion'")
	db.close()
	assert.throws(() => openStore(workspace), /schema version 1\. Expected 3/)
})

function finishedRun(t: Parameters<typeof store>[0]) {
	const opened = store(t)
	ready(opened)
	begin(opened)
	check(opened, 'run-1', 'T1.A1', 'passed')
	check(opened, 'run-1', 'T1.A2', 'passed')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T1' })
	check(opened, 'run-1', 'T2.A1', 'passed')
	failT2(opened, 'run-1')
	closeTest(opened, actor, { runId: 'run-1', testId: 'T2' })
	recordGap(opened, actor, {
		runId: 'run-1',
		gap: {
			id: 'G9',
			severity: 'non_blocking',
			status: 'open',
			requirementIds: ['R2'],
			testIds: ['T2'],
			question: 'Is the loyalty label right?',
			consequence: 'The label is unchecked.',
			decisionId: null,
		},
	})
	finishRun(opened, actor, { runId: 'run-1', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	retireInstance(opened, actor, { targetId: 'checkout-local', instanceId: 'local' })
	return opened
}

test('triggers refuse updates and deletes on every table', (t) => {
	const opened = finishedRun(t)
	const tables = opened.db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all()
		.map((row) => String(row.name))
	for (const table of tables) {
		assert.throws(() => opened.db.exec(`DELETE FROM ${table}`), /immutable/, table)
		if (table !== 'decisions')
			assert.throws(() => opened.db.exec(`UPDATE ${table} SET rowid = rowid`), /immutable/, table)
	}
	assert.throws(() => opened.db.exec("UPDATE plan_revisions SET body = '{}'"), /Rows of plan_revisions are immutable/)
})

test('a decision changes only applied_revision, only once, and only from NULL', (t) => {
	const opened = store(t)
	ready(opened)
	assert.throws(() => opened.db.exec('UPDATE decisions SET applied_revision = 3'), /Decisions are immutable/)
	assert.throws(() => opened.db.exec('UPDATE decisions SET applied_revision = NULL'), /Decisions are immutable/)
	write(opened, { actor, command: 'test', subject: 'checkout', input: null }, (operationId) => {
		execute(
			opened,
			"INSERT INTO decisions (id, plan_id, base_revision, gap_id, kind, value, source, rationale, actor, operation_id) VALUES ('D9', 'checkout', 2, 'G9', 'defer', 'v', NULL, 'r', 'a', ?)",
			operationId
		)
		return { reply: { status: 'completed', subject: 'checkout', reasons: [], data: {} }, subjects: [] }
	})
	assert.throws(
		() => opened.db.exec("UPDATE decisions SET applied_revision = 3, value = 'other' WHERE id = 'D9'"),
		/Decisions are immutable/
	)
	opened.db.exec("UPDATE decisions SET applied_revision = 3 WHERE id = 'D9'")
	assert.throws(
		() => opened.db.exec("UPDATE decisions SET applied_revision = 4 WHERE id = 'D9'"),
		/Decisions are immutable/
	)
})

test('a write that meets a lock rolls back and logs no rejection', (t) => {
	const opened = store(t)
	const busy = Object.assign(new Error('database is locked'), { errcode: 5 })
	assert(isBusy(busy))
	assert(isBusy(Object.assign(new Error('database is locked'), { errcode: 517 })))
	assert(!isBusy(new Error('database is locked')))
	assert.throws(
		() =>
			write(opened, { actor, command: 'test', subject: 'x', input: null }, (operationId) => {
				execute(
					opened,
					"INSERT INTO target_requests (target_id, body, operation_id) VALUES ('t', '{}', ?)",
					operationId
				)
				throw busy
			}),
		/database is locked/
	)
	assert.equal(opened.db.isTransaction, false)
	assert.equal(opened.db.prepare('SELECT count(*) AS n FROM target_requests').get()!.n, 0)
	assert.equal(opened.db.prepare('SELECT count(*) AS n FROM operations').get()!.n, 0)
})

test('foreign keys refuse rows that name missing parents', (t) => {
	const opened = store(t)
	const attempt = (sql: string) =>
		write(opened, { actor, command: 'test', subject: 'x', input: null }, (operationId) => {
			execute(opened, sql, operationId)
			return { reply: { status: 'completed', subject: 'x', reasons: [], data: {} }, subjects: [] }
		})
	assert.throws(
		() =>
			attempt(
				"INSERT INTO plan_requests (plan_id, target_id, target_revision, body, operation_id) VALUES ('p', 'missing', 1, '{}', ?)"
			),
		/FOREIGN KEY constraint failed/
	)
	assert.throws(
		() =>
			attempt(
				"INSERT INTO evidence (id, run_id, test_id, assertion_id, kind, name, media_type, sha256, operation_id) VALUES ('e', 'run-x', 'T1', NULL, 'observation', 'n', 'text/plain', 'abc', ?)"
			),
		/FOREIGN KEY constraint failed/
	)
	assert.throws(
		() =>
			opened.db.exec(
				"INSERT INTO target_requests (target_id, body, operation_id) VALUES ('t', '{}', 'no-operation')"
			),
		/FOREIGN KEY constraint failed/
	)
})

test('a reader sees committed writes while another connection holds the write lock', (t) => {
	const first = store(t)
	const second = store(t, first.workspace)
	target(first)
	first.db.exec('BEGIN IMMEDIATE')
	first.db.exec("INSERT INTO meta (key, value) VALUES ('pending', 'x')")
	assert.equal(second.db.prepare('SELECT count(*) AS n FROM profiles').get()!.n, 1)
	assert.equal(second.db.prepare("SELECT count(*) AS n FROM meta WHERE key = 'pending'").get()!.n, 0)
	second.db.exec('PRAGMA busy_timeout = 0')
	assert.throws(() => second.db.exec('BEGIN IMMEDIATE'), /database is locked/)
	first.db.exec('ROLLBACK')
	const reader = openReadOnlyStore(first.workspace)
	t.after(() => closeStore(reader))
	assert.equal(reader.db.prepare('SELECT count(*) AS n FROM profiles').get()!.n, 1)
	assert.throws(() => reader.db.exec("INSERT INTO meta (key, value) VALUES ('x', 'y')"), /readonly/)
})

test('canonical JSON sorts keys and has no whitespace; digest is SHA-256 hex', () => {
	assert.equal(
		canonical({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: null } }),
		'{"a":{"c":null,"d":[3,{"e":2,"f":1}]},"b":1}'
	)
	assert.equal(digest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('ULIDs encode the time in Crockford base32 and never decrease in one process', () => {
	const before = Date.now()
	const ids = Array.from({ length: 200 }, () => ulid())
	for (const id of ids) assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/)
	assert.deepEqual([...ids].sort(), ids)
	assert.equal(new Set(ids).size, ids.length)
	const time = [...ids[0].slice(0, 10)].reduce(
		(value, character) => value * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(character),
		0
	)
	assert(time >= before && time <= Date.now())
	assert(ulid(before - 60000) > ids[ids.length - 1])
})

test('a plan revision row changes only while it is the latest, unapproved, and not run', (t) => {
	const opened = store(t)
	target(opened, { approvals: { plan: 'none', result: 'none' } })
	plan(opened)
	opened.db.exec("UPDATE plan_revisions SET operation_id = operation_id WHERE plan_id = 'checkout'")
	assert.throws(
		() => opened.db.exec("UPDATE plan_revisions SET revision = 5 WHERE plan_id = 'checkout'"),
		/immutable once approved, run, or revised/
	)
	revised(opened)
	assert.throws(
		() => opened.db.exec("UPDATE plan_revisions SET body = body WHERE plan_id = 'checkout' AND revision = 1"),
		/immutable once approved, run, or revised/
	)
	opened.db.exec("UPDATE plan_revisions SET body = body WHERE plan_id = 'checkout' AND revision = 2")
	begin(opened, 'run-1', ['T1'])
	assert.throws(
		() => opened.db.exec("UPDATE plan_revisions SET body = body WHERE plan_id = 'checkout' AND revision = 2"),
		/immutable once approved, run, or revised/
	)
	const content = planCandidate(planRevision(opened, 'checkout').plan)
	const edited = editPlan(opened, actor, { reference: 'checkout@2', candidate: content })
	assert.deepEqual([edited.subject, edited.data.edit, edited.data.reason], ['checkout@3', 'new_revision', 'run'])
	approvePlan(opened, actor, { reference: 'checkout@3', rationale: 'Ok.' })
	assert.throws(
		() => opened.db.exec("UPDATE plan_revisions SET body = body WHERE plan_id = 'checkout' AND revision = 3"),
		/immutable once approved, run, or revised/
	)
})
