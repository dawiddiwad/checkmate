import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Page } from './layout.ts'
import type { ListPage, ListQuery } from '../views.ts'
import { operationLog, pagedOperations } from '../views.ts'
import { html, join, pill, plural, time, words } from './html.ts'
import { heading } from './layout.ts'

type Direction = 'asc' | 'desc'
type Column = { label: string; sort?: string; first?: Direction }
type Filter = { name: string; label: string; choices: string[][]; strict: boolean }

export type ListSpec = {
	path: string
	region: string
	noun: string
	nouns: string
	search: string
	columns: Column[]
	sort: string
	direction: Direction
	filters: Filter[]
}

export type ListState = {
	q: string
	size: number
	page: number
	sort: string
	direction: Direction
	filters: Record<string, string>
}

const pageSizes = [25, 50, 100]

export function listState(params: URLSearchParams, spec: ListSpec): ListState {
	const size = Number(params.get('size'))
	const page = Math.floor(Number(params.get('page')))
	const sort = params.get('sort') ?? ''
	const direction = params.get('dir')
	const filters: Record<string, string> = {}
	for (const filter of spec.filters) {
		const value = params.get(filter.name)?.trim() ?? ''
		if (!value) continue
		if (filter.strict && !filter.choices.some(([choice]) => choice === value)) continue
		filters[filter.name] = value
	}
	return {
		q: params.get('q')?.trim() ?? '',
		size: pageSizes.includes(size) ? size : 25,
		page: page > 1 ? page : 1,
		sort: spec.columns.some((column) => column.sort === sort) ? sort : spec.sort,
		direction: direction === 'asc' || direction === 'desc' ? direction : spec.direction,
		filters,
	}
}

export function listHref(spec: ListSpec, state: ListState, change: Partial<ListState> = {}) {
	const next = { ...state, ...change }
	const params = new URLSearchParams()
	if (next.q) params.set('q', next.q)
	for (const filter of spec.filters) if (next.filters[filter.name]) params.set(filter.name, next.filters[filter.name])
	if (next.size !== 25) params.set('size', String(next.size))
	if (next.sort !== spec.sort) params.set('sort', next.sort)
	if (next.direction !== spec.direction) params.set('dir', next.direction)
	if (next.page > 1) params.set('page', String(next.page))
	const query = params.toString()
	return query ? `${spec.path}?${query}` : spec.path
}

export function listPage<T>(state: ListState, load: (query: ListQuery) => ListPage<T>) {
	const query = (page: number) => ({
		limit: state.size,
		offset: (page - 1) * state.size,
		sort: state.sort,
		direction: state.direction,
		q: state.q,
		filters: state.filters,
	})
	const page = load(query(state.page))
	const last = Math.max(1, Math.ceil(page.total / state.size))
	if (state.page <= last) return { page, state }
	return { page: load(query(last)), state: { ...state, page: last } }
}

function options(choices: string[][], selected: string) {
	return choices.map(
		([value, label]) => html`<option value="${value}" ${value === selected ? html`selected` : ''}>${label}</option>`
	)
}

function filterChoices(filter: Filter, selected: string) {
	if (!selected || filter.choices.some(([value]) => value === selected)) return filter.choices
	return [...filter.choices, [selected, selected]]
}

export function filterBar(spec: ListSpec, state: ListState) {
	const hiddenField = (name: string, value: string, fallback: string) =>
		html`<input type="hidden" name="${name}" value="${value}" data-default="${fallback}" />`
	return html`<form class="filters" method="get" action="${spec.path}" role="search" data-list-form>
		<label class="sr-only" for="q">Search ${spec.nouns}</label>
		<input
			id="q"
			type="search"
			name="q"
			value="${state.q}"
			placeholder="${spec.search}"
			autocomplete="off"
			data-search
		/>
		${spec.filters.map(
			(filter) =>
				html`<label class="sr-only" for="filter-${filter.name}">${filter.label}</label>
					<select id="filter-${filter.name}" name="${filter.name}" data-default="">
						${options(filterChoices(filter, state.filters[filter.name] ?? ''), state.filters[filter.name] ?? '')}
					</select>`
		)}
		<label class="sr-only" for="size">Rows per page</label>
		<select id="size" name="size" data-default="25">
			${options(
				pageSizes.map((size) => [String(size), `${size} rows`]),
				String(state.size)
			)}
		</select>
		${hiddenField('sort', state.sort, spec.sort)} ${hiddenField('dir', state.direction, spec.direction)}
		<button class="btn" data-list-submit>Filter</button>
		<a class="btn ghost" href="${spec.path}" data-list-clear>Clear</a>
	</form>`
}

function headerCell(spec: ListSpec, state: ListState, column: Column) {
	if (!column.sort) return html`<th scope="col">${column.label}</th>`
	const active = state.sort === column.sort
	const direction: Direction = active ? (state.direction === 'asc' ? 'desc' : 'asc') : (column.first ?? 'asc')
	const href = listHref(spec, state, { sort: column.sort, direction, page: 1 })
	const sorted = active ? html` aria-sort="${state.direction === 'asc' ? 'ascending' : 'descending'}"` : ''
	const arrow = active ? (state.direction === 'asc' ? '↑' : '↓') : '↕'
	return html`<th scope="col" ${sorted}>
		<a class="sort${active ? ' on' : ''}" href="${href}" data-list-link
			>${column.label}<span class="arrow" aria-hidden="true">${arrow}</span></a
		>
	</th>`
}

