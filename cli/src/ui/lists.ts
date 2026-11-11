import type { ListOptions } from '../../../plugin/src/views.ts'
import type { Store } from '../../../plugin/src/store.ts'
import type { Html } from './html.ts'
import type { Page } from './layout.ts'
import {
	inbox,
	listOptions,
	listTimestamp,
	operationActors,
	operationLogPage,
	planDetail,
	planList,
	planListPage,
	runDetail,
	runList,
	runListPage,
} from '../../../plugin/src/views.ts'
import { html, join, pill, plural, time, words } from './html.ts'
import { heading } from './layout.ts'

type Waiting = ReturnType<typeof inbox>

export function inboxItems(waiting: Waiting) {
	return [
		...waiting.gaps.map((gap) => `/plans/${gap.planId}@${gap.revision}/gaps/${gap.gapId}#answer`),
		...waiting.plans.map((plan) => `/plans/${plan.planId}@${plan.revision}#decide`),
		...waiting.results.map((result) => `/runs/${result.runId}#decide`),
	]
}

export function inboxCount(waiting: Waiting) {
	return waiting.gaps.length + waiting.plans.length + waiting.results.length
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
				html`<span class="st ${countLook[key][1]}" title="${values[key]} ${words(key)}"
					><span aria-hidden="true">${countLook[key][0]}</span> ${values[key]}<span class="sr-only">
						${words(key)}</span
					></span
				>`
		)}</span
	>`
}

function group(title: string, items: Html[], key: string) {
	return html`<section class="group" aria-labelledby="group-${key}">
		<h2 class="group-h" id="group-${key}">${title} · ${items.length}</h2>
		${
			items.length
				? html`<ul class="items">
						${items.map((item) => html`<li>${item}</li>`)}
					</ul>`
				: html`<p class="none">None.</p>`
		}
	</section>`
}

export function inboxPage(store: Store): Page {
	const waiting = inbox(store)
	const total = inboxCount(waiting)
	const gaps = waiting.gaps.map(
		(gap) =>
			html`<a
				class="item"
				href="/plans/${gap.planId}@${gap.revision}/gaps/${gap.gapId}#answer"
				data-nav-item
				data-key="gap:${gap.planId}:${gap.gapId}"
				data-announce="New gap ${gap.planId} ${gap.gapId}"
			>
				<span class="id">${gap.planId} · ${gap.gapId}</span>
				<span class="what">${gap.question}</span>
				<span class="end">${pill(gap.severity)} <span class="age">${time(gap.since)}</span></span>
			</a>`
	)
	const plans = waiting.plans.map(
		(plan) =>
			html`<a
				class="item"
				href="/plans/${plan.planId}@${plan.revision}#decide"
				data-nav-item
				data-key="plan:${plan.planId}@${plan.revision}"
				data-announce="${plan.planId}@${plan.revision} waits for approval"
			>
				<span class="id">${plan.planId}@${plan.revision}</span>
				<span class="what">${plan.summary}</span>
				<span class="end"><span class="age">${time(plan.since)}</span></span>
			</a>`
	)
	const results = waiting.results.map(
		(result) =>
			html`<a
				class="item"
				href="/runs/${result.runId}#decide"
				data-nav-item
				data-key="run:${result.runId}"
				data-announce="${result.runId} waits for acceptance"
			>
				<span class="id">${result.runId}</span>
				<span class="what"
					>${result.planId}@${result.revision} · build <code>${result.build}</code> · ${counts(result.counts)}
					· coverage ${result.coverage}</span
				>
				<span class="end"><span class="age">${time(result.since)}</span></span>
			</a>`
	)
	const sub = total ? `${plural(total, 'item')} ${total === 1 ? 'waits' : 'wait'} for you, oldest first.` : null
	const body = total
		? html`${group('Gaps to answer', gaps, 'gaps')} ${group('Plans to approve', plans, 'plans')}
			${group('Results to accept', results, 'results')}`
		: emptyInbox(store)
	return {
		title: 'Inbox',
		section: 'inbox',
		subjects: ['inbox'],
		body: html`${heading('Inbox', sub)}
			<div class="stack" data-region="inbox" data-list>${body}</div>`,
	}
}

function emptyInbox(store: Store) {
	const latest = runList(store).slice(-3).reverse()
	return html`<div class="empty">
		<p class="empty-title">Nothing waits for you.</p>
		${
			latest.length
				? html`<p>Latest runs:</p>
						<ul class="items">
							${latest.map(
								(run) =>
									html`<li>
										<a class="item" href="/runs/${run.runId}" data-nav-item
											><span class="id">${run.runId}</span
											><span class="what"
												>${run.planId}@${run.revision} · build <code>${run.build}</code></span
											><span class="end">${pill(run.acceptance ?? run.state)}</span></a
										>
									</li>`
							)}
						</ul>`
				: ''
		}
		<p><a href="/runs">All runs</a></p>
	</div>`
}

export type PlanFilters = ListOptions & { q: string; show: string }

const planShows = [
	['all', 'All plans'],
	['needs_decision', 'Open gaps'],
	['awaiting_approval', 'Awaiting approval'],
	['blocked', 'Blocked'],
]

function options(choices: string[][], selected: string) {
	return choices.map(
		([value, label]) => html`<option value="${value}" ${value === selected ? html`selected` : ''}>${label}</option>`
	)
}

function filterBar(fields: Html, reset: string, active: boolean) {
	return html`<form class="filters" method="get" role="search" data-list-filters>
		${fields}
		<button class="btn">Filter</button>
		${active ? html`<a class="btn ghost" href="${reset}" data-list-link>Clear</a>` : ''}
	</form>`
}

function testSummary(plan: ReturnType<typeof planDetail>['plan']) {
	const count = (readiness: string) => plan.tests.filter((test) => test.readiness === readiness).length
	return html`${plural(plan.tests.length, 'test')}
		<span class="muted"
			>· ${count('ready')}
			ready${count('blocked') ? ` · ${count('blocked')} blocked` : ''}${
				count('deferred') ? ` · ${count('deferred')} deferred` : ''
			}</span
		>`
}

export function plansPage(store: Store, filters: PlanFilters): Page {
	const result = planListPage(store, filters)
	const { rows } = result
	const fields = html`<label class="sr-only" for="q">Search plans</label>
		<input id="q" type="search" name="q" value="${filters.q}" placeholder="Search all columns" data-search />
		<label class="sr-only" for="show">Show</label>
		<select id="show" name="show">
			${options(planShows, filters.show)}
		</select>`
	const table = rows.length
		? html`<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Plan</th>
							<th scope="col">Tests</th>
							<th scope="col">Open gaps</th>
							<th scope="col">Approval</th>
							<th scope="col">Blocks</th>
							${sortHeading('Updated', '/plans', filters)}
						</tr>
					</thead>
					<tbody>
						${rows.map((row) => {
							const detail = row
							return html`<tr data-key="plan:${row.planId}" data-nav-row>
								<td>
									<a class="mono" href="/plans/${row.planId}@${row.revision}" data-nav-item
										>${row.planId}@${row.revision}</a
									>
								</td>
								<td>${testSummary(detail.plan)}</td>
								<td>
									${
										row.openGaps.length
											? join(
													row.openGaps.map(
														(id) =>
															html`<a
																class="mono"
																href="/plans/${row.planId}@${row.revision}/gaps/${id}"
																>${id}${row.openBlockingGaps.includes(id) ? html`<span class="sr-only"> blocking</span>` : ''}</a
															>`
													),
													', '
												)
											: html`<span class="muted">none</span>`
									}
								</td>
								<td>${pill(row.approval)}</td>
								<td>
									${
										row.blocked.length
											? html`<ul class="plain">
													${row.blocked.map(
														(block) =>
															html`<li>
																<span class="mono">${block.testId}</span> by
																<span class="mono">${block.dependency}</span>:
																${block.cause}
															</li>`
													)}
												</ul>`
											: html`<span class="muted">none</span>`
									}
								</td>
								<td class="nowrap">${time(row.since, listTimestamp(row.since))}</td>
							</tr>`
						})}
					</tbody>
				</table>
			</div>`
		: html`<p class="empty-line">No plan matches these filters.</p>`
	return {
		title: 'Plans',
		section: 'plans',
		subjects: ['*'],
		body: html`${heading('Plans', 'Each plan at its latest revision.')}
			${filterBar(html`${fields}${pageSize(filters)}`, '/plans', Boolean(filters.q || filters.show !== 'all'))}
			<div data-region="plans" data-list>${table}${pagination('/plans', filters, result)}</div>`,
	}
}

export type RunFilters = ListOptions & { plan: string; build: string; status: string }

const runStatuses = [
	['all', 'All runs'],
	['started', 'In progress'],
	['pending', 'Awaiting acceptance'],
	['approved', 'Accepted'],
	['rejected', 'Rejected'],
]

function runStatus(row: ReturnType<typeof runList>[number]) {
	if (row.state === 'started') return pill('started', 'in progress')
	if (row.acceptance === 'approved') return pill('approved', 'accepted')
	if (row.acceptance === 'pending') return pill('pending', 'awaiting acceptance')
	return pill(row.acceptance ?? 'finalized')
}

export function runOutcomeCounts(store: Store, runId: string) {
	const values: Record<string, number> = {}
	for (const test of runDetail(store, runId).tests)
		if (test.outcome) values[test.outcome] = (values[test.outcome] ?? 0) + 1
	return values
}

export function runsPage(store: Store, filters: RunFilters): Page {
	const result = runListPage(store, filters)
	const { rows } = result
	const plans = planList(store).map((row) => [row.planId, row.planId])
	const fields = html`${searchField(filters.q)}<label class="sr-only" for="plan">Plan</label>
		<select id="plan" name="plan">
			${options([['', 'All plans'], ...plans], filters.plan)}
		</select>
		<label class="sr-only" for="build">Build</label>
		<input id="build" type="search" name="build" value="${filters.build}" placeholder="Build" data-search />
		<label class="sr-only" for="status">Status</label>
		<select id="status" name="status">
			${options(runStatuses, filters.status)}
		</select>`
	const table = rows.length
		? html`<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Run</th>
							<th scope="col">Plan</th>
							<th scope="col">Build</th>
							<th scope="col">Tests</th>
							<th scope="col">Completion</th>
							<th scope="col">Coverage</th>
							<th scope="col">Status</th>
							${sortHeading('Started', '/runs', filters)}
						</tr>
					</thead>
					<tbody>
						${rows.map(
							(row) =>
								html`<tr data-key="run:${row.runId}" data-nav-row>
									<td><a class="mono" href="/runs/${row.runId}" data-nav-item>${row.runId}</a></td>
									<td>
										<a class="mono" href="/plans/${row.planId}@${row.revision}"
											>${row.planId}@${row.revision}</a
										>
									</td>
									<td class="mono">${row.build}</td>
									<td>${counts(row.counts)}</td>
									<td>
										${row.completion ? pill(row.completion) : html`<span class="muted">running</span>`}
									</td>
									<td>${row.coverage ? pill(row.coverage) : html`<span class="muted">–</span>`}</td>
									<td>${runStatus(row)}</td>
									<td class="nowrap">${time(row.startedAt, listTimestamp(row.startedAt))}</td>
								</tr>`
						)}
					</tbody>
				</table>
			</div>`
		: html`<p class="empty-line">No run matches these filters.</p>`
	return {
		title: 'Runs',
		section: 'runs',
		subjects: ['*'],
		body: html`${heading('Runs', 'Test execution and results.')}
			${filterBar(html`${fields}${pageSize(filters)}`, '/runs', Boolean(filters.q || filters.plan || filters.build || filters.status !== 'all'))}
			<div data-region="runs" data-list>${table}${pagination('/runs', filters, result)}</div>`,
	}
}

export type LogFilters = ListOptions & { subject: string; actor: string }

export function subjectLink(subject: string) {
	const [kind, id] = subject.split(/:(.*)/)
	if (kind === 'plan') return html`<a class="mono" href="/plans/${id}">${subject}</a>`
	if (kind === 'run') return html`<a class="mono" href="/runs/${id}">${subject}</a>`
	if (kind === 'inbox') return html`<a class="mono" href="/">${subject}</a>`
	return html`<span class="mono">${subject}</span>`
}

function reasons(response: unknown) {
	const list = (response as { reasons?: unknown })?.reasons
	return Array.isArray(list) ? list.map(String) : []
}

export function logPage(store: Store, filters: LogFilters): Page {
	const result = operationLogPage(store, filters)
	const actors = operationActors(store)
	const { rows } = result
	const fields = html`${searchField(filters.q)}<label class="sr-only" for="subject">Subject</label>
		<input
			id="subject"
			type="search"
			name="subject"
			value="${filters.subject}"
			placeholder="Subject: plan:checkout"
			data-search
		/>
		<label class="sr-only" for="actor-filter">Actor</label>
		<select id="actor-filter" name="actor">
			${options([['', 'All actors'], ...actors.map((actor) => [actor, actor])], filters.actor)}
		</select>`
	const table = rows.length
		? html`<div class="scroll">
				<table class="log">
					<thead>
						<tr>
							${sortHeading('Time', '/log', filters)}
							<th scope="col">Actor</th>
							<th scope="col">Command</th>
							<th scope="col">Status</th>
							<th scope="col">Subjects</th>
							<th scope="col">Operation</th>
						</tr>
					</thead>
					<tbody>
						${rows.map(
							(row) =>
								html`<tr data-key="op:${row.rowid}">
									<td class="nowrap">${time(row.at, listTimestamp(row.at))}</td>
									<td>${row.actor}</td>
									<td>
										<span class="mono">${row.command}</span>
										${
											row.status === 'rejected'
												? html`<div class="reason">${reasons(row.response).join(' ')}</div>`
												: ''
										}
									</td>
									<td>
										${pill(row.status === 'rejected' ? 'rejected_operation' : row.status, words(row.status))}
									</td>
									<td>
										${row.subjects.length ? join(row.subjects.map(subjectLink), ' ') : html`<span class="muted">none</span>`}
									</td>
									<td class="mono muted">${row.id}</td>
								</tr>`
						)}
					</tbody>
				</table>
			</div>`
		: html`<p class="empty-line">No operation matches these filters.</p>`
	return {
		title: 'Log',
		section: 'log',
		subjects: ['*'],
		body: html`${heading('Log', 'Every recorded write.')}
			${filterBar(html`${fields}${pageSize(filters)}`, '/log', Boolean(filters.q || filters.subject || filters.actor))}
			<div data-region="log" data-list>${table}${pagination('/log', filters, result)}</div>`,
	}
}

function listUrl(path: string, filters: object, changes: Record<string, string | number>) {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries({ ...filters, ...changes }))
		if (value !== undefined && value !== '') params.set(key, String(value))
	return `${path}?${params}`
}

function searchField(query = '') {
	return html`<label class="sr-only" for="q">Search all columns</label>
		<input id="q" name="q" type="search" value="${query}" placeholder="Search all columns" data-search />`
}

function pageSize(filters: ListOptions) {
	const selected = listOptions(filters)
	return html`<label for="size">Rows</label>
		<select id="size" name="size">
			${options(
				['25', '50', '100'].map((size) => [size, size]),
				String(selected.size)
			)}
		</select>
		<input type="hidden" name="order" value="${selected.order}" />`
}

function sortHeading(label: string, path: string, filters: ListOptions) {
	const ascending = filters.order === 'asc'
	return html`<th scope="col" aria-sort="${ascending ? 'ascending' : 'descending'}">
		<a
			href="${listUrl(path, filters, { order: ascending ? 'desc' : 'asc', page: 1 })}"
			data-list-link
			aria-label="Sort ${label.toLowerCase()} ${ascending ? 'newest' : 'oldest'} first"
			>${label} ${ascending ? '↑' : '↓'}</a
		>
	</th>`
}

function pagination(
	path: string,
	filters: ListOptions,
	result: { page: number; pages: number; size: number; total: number }
) {
	const { page, pages, size, total } = result
	return html`<nav class="pagination" aria-label="Pagination">
		<span data-list-count>${total ? (page - 1) * size + 1 : 0}–${Math.min(page * size, total)} of ${total}</span>
		<span>Page ${page} of ${pages}</span>
		${page > 1 ? html`<a class="btn" href="${listUrl(path, filters, { page: page - 1 })}" data-list-link>Previous</a>` : ''}
		${page < pages ? html`<a class="btn" href="${listUrl(path, filters, { page: page + 1 })}" data-list-link>Next</a>` : ''}
	</nav>`
}
