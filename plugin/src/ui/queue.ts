import type { Store } from '../store.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import type { QueueGroup, QueueItem } from '../views.ts'
import { mergedClaims, mergedQuestions, needsYou, planDetail, runDetail } from '../views.ts'
import { claimAddress, claimPane } from './claims.ts'
import { html, pill, plural, time } from './html.ts'
import { actorField, emptyState, hidden, keptText, messages, returnFields, sourceAndReason } from './forms.ts'
import { counts } from './lists.ts'
import { approvalPanel } from './plan.ts'
import { decisionPanel } from './run.ts'

export type QueueFilters = { plan: string; q: string }
export type QueueRefusal = { key: string; state: FormState }

type Waiting = ReturnType<typeof needsYou>

const groups: Array<{ group: QueueGroup; title: string; help: string }> = [
	{ group: 'blocking', title: 'Blocks testing', help: 'The testers wait for these answers.' },
	{ group: 'claims', title: 'Claims to decide', help: 'Suspected or unresolved. Accept or reject each.' },
	{ group: 'approvals', title: 'Approvals', help: 'Plans and results that wait for your decision.' },
	{ group: 'questions', title: 'Questions that do not block', help: 'Answer them when you have time.' },
]

export function queueFilters(params: URLSearchParams): QueueFilters {
	return { plan: params.get('plan')?.trim() ?? '', q: params.get('q')?.trim() ?? '' }
}

export function queueHref(filters: QueueFilters, key: string | null = null) {
	const params = new URLSearchParams()
	if (filters.plan) params.set('plan', filters.plan)
	if (filters.q) params.set('q', filters.q)
	if (key) params.set('item', key)
	const query = params.toString()
	return query ? `/?${query}` : '/'
}

function matches(item: QueueItem, filters: QueueFilters) {
	if (filters.plan && item.planId !== filters.plan) return false
	if (!filters.q) return true
	const text = `${item.planId} ${item.id} ${item.title} ${item.state ?? ''} ${item.severity ?? ''}`.toLowerCase()
	return filters.q
		.toLowerCase()
		.split(/\s+/)
		.every((word) => text.includes(word))
}

function groupTitle(group: QueueGroup) {
	return groups.find((item) => item.group === group)!.title
}

function badge(item: QueueItem) {
	if (item.kind === 'claim') return html`${pill(item.severity!)} ${pill(item.state!)}`
	if (item.kind === 'plan') return pill(item.state === 'rejected' ? 'rejected' : 'pending', 'plan')
	if (item.kind === 'result') return pill('pending', 'result')
	return ''
}

function row(item: QueueItem, filters: QueueFilters, selected: string | null) {
	const current = item.key === selected ? html` aria-current="true"` : ''
	return html`<li>
		<a
			class="q-row"
			href="${queueHref(filters, item.key)}"
			data-queue-link
			data-nav-item
			data-key="${item.key}"
			${current}
		>
			<span class="q-top"
				><span class="q-id"
					>${item.planId} · ${item.kind === 'plan' ? `revision ${item.revision}` : item.id}</span
				>
				<span class="q-tags"
					>${badge(item)}${item.since ? html` <span class="age">${time(item.since)}</span>` : ''}</span
				></span
			>
			<span class="q-title">${item.title}</span>
		</a>
	</li>`
}

function groupList(group: (typeof groups)[number], items: QueueItem[], filters: QueueFilters, selected: string | null) {
	if (!items.length) return ''
	const list = html`<ul class="q-items">
		${items.map((item) => row(item, filters, selected))}
	</ul>`
	const head = html`<span class="q-group-title">${group.title}</span> <span class="n">${items.length}</span>`
	if (group.group !== 'questions')
		return html`<section class="q-group" aria-labelledby="q-${group.group}">
			<h2 class="q-group-h" id="q-${group.group}">${head}</h2>
			${list}
		</section>`
	const open = filters.q || items.some((item) => item.key === selected) ? html` open` : ''
	return html`<details class="q-group q-fold" data-open-key="queue:questions" ${open}>
		<summary class="q-group-h">${head} <span class="q-fold-note">${group.help}</span></summary>
		${list}
	</details>`
}