function pager(spec: ListSpec, state: ListState, total: number) {
	const last = Math.max(1, Math.ceil(total / state.size))
	if (last === 1) return ''
	const link = (page: number, label: string, rel: string) =>
		page === state.page || page < 1 || page > last
			? html`<span class="btn small" aria-disabled="true">${label}</span>`
			: html`<a class="btn small" href="${listHref(spec, state, { page })}" rel="${rel}" data-list-link
					>${label}</a
				>`
	return html`<nav class="pager" aria-label="Pages">
		${link(1, '« First', 'first')} ${link(state.page - 1, '‹ Previous', 'prev')}
		<span class="pager-at">Page ${state.page} of ${last}</span>
		${link(state.page + 1, 'Next ›', 'next')} ${link(last, 'Last »', 'last')}
	</nav>`
}

export function listRegion(spec: ListSpec, state: ListState, total: number, rows: Html[], tableClass = '') {
	const first = total ? (state.page - 1) * state.size + 1 : 0
	const last = Math.min(total, state.page * state.size)
	const count = total
		? `Showing ${first}–${last} of ${plural(total, spec.noun, spec.nouns)}`
		: `No ${spec.noun} matches these filters.`
	return html`<div data-region="${spec.region}" data-list-region>
		<p class="list-count" data-list-count role="status">${count}</p>
		${
			total
				? html`<div class="scroll">
							<table class="${tableClass}">
								<thead>
									<tr>
										${spec.columns.map((column) => headerCell(spec, state, column))}
									</tr>
								</thead>
								<tbody>
									${rows}
								</tbody>
							</table>
						</div>
						${pager(spec, state, total)}`
				: ''
		}
	</div>`
}

export function distinct(values: string[]) {
	return [...new Set(values)].sort().map((value) => [value, value])
}

export function subjectLink(subject: string) {
	const [kind, id] = subject.split(/:(.*)/)
	if (kind === 'target') return html`<a class="mono" href="/settings/targets/${id}">${subject}</a>`
	if (kind === 'change') return html`<a class="mono" href="/changes/${id}">${subject}</a>`
	return html`<span class="mono">${subject}</span>`
}

function reasons(response: unknown) {
	const list = (response as { reasons?: unknown })?.reasons
	return Array.isArray(list) ? list.map(String) : []
}

export function logSpec(store: Store): ListSpec {
	const recent = operationLog(store, { limit: 1000 })
	return {
		path: '/log',
		region: 'log',
		noun: 'operation',
		nouns: 'operations',
		search: 'Search the log',
		columns: [
			{ label: 'Time', sort: 'time', first: 'desc' },
			{ label: 'Actor', sort: 'actor' },
			{ label: 'Command', sort: 'command' },
			{ label: 'Status', sort: 'status' },
			{ label: 'Subjects' },
			{ label: 'Operation' },
		],
		sort: 'time',
		direction: 'desc',
		filters: [
			{
				name: 'subject',
				label: 'Subject',
				choices: [['', 'All subjects'], ...distinct(recent.flatMap((row) => row.subjects))],
				strict: false,
			},
			{
				name: 'actor',
				label: 'Actor',
				choices: [['', 'All actors'], ...distinct(recent.map((row) => row.actor))],
				strict: false,
			},
			{
				name: 'command',
				label: 'Command',
				choices: [['', 'All commands'], ...distinct(recent.map((row) => row.command))],
				strict: false,
			},
			{
				name: 'status',
				label: 'Status',
				choices: [['', 'All statuses'], ...distinct(recent.map((row) => row.status))],
				strict: false,
			},
		],
	}
}

type LogRow = ReturnType<typeof pagedOperations>['rows'][number]

function logRow(row: LogRow) {
	return html`<tr data-key="op:${row.rowid}">
		<td class="nowrap">${time(row.at)}</td>
		<td>${row.actor}</td>
		<td>
			<span class="mono">${row.command}</span>
			${row.status === 'rejected' ? html`<div class="reason">${reasons(row.response).join(' ')}</div>` : ''}
		</td>
		<td>${pill(row.status === 'rejected' ? 'rejected_operation' : row.status, words(row.status))}</td>
		<td>
			${row.subjects.length ? join(row.subjects.map(subjectLink), ' ') : html`<span class="muted">none</span>`}
		</td>
		<td class="mono muted">${row.id}</td>
	</tr>`
}

export function logPage(store: Store, params: URLSearchParams): Page {
	const spec = logSpec(store)
	const { page, state } = listPage(listState(params, spec), (query) => pagedOperations(store, query))
	return {
		title: 'Log',
		section: 'log',
		subjects: ['*'],
		body: html`${heading('Log', 'Every write to the workspace.')} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(logRow), 'log')}`,
	}
}
