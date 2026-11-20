import type { Store } from '../store.ts'
import { navigator, reviewOf } from './review.ts'
import type { Plan } from '../types.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import type { QueueItem } from '../views.ts'
import {
	mergedClaims,
	mergedQuestions,
	needsYou,
	planDetail,
	planExplorations,
	planHistory,
	planStatus,
} from '../views.ts'
import { decisionToken, planRequest, planRunGaps } from '../plans.ts'
import { gapsAffecting } from '../contracts.ts'
import { planCost } from '../costs.ts'
import { costText, glyph, hasMetadata, html, join, metadataList, pill, plural, short, time, words } from './html.ts'
import { banner, downloads, emptyNotice, heading } from './layout.ts'
import { emptyState, gapPanel, recordPanel, verdictPanel } from './forms.ts'
import { counts, loopState, runStatus } from './lists.ts'
import { claimsTable, explorationBanners, explorationsTable, questionsList } from './exploration.ts'

type Detail = ReturnType<typeof planDetail>
type Test = Plan['tests'][number]
type Gap = Plan['gaps'][number]

function testLink(planId: string, revision: number, reference: string) {
	const [owner, id] = reference.includes(':') ? reference.split(':') : [null, reference]
	return owner
		? html`<a class="mono" href="/plans/${owner}#${id}">${reference}</a>`
		: html`<a class="mono" href="/plans/${planId}@${revision}#${id}">${reference}</a>`
}

function ids(values: string[], link: (id: string) => Html) {
	return values.length ? join(values.map(link), ', ') : html`<span class="muted">none</span>`
}

function facts(rows: Array<[string, Html | string | false]>) {
	const shown = rows.filter(([, value]) => value !== false)
	return html`<dl class="facts">
		${shown.map(
			([label, value]) =>
				html`<div>
					<dt>${label}</dt>
					<dd>${value}</dd>
				</div>`
		)}
	</dl>`
}

function removeTest(context: Context, detail: Detail, test: Test) {
	const subject = `${detail.planId}@${detail.revision}`
	const actor = context.actor
		? ''
		: html`<div class="field-group">
				<label class="lab" for="remove-actor-${test.id}">Your name</label>
				<input id="remove-actor-${test.id}" name="actor" required autocomplete="name" />
			</div>`
	return html`<details class="test-remove" data-open-key="remove:${test.id}">
		<summary class="btn small">Remove ${test.id}</summary>
		<form method="post" action="/plans/${subject}/edit" class="decision-form">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<input type="hidden" name="sha" value="${detail.sha256}" />
			<input type="hidden" name="mode" value="remove" />
			<input type="hidden" name="test" value="${test.id}" />
			<div class="field-group">
				<label class="lab" for="remove-${test.id}">Reason for removal</label>
				<textarea id="remove-${test.id}" name="rationale" rows="2" required data-rationale></textarea>
			</div>
			${actor}
			<p class="help">Checkmate saves a new revision without ${test.id} and records who removed it and why.</p>
			<div class="btns"><button class="btn" data-needs-rationale>Remove ${test.id}</button></div>
		</form>
	</details>`
}

