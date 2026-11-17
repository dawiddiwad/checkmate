import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Page } from './layout.ts'
import type { ListPage, ListQuery } from '../views.ts'
import { operationLog, pagedOperations, pagedRuns, planList, runList } from '../views.ts'
import { glyph, html, join, pill, pillClass, plural, time, words } from './html.ts'
import { emptyNotice, heading } from './layout.ts'

export function loopState(loop: { state: string; waitsOn: string }) {
	const role = loop.waitsOn === 'qa' ? 'QA' : loop.waitsOn
	return html`<span class="loop"
		>${pill(loop.state)}${loop.waitsOn === 'none' ? '' : html` <span class="muted small">waits on ${role}</span>`}</span
	>`
}

const countOrder = ['passed', 'failed', 'inconclusive', 'error', 'blocked', 'not_run'] as const
const countLook: Record<string, [string, string]> = {
	passed: ['✓', 'pass'],
	failed: ['✗', 'fail'],
	inconclusive: ['?', 'unsure'],
	error: ['!', 'warn'],
	blocked: ['–', 'block'],
	not_run: ['–', 'block'],
}

export function counts(values: Record<string, number>) {
	const shown = countOrder.filter((key) => values[key])
	if (!shown.length) return html`<span class="muted">no outcomes yet</span>`
	return html`<span class="counts"
		>${shown.map(
			(key) =>
				html`<span class="${pillClass(key)}" title="${values[key]} ${words(key)}"
					><span aria-hidden="true">${glyph(countLook[key][0])}</span> ${values[key]}<span class="sr-only">
						${words(key)}</span
					></span
				>`
		)}</span
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

function listPage<T>(state: ListState, load: (query: ListQuery) => ListPage<T>) {
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

function filterBar(spec: ListSpec, state: ListState) {
	return html`<form class="filters" method="get" action="${spec.path}" role="search" data-list-form>
		<label class="sr-only" for="q">Search ${spec.noun}s</label>
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
		<label class="sr-only" for="sort">Sort by</label>
		<select id="sort" name="sort" data-default="${spec.sort}">
			${options(
				spec.columns.filter((column) => column.sort).map((column) => [column.sort!, `Sort: ${column.label}`]),
				state.sort
			)}
		</select>
		<label class="sr-only" for="dir">Order</label>
		<select id="dir" name="dir" data-default="${spec.direction}">
			${options(
				[
					['desc', 'Descending'],
					['asc', 'Ascending'],
				],
				state.direction
			)}
		</select>
		<label class="sr-only" for="size">Rows per page</label>
		<select id="size" name="size" data-default="25">
			${options(
				pageSizes.map((size) => [String(size), `${size} rows`]),
				String(state.size)
			)}
		</select>
		<button class="btn" data-list-submit>Filter</button>
		<a class="btn ghost" href="${spec.path}" data-list-clear>Clear</a>
	</form>`
}

function pageTrail(spec: ListSpec, state: ListState, total: number, title: string) {
	const last = Math.max(1, Math.ceil(total / state.size))
	if (last === 1) return { back: '/' }
	return {
		back: state.page > 1 ? listHref(spec, state, { page: 1 }) : '/',
		crumbs: [[`${title} · page ${state.page} of ${last}`, null]] as Array<[string, string | null]>,
	}
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

function listRegion(spec: ListSpec, state: ListState, total: number, rows: Html[]) {
	const first = total ? (state.page - 1) * state.size + 1 : 0
	const last = Math.min(total, state.page * state.size)
	const count = total ? `Showing ${first}–${last} of ${plural(total, spec.noun)}` : ''
	return html`<div data-region="${spec.region}" data-list-region>
		<p class="list-count" data-list-count role="status">${count}</p>
		${
			total
				? html`<ul class="q-items l-rows">
							${rows}
						</ul>
						${pager(spec, state, total)}`
				: state.q || Object.keys(state.filters).length
					? emptyNotice(
							`No ${spec.noun} matches these filters.`,
							html`<a href="${spec.path}" data-list-clear>Clear the filters</a>`
						)
					: emptyNotice(spec.none[0], spec.none[1])
		}
	</div>`
}

function listRow(
	key: string,
	href: string | null,
	top: Html | string,
	tags: Html | string,
	lines: Array<Html | string>
) {
	const inner = html`<span class="q-top"><span class="q-id">${top}</span> <span class="q-tags">${tags}</span></span>
		${lines.map((line, index) => html`<span class="${index ? 'q-note' : 'q-title'}">${line}</span>`)}`
	const label = key.slice(key.indexOf(':') + 1)
	return html`<li data-key="${key}" data-nav-row>
		${
			href
				? html`<a class="q-row" href="${href}" data-row data-href="${href}" data-label="${label}">${inner}</a>`
				: html`<div class="q-row" tabindex="-1" data-row data-label="${label}">${inner}</div>`
		}
	</li>`
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
	if (row.state === 'started') return pill('started', 'in progress')
	if (row.acceptance === 'approved') return pill('approved', 'accepted')
	if (row.acceptance === 'pending') return pill('pending', 'awaiting acceptance')
	return pill(row.acceptance ?? 'finalized')
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
		none: ['No run yet.', html`Approve a plan, then run <code>/checkmate:test</code> in Claude Code.`],
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

type RunRow = ReturnType<typeof pagedRuns>['rows'][number]

function runRow(row: RunRow) {
	return listRow(
		`run:${row.runId}`,
		`/runs/${row.runId}`,
		`${row.runId} · ${row.planId}@${row.revision}`,
		html`${runStatus(row)} ${time(row.startedAt)}`,
		[
			html`${counts(row.counts)}
				<span class="muted"
					>· build <code>${row.build}</code> · ${row.instanceId} ·
					${row.coverage ? `coverage ${words(row.coverage)}` : 'running'}</span
				>`,
		]
	)
}

export function runsPage(store: Store, params: URLSearchParams): Page {
	const spec = runsSpec(store)
	const { page, state } = listPage(listState(params, spec), (query) => pagedRuns(store, query))
	return {
		title: 'Runs',
		section: 'runs',
		subjects: ['*'],
		address: listHref(spec, state),
		...pageTrail(spec, state, page.total, 'Runs'),
		body: html`${heading('Runs', 'Every run of every plan.')} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(runRow))}`,
	}
}

export function subjectLink(subject: string) {
	const [kind, id] = subject.split(/:(.*)/)
	if (kind === 'plan') return html`<a class="mono" href="/plans/${id}">${subject}</a>`
	if (kind === 'run') return html`<a class="mono" href="/runs/${id}">${subject}</a>`
	if (kind === 'target') return html`<a class="mono" href="/settings/targets/${id}">${subject}</a>`
	if (kind === 'inbox') return html`<a class="mono" href="/">${subject}</a>`
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

type LogRow = ReturnType<typeof pagedOperations>['rows'][number]

function logRow(row: LogRow) {
	return listRow(
		`op:${row.rowid}`,
		null,
		row.command,
		html`${pill(row.status === 'rejected' ? 'rejected_operation' : row.status, words(row.status))} ${time(row.at)}`,
		[
			html`${row.actor} ·
			${row.subjects.length ? join(row.subjects.map(subjectLink), ' ') : html`<span class="muted">no subject</span>`}`,
			...(row.status === 'rejected'
				? [html`<span class="reason">${reasons(row.response).join(' ')}</span>`]
				: []),
			html`<span class="mono muted">${row.id}</span>`,
		]
	)
}

export function logPage(store: Store, params: URLSearchParams): Page {
	const spec = logSpec(store)
	const { page, state } = listPage(listState(params, spec), (query) => pagedOperations(store, query))
	return {
		title: 'Log',
		section: 'log',
		subjects: ['*'],
		address: listHref(spec, state),
		...pageTrail(spec, state, page.total, 'Log'),
		body: html`${heading('Log', 'Every write to the workspace.')} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(logRow))}`,
	}
}
