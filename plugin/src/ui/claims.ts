import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import type { Claim } from '../journal.ts'
import { claimsAcross } from '../views.ts'
import { html, pill, plural, time } from './html.ts'
import { banner, listAndItem } from './layout.ts'
import type { BulkState, Picked } from './bulk.ts'
import { bulkBar, bulkPanel, pickBox } from './bulk.ts'
import { actorField, emptyState, hidden, keptText, messages, recordPanel, returnFields } from './forms.ts'
import { claimEvidenceList } from './exploration.ts'

export type ClaimFilters = {
	q: string
	state: string
	severity: string
	plan: string
	build: string
	since: string
	limit: string
	picks: string[]
}
export type ClaimRefusal = { key: string; state: FormState }
type Row = ReturnType<typeof claimsAcross>[number]

const states = ['suspected', 'unresolved', 'observed', 'confirmed', 'accepted', 'rejected']
const severities = ['critical', 'high', 'medium', 'low']
const periods = [
	['1', 'Last 24 hours'],
	['7', 'Last 7 days'],
	['14', 'Last 14 days'],
	['30', 'Last 30 days'],
]
const names = ['q', 'state', 'severity', 'plan', 'build', 'since'] as const

export function claimAddress(claim: { explorationId: string; id: string }) {
	return `/explorations/${claim.explorationId}/claims/${claim.id}`
}

export function claimKey(planId: string, claimId: string) {
	return `claim:${planId}:${claimId}`
}

export function claimFilters(params: URLSearchParams): ClaimFilters {
	const value = (name: string) => params.get(name)?.trim() ?? ''
	return {
		q: value('q'),
		state: states.includes(value('state')) ? value('state') : '',
		severity: severities.includes(value('severity')) ? value('severity') : '',
		plan: value('plan'),
		build: value('build'),
		since: periods.some(([days]) => days === value('since')) ? value('since') : '',
		limit: /^[1-9][0-9]{0,5}$/.test(value('limit')) ? value('limit') : '',
		picks: params.getAll('pick'),
	}
}

export function claimsHref(filters: Partial<ClaimFilters>, key: string | null = null, list = false) {
	const params = new URLSearchParams()
	for (const name of names) if (filters[name]) params.set(name, filters[name])
	if (key) params.set('item', key)
	if (filters.limit) params.set('limit', filters.limit)
	for (const pick of filters.picks ?? []) params.append('pick', pick)
	if (key && list) params.set('view', 'list')
	const query = params.toString()
	return query ? `/claims?${query}` : '/claims'
}

function matches(row: Row, filters: ClaimFilters, now: number) {
	if (filters.state && row.state !== filters.state) return false
	if (filters.severity && row.severity !== filters.severity) return false
	if (filters.plan && row.planId !== filters.plan) return false
	if (filters.build && row.build !== filters.build) return false
	if (filters.since && now - Date.parse(row.foundAt) > Number(filters.since) * 24 * 3600 * 1000) return false
	if (!filters.q) return true
	const text = [row.planId, row.id, row.title, row.expected, row.actual, row.build, row.explorationId, row.state]
		.join(' ')
		.toLowerCase()
	return filters.q
		.toLowerCase()
		.split(/\s+/)
		.every((word) => text.includes(word))
}

