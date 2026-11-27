import type { Store } from '../store.ts'
import type { ListPage, ListQuery } from '../views.ts'
import { operationLog, pagedRuns, planList, runList } from '../views.ts'
import type { Html } from './html.ts'
import { formButton } from './components/button.ts'
import { emptyNotice } from './components/empty-state.ts'
import { statusMark } from './components/status-mark.ts'
import { html, plural, words } from './html.ts'

export function loopState(loop: { state: string; waitsOn: string }) {
	const role = loop.waitsOn === 'qa' ? 'QA' : loop.waitsOn
	return html`<span class="loop"
		>${statusMark({ state: loop.state })}${loop.waitsOn === 'none' ? '' : html` <span class="sc-muted sc-note">waits on ${role}</span>`}</span
	>`
}

type Direction = 'asc' | 'desc'
type Column = { label: string; sort?: string; first?: Direction }
type Filter = { name: string; label: string; choices: string[][]; strict: boolean }

export type ListSpec = {
	path: string
	region: string
	noun: string
	search: string
	columns: Column[]
	sort: string
	direction: Direction
	filters: Filter[]
	none: [string, Html | string]
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
	return html`<form class="sc-filters" method="get" action="${spec.path}" role="search" data-list-form>
		<label class="sc-sr" for="q">Search ${spec.noun}s</label>
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
				html`<label class="sc-sr" for="filter-${filter.name}">${filter.label}</label>
					<select id="filter-${filter.name}" name="${filter.name}" data-default="">
						${options(filterChoices(filter, state.filters[filter.name] ?? ''), state.filters[filter.name] ?? '')}
					</select>`
		)}
		<label class="sc-sr" for="sort">Sort by</label>
		<select id="sort" name="sort" data-default="${spec.sort}">
			${options(
				spec.columns.filter((column) => column.sort).map((column) => [column.sort!, `Sort: ${column.label}`]),
				state.sort
			)}
		</select>
		<label class="sc-sr" for="dir">Order</label>
		<select id="dir" name="dir" data-default="${spec.direction}">
			${options(
				[
					['desc', 'Descending'],
					['asc', 'Ascending'],
				],
				state.direction
			)}
		</select>
		<label class="sc-sr" for="size">Rows per page</label>
		<select id="size" name="size" data-default="25">
			${options(
				pageSizes.map((size) => [String(size), `${size} rows`]),
				String(state.size)
			)}
		</select>
		${formButton({ label: 'Filter', attrs: { 'data-list-submit': true } })}
		${formButton({ label: 'Clear', href: spec.path, quiet: true, attrs: { 'data-list-clear': true } })}
	</form>`
}

export function pageTrail(spec: ListSpec, state: ListState, total: number, title: string) {
	const last = Math.max(1, Math.ceil(total / state.size))
	if (last === 1) return { back: '/' }
	return {
		back: state.page > 1 ? listHref(spec, state, { page: 1 }) : '/',
		crumbs: [[`${title} · page ${state.page} of ${last}`, null]] as Array<[string, string | null]>,
	}
}

export function pager(spec: ListSpec, state: ListState, total: number) {
	const last = Math.max(1, Math.ceil(total / state.size))
	if (last === 1) return ''
	const link = (page: number, label: string, rel: string) =>
		page === state.page || page < 1 || page > last
			? formButton({ label, element: 'span', inline: true, attrs: { 'aria-disabled': 'true' } })
			: formButton({
					label,
					href: listHref(spec, state, { page }),
					inline: true,
					attrs: { rel, 'data-list-link': true },
				})
	return html`<nav class="sc-pager" aria-label="Pages">
		${link(1, '« First', 'first')} ${link(state.page - 1, '‹ Previous', 'prev')}
		<span class="sc-pager-at">Page ${state.page} of ${last}</span>
		${link(state.page + 1, 'Next ›', 'next')} ${link(last, 'Last »', 'last')}
	</nav>`
}

