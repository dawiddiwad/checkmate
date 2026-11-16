import type { Store } from './store.ts'
import { all, one } from './store.ts'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { requireChoice, requireCondition } from './contracts.ts'

type OperationRow = {
	rowid: number
	id: string
	at: string
	actor: string
	command: string
	arguments: string
	status: string
	response: string
	subjects: string
}

export function operationLog(store: Store, filters: { subject?: string; limit?: number; after?: number } = {}) {
	const limit = filters.limit ?? 50
	requireCondition(Number.isInteger(limit) && limit > 0 && limit <= 1000, `Invalid limit: ${limit}. Use 1 to 1000.`)
	return all<OperationRow>(
		store,
		`SELECT rowid, * FROM operations
		WHERE (? IS NULL OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = ?)) AND rowid > ?
		ORDER BY rowid ${filters.after === undefined ? 'DESC' : 'ASC'} LIMIT ?`,
		filters.subject ?? null,
		filters.subject ?? null,
		filters.after ?? 0,
		limit
	).map(operationRow)
}

function operationRow(row: OperationRow) {
	return {
		rowid: row.rowid,
		id: row.id,
		at: row.at,
		actor: row.actor,
		command: row.command,
		status: row.status,
		subjects: JSON.parse(row.subjects) as string[],
		arguments: JSON.parse(row.arguments) as unknown,
		response: JSON.parse(row.response) as unknown,
	}
}

export function changesAfter(store: Store, rowid: number) {
	return all<{ rowid: number; id: string; subjects: string }>(
		store,
		'SELECT rowid, id, subjects FROM operations WHERE rowid > ? ORDER BY rowid',
		rowid
	).map((row) => ({ rowid: row.rowid, id: row.id, subjects: JSON.parse(row.subjects) as string[] }))
}

export type ListQuery = {
	limit?: number
	offset?: number
	sort?: string
	direction?: 'asc' | 'desc'
	q?: string
	filters?: Record<string, string | undefined>
}
export type ListPage<T> = {
	rows: T[]
	total: number
	limit: number
	offset: number
	sort: string
	direction: 'asc' | 'desc'
}
const pageSizes = [25, 50, 100]

function listQuery(query: ListQuery, columns: string[], defaults: { sort: string; direction: 'asc' | 'desc' }) {
	const limit = query.limit ?? 25
	const offset = query.offset ?? 0
	const sort = query.sort ?? defaults.sort
	const direction = query.direction ?? (query.sort ? 'asc' : defaults.direction)
	requireCondition(pageSizes.includes(limit), `Invalid limit: ${limit}. Use one of: ${pageSizes.join(', ')}.`)
	requireCondition(Number.isInteger(offset) && offset >= 0, `Invalid offset: ${offset}. Use 0 or more.`)
	requireChoice(sort, columns, 'sort column')
	requireChoice(direction, ['asc', 'desc'], 'sort direction')
	return { limit, offset, sort, direction, q: query.q?.trim().toLowerCase() ?? '' }
}

function filterValue(filters: ListQuery['filters'], names: Record<string, readonly string[] | null>) {
	const values: Record<string, string> = {}
	for (const [name, value] of Object.entries(filters ?? {})) {
		if (value === undefined || value === '') continue
		requireCondition(name in names, `Unknown filter: ${name}. Use: ${Object.keys(names).join(', ')}.`)
		const choices = names[name]
		if (choices) requireChoice(value, choices, `${name} filter`)
		values[name] = value
	}
	return values
}

const logColumns: Record<string, string> = {
	time: 'rowid',
	actor: 'actor',
	command: 'command',
	status: 'status',
}