export function claimPane(
	store: Store,
	context: Context,
	planId: string,
	claim: Claim,
	crumbs: Html,
	form: { key: string; back: string; state: FormState }
) {
	const steps = [claim.steps ?? []].flat()
	const state = form.state
	const decision = claim.decision
		? recordPanel(
				'Decision',
				html`<div data-stale-slot>${messages(state)}</div>
					<p class="subj">${pill(claim.state)} ${claim.id}</p>
					<p class="help">By ${claim.decision.actor}. Reason: ${claim.decision.rationale}</p>
					${keptText(state)}`
			)
		: html`<section class="panel decision" id="decide" aria-labelledby="decide-title" data-region="decision">
				<h3 class="lab" id="decide-title">Is ${claim.id} a defect?</h3>
				<div data-stale-slot>${messages(state)}</div>
				<form method="post" action="${claimAddress(claim)}" class="decision-form" data-quick-claim>
					${hidden(context, '')} ${returnFields(form, form.back)}
					<label class="lab" for="rationale">Reason <span class="req">needed to reject</span></label>
					<textarea id="rationale" name="rationale" rows="2" placeholder="Optional to accept">
${state.values.rationale ?? ''}</textarea>
					${actorField(context, state)}
					<div class="btns">
						<button class="btn primary" name="verdict" value="approved">
							Accept as a defect <kbd aria-hidden="true">a</kbd>
						</button>
						<button class="btn" name="verdict" value="rejected">
							Reject <kbd aria-hidden="true">r</kbd>
						</button>
					</div>
				</form>
			</section>`
	return html`${crumbs}
		<h2 class="q-h">${claim.title}</h2>
		<p class="q-meta">
			${pill(claim.severity)} ${pill(claim.state)} Build <code>${claim.build}</code> ·
			<a href="/explorations/${claim.explorationId}">exploration ${claim.explorationId}</a> · reported by
			${claim.actors.join(', ')}
		</p>
		${claim.reason && !claim.decision ? banner('warn', claim.reason) : ''}
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
		${claimEvidenceList(store, planId, claim)} ${decision}`
}

function select(name: string, label: string, all: string, choices: string[][], value: string) {
	return html`<label class="sr-only" for="claims-${name}">${label}</label>
		<select id="claims-${name}" name="${name}">
			<option value="">${all}</option>
			${choices.map(
				([choice, text]) =>
					html`<option value="${choice}" ${choice === value ? html`selected` : ''}>${text}</option>`
			)}
		</select>`
}

function filterForm(rows: Row[], filters: ClaimFilters) {
	const plans = [...new Set(rows.map((row) => row.planId))].sort().map((plan) => [plan, plan])
	const builds = [...new Set(rows.map((row) => row.build))].sort().map((build) => [build, build])
	return html`<form class="q-filters" method="get" action="/claims" role="search" data-queue-filter>
		<label class="sr-only" for="claims-q">Search the claims</label>
		<input
			id="claims-q"
			type="search"
			name="q"
			value="${filters.q}"
			placeholder="Search title, expected, actual"
			autocomplete="off"
			data-search
		/>
		${select(
			'state',
			'State',
			'Any state',
			states.map((state) => [state, state]),
			filters.state
		)}
		${select(
			'severity',
			'Severity',
			'Any severity',
			severities.map((severity) => [severity, severity]),
			filters.severity
		)}
		${select('plan', 'Plan', 'All plans', plans, filters.plan)}
		${select('build', 'Build', 'All builds', builds, filters.build)}
		${select('since', 'Found', 'Any time', periods, filters.since)}
		<button class="btn small" data-queue-submit>Filter</button>
	</form>`
}

function row(item: Row, filters: ClaimFilters, selected: string | null) {
	const key = claimKey(item.planId, item.id)
	return html`<li class="q-li">
		${item.decision ? html`<span></span>` : pickBox(key, `${item.planId} ${item.id}`, filters.picks.includes(key))}
		<a
			class="q-row"
			href="${claimsHref(filters, key)}"
			data-queue-link
			data-nav-item
			data-key="${key}"
			${key === selected ? html`aria-current="true"` : ''}
		>
			<span class="q-top"
				><span class="q-id">${item.planId} · ${item.id}</span>
				<span class="q-tags"
					>${pill(item.severity)} ${pill(item.state)} <span class="age">${time(item.foundAt)}</span></span
				></span
			>
			<span class="q-title">${item.title}</span>
		</a>
	</li>`
}

function crumbs(item: Row, filters: ClaimFilters) {
	return html`<div class="q-crumbs">
		<nav aria-label="Breadcrumb">
			<ol>
				<li>
					<a href="${claimsHref(filters, claimKey(item.planId, item.id), true)}" data-queue-back>Claims</a>
				</li>
				<li><a href="/plans/${item.planId}">${item.planId}</a></li>
				<li><a href="/explorations/${item.explorationId}">${item.explorationId}</a></li>
				<li aria-current="page">${item.id}</li>
			</ol>
		</nav>
		<a class="btn small ghost" href="${claimAddress(item)}">Open full page</a>
	</div>`
}