export function listRegion(spec: ListSpec, state: ListState, total: number, rows: Html) {
	const first = total ? (state.page - 1) * state.size + 1 : 0
	const last = Math.min(total, state.page * state.size)
	const count = total ? `Showing ${first}–${last} of ${plural(total, spec.noun)}` : ''
	return html`<div data-region="${spec.region}" data-list-region>
		<p class="sc-count" data-list-count role="status">${count}</p>
		${
			total
				? html`${rows} ${pager(spec, state, total)}`
				: state.q || Object.keys(state.filters).length
					? emptyNotice({
							what: `No ${spec.noun} matches these filters.`,
							next: html`<a href="${spec.path}" data-list-clear>Clear the filters</a>`,
						})
					: emptyNotice({ what: spec.none[0], next: spec.none[1] })
		}
	</div>`
}

const runStatuses = [
	['', 'All runs'],
	['started', 'In progress'],
	['pending', 'Awaiting acceptance'],
	['approved', 'Accepted'],
	['rejected', 'Rejected'],
	['not_required', 'No acceptance needed'],
]

export function runStatus(row: { state: string; acceptance: string | null }) {
	if (row.state === 'started') return statusMark({ state: 'started', label: 'in progress' })
	if (row.acceptance === 'approved') return statusMark({ state: 'approved', label: 'accepted' })
	if (row.acceptance === 'pending') return statusMark({ state: 'awaits_acceptance', label: 'awaiting acceptance' })
	return statusMark({ state: row.acceptance ?? 'finalized' })
}

function distinct(values: string[]) {
	return [...new Set(values)].sort().map((value) => [value, value])
}

export function runsSpec(store: Store): ListSpec {
	const runs = runList(store)
	return {
		path: '/runs',
		region: 'runs',
		noun: 'run',
		none: ['No run yet.', html`Open a plan to review its tests and start a run.`],
		search: 'Search runs',
		columns: [
			{ label: 'Run', sort: 'run' },
			{ label: 'Plan', sort: 'plan' },
			{ label: 'Build', sort: 'build' },
			{ label: 'Instance', sort: 'instance' },
			{ label: 'Tests' },
			{ label: 'Completion', sort: 'completion' },
			{ label: 'Coverage', sort: 'coverage' },
			{ label: 'Status', sort: 'status' },
			{ label: 'Started', sort: 'started', first: 'desc' },
		],
		sort: 'started',
		direction: 'desc',
		filters: [
			{
				name: 'plan',
				label: 'Plan',
				choices: [['', 'All plans'], ...distinct(planList(store).map((row) => row.planId))],
				strict: false,
			},
			{
				name: 'build',
				label: 'Build',
				choices: [['', 'All builds'], ...distinct(runs.map((row) => row.build))],
				strict: false,
			},
			{ name: 'status', label: 'Status', choices: runStatuses, strict: true },
		],
	}
}

export type RunRow = ReturnType<typeof pagedRuns>['rows'][number]

export function subjectLink(subject: string) {
	const [kind, id] = subject.split(/:(.*)/)
	if (kind === 'plan') return html`<a class="sc-mono" href="/plans/${id}">${subject}</a>`
	if (kind === 'run') return html`<a class="sc-mono" href="/runs/${id}">${subject}</a>`
	if (kind === 'target') return html`<a class="sc-mono" href="/settings/targets/${id}">${subject}</a>`
	if (kind === 'chat') return html`<a class="sc-mono" href="/chats/${id}">${subject}</a>`
	if (kind === 'chats') return html`<a class="sc-mono" href="/chats">Chats</a>`
	if (kind === 'inbox') return html`<a class="sc-mono" href="/">${subject}</a>`
	return html`<span class="sc-mono">${subject}</span>`
}

export function logSpec(store: Store): ListSpec {
	const recent = operationLog(store, { limit: 1000, display: true })
	return {
		path: '/log',
		region: 'log',
		noun: 'operation',
		none: ['No operation yet.', 'Each change to the record shows here.'],
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
				choices: [
					['', 'All statuses'],
					...distinct(recent.map((row) => row.status)).map(([value]) => [value, words(value)]),
				],
				strict: false,
			},
		],
	}
}