export function testCard(detail: Detail, test: Test, remove: Html | '' = '') {
	const { planId, revision } = detail
	return html`<article class="test" id="${test.id}" data-key="test:${test.id}">
		<header class="test-h">
			${pill(test.readiness)}
			<a class="id" href="#${test.id}">${test.id}</a>
			<h3>${test.title}</h3>
			<span class="count">${test.capability} · ${plural(test.assertions.length, 'assertion')}</span>
		</header>
		<div class="test-b">
			${facts([
				['Requirements', ids(test.requirementIds, (id) => html`<a class="mono" href="#${id}">${id}</a>`)],
				[
					'Depends on',
					test.dependsOn.length > 0 && ids(test.dependsOn, (id) => testLink(planId, revision, id)),
				],
				[
					'Gaps',
					test.gapIds.length > 0 && ids(test.gapIds, (id) => html`<a class="mono" href="#${id}">${id}</a>`),
				],
				[
					'Operations',
					test.operations.length > 0 && html`<span class="mono">${test.operations.join(', ')}</span>`,
				],
				[
					'Preconditions',
					test.preconditions.length > 0 &&
						html`<ul class="plain">
							${test.preconditions.map((item) => html`<li>${item}</li>`)}
						</ul>`,
				],
				['Action', test.action],
				['Metadata', hasMetadata(test.metadata) && metadataList(test.metadata)],
			])}
		</div>
		${
			test.assertions.length
				? html`<ul class="checklist" aria-label="Assertions of ${test.id}">
						${test.assertions.map(
							(assertion) =>
								html`<li class="asr" id="${test.id}.${assertion.id}">
									<span class="box" aria-hidden="true"></span>
									<span class="aid">${assertion.id}</span>
									<span class="check">${assertion.check}</span>
									<span class="tag">${words(assertion.checkKind)}</span>
								</li>`
						)}
					</ul>`
				: html`<p class="test-note">No assertions yet. A blocking gap must be answered first.</p>`
		}
		${remove}
	</article>`
}

function decisionFor(plan: Plan, gap: Gap) {
	return plan.decisions.find((decision) => decision.id === gap.decisionId)
}

function gapRow(detail: Detail, gap: Gap) {
	const decision = decisionFor(detail.plan, gap)
	const pending = detail.pendingDecisions.find((item) => item.gapId === gap.id)
	const answerable = gap.status === 'open' && !pending && detail.revision === detail.latestRevision
	const affects = [...gap.requirementIds, ...gap.testIds]
	const head = html`<span class="id mono">${gap.id}</span>
		${pill(gap.severity)} ${pill(gap.status)}
		<span class="gap-refs muted"
			>${affects.length ? `affects ${affects.join(', ')}` : 'affects the whole plan'}</span
		>`
	const content = html`<p class="muted">${gap.consequence}</p>
		${
			decision
				? html`<p class="gap-d">
						${pill(decision.kind)} ${decision.value} <span class="muted">· ${decision.actor}</span>
					</p>`
				: ''
		}
		${
			pending
				? html`<p class="gap-d">
						${pill('pending', 'decision pending')} ${words(pending.kind)}: ${pending.value}
						<span class="muted">· ${pending.actor} · applies in the next revision</span>
					</p>`
				: ''
		}
		${
			answerable
				? html`<p>
						<a class="btn small" href="/plans/${detail.planId}@${detail.revision}/gaps/${gap.id}"
							>Answer ${gap.id}</a
						>
					</p>`
				: ''
		}`
	if (gap.status === 'open')
		return html`<li class="gap" id="${gap.id}" data-key="gap:${gap.id}">
			<div class="gap-h">${head}</div>
			<p class="gap-q">${gap.question}</p>
			${content}
		</li>`
	return html`<li class="gap closed" id="${gap.id}" data-key="gap:${gap.id}">
		<details data-open-key="gap:${gap.id}">
			<summary>
				<span class="gap-h">${head}</span>
				<span class="gap-q">${gap.question}</span>
			</summary>
			<div class="gap-b">${content}</div>
		</details>
	</li>`
}

function gapsList(detail: Detail) {
	const gaps = detail.plan.gaps
	if (!gaps.length) return html`<p class="none">No gap. The plan has no open question.</p>`
	const open = gaps.filter((gap) => gap.status === 'open')
	const closed = gaps.filter((gap) => gap.status !== 'open')
	return html`<ul class="gaps">
		${[...open, ...closed].map((gap) => gapRow(detail, gap))}
	</ul>`
}