const shownLimit = 50

function nextKey(shown: Row[], item: Row) {
	const index = shown.indexOf(item)
	const next = shown[index + 1] ?? shown[index - 1]
	return next ? claimKey(next.planId, next.id) : null
}

export function claimsPage(
	store: Store,
	context: Context,
	params: URLSearchParams,
	refusal: ClaimRefusal | null = null,
	bulk: BulkState | null = null,
	now = Date.now()
): Page {
	const rows = claimsAcross(store)
	const filters = claimFilters(params)
	const shown = rows.filter((item) => matches(item, filters, now))
	const picked: Picked[] = shown
		.filter((entry) => !entry.decision && filters.picks.includes(claimKey(entry.planId, entry.id)))
		.map((entry) => ({
			key: claimKey(entry.planId, entry.id),
			kind: 'claim',
			planId: entry.planId,
			id: entry.id,
			title: entry.title,
			explorationId: entry.explorationId,
		}))
	const asked = refusal?.key ?? params.get('item')
	const item = asked
		? (shown.find((entry) => claimKey(entry.planId, entry.id) === asked) ?? null)
		: (shown[0] ?? null)
	const key = item ? claimKey(item.planId, item.id) : null
	const filtered = names.some((name) => filters[name])
	const limit = Math.max(shownLimit, Number(filters.limit) || 0)
	const list = html`<div class="q-head">
			<h1 id="claims-title">Claims</h1>
			<p class="sub">
				${filtered ? `${shown.length} of ${plural(rows.length, 'claim')} match.` : `${plural(rows.length, 'claim')}, newest first.`}
			</p>
		</div>
		${filterForm(rows, filters)}
		${bulkBar(
			'/claims',
			[
				...names.filter((name) => filters[name]).map((name) => [name, filters[name]] as [string, string]),
				...(filters.limit ? [['limit', filters.limit] as [string, string]] : []),
				...(key ? [['item', key] as [string, string]] : []),
			],
			picked.length,
			claimsHref({ ...filters, picks: [] }, key)
		)}
		${
			shown.length
				? html`<ul class="q-items">
						${shown.slice(0, limit).map((entry) => row(entry, filters, key))}
					</ul>`
				: html`<p class="none">
						No claim matches these filters. <a href="/claims" data-queue-back>Clear the filters</a>
					</p>`
		}
		${
			shown.length > limit
				? html`<p class="q-more">
						<a
							class="btn small"
							href="${claimsHref({ ...filters, limit: String(limit + shownLimit) }, key)}"
							data-queue-go
							data-more-rows
							>Show ${Math.min(shownLimit, shown.length - limit)} more</a
						>
						<span class="muted">${limit} of ${shown.length} shown</span>
					</p>`
				: ''
		}`
	const pane =
		picked.length || bulk
			? bulkPanel(context, picked, claimsHref({ ...filters, picks: [] }, key), bulk)
			: item
				? claimPane(store, context, item.planId, item, crumbs(item, filters), {
						key: key!,
						back: claimsHref(filters, filters.state ? nextKey(shown, item) : key),
						state: refusal?.state ?? emptyState(),
					})
				: html`<div class="empty">
						<p class="empty-title">
							${asked ? 'This claim does not match the filters.' : 'No claim to show.'}
						</p>
						<p><a href="${claimsHref(filters)}" data-queue-back>Back to the list</a></p>
					</div>`
	return {
		title: item ? `${item.planId} · ${item.id} · Claims` : 'Claims',
		section: 'claims',
		subjects: ['*'],
		status: refusal ? 422 : undefined,
		body: listAndItem({
			label: 'Claims',
			list,
			detail: pane,
			selected: key ?? '',
			open: Boolean(asked) && params.get('view') !== 'list',
		}),
	}
}