function exploring(waiting: Waiting) {
	const running = waiting.running.map(
		(item) =>
			html`<li data-key="running:${item.explorationId}">
				<a href="/explorations/${item.explorationId}"
					>${item.paused ? pill('stopped', 'paused') : pill('running')}
					<span class="mono">${item.planId} · ${item.explorationId}</span></a
				>
				<span class="muted"
					>${item.paused ? html`Waits for you in Claude Code: ${item.paused}` : html`${item.state} on build ${item.build}`}</span
				>
			</li>`
	)
	const failed = waiting.failed.map(
		(item) =>
			html`<li data-key="failed:${item.explorationId}">
				<a href="/explorations/${item.explorationId}"
					>${pill(item.state)} <span class="mono">${item.planId} · ${item.explorationId}</span></a
				>
				<span class="muted">${item.reason ?? ''}</span>
			</li>`
	)
	if (!running.length && !failed.length) return ''
	return html`<section class="q-now" aria-labelledby="q-now">
		<h2 class="q-group-h" id="q-now">Explorations</h2>
		<ul class="q-now-list">
			${running} ${failed}
		</ul>
	</section>`
}

function filterForm(waiting: Waiting, filters: QueueFilters) {
	const plans = [...new Set(waiting.items.map((item) => item.planId))].sort()
	return html`<form class="q-filters" method="get" action="/" role="search" data-queue-filter>
		<label class="sr-only" for="queue-q">Search the items</label>
		<input
			id="queue-q"
			type="search"
			name="q"
			value="${filters.q}"
			placeholder="Search"
			autocomplete="off"
			data-search
		/>
		<label class="sr-only" for="queue-plan">Plan</label>
		<select id="queue-plan" name="plan">
			<option value="">All plans</option>
			${plans.map(
				(plan) => html`<option value="${plan}" ${plan === filters.plan ? html`selected` : ''}>${plan}</option>`
			)}
		</select>
		<button class="btn small" data-queue-submit>Filter</button>
	</form>`
}

function crumbs(item: QueueItem, filters: QueueFilters, full: string) {
	return html`<div class="q-crumbs">
		<nav aria-label="Breadcrumb">
			<ol>
				<li><a href="${queueHref(filters)}" data-queue-back>Needs you</a></li>
				<li>${groupTitle(item.group)}</li>
				<li><a href="/plans/${item.planId}">${item.planId}</a></li>
				<li aria-current="page">${item.kind === 'plan' ? `revision ${item.revision}` : item.id}</li>
			</ol>
		</nav>
		<a class="btn small ghost" href="${full}">Open full page</a>
	</div>`
}

const kinds = [
	{ value: 'clarify', label: 'Clarify', key: 'c', help: 'Clarify gives the expected behaviour.' },
	{
		value: 'accept_assumption',
		label: 'Accept assumption',
		key: 's',
		help: 'Tests run on your answer as an assumption.',
	},
	{
		value: 'defer',
		label: 'Defer',
		key: 'd',
		help: 'Defer moves the question out of this scope. No answer is needed.',
	},
]

