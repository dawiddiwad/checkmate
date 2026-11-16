import type { Store } from '../store.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import type { QueueGroup, QueueItem } from '../views.ts'
import { mergedClaims, mergedQuestions, needsYou, planDetail, runDetail } from '../views.ts'
import { html, pill, plural, time } from './html.ts'
import { banner } from './layout.ts'
import { actorField, emptyState, gapPanel, hidden, messages, rationaleField } from './forms.ts'
import { claimEvidenceList } from './exploration.ts'
import { counts } from './lists.ts'

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

function returnFields(item: QueueItem, back: string) {
	return html`<input type="hidden" name="item" value="${item.key}" />
		<input type="hidden" name="return" value="${back}" />`
}

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
	return html`${crumbs(item, filters, action)}
		<h2 class="q-h">${item.title}</h2>
		<p class="q-meta">
			${item.group === 'blocking' ? html`${pill('blocking')} ` : ''}Asked in
			${source}${item.since ? html` · ${time(item.since)} ago` : ''}${
				question && question.members.length > 1 ? html` · asked as ${question.members.join(', ')}` : ''
			}
		</p>
		${gapPanel(
			context,
			{
				action,
				cancel: queueHref(filters),
				sha256,
				title: '',
				question: '',
				staleMessage: `${item.planId} changed. Review the question before you answer.`,
				extra: returnFields(item, back),
			},
			state
		)}`
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
	const action = `/explorations/${claim.explorationId}/claims/${claim.id}`
	const steps = [claim.steps ?? []].flat()
	const verdict = state.values.verdict ?? ''
	const choice = (value: string, label: string) =>
		html`<input
				type="radio"
				id="verdict-${value}"
				name="verdict"
				value="${value}"
				required
				${verdict === value ? html`checked` : ''}
			/><label for="verdict-${value}">${label}</label>`
	return html`${crumbs(item, filters, action)}
		<h2 class="q-h">${claim.title}</h2>
		<p class="q-meta">
			${pill(claim.severity)} ${pill(claim.state)} Build <code>${claim.build}</code> ·
			<a href="/explorations/${claim.explorationId}">exploration ${claim.explorationId}</a> · reported by
			${claim.actors.join(', ')}
		</p>
		${claim.reason ? banner('warn', claim.reason) : ''}
		<div class="q-compare">
			<div>
				<p class="lab">Expected</p>
				<p>${claim.expected}</p>
			</div>
			<div>
				<p class="lab">Actual</p>
				<p>${claim.actual}</p>
			</div>
		</div>
		${
			steps.length
				? html`<p class="lab">Steps</p>
						<ol class="steps">
							${steps.map((step) => html`<li>${step}</li>`)}
						</ol>`
				: html`<p class="help">The tester gave no steps.</p>`
		}
		<p class="lab">Evidence</p>
		${claimEvidenceList(store, item.planId, claim)}
		<section class="panel decision" id="decide" aria-labelledby="decide-title" data-region="decision">
			<h3 class="lab" id="decide-title">Decision</h3>
			<div data-stale-slot>${messages(state)}</div>
			<form method="post" action="${action}" class="decision-form" data-claim-form>
				${hidden(context, '')} ${returnFields(item, back)}
				<fieldset class="seg-field">
					<legend class="lab">Is ${claim.id} a defect?</legend>
					<div class="seg">${choice('approved', 'Accept as a defect')}${choice('rejected', 'Reject')}</div>
				</fieldset>
				${rationaleField(state, 'Why do you decide this?')} ${actorField(context, state)}
				<div class="btns">
					<button class="btn primary" data-needs-rationale>Record decision</button>
					<span class="help"
						>Keys: <kbd>a</kbd> accept, <kbd>r</kbd> reject, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> send</span
					>
				</div>
			</form>
		</section>`
}

function outcomes(tests: Array<{ outcome: string | null }>) {
	const found: Record<string, number> = {}
	for (const test of tests) found[test.outcome ?? 'not_run'] = (found[test.outcome ?? 'not_run'] ?? 0) + 1
	return found
}

function approvalDetail(store: Store, item: QueueItem, filters: QueueFilters) {
	if (item.kind === 'result') {
		const detail = runDetail(store, item.runId!)
		const full = `/runs/${item.runId}#decide`
		return html`${crumbs(item, filters, full)}
			<h2 class="q-h">${item.runId} waits for acceptance</h2>
			<p class="q-meta">
				${item.planId}@${item.revision} · build <code>${detail.build}</code> · coverage
				${detail.result?.coverage ?? 'none'}
			</p>
			<p>${counts(outcomes(detail.tests))}</p>
			<p><a class="btn primary" href="${full}">Review and decide</a></p>`
	}
	const full = `/plans/${item.planId}@${item.revision}#decide`
	return html`${crumbs(item, filters, full)}
		<h2 class="q-h">
			${item.planId}@${item.revision} waits for ${item.state === 'rejected' ? 'a change' : 'approval'}
		</h2>
		<p>${item.title}</p>
		<p><a class="btn primary" href="${full}">Review and decide</a></p>`
}

function gone(filters: QueueFilters) {
	return html`<div class="empty">
		<p class="empty-title">This item does not wait for you now.</p>
		<p>Somebody decided it, or a filter hides it.</p>
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
	return approvalDetail(store, item, filters)
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
			? gone(filters)
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
