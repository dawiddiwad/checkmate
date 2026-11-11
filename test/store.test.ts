import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
	canonical,
	closeStore,
	digest,
	execute,
	openReadOnlyStore,
	openStore,
	resolveActor,
	ulid,
	write,
} from '../plugin/src/store.ts'
import { closeTest, finishRun, recordGap } from '../plugin/src/runs.ts'
import { actor, begin, check, directory, failT2, ready, store, target } from './support.ts'

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
			{ key: 'schemaVersion', value: '1' },
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
	db.exec("UPDATE meta SET value = '2' WHERE key = 'schemaVersion'")
	db.close()
	assert.throws(() => openStore(workspace), /schema version 2\. Expected 1/)
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

test('actor defaults to repository identity and supports caller overrides', (t) => {
	const workspace = directory(t)
	execFileSync('git', ['init', '--quiet', workspace])
	execFileSync('git', ['-C', workspace, 'config', 'user.name', 'Repository Tester'])
	assert.equal(
		resolveActor(workspace, '  Explicit Actor  ', { CHECKMATE_ACTOR: 'Environment Actor' }),
		'Explicit Actor'
	)
	assert.equal(resolveActor(workspace, undefined, { CHECKMATE_ACTOR: 'Environment Actor' }), 'Environment Actor')
	assert.equal(resolveActor(workspace, '', { USER: 'system-user' }), 'Repository Tester')
	const opened = store(t, workspace)
	write(opened, { actor: undefined, command: 'test', subject: 'actor', input: null }, (_id, _at, actor) => ({
		reply: { status: 'completed', subject: 'actor', reasons: [], data: { actor } },
		subjects: [],
	}))
	assert.equal(opened.db.prepare('SELECT actor FROM operations').get()!.actor, 'Repository Tester')
})