function questionDetail(
	store: Store,
	context: Context,
	item: QueueItem,
	filters: QueueFilters,
	back: string,
	state: FormState
) {
	const question = mergedQuestions(store, item.planId).find((entry) => entry.id === item.id)
	const action = item.explorationId
		? `/explorations/${item.explorationId}/questions/${item.id}`
		: `/plans/${item.planId}@${planDetail(store, item.planId).latestRevision}/gaps/${item.id}`
	const sha256 = item.explorationId ? '' : planDetail(store, item.planId).sha256
	const source = item.explorationId
		? html`<a href="/explorations/${item.explorationId}">exploration ${item.explorationId}</a>`
		: item.runId
			? html`<a href="/runs/${item.runId}">run ${item.runId}</a>`
			: html`<a href="/plans/${item.planId}">plan ${item.planId}</a>`
	const selected = state.values.kind || 'clarify'
	return html`${crumbs(item, filters, action)}
		<h2 class="q-h">${item.title}</h2>
		<p class="q-meta">
			${item.group === 'blocking' ? html`${pill('blocking')} ` : ''}Asked in
			${source}${item.since ? html` · ${time(item.since)} ago` : ''}${
				question && question.members.length > 1 ? html` · asked as ${question.members.join(', ')}` : ''
			}
		</p>
		<section class="panel decision" id="answer" aria-labelledby="answer-title" data-region="decision">
			<h3 class="lab" id="answer-title">Your answer</h3>
			<div data-stale-slot>${messages(state)}</div>
			<form method="post" action="${action}" class="decision-form gap-form" data-quick-form>
				${hidden(context, sha256)} ${returnFields(item, back)}
				<fieldset class="seg-field">
					<legend class="sr-only">Kind of answer</legend>
					<div class="seg">
						${kinds.map(
							(kind) =>
								html`<input
										type="radio"
										id="kind-${kind.value}"
										name="kind"
										value="${kind.value}"
										${selected === kind.value ? html`checked` : ''}
									/><label for="kind-${kind.value}">${kind.label} <kbd>${kind.key}</kbd></label>`
						)}
					</div>
				</fieldset>
				${kinds.map((kind) => html`<p class="help kind-help" data-kind="${kind.value}">${kind.help}</p>`)}
				<label class="sr-only" for="value">Answer</label>
				<textarea id="value" name="value" rows="2" placeholder="Type the answer">
${state.values.value ?? ''}</textarea>
				${sourceAndReason(context, state, 'Reason')} ${actorField(context, state)}
				<div class="btns">
					<button class="btn primary">Record answer</button>
					<span class="help"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends. <kbd>d</kbd> defers at once.</span>
				</div>
			</form>
		</section>`
}

function claimDetail(
	store: Store,
	context: Context,
	item: QueueItem,
	filters: QueueFilters,
	back: string,
	state: FormState
) {
	const claim = mergedClaims(store, item.planId).find((entry) => entry.id === item.id)
	if (!claim) return gone(filters)
	return claimPane(store, context, item.planId, claim, crumbs(item, filters, claimAddress(claim)), {
		key: item.key,
		back,
		state,
	})
}

function outcomes(tests: Array<{ outcome: string | null }>) {
	const found: Record<string, number> = {}
	for (const test of tests) found[test.outcome ?? 'not_run'] = (found[test.outcome ?? 'not_run'] ?? 0) + 1
	return found
}

function approvalDetail(
	store: Store,
	context: Context,
	item: QueueItem,
	filters: QueueFilters,
	back: string,
	state: FormState | null
) {
	const extra = returnFields(item, back)
	if (item.kind === 'result') {
		const detail = runDetail(store, item.runId!)
		const findings = detail.findings.filter((finding) => finding.type === 'defect')
		return html`${crumbs(item, filters, `/runs/${item.runId}`)}
			<h2 class="q-h">Accept the result of ${item.runId}?</h2>
			<p class="q-meta">
				${item.planId}@${item.revision} · build <code>${detail.build}</code> · coverage
				${detail.result?.coverage ?? 'none'} · ${counts(outcomes(detail.tests))}
			</p>
			${
				findings.length
					? html`<p class="lab">Defects</p>
							<ul class="plain">
								${findings.map((finding) => html`<li>${pill(finding.severity)} ${finding.title}</li>`)}
							</ul>`
					: ''
			}
			${decisionPanel(store, context, detail, state, extra)}`
	}
	const detail = planDetail(store, item.planId, item.revision)
	return html`${crumbs(item, filters, `/plans/${item.planId}@${item.revision}`)}
		<h2 class="q-h">
			${item.state === 'rejected' ? 'Change or approve' : 'Approve'} ${item.planId}@${item.revision}?
		</h2>
		<p class="q-meta">${detail.plan.objective}</p>
		<ul class="plain">
			${detail.plan.tests.map((test) => html`<li>${pill(test.readiness)} <span class="mono">${test.id}</span> ${test.title}</li>`)}
		</ul>
		${approvalPanel(store, context, detail, state, extra)}`
}

