import type { SQLInputValue } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export type Status =
	'completed' | 'needs_decision' | 'interrupted' | 'operational_error' | 'rejected' | 'invalid_request' | 'running'
export type Reply = {
	status: Status
	subject: string
	reasons: string[]
	refusal?: 'malformed' | 'prohibited'
	hint?: string
	data: Record<string, unknown>
}
export type Change = { reply: Reply; subjects: string[] }
export type Store = { db: DatabaseSync; workspace: string; path: string; via?: string }
export type Operation = { actor: string | undefined; command: string; subject: string; input: unknown }

export const contractVersion = 'toolkit-2'
const schemaVersion = '8'

export class WorkspaceSchemaError extends Error {}

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
	subjects TEXT NOT NULL,
	via TEXT
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
	tool_session TEXT NOT NULL,
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
CREATE TABLE explorations (
	exploration_id TEXT PRIMARY KEY,
	plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
	plan_revision INTEGER,
	target_id TEXT NOT NULL,
	target_revision INTEGER NOT NULL,
	instance_id TEXT NOT NULL,
	build TEXT NOT NULL,
	mode TEXT NOT NULL,
	charter TEXT NOT NULL,
	started_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (target_id, target_revision) REFERENCES profiles(target_id, revision),
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE exploration_events (
	exploration_id TEXT NOT NULL REFERENCES explorations(exploration_id),
	at TEXT NOT NULL,
	step TEXT NOT NULL,
	explorer TEXT,
	status TEXT NOT NULL,
	detail TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE journal_entries (
	exploration_id TEXT NOT NULL REFERENCES explorations(exploration_id),
	entry_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	build TEXT,
	body TEXT NOT NULL,
	actor TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE target_request_corrections (
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, operation_id)
) STRICT;
CREATE TABLE assertion_corrections (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	assertion_id TEXT NOT NULL,
	attempt INTEGER NOT NULL,
	result TEXT NOT NULL,
	observed TEXT,
	reason TEXT NOT NULL,
	recorded_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE plan_promotions (
	plan_id TEXT NOT NULL,
	source_revision INTEGER NOT NULL,
	promoted_revision INTEGER NOT NULL,
	build TEXT NOT NULL,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	result_sha256 TEXT NOT NULL,
	tests TEXT NOT NULL,
	rationale TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (plan_id, source_revision),
	CHECK (promoted_revision = source_revision + 1),
	FOREIGN KEY (plan_id, source_revision) REFERENCES plan_revisions(plan_id, revision),
	FOREIGN KEY (plan_id, promoted_revision) REFERENCES plan_revisions(plan_id, revision)
) STRICT;
CREATE TABLE exploration_event_costs (
	source_operation_id TEXT NOT NULL REFERENCES operations(id),
	step TEXT NOT NULL,
	explorer TEXT NOT NULL,
	cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
	partial INTEGER NOT NULL CHECK(partial IN (0, 1)),
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (source_operation_id, step, explorer)
) STRICT;
CREATE TABLE plan_rules (
	plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
	origin TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE plan_builds (
	plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
	build TEXT NOT NULL,
	first_tested_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (plan_id, build)
) STRICT;
CREATE TABLE handoffs (
	plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
	claim_id TEXT NOT NULL,
	target TEXT,
	actor TEXT NOT NULL,
	at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE workspace_settings (
	name TEXT NOT NULL,
	value TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE requests (
	request_id TEXT PRIMARY KEY,
	text TEXT NOT NULL,
	context TEXT NOT NULL,
	asker TEXT NOT NULL,
	conversation TEXT NOT NULL,
	asked_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE request_events (
	request_id TEXT NOT NULL REFERENCES requests(request_id),
	at TEXT NOT NULL,
	step TEXT NOT NULL,
	status TEXT NOT NULL,
	detail TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
`
const views = `
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
const tableNamesOf = (ddl: string) => [...ddl.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1])
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
const triggersOf = (ddl: string) =>
	tableNamesOf(ddl)
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

export function busyTimeout(value = process.env.CHECKMATE_BUSY_TIMEOUT_MS) {
	const milliseconds = Number(value)
	return value !== undefined && /^[1-9][0-9]*$/.test(value) && milliseconds <= 2147483647 ? milliseconds : 30000
}

// A first open can switch the database to WAL while another process reads it. SQLite then fails at once
// after the busy timeout. Nothing changes in that case, so the open retries a few times.
const openAttempts = 3
const openRetryMilliseconds = 250

export function openStore(workspace: string): Store {
	for (let attempt = 1; ; attempt++) {
		try {
			return openStoreOnce(workspace)
		} catch (error) {
			if (!isBusy(error) || attempt >= openAttempts) throw error
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, openRetryMilliseconds)
		}
	}
}

function openStoreOnce(workspace: string): Store {
	const path = databasePath(workspace)
	mkdirSync(join(workspace, '.checkmate'), { recursive: true })
	const db = new DatabaseSync(path)
	try {
		db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`)
		hasCurrentSchema(db, path)
		db.exec('PRAGMA journal_mode = WAL')
		db.exec('PRAGMA foreign_keys = ON')
		db.exec('BEGIN IMMEDIATE')
		if (!hasCurrentSchema(db, path)) {
			db.exec(tables + views)
			db.exec(triggersOf(tables))
			db.exec(`CREATE TRIGGER promoted_plan_update BEFORE UPDATE ON plan_revisions
 WHEN EXISTS (SELECT 1 FROM plan_promotions WHERE plan_id = OLD.plan_id AND promoted_revision = OLD.revision)
 BEGIN SELECT RAISE(ABORT, 'Rows of promoted plan revisions are immutable'); END;`)
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
	return { db, workspace, path }
}

export function openReadOnlyStore(workspace: string): Store {
	const path = databasePath(workspace)
	if (existsSync(path)) {
		const db = openReadOnlyDatabase(path)
		try {
			if (hasCurrentSchema(db, path)) return { db, workspace, path }
		} catch (error) {
			db.close()
			throw error
		}
		db.close()
	}
	closeStore(openStore(workspace))
	return { db: openReadOnlyDatabase(path), workspace, path }
}

function openReadOnlyDatabase(path: string) {
	const db = new DatabaseSync(path, { readOnly: true })
	try {
		db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`)
		return db
	} catch (error) {
		db.close()
		throw error
	}
}

function hasCurrentSchema(db: DatabaseSync, path: string) {
	const first = db
		.prepare("SELECT name, type FROM sqlite_schema ORDER BY name = 'meta' AND type = 'table' DESC LIMIT 1")
		.get()
	if (!first) return false
	const version =
		first.name === 'meta' && first.type === 'table'
			? db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get()?.value
			: undefined
	if (version === schemaVersion) return true
	throw new WorkspaceSchemaError(
		`Database ${path} was created by an older version of Checkmate. Move the .checkmate folder aside, then run setup to start fresh.`
	)
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
		'INSERT INTO operations (id, at, actor, command, arguments, status, response, subjects, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
		operation.id,
		operation.at,
		operation.actor,
		operation.command,
		canonical(operation.input ?? null),
		reply.status,
		canonical(reply),
		canonical(subjects),
		store.via ?? null
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

export function saveBlob(store: Store, bytes: Uint8Array) {
	const sha256 = digest(bytes)
	execute(store, 'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)', sha256, bytes.length, bytes)
	return { sha256, size: bytes.length }
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
