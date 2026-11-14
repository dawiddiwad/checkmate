import type { SQLInputValue } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export type Status =
	'completed' | 'needs_decision' | 'interrupted' | 'operational_error' | 'rejected' | 'invalid_request'
export type Reply = { status: Status; subject: string; reasons: string[]; data: Record<string, unknown> }
export type Change = { reply: Reply; subjects: string[] }
export type Store = { db: DatabaseSync; workspace: string; path: string }
export type Operation = { actor: string | undefined; command: string; subject: string; input: unknown }

export const contractVersion = 'toolkit-2'
const schemaVersion = '3'

const operationReference = 'REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED'
const tables = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE operations (
	id TEXT PRIMARY KEY,
	at TEXT NOT NULL,
	actor TEXT NOT NULL,
	command TEXT NOT NULL,
	arguments TEXT NOT NULL,
	status TEXT NOT NULL,
	response TEXT NOT NULL,
	subjects TEXT NOT NULL
) STRICT;
CREATE TABLE blobs (sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE TABLE target_requests (
	target_id TEXT PRIMARY KEY,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE profiles (
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	revision INTEGER NOT NULL,
	sha256 TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, revision)
) STRICT;
CREATE TABLE instances (
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	instance_id TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, instance_id)
) STRICT;
CREATE TABLE instance_retirements (
	target_id TEXT NOT NULL,
	instance_id TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, instance_id),
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE plan_requests (
	plan_id TEXT PRIMARY KEY,
	target_id TEXT NOT NULL,
	target_revision INTEGER NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (target_id, target_revision) REFERENCES profiles(target_id, revision)
) STRICT;
CREATE TABLE plan_revisions (
	plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
	revision INTEGER NOT NULL,
	previous_revision INTEGER,
	sha256 TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (plan_id, revision),
	CHECK ((revision = 1 AND previous_revision IS NULL) OR previous_revision = revision - 1)
) STRICT;
CREATE TABLE decisions (
	id TEXT PRIMARY KEY,
	plan_id TEXT NOT NULL,
	base_revision INTEGER NOT NULL,
	gap_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	value TEXT NOT NULL,
	source TEXT,
	rationale TEXT NOT NULL,
	actor TEXT NOT NULL,
	applied_revision INTEGER,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (plan_id, base_revision) REFERENCES plan_revisions(plan_id, revision),
	UNIQUE (plan_id, base_revision, gap_id)
) STRICT;
CREATE TABLE approvals (
	id TEXT PRIMARY KEY,
	subject_kind TEXT NOT NULL,
	subject_id TEXT NOT NULL,
	subject_sha256 TEXT NOT NULL,
	verdict TEXT NOT NULL,
	rationale TEXT NOT NULL,
	actor TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE runs (
	run_id TEXT PRIMARY KEY,
	plan_id TEXT NOT NULL,
	plan_revision INTEGER NOT NULL,
	plan_sha256 TEXT NOT NULL,
	target_id TEXT NOT NULL,
	target_revision INTEGER NOT NULL,
	instance_id TEXT NOT NULL,
	application_build TEXT NOT NULL,
	request TEXT NOT NULL,
	started_at TEXT NOT NULL,
	browser_session TEXT NOT NULL,
	deadline_seconds INTEGER NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (plan_id, plan_revision) REFERENCES plan_revisions(plan_id, revision),
	FOREIGN KEY (target_id, target_revision) REFERENCES profiles(target_id, revision),
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE run_attempts (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	attempt INTEGER NOT NULL,
	started_at TEXT NOT NULL,
	actor TEXT NOT NULL,
	PRIMARY KEY (run_id, attempt)
) STRICT;
CREATE TABLE assertion_results (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	assertion_id TEXT NOT NULL,
	attempt INTEGER NOT NULL,
	result TEXT NOT NULL,
	observed TEXT,
	reason TEXT,
	recorded_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, test_id, assertion_id),
	FOREIGN KEY (run_id, attempt) REFERENCES run_attempts(run_id, attempt)
) STRICT;
CREATE TABLE outcomes (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	attempt INTEGER NOT NULL,
	outcome TEXT NOT NULL,
	reason TEXT,
	recorded_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, test_id),
	FOREIGN KEY (run_id, attempt) REFERENCES run_attempts(run_id, attempt)
) STRICT;
CREATE TABLE evidence (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	assertion_id TEXT,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	media_type TEXT NOT NULL,
	sha256 TEXT NOT NULL REFERENCES blobs(sha256),
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE findings (
	id TEXT NOT NULL,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, id)
) STRICT;
CREATE TABLE run_gaps (
	id TEXT NOT NULL,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, id)
) STRICT;
CREATE TABLE results (
	run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
	completion TEXT NOT NULL,
	coverage TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	sha256 TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE VIEW latest_plans AS
	SELECT p.* FROM plan_revisions p
	WHERE p.revision = (SELECT max(revision) FROM plan_revisions WHERE plan_id = p.plan_id);
CREATE VIEW plan_tests AS
	SELECT p.plan_id, p.revision, t.value ->> '$.id' AS test_id, t.value AS test
	FROM plan_revisions p, json_each(p.body, '$.tests') t;
CREATE VIEW plan_gaps AS
	SELECT p.plan_id, p.revision, g.value ->> '$.id' AS gap_id,
		g.value ->> '$.status' AS status, g.value ->> '$.severity' AS severity, g.value AS gap
	FROM plan_revisions p, json_each(p.body, '$.gaps') g;
`
const tableNames = [...tables.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1])
const decisionColumns = [
	'id',
	'plan_id',
	'base_revision',
	'gap_id',
	'kind',
	'value',
	'source',
	'rationale',
	'actor',
	'operation_id',
]
function updateTrigger(table: string) {
	if (table === 'decisions')
		return `CREATE TRIGGER decisions_update BEFORE UPDATE ON decisions
	WHEN OLD.applied_revision IS NOT NULL OR NEW.applied_revision IS NULL OR ${decisionColumns
		.map((column) => `NEW.${column} IS NOT OLD.${column}`)
		.join(' OR ')}
	BEGIN SELECT RAISE(ABORT, 'Decisions are immutable. Only applied_revision can change, once, from NULL'); END;`
	if (table === 'plan_revisions')
		return `CREATE TRIGGER plan_revisions_update BEFORE UPDATE ON plan_revisions
	WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.revision IS NOT OLD.revision
		OR NEW.previous_revision IS NOT OLD.previous_revision
		OR EXISTS (SELECT 1 FROM approvals WHERE subject_kind = 'plan'
			AND subject_id = OLD.plan_id || '@' || OLD.revision AND verdict = 'approved')
		OR EXISTS (SELECT 1 FROM runs WHERE plan_id = OLD.plan_id AND plan_revision = OLD.revision)
		OR EXISTS (SELECT 1 FROM plan_revisions WHERE plan_id = OLD.plan_id AND revision > OLD.revision)
	BEGIN SELECT RAISE(ABORT, 'Rows of plan_revisions are immutable once approved, run, or revised'); END;`
	return `CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;`
}
const triggers = tableNames
	.map(
		(table) => `${updateTrigger(table)}
CREATE TRIGGER ${table}_delete BEFORE DELETE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;`
	)
	.join('\n')

export function completed(subject: string, data: Record<string, unknown> = {}): Reply {
	return { status: 'completed', subject, reasons: [], data }
}

export function databasePath(workspace: string) {
	return join(workspace, '.checkmate', 'checkmate.db')
}

export function removeTemporaryDirectory(store: Store, name: string) {
	const temporary = join(store.workspace, '.checkmate', 'tmp')
	rmSync(join(temporary, name), { recursive: true, force: true })
	try {
		rmdirSync(temporary)
	} catch {}
}

export const busyReason = 'Another command holds the database lock. Nothing changed. Run the command again.'

export function isBusy(error: unknown) {
	return error instanceof Error && 'errcode' in error && [5, 6].includes(Number(error.errcode) & 0xff)
}

export function openStore(workspace: string): Store {
	const path = databasePath(workspace)
	mkdirSync(join(workspace, '.checkmate'), { recursive: true })
	const db = new DatabaseSync(path)
	try {
		db.exec('PRAGMA busy_timeout = 30000')
		db.exec('PRAGMA journal_mode = WAL')
		db.exec('PRAGMA foreign_keys = ON')
		db.exec('BEGIN IMMEDIATE')
		if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) {
			db.exec(tables)
			db.exec(triggers)
			const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
			insert.run('contractVersion', contractVersion)
			insert.run('schemaVersion', schemaVersion)
		}
		db.exec('COMMIT')
	} catch (error) {
		if (db.isTransaction) db.exec('ROLLBACK')
		db.close()
		throw error
	}
	return checkedStore(db, workspace, path)
}

export function openReadOnlyStore(workspace: string): Store {
	const path = databasePath(workspace)
	closeStore(openStore(workspace))
	const db = new DatabaseSync(path, { readOnly: true })
	db.exec('PRAGMA busy_timeout = 30000')
	return checkedStore(db, workspace, path)
}

function checkedStore(db: DatabaseSync, workspace: string, path: string): Store {
	const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get()
	if (row?.value !== schemaVersion) {
		db.close()
		throw new Error(`Database ${path} has schema version ${row?.value ?? 'none'}. Expected ${schemaVersion}.`)
	}
	return { db, workspace, path }
}

export function closeStore(store: Store) {
	store.db.close()
}

export function one<T>(store: Store, sql: string, ...parameters: SQLInputValue[]): T | undefined {
	return store.db.prepare(sql).get(...parameters) as T | undefined
}

export function all<T>(store: Store, sql: string, ...parameters: SQLInputValue[]): T[] {
	return store.db.prepare(sql).all(...parameters) as T[]
}

export function execute(store: Store, sql: string, ...parameters: SQLInputValue[]) {
	store.db.prepare(sql).run(...parameters)
}

export function write(
	store: Store,
	operation: Operation,
	change: (operationId: string, at: string, actor: string) => Change
) {
	const actor = operation.actor?.trim()
	if (!actor) throw new Error('A write needs an actor. Use --actor <name> or set CHECKMATE_ACTOR.')
	const id = ulid()
	const at = new Date().toISOString()
	store.db.exec('BEGIN IMMEDIATE')
	try {
		const { reply, subjects } = change(id, at, actor)
		recordOperation(store, { ...operation, id, at, actor }, reply, subjects)
		store.db.exec('COMMIT')
		return reply
	} catch (error) {
		if (store.db.isTransaction) store.db.exec('ROLLBACK')
		if (isBusy(error)) throw error
		const reason = error instanceof Error ? error.message : String(error)
		store.db.exec('BEGIN IMMEDIATE')
		recordOperation(
			store,
			{ ...operation, id: ulid(), at: new Date().toISOString(), actor },
			{ status: 'rejected', subject: operation.subject, reasons: [reason], data: {} },
			[]
		)
		store.db.exec('COMMIT')
		throw error
	}
}

function recordOperation(
	store: Store,
	operation: Operation & { id: string; at: string; actor: string },
	reply: Reply,
	subjects: string[]
) {
	execute(
		store,
		'INSERT INTO operations (id, at, actor, command, arguments, status, response, subjects) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		operation.id,
		operation.at,
		operation.actor,
		operation.command,
		canonical(operation.input ?? null),
		reply.status,
		canonical(reply),
		canonical(subjects)
	)
}

export function canonical(value: unknown): string {
	return JSON.stringify(sorted(value))
}

function sorted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sorted)
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sorted((value as Record<string, unknown>)[key])])
		)
	return value
}

export function digest(content: string | Uint8Array) {
	return createHash('sha256').update(content).digest('hex')
}

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let lastTime = 0
let lastRandom = 0n

export function ulid(now = Date.now()) {
	if (now > lastTime) {
		lastTime = now
		lastRandom = BigInt(`0x${randomBytes(10).toString('hex')}`)
	} else {
		lastRandom += 1n
		if (lastRandom >= 1n << 80n) throw new Error('ULID random part overflowed in one millisecond')
	}
	return base32(BigInt(lastTime), 10) + base32(lastRandom, 16)
}

function base32(value: bigint, length: number) {
	let text = ''
	for (let i = 0; i < length; i++) {
		text = crockford[Number(value % 32n)] + text
		value /= 32n
	}
	return text
}