function runsTable(detail: Detail) {
	if (!detail.runs.length)
		return html`<p class="none">
			No run uses this plan yet. Approve the plan, then choose <strong>Test build…</strong> on its review page.
		</p>`
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Run</th>
					<th scope="col">Revision</th>
					<th scope="col">Build</th>
					<th scope="col">Instance</th>
					<th scope="col">Tests</th>
					<th scope="col">Completion</th>
					<th scope="col">Acceptance</th>
					<th scope="col">Started</th>
				</tr>
			</thead>
			<tbody>
				${[...detail.runs].reverse().map(
					(run) =>
						html`<tr data-key="run:${run.runId}">
							<td><a class="mono" href="/runs/${run.runId}">${run.runId}</a></td>
							<td>
								<a class="mono" href="/plans/${detail.planId}@${run.revision}">@${run.revision}</a>
							</td>
							<td class="mono">${run.build}</td>
							<td class="mono">${run.instanceId}</td>
							<td>${counts(run.counts)}</td>
							<td>${run.completion ? pill(run.completion) : html`<span class="muted">running</span>`}</td>
							<td>${runStatus(run)}</td>
							<td class="nowrap">${time(run.startedAt)}</td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function requirementsTable(plan: Plan) {
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">ID</th>
					<th scope="col">Requirement</th>
					<th scope="col">Tests</th>
					<th scope="col">Coverage</th>
				</tr>
			</thead>
			<tbody>
				${plan.requirements.map((requirement) => {
					const coverage = plan.coverage.find((row) => row.requirementId === requirement.id)
					return html`<tr id="${requirement.id}">
						<td class="mono">${requirement.id}</td>
						<td>
							${requirement.text}
							<div class="muted small">Source <code>${requirement.source}</code></div>
							${hasMetadata(requirement.metadata) ? html`<div class="small">${metadataList(requirement.metadata)}</div>` : ''}
						</td>
						<td>${ids(coverage?.testIds ?? [], (id) => html`<a class="mono" href="#${id}">${id}</a>`)}</td>
						<td>${coverage ? pill(coverage.status) : ''}</td>
					</tr>`
				})}
			</tbody>
		</table>
	</div>`
}

function decisionsList(plan: Plan) {
	if (!plan.decisions.length && !plan.assumptions.length) return html`<p class="none">No decision applied yet.</p>`
	return html`<ul class="records">
			${plan.decisions.map(
				(decision) =>
					html`<li>
						<div class="record-h">
							${pill(decision.kind)} <a class="mono" href="#${decision.gapId}">${decision.gapId}</a>
							<span class="muted">by ${decision.actor}</span>
							<span class="mono muted small">${decision.id}</span>
						</div>
						<p>${decision.value}</p>
						<p class="muted small">
							Rationale:
							${decision.rationale}${decision.source ? html` · Source <code>${decision.source}</code>` : ''}
						</p>
					</li>`
			)}
		</ul>
		${
			plan.assumptions.length
				? html`<h3 class="minor">Assumptions</h3>
						<ul class="plain">
							${plan.assumptions.map((item) => html`<li>${item.text}</li>`)}
						</ul>`
				: ''
		}`
}

function changeLine(line: string) {
	const arrow = line.indexOf(' → ')
	const colon = line.indexOf(': ')
	if (arrow < 0 || colon < 0 || colon > arrow) return html`<li><code>${line}</code></li>`
	return html`<li>
		<code>${line.slice(0, colon)}</code>
		<span class="was">${line.slice(colon + 2, arrow)}</span>
		<span aria-hidden="true" class="arrow">${glyph('→')}</span><span class="sr-only">changed to</span>
		<span class="now">${line.slice(arrow + 3)}</span>
	</li>`
}

const historyShown = 6

export function planHistoryList(store: Store, detail: Detail, all: boolean) {
	const revisions = planHistory(store, detail.planId).reverse()
	const shown = all ? revisions : revisions.slice(0, historyShown)
	const hidden = revisions.length - shown.length
	const subject = `${detail.planId}@${detail.revision}`
	return html`<div class="history-wrap" data-history>
		<ol class="history${hidden ? ' clipped' : ''}">
			${shown.map(
				(item, index) =>
					html`<li class="${item.revision === detail.revision ? 'current' : ''}">
						<details ${index === 0 ? html`open` : ''} data-open-key="revision:${item.revision}">
							<summary class="record-h">
								<span class="mono rev">${detail.planId}@${item.revision}</span>
								<span class="muted">by ${item.actor} · ${time(item.at)}</span>
								<code class="muted small" title="${item.sha256}">${short(item.sha256)}</code>
								<span class="muted small"
									>${item.changes.length ? plural(item.changes.length, 'change') : 'first revision'}</span
								>
							</summary>
							<div class="history-b">
								${
									item.changes.length
										? html`<ul class="changes">
												${item.changes.map(changeLine)}
											</ul>`
										: html`<p class="muted small">First revision.</p>`
								}
								<p class="small">
									<a class="h-link" href="/plans/${detail.planId}@${item.revision}"
										>Open ${detail.planId}@${item.revision}</a
									>
								</p>
							</div>
						</details>
					</li>`
			)}
		</ol>
		${
			hidden
				? html`<a
						class="history-more"
						href="/plans/${subject}?history=all#history"
						data-history-more="/plans/${subject}/history"
						><span class="btn small">Show full history · ${plural(hidden, 'earlier revision')}</span></a
					>`
				: ''
		}
	</div>`
}

export function approvalPanel(
	store: Store,
	context: Context,
	detail: Detail,
	state: FormState | null,
	extra: Html | null = null
) {
	const subject = `${detail.planId}@${detail.revision}`
	const latest = detail.approval.latest
	if (detail.approval.policy === 'none')
		return recordPanel('Approval', html`<p class="help">The target policy does not require plan approval.</p>`)
	if (latest && latest.sha256 === detail.sha256 && !state)
		return recordPanel(
			'Approval',
			html`<p class="subj">${pill(latest.verdict)} ${subject}</p>
				<p class="help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>
				${latest.sha256 !== detail.sha256 ? banner('warn', 'This decision was for another digest.') : ''}`,
			`${subject} was ${latest.verdict} by ${latest.actor}. Review it before you decide.`
		)
	return verdictPanel(
		context,
		{
			action: `/plans/${subject}`,
			subject,
			question: `Approve ${subject}?`,
			sha256: detail.sha256,
			token: decisionToken(store, 'plan', subject),
			digestLabel: 'Plan',
			approve: {
				value: 'approve',
				label: `Approve ${subject}`,
				confirm: 'Confirm approval',
				summary: `Approve ${subject}. Runs can then use this revision.`,
			},
			reject: {
				value: 'reject',
				label: 'Reject',
				confirm: 'Confirm rejection',
				summary: `Reject ${subject}. The agent must revise the plan.`,
			},
			staleMessage: `${detail.planId} changed. Review it before you decide.`,
			...(extra ? { extra } : {}),
			intro: html`<p class="help">${planSummaryLine(detail.plan)}</p>`,
		},
		state ?? emptyState()
	)
}

function planSummaryLine(plan: Plan) {
	const count = (readiness: string) => plan.tests.filter((test) => test.readiness === readiness).length
	const open = plan.gaps.filter((gap) => gap.status === 'open').length
	return `${plural(plan.tests.length, 'test')}: ${count('ready')} ready, ${count('blocked')} blocked, ${count('deferred')} deferred. ${plural(open, 'open gap')}.`
}

function newerBanner(detail: Detail) {
	if (detail.revision === detail.latestRevision) return ''
	return banner(
		'info',
		html`Revision ${detail.latestRevision} is available.
			<a href="/plans/${detail.planId}@${detail.latestRevision}"
				>Review ${detail.planId}@${detail.latestRevision}</a
			>`
	)
}

function side(content: Html) {
	return html`<aside class="side" aria-label="Decision">${content}</aside>`
}

function fold(id: string, title: Html | string, count: number | null, open: boolean, body: Html, region = '') {
	return html`<details
		class="fold"
		data-open-key="section:${id}"
		${region ? html`data-region="${region}"` : ''}
		${open ? html`open` : ''}
	>
		<summary>
			<h2 id="${id}">${title}${count === null ? '' : html` <span class="n">${count}</span>`}</h2>
		</summary>
		<div class="fold-b">${body}</div>
	</details>`
}

type PlanContext = {
	waiting: QueueItem[]
	claims: ReturnType<typeof mergedClaims>
	questions: ReturnType<typeof mergedQuestions>
	explorations: ReturnType<typeof planExplorations>
	status: ReturnType<typeof planStatus>
}

function planContext(store: Store, planId: string, harness: Context['harness']): PlanContext {
	return {
		waiting: needsYou(store).items.filter((item) => item.planId === planId),
		claims: mergedClaims(store, planId),
		questions: mergedQuestions(store, planId),
		explorations: planExplorations(store, planId),
		status: planStatus(store, planId, harness),
	}
}

function nextLine(planId: string, found: PlanContext) {
	const mine = found.waiting.filter((item) => item.group !== 'questions').length
	const why = found.status.why[0]
	const action =
		mine > 0
			? html`<a class="btn small primary" href="/plans/${planId}?view=needs&amp;focus=list"
					>Decide ${plural(mine, 'item')} in Needs you</a
				>`
			: found.status.next[0]
				? html`<code>${found.status.next[0]}</code>`
				: ''
	return html`<div class="next-line" data-region="next">
		${loopState(found.status)} ${why ? html`<span>${why}</span>` : ''} ${action}
	</div>`
}

function chips(found: PlanContext, extra: Array<[string, string, number]>) {
	const deciding = found.waiting.filter((item) => item.kind === 'claim').length
	const open = found.questions.filter((question) => question.answer === null)
	const blocking = open.filter((question) => question.blocking).length
	const items: Array<[string, Html | string]> = [
		[
			'claims',
			html`Claims
				<b>${found.claims.length}</b
				>${deciding ? html` <span class="st warn">${deciding} to decide</span>` : ''}`,
		],
		[
			'questions',
			html`Questions
				<b>${open.length}</b> open${blocking ? html` <span class="st fail">${blocking} blocking</span>` : ''}`,
		],
		['explorations', html`Explorations <b>${found.explorations.length}</b>`],
		...extra.map(([id, label, count]): [string, Html] => [id, html`${label} <b>${count}</b>`]),
	]
	return html`<nav class="chips" aria-label="Sections">
		${items.map(([id, label]) => html`<a href="#${id}">${label}</a>`)}
	</nav>`
}

function claimsFold(planId: string, found: PlanContext) {
	const deciding = found.waiting.some((item) => item.kind === 'claim')
	return fold(
		'claims',
		'Claims',
		found.claims.length,
		deciding,
		html`<p class="help">
				The merged claims of completed explorations.
				<a class="tap" href="/plans/${planId}?view=all">Open them in All items</a>.
			</p>
			${claimsTable(planId, found.claims)}`,
		'claims'
	)
}

function questionsFold(planId: string, found: PlanContext, gaps: Html | '' = '', openGaps = 0, blockingGaps = 0) {
	const open = found.questions.filter((question) => question.answer === null)
	const blocking = open.some((question) => question.blocking) || blockingGaps > 0
	return fold(
		'questions',
		'Questions',
		open.length + openGaps,
		blocking,
		html`${gaps}
			<h3 class="minor">Questions of the testers <span class="n">${found.questions.length}</span></h3>
			${questionsList(planId, found.questions)}`,
		'questions'
	)
}

function explorationsFold(found: PlanContext) {
	const attention = found.explorations.some(
		(item) => item.running || ['failed', 'stopped', 'interrupted'].includes(item.state)
	)
	return fold(
		'explorations',
		'Explorations',
		found.explorations.length,
		attention,
		explorationsTable(found.explorations),
		'explorations'
	)
}

export function planPage(
	store: Store,
	context: Context,
	planId: string,
	revision: number,
	state: FormState | null = null,
	allHistory = false,
	chatting = false
): Page {
	const detail = planDetail(store, planId, revision)
	const { plan } = detail
	const subject = `${planId}@${revision}`
	const latest = detail.revision === detail.latestRevision
	const found = planContext(store, planId, context.harness)
	const cost = planCost(store, planId)
	const meta = html`<div class="meta">
		${pill(detail.approval.state)}
		<span class="pill">target <span class="mono">${plan.target.targetId}@${plan.target.revision}</span></span>
		<span class="pill" title="${detail.sha256}">sha256 <span class="mono">${short(detail.sha256)}</span></span>
		<span
			class="pill"
			data-region="plan-cost"
			title="Reported cost across this plan’s explorations, chats, and structured runs"
			>Total cost ${costText(cost.costUsd, cost.costPartial)}</span
		>
		<span class="head-actions">
			${latest ? html`<a class="btn small" href="/plans/${subject}/edit">Edit plan</a>` : ''}
			${downloads('Export', `/plans/${subject}/export`, 'The HTML export is print-ready. Open it and print to PDF.')}
		</span>
	</div>`
	const pending = detail.pendingDecisions.length
		? banner(
				'info',
				html`${plural(detail.pendingDecisions.length, 'decision')}
				${detail.pendingDecisions.length === 1 ? 'waits' : 'wait'} for the next revision:
				${detail.pendingDecisions.map((item) => `${item.gapId} ${words(item.kind)}`).join(', ')}.`
			)
		: ''
	const openGaps = plan.gaps.filter((gap) => gap.status === 'open')
	const approving = detail.approval.state === 'pending' || detail.approval.state === 'rejected'
	const accepting = detail.runs.some((run) => run.acceptance === 'pending')
	const anyOpen =
		approving ||
		accepting ||
		found.waiting.length > 0 ||
		found.explorations.some((item) => item.running || ['failed', 'stopped', 'interrupted'].includes(item.state))
	const overview = html`<p class="lead">${plan.objective}</p>
		<p class="help">${planSummaryLine(plan)}</p>
		<h3 class="minor" id="requirements">
			Requirements and coverage
			${latest ? html`<a class="h-link" href="/plans/${subject}/edit#edit-requirements">Edit</a>` : ''}
		</h3>
		${requirementsTable(plan)}
		<h3 class="minor" id="decisions">Decisions</h3>
		${decisionsList(plan)}`
	const gaps = html`<h3 class="minor" id="gaps">Gaps of the plan <span class="n">${plan.gaps.length}</span></h3>
		<div data-region="gaps">${gapsList(detail)}</div>`
	const body = html`${heading(subject, null, meta)} ${nextLine(planId, found)}
		${chips(found, [
			['tests', 'Tests', plan.tests.length],
			['runs', 'Runs', detail.runs.length],
		])}
		<div data-region="banners">${newerBanner(detail)} ${pending} ${explorationBanners(found.explorations)}</div>
		<div class="split">
			<div class="main-col">
				${fold('overview', 'Overview', null, approving || !anyOpen, overview)} ${claimsFold(planId, found)}
				${questionsFold(
					planId,
					found,
					gaps,
					openGaps.length,
					openGaps.filter((gap) => gap.severity === 'blocking').length
				)}
				${explorationsFold(found)}
				${fold(
					'tests',
					html`Tests${latest ? html` <a class="h-link" href="/plans/${subject}/edit#edit-tests">Edit</a>` : ''}`,
					plan.tests.length,
					approving,
					html`<div class="stack">
						${plan.tests.map((test) => testCard(detail, test, latest ? removeTest(context, detail, test) : ''))}
					</div>`,
					'tests'
				)}
				${fold('runs', 'Runs', detail.runs.length, accepting, runsTable(detail), 'plan-runs')}
				${fold('history', 'History', null, allHistory, planHistoryList(store, detail, allHistory), 'history')}
			</div>
			${side(approvalPanel(store, context, detail, state))}
		</div>`
	return {
		title: subject,
		section: 'home',
		subjects: [
			`plan:${planId}`,
			'inbox',
			...detail.runs.map((run) => `run:${run.runId}`),
			...found.explorations.map((item) => `exploration:${item.explorationId}`),
		],
		body,
		crumbs: [
			['Plans', '/'],
			[planId, `/plans/${planId}`],
			[subject, null],
		],
		back: `/plans/${planId}?nav=plan`,
		nav: navigator(reviewOf(store, planId), 'plan', null, {
			href: `/plans/${subject}?chat=list${allHistory ? '&history=all' : ''}`,
			active: chatting,
		}),
	}
}

function storedTestsEmpty(planId: string, completed: string | undefined, harness: Context['harness']) {
	return html`<div data-key="no-tests">
		${emptyNotice(
			'No stored tests yet.',
			html`A stored test comes from the claims of a completed exploration. To store them, run
				<code>checkmate harvest ${completed ?? '<explorationId>'}</code>. To write a plan with tests, run
				<code>${harness === 'pi' ? `checkmate delegate plan ${planId}` : `/checkmate:plan ${planId}`}</code>.`
		)}
	</div>`
}

export function requestPage(store: Store, planId: string, harness: Context['harness']): Page {
	const { request, target } = planRequest(store, planId)
	const found = planContext(store, planId, harness)
	const targetRef = `${target.profile.targetId}@${target.revision}`
	const targetLink = html`<a
		class="mono"
		href="/settings/targets/${target.profile.targetId}?revision=${target.revision}"
		>${targetRef}</a
	>`
	const instances = [...new Set(found.explorations.map((item) => item.instanceId))]
	const sources = [...(request.context?.sources ?? []), ...(request.sourceContext ?? []).map((item) => item.uri)]
	const completed = found.explorations.filter((item) => item.state === 'completed').at(-1)?.explorationId
	const meta = html`<div class="meta">
		${pill('requested', 'no revision yet')}
		<span class="pill">target <span class="mono">${targetRef}</span></span>
	</div>`
	const anyOpen =
		found.waiting.length > 0 ||
		found.explorations.some((item) => item.running || ['failed', 'stopped', 'interrupted'].includes(item.state))
	const overview = facts([
		['Objective', request.objective],
		['Target', targetLink],
		[
			'Instance',
			instances.length
				? html`<span class="mono">${instances.join(', ')}</span>`
				: html`<span class="muted">none yet</span>`,
		],
		[
			'Sources',
			sources.length
				? html`<ul class="plain">
						${sources.map((source) => html`<li><code>${source}</code></li>`)}
					</ul>`
				: html`<span class="muted">none</span>`,
		],
		['Instructions', request.context?.instructions || false],
		[
			'Requirements',
			(request.requirements ?? []).length > 0 &&
				html`<ul class="plain">
					${(request.requirements ?? []).map((item) => html`<li><span class="mono">${item.id}</span> ${item.text}</li>`)}
				</ul>`,
		],
	])
	const body = html`${heading(planId, request.objective, meta)} ${nextLine(planId, found)}
		${chips(found, [['tests', 'Stored tests', 0]])}
		<div data-region="banners">${explorationBanners(found.explorations)}</div>
		<div class="split">
			<div class="main-col">
				${fold('request', 'Request', null, !anyOpen, overview)} ${claimsFold(planId, found)}
				${questionsFold(planId, found)} ${explorationsFold(found)}
				${fold('tests', 'Stored tests', 0, !found.explorations.length, storedTestsEmpty(planId, completed, harness), 'tests')}
			</div>
			${side(
				recordPanel(
					'Next',
					html`${found.status.why.map((line) => html`<p class="help">${line}</p>`)}
						<ul class="plain">
							${found.status.next.map((line) => html`<li><code>${line}</code></li>`)}
						</ul>`
				)
			)}
		</div>`
	return {
		title: planId,
		section: 'home',
		subjects: [`plan:${planId}`, 'inbox', ...found.explorations.map((item) => `exploration:${item.explorationId}`)],
		body,
		crumbs: [
			['Plans', '/'],
			[planId, `/plans/${planId}`],
			['Request', null],
		],
		back: `/plans/${planId}?nav=plan`,
		nav: navigator(reviewOf(store, planId), 'plan'),
	}
}

export function gapPage(
	store: Store,
	context: Context,
	planId: string,
	revision: number,
	gapId: string,
	state: FormState | null = null
): Page {
	const detail = planDetail(store, planId, revision)
	const { plan } = detail
	const latest = detail.revision === detail.latestRevision
	const fromRun =
		plan.gaps.some((item) => item.id === gapId) || !latest ? null : unadoptedRunGap(store, planId, gapId)
	const gap = plan.gaps.find((item) => item.id === gapId) ?? fromRun?.gap
	if (!gap) throw new Error(`Unknown gap ${gapId} in ${planId}@${revision}`)
	const subject = `${planId}@${revision}`
	const pending = detail.pendingDecisions.find((item) => item.gapId === gap.id)
	const decision = decisionFor(plan, gap)
	const tests = plan.tests.filter((test) => gapsAffecting([gap], test).length > 0)
	const requirements = plan.requirements.filter((requirement) => gap.requirementIds.includes(requirement.id))
	const runBanner = fromRun
		? banner(
				'info',
				html`This gap comes from run <a class="mono" href="/runs/${fromRun.runId}">${fromRun.runId}</a>. Your
					answer adds it to ${planId}.`
			)
		: ''
	let panel: Html
	if (state || (latest && gap.status === 'open' && !pending))
		panel = gapPanel(
			context,
			{
				action: `/plans/${subject}/gaps/${gap.id}`,
				cancel: `/plans/${subject}#${gap.id}`,
				sha256: detail.sha256,
				title: html`${planId} · ${gap.id} · ${words(gap.severity)}`,
				question: gap.question,
				staleMessage: `${planId} changed. Review it before you answer.`,
			},
			state ?? emptyState()
		)
	else if (pending)
		panel = recordPanel(
			'Answer recorded',
			html`<p class="subj">${pill(pending.kind)} ${gap.id}</p>
				<blockquote>${pending.value}</blockquote>
				<p class="help">By ${pending.actor}. The agent applies it in the next revision of ${planId}.</p>`
		)
	else if (decision)
		panel = recordPanel(
			'Decision',
			html`<p class="subj">${pill(decision.kind)} ${gap.id}</p>
				<blockquote>${decision.value}</blockquote>
				<p class="help">By ${decision.actor}. Rationale: ${decision.rationale}</p>`
		)
	else
		panel = recordPanel(
			'Answer gap',
			html`<p class="help">Answer this gap on the latest revision.</p>
				<p>
					<a class="btn" href="/plans/${planId}@${detail.latestRevision}/gaps/${gap.id}"
						>Open ${planId}@${detail.latestRevision}</a
					>
				</p>`
		)
	const meta = html`<div class="meta">
		${pill(gap.severity)} ${pill(gap.status)} <a class="pill" href="/plans/${subject}">${subject}</a>
	</div>`
	const body = html`${heading(html`${planId} · ${gap.id}`, gap.question, meta)}
		<div data-region="banners">${newerBanner(detail)} ${runBanner}</div>
		<div class="split">
			<div class="main-col">
				<section aria-labelledby="consequence">
					<h2 id="consequence">Consequence</h2>
					<p class="lead">${gap.consequence}</p>
				</section>
				${
					requirements.length
						? html`<section aria-labelledby="gap-requirements">
								<h2 id="gap-requirements">Requirements</h2>
								<ul class="records">
									${requirements.map(
										(requirement) =>
											html`<li>
												<div class="record-h"><span class="mono">${requirement.id}</span></div>
												<p>${requirement.text}</p>
												<p class="muted small">Source <code>${requirement.source}</code></p>
											</li>`
									)}
								</ul>
							</section>`
						: ''
				}
				<section aria-labelledby="gap-tests">
					<h2 id="gap-tests">Affected tests <span class="n">${tests.length}</span></h2>
					${
						tests.length
							? html`<div class="stack">${tests.map((test) => testCard(detail, test))}</div>`
							: html`<p class="none">No test names this gap.</p>`
					}
				</section>
			</div>
			${side(panel)}
		</div>`
	return {
		title: `${planId} ${gap.id}`,
		section: 'home',
		crumbs: [
			['Plans', '/'],
			[planId, `/plans/${planId}`],
			[subject, `/plans/${subject}`],
			[gap.id, null],
		],
		back: `/plans/${subject}`,
		nav: navigator(reviewOf(store, planId), 'plan'),
		subjects: [`plan:${planId}`, 'inbox', ...(fromRun ? [`run:${fromRun.runId}`] : [])],
		body,
	}
}

function unadoptedRunGap(store: Store, planId: string, gapId: string) {
	const found = planRunGaps(store, planId).filter((item) => item.gap.id === gapId && !item.adopted)
	return found.length === 1 ? found[0] : null
}