export function pagedOperations(
	store: Store,
	query: ListQuery = {}
): ListPage<ReturnType<typeof operationLog>[number]> {
	const options = listQuery(query, Object.keys(logColumns), { sort: 'time', direction: 'desc' })
	const filters = filterValue(query.filters, { subject: null, actor: null, command: null, status: null })
	const where = `WHERE (:subject IS NULL OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = :subject))
		AND (:actor IS NULL OR actor = :actor) AND (:command IS NULL OR command = :command)
		AND (:status IS NULL OR status = :status)
		AND (:q = '' OR instr(lower(at || ' ' || actor || ' ' || command || ' ' || status || ' ' || subjects || ' ' || id
			|| ' ' || coalesce(response ->> '$.reasons', '')), :q) > 0)`
	const parameters = {
		subject: filters.subject ?? null,
		actor: filters.actor ?? null,
		command: filters.command ?? null,
		status: filters.status ?? null,
		q: options.q,
	}
	const total = (
		store.db.prepare(`SELECT count(*) AS total FROM operations ${where}`).get(parameters) as { total: number }
	).total
	const direction = options.direction === 'asc' ? 'ASC' : 'DESC'
	const rows = store.db
		.prepare(
			`SELECT rowid, * FROM operations ${where} ORDER BY ${logColumns[options.sort]} ${direction}, rowid ${direction} LIMIT :limit OFFSET :offset`
		)
		.all({ ...parameters, limit: options.limit, offset: options.offset }) as OperationRow[]
	return {
		rows: rows.map(operationRow),
		total,
		limit: options.limit,
		offset: options.offset,
		sort: options.sort,
		direction: options.direction,
	}
}

export function pageOf<T>(
	items: T[],
	query: ListQuery,
	options: {
		columns: Record<string, (item: T) => string | number>
		sort: string
		direction: 'asc' | 'desc'
		filters: Record<string, (item: T) => string>
		text: (item: T) => string
	}
): ListPage<T> {
	const chosen = listQuery(query, Object.keys(options.columns), options)
	const filters = filterValue(
		query.filters,
		Object.fromEntries(Object.keys(options.filters).map((name) => [name, null]))
	)
	const key = options.columns[chosen.sort]
	const sign = chosen.direction === 'asc' ? 1 : -1
	const rows = items
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => Object.entries(filters).every(([name, value]) => options.filters[name](item) === value))
		.filter(({ item }) => !chosen.q || options.text(item).toLowerCase().includes(chosen.q))
		.sort((a, b) => {
			const x = key(a.item)
			const y = key(b.item)
			return (x < y ? -sign : x > y ? sign : 0) || (a.index - b.index) * sign
		})
	return {
		rows: rows.slice(chosen.offset, chosen.offset + chosen.limit).map(({ item }) => item),
		total: rows.length,
		limit: chosen.limit,
		offset: chosen.offset,
		sort: chosen.sort,
		direction: chosen.direction,
	}
}

export function recordRuns(store: Store, changeId: string) {
	return all<OperationRow>(
		store,
		"SELECT rowid, * FROM operations WHERE command = 'record' AND arguments ->> '$.changeId' = ? ORDER BY rowid DESC",
		changeId
	).map((row) => {
		const response = JSON.parse(row.response) as {
			reasons?: string[]
			data?: { build?: string | null; saved?: number; refused?: number; session?: string }
		}
		const input = JSON.parse(row.arguments) as { build?: string; session?: string }
		return {
			id: row.id,
			at: row.at,
			actor: row.actor,
			status: row.status,
			build: response.data?.build ?? input.build ?? null,
			session: response.data?.session ?? input.session ?? null,
			saved: response.data?.saved ?? null,
			refused: response.data?.refused ?? null,
			reasons: response.reasons ?? [],
		}
	})
}

export function namedEvidence(store: Store, path: string) {
	const named = one(
		store,
		"SELECT 1 FROM journal_entries, json_each(body, '$.evidence') WHERE value ->> '$.path' = ?",
		path
	)
	if (!named || isAbsolute(path)) return null
	const file = resolve(store.workspace, path)
	if (!existsSync(file)) return null
	const real = realpathSync(file)
	if (!real.startsWith(realpathSync(store.workspace) + sep) || !statSync(real).isFile()) return null
	return real
}
