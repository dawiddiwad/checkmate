import type { SQLInputValue } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Status =
	'completed' | 'needs_decision' | 'interrupted' | 'operational_error' | 'rejected' | 'invalid_request'
export type Reply = {
	status: Status
	subject: string
	reasons: string[]
	refusal?: 'malformed' | 'prohibited'
	hint?: string
	data: Record<string, unknown>
}
export type Change = { reply: Reply; subjects: string[] }
export type Store = { db: DatabaseSync; workspace: string; path: string }
export type Operation = { actor: string | undefined; command: string; subject: string; input: unknown }

export const contractVersion = 'toolkit-2'
const schemaVersion = '5'

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
CREATE TABLE changes (
	change_id TEXT PRIMARY KEY,
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	instance_id TEXT,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE journal_entries (
	change_id TEXT NOT NULL REFERENCES changes(change_id),
	entry_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	build TEXT,
	body TEXT NOT NULL,
	actor TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
`
const tableNames = [...tables.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1])
const triggers = tableNames
	.map(
		(table) => `CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;
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

export const busyReason = 'Another command holds the database lock. Nothing changed. Run the command again.'

export function isBusy(error: unknown) {
	return error instanceof Error && 'errcode' in error && [5, 6].includes(Number(error.errcode) & 0xff)
}

export function busyTimeout(value = process.env.CHECKMATE_BUSY_TIMEOUT_MS) {
	const milliseconds = Number(value)
	return value !== undefined && /^[1-9][0-9]*$/.test(value) && milliseconds <= 2147483647 ? milliseconds : 30000
}

export function createStore(workspace: string): Store {
	mkdirSync(join(workspace, '.checkmate'), { recursive: true })
	return connect(workspace)
}

export function openStore(workspace: string): Store {
	if (!existsSync(databasePath(workspace))) throw new Error(`No Checkmate store at ${databasePath(workspace)}.`)
	return connect(workspace)
}

function connect(workspace: string): Store {
	const path = databasePath(workspace)
	const db = new DatabaseSync(path)
	try {
		db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`)
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
	db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`)
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