function gone(filters: QueueFilters, state: FormState = emptyState()) {
	return html`<div class="empty">
		${messages(state)}
		<p class="empty-title">This item does not wait for you now.</p>
		<p>Somebody decided it, or a filter hides it.</p>
		${keptText(state)}
		<p><a href="${queueHref(filters)}" data-queue-back>Back to the list</a></p>
	</div>`
}

function nothing(waiting: Waiting, filters: QueueFilters) {
	const filtered = filters.plan || filters.q
	return html`<div class="empty">
		<p class="empty-title">${filtered ? 'No item matches these filters.' : 'Nothing waits for you.'}</p>
		${
			filtered
				? html`<p><a href="/" data-queue-back>Clear the filters</a></p>`
				: html`<p>${plural(waiting.running.length, 'exploration')} running. The list updates by itself.</p>`
		}
	</div>`
}

function detail(
	store: Store,
	context: Context,
	waiting: Waiting,
	item: QueueItem | null,
	filters: QueueFilters,
	back: string,
	state: FormState
) {
	if (!item) return nothing(waiting, filters)
	if (item.kind === 'question' || item.kind === 'gap')
		return questionDetail(store, context, item, filters, back, state)
	if (item.kind === 'claim') return claimDetail(store, context, item, filters, back, state)
	return approvalDetail(
		store,
		context,
		item,
		filters,
		back,
		state.values.verdict || state.error || state.stale ? state : null
	)
}

export function queuePage(
	store: Store,
	context: Context,
	params: URLSearchParams,
	refusal: QueueRefusal | null = null
): Page {
	const waiting = needsYou(store)
	const filters = queueFilters(params)
	const shown = waiting.items.filter((item) => matches(item, filters))
	const asked = refusal?.key ?? params.get('item')
	const item = asked ? (shown.find((entry) => entry.key === asked) ?? null) : (shown[0] ?? null)
	const index = item ? shown.indexOf(item) : -1
	const next = shown[index + 1] ?? shown[index - 1] ?? null
	const back = queueHref(filters, next?.key ?? null)
	const open = asked ? html` data-open` : ''
	const urgent = waiting.urgent
	const sub = urgent
		? `${plural(urgent, 'item')} ${urgent === 1 ? 'needs' : 'need'} your decision. The most urgent is first.`
		: 'No decision waits for you.'
	const list = html`<section class="q-list" aria-labelledby="queue-title" data-region="queue-list">
		<div class="q-head">
			<h1 id="queue-title">Needs you</h1>
			<p class="sub">${sub}</p>
		</div>
		${filterForm(waiting, filters)} ${exploring(waiting)}
		${groups.map((group) =>
			groupList(
				group,
				shown.filter((entry) => entry.group === group.group),
				filters,
				item?.key ?? null
			)
		)}
		${shown.length ? '' : html`<p class="none">${filters.plan || filters.q ? 'No item matches these filters.' : 'Nothing waits for you.'}</p>`}
		<p class="q-foot"><a href="/inbox">Show all items as one list</a></p>
	</section>`
	const pane =
		asked && !item
			? gone(filters, refusal?.state)
			: detail(store, context, waiting, item, filters, back, refusal?.state ?? emptyState())
	return {
		title: item ? `${item.planId} · ${item.id} · Needs you` : 'Needs you',
		section: 'inbox',
		subjects: ['*'],
		status: refusal ? 422 : undefined,
		body: html`<div class="queue" data-queue data-selected="${item?.key ?? ''}" ${open}>
			${list}
			<section
				class="q-detail"
				aria-label="Selected item"
				tabindex="-1"
				data-region="queue-detail"
				data-key="detail:${item?.key ?? ''}"
			>
				${pane}
			</section>
		</div>`,
	}
}

export function queueCount(store: Store) {
	return needsYou(store).urgent
}
