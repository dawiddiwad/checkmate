import type { Store } from '../../store.ts'
import type { Plan } from '../../types.ts'
import type { QueueItem } from '../../views.ts'
import {
	mergedClaims,
	mergedQuestions,
	needsYou,
	planDetail,
	planExplorations,
	planHistory,
	planStatus,
} from '../../views.ts'
import { decisionToken, planRequest, planRunGaps } from '../../plans.ts'
import { gapsAffecting } from '../../contracts.ts'
import { planCost } from '../../costs.ts'
import type { FormState } from '../forms.ts'
import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { blockingBanner } from '../components/banner.ts'
import { boardCell } from '../components/board.ts'
import { formButton } from '../components/button.ts'
import { dataTable, tableRow } from '../components/data-table.ts'
import { emptyNotice } from '../components/empty-state.ts'
import { facts } from '../components/facts.ts'
import { field, textArea, textInput } from '../components/field.ts'
import { fold } from '../components/fold.ts'
import { downloadMenu } from '../components/menu.ts'
import { notice } from '../components/notice.ts'
import { heading } from '../components/page-heading.ts'
import { statusCounts, statusMark } from '../components/status-mark.ts'
import { jumpLinks } from '../components/tabs.ts'
import { emptyState, gapPanel, recordPanel, verdictPanel } from '../forms.ts'
import { costText, glyph, hasMetadata, html, join, metadataList, plural, short, time, words } from '../html.ts'
import { loopState, runStatus } from '../lists.ts'
import type { Review } from '../review.ts'
import { navigator, openedHref, outside, reviewOf, ruleBoard } from '../review.ts'
import { claimsTable, explorationBanners, explorationsTable, questionsList } from './exploration.ts'

type Detail = ReturnType<typeof planDetail>
type Test = Plan['tests'][number]
type Gap = Plan['gaps'][number]

function testLink(planId: string, revision: number, reference: string) {
	const [owner, id] = reference.includes(':') ? reference.split(':') : [null, reference]
	return owner
		? html`<a class="sc-mono" href="/plans/${owner}#${id}">${reference}</a>`
		: html`<a class="sc-mono" href="/plans/${planId}@${revision}#${id}">${reference}</a>`
}

function ids(values: string[], link: (id: string) => Html) {
	return values.length ? join(values.map(link), ', ') : html`<span class="sc-muted">none</span>`
}

function removeTest(context: Context, detail: Detail, test: Test) {
	const subject = `${detail.planId}@${detail.revision}`
	const actor = context.actor
		? ''
		: html`${field({ id: `remove-actor-${test.id}`, label: 'Your name', control: textInput({ id: `remove-actor-${test.id}`, name: 'actor', attrs: { required: true, autocomplete: 'name' } }) })}`
	return html`<details class="test-remove" data-open-key="remove:${test.id}">
		${formButton({ label: `Remove ${test.id}`, element: 'summary', inline: true })}
		<form method="post" action="/plans/${subject}/edit" class="sc-form">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<input type="hidden" name="sha" value="${detail.sha256}" />
			<input type="hidden" name="mode" value="remove" />
			<input type="hidden" name="test" value="${test.id}" />
			${field({ id: `remove-${test.id}`, label: 'Reason for removal', control: textArea({ id: `remove-${test.id}`, name: 'rationale', rows: 2, attrs: { required: true, 'data-rationale': true } }) })}
			${actor}
			<p class="sc-help">Checkmate saves a new revision without ${test.id} and records who removed it and why.</p>
			<div class="sc-row-btns">
				${formButton({ label: `Remove ${test.id}`, attrs: { 'data-needs-rationale': true } })}
			</div>
		</form>
	</details>`
}

export function testCard(detail: Detail, test: Test, remove: Html | '' = '') {
	const { planId, revision } = detail
	return html`<article class="test" id="${test.id}" data-key="test:${test.id}">
		<header class="test-h">
			${statusMark({ state: test.readiness })}
			<a class="id" href="#${test.id}">${test.id}</a>
			<h3>${test.title}</h3>
			<span class="count">${test.capability} · ${plural(test.assertions.length, 'assertion')}</span>
		</header>
		<div class="test-b">
			${facts({
				rows: [
					[
						'Requirements',
						ids(test.requirementIds, (id) => html`<a class="sc-mono" href="#${id}">${id}</a>`),
					],
					[
						'Depends on',
						test.dependsOn.length > 0 && ids(test.dependsOn, (id) => testLink(planId, revision, id)),
					],
					[
						'Gaps',
						test.gapIds.length > 0 &&
							ids(test.gapIds, (id) => html`<a class="sc-mono" href="#${id}">${id}</a>`),
					],
					[
						'Operations',
						test.operations.length > 0 && html`<span class="sc-mono">${test.operations.join(', ')}</span>`,
					],
					[
						'Preconditions',
						test.preconditions.length > 0 &&
							html`<ul class="sc-plain">
								${test.preconditions.map((item) => html`<li>${item}</li>`)}
							</ul>`,
					],
					['Action', test.action],
					['Metadata', hasMetadata(test.metadata) && metadataList(test.metadata)],
				],
			})}
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
									<span class="sc-chip">${words(assertion.checkKind)}</span>
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
	const head = html`<span class="id sc-mono">${gap.id}</span>
		${statusMark({ state: gap.severity })} ${statusMark({ state: gap.status })}
		<span class="gap-refs sc-muted"
			>${affects.length ? `affects ${affects.join(', ')}` : 'affects the whole plan'}</span
		>`
	const content = html`<p class="sc-muted">${gap.consequence}</p>
		${
			decision
				? html`<p class="gap-d">
						${statusMark({ state: decision.kind })} ${decision.value}
						<span class="sc-muted">· ${decision.actor}</span>
					</p>`
				: ''
		}
		${
			pending
				? html`<p class="gap-d">
						${statusMark({ state: 'pending', label: 'decision pending' })} ${words(pending.kind)}:
						${pending.value}
						<span class="sc-muted">· ${pending.actor} · applies in the next revision</span>
					</p>`
				: ''
		}
		${
			answerable
				? html`<p>
						${formButton({ label: `Answer ${gap.id}`, href: `/plans/${detail.planId}@${detail.revision}/gaps/${gap.id}`, inline: true })}
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
	if (!gaps.length) return html`<p class="sc-empty is-line">No gap. The plan has no open question.</p>`
	const open = gaps.filter((gap) => gap.status === 'open')
	const closed = gaps.filter((gap) => gap.status !== 'open')
	return html`<ul class="gaps">
		${[...open, ...closed].map((gap) => gapRow(detail, gap))}
	</ul>`
}

function runsTable(detail: Detail) {
	if (!detail.runs.length)
		return html`<p class="sc-empty is-line">
			No run uses this plan yet. Approve the plan, then choose <strong>Test build…</strong> on its review page.
		</p>`
	return dataTable({
		columns: ['Run', 'Revision', 'Build', 'Instance', 'Tests', 'Completion', 'Acceptance', 'Started'],
		rows: [...detail.runs].reverse().map((run) =>
			tableRow({
				cells: [
					html`<a class="sc-mono" href="/runs/${run.runId}">${run.runId}</a>`,
					html`<a class="sc-mono" href="/plans/${detail.planId}@${run.revision}">@${run.revision}</a>`,
					{ content: run.build, attrs: { class: 'is-mono' } },
					{ content: run.instanceId, attrs: { class: 'is-mono' } },
					statusCounts({ counts: run.counts }),
					run.completion
						? statusMark({ state: run.completion })
						: html`<span class="sc-muted">running</span>`,
					runStatus(run),
					{ content: time(run.startedAt), attrs: { class: 'is-muted' } },
				],
				attrs: { 'data-key': `run:${run.runId}` },
			})
		),
		scroll: true,
	})
}

function requirementsTable(plan: Plan) {
	return dataTable({
		columns: ['ID', 'Requirement', 'Tests', 'Coverage'],
		rows: plan.requirements.map((requirement) => {
			const coverage = plan.coverage.find((row) => row.requirementId === requirement.id)
			return tableRow({
				cells: [
					{ content: requirement.id, attrs: { class: 'is-mono' } },
					html`${requirement.text}
						<div class="sc-muted sc-note">Source <code>${requirement.source}</code></div>
						${hasMetadata(requirement.metadata) ? html`<div class="sc-note">${metadataList(requirement.metadata)}</div>` : ''}`,
					html`${ids(coverage?.testIds ?? [], (id) => html`<a class="sc-mono" href="#${id}">${id}</a>`)}`,
					coverage ? statusMark({ state: coverage.status }) : '',
				],
				attrs: { id: requirement.id },
			})
		}),
		scroll: true,
	})
}

function decisionsList(plan: Plan) {
	if (!plan.decisions.length && !plan.assumptions.length)
		return html`<p class="sc-empty is-line">No decision applied yet.</p>`
	return html`${
		plan.decisions.length
			? dataTable({
					columns: ['Gap', 'Kind', 'Decision', 'By'],
					rows: plan.decisions.map((decision) =>
						tableRow({
							attrs: { title: decision.id },
							cells: [
								html`<a class="sc-mono" href="#${decision.gapId}">${decision.gapId}</a>`,
								statusMark({ state: decision.kind }),
								{
									content: html`${decision.value}
										<div class="sc-muted sc-note">
											Rationale:
											${decision.rationale}${decision.source ? html` · Source <code>${decision.source}</code>` : ''}
										</div>`,
									attrs: { class: 'is-title' },
								},
								{ content: decision.actor, attrs: { class: 'is-muted' } },
							],
						})
					),
					scroll: true,
				})
			: ''
	}
	${
		plan.assumptions.length
			? html`<h3 class="sc-sub-h">Assumptions</h3>
					<ul class="sc-plain">
						${plan.assumptions.map((item) => html`<li>${item.text}</li>`)}
					</ul>`
			: ''
	}`
}

function plainValue(value: string) {
	if (!value.startsWith('"')) return value
	try {
		return String(JSON.parse(value))
	} catch {
		return value
	}
}

function changeLine(line: string) {
	const added = /^(\S+) (added|removed): (.*)$/.exec(line)
	if (added)
		return html`<li class="${added[2] === 'added' ? 'is-add' : 'is-del'}">
			<span class="sc-diff-op" aria-label="${added[2]}">${added[2] === 'added' ? '+' : '−'}</span>
			<span class="sc-diff-id">${added[1]}</span>
			<span>${plainValue(added[3])}</span>
		</li>`
	const changed = /^(\S+) (\S+): (.*) → (.*)$/.exec(line)
	if (!changed)
		return html`<li>
			<span class="sc-diff-op" aria-hidden="true">·</span><span class="sc-diff-id"></span><span>${line}</span>
		</li>`
	return html`<li class="is-mod">
		<span class="sc-diff-op" aria-label="changed">~</span>
		<span class="sc-diff-id">${changed[1]}</span>
		<span
			>${changed[2]}: <span class="was">${plainValue(changed[3])}</span
			><span aria-hidden="true" class="arrow">${glyph('→')}</span
			><span class="sc-sr">changed to</span>${plainValue(changed[4])}</span
		>
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
					html`<li class="sc-ver${item.revision === detail.revision ? ' is-cur' : ''}">
						<details ${index === 0 ? html`open` : ''} data-open-key="revision:${item.revision}">
							<summary class="sc-ver-h">
								<span class="sc-ver-id">${detail.planId}@${item.revision}</span>
								${item.revision === detail.revision ? statusMark({ state: detail.approval.state }) : ''}
								<span class="sc-ver-m"
									>by ${item.actor} · ${time(item.at)} ·
									<code title="${item.sha256}">${short(item.sha256)}</code> ·
									${item.changes.length ? plural(item.changes.length, 'change') : 'first revision'}</span
								>
							</summary>
							${
								item.changes.length
									? html`<ul class="sc-diff">
											${item.changes.map(changeLine)}
										</ul>`
									: ''
							}
							${
								item.revision === detail.revision
									? ''
									: html`<p class="sc-ver-open">
											<a href="/plans/${detail.planId}@${item.revision}"
												>Open ${detail.planId}@${item.revision}</a
											>
										</p>`
							}
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
						>${formButton({ label: `Show full history · ${plural(hidden, 'earlier revision')}`, element: 'span', inline: true })}</a
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
		return recordPanel('Approval', html`<p class="sc-help">The target policy does not require plan approval.</p>`)
	if (latest && latest.sha256 === detail.sha256 && !state)
		return recordPanel(
			'Approval',
			html`<p class="subj">${statusMark({ state: latest.verdict })} ${subject}</p>
				<p class="sc-help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>
				${latest.sha256 !== detail.sha256 ? notice({ kind: 'warn', content: 'This decision was for another digest.' }) : ''}`,
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
			intro: html`<p class="sc-help">${planSummaryLine(detail.plan)}</p>`,
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
	return notice({
		kind: 'info',
		content: html`Revision ${detail.latestRevision} is available.
			<a href="/plans/${detail.planId}@${detail.latestRevision}"
				>Review ${detail.planId}@${detail.latestRevision}</a
			>`,
	})
}

function side(content: Html) {
	return html`<aside class="side" aria-label="Decision">${content}</aside>`
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

function blockingTitle(items: Review['items']) {
	const one = items.length === 1
	if (items.every((item) => item.kind === 'gap')) return `open ${one ? 'gap blocks' : 'gaps block'} testing`
	if (items.every((item) => item.kind === 'question')) return `${one ? 'question blocks' : 'questions block'} testing`
	return `${one ? 'item blocks' : 'items block'} testing`
}

function planBanner(gaps: Gap[], review: Review) {
	const waiting = review.items.filter((item) => item.needs)
	const blocking = waiting.filter((item) => item.blocking)
	const first = blocking[0]
	if (first) {
		const holds = gaps.find((gap) => gap.id === first.id)?.testIds ?? []
		const more = waiting.length - 1
		return html`<div data-region="next">
			${blockingBanner({
				count: blocking.length,
				title: blockingTitle(blocking),
				text: `${first.id} “${first.title}”${holds.length ? ` holds ${holds.join(', ')}` : ''}.${more ? ` ${plural(more, 'more item')} ${more === 1 ? 'waits' : 'wait'} in Needs you.` : ''}`,
				action: `Answer ${first.id}`,
				href: openedHref(review, first, 'needs'),
			})}
		</div>`
	}
	return ''
}

function nextLine(planId: string, gaps: Gap[], review: Review, found: PlanContext) {
	const banner = planBanner(gaps, review)
	if (banner) return banner
	const waiting = review.items.filter((item) => item.needs)
	const why = found.status.why[0]
	const action = waiting.length
		? formButton({
				label: `Decide ${plural(waiting.length, 'item')} in Needs you`,
				href: `/plans/${planId}?view=needs&focus=list`,
				emphasis: 'primary',
				inline: true,
			})
		: found.status.next[0]
			? html`<code>${found.status.next[0]}</code>`
			: ''
	return html`<div class="next-line" data-region="next">
		${loopState(found.status)} ${why ? html`<span>${why}</span>` : ''} ${action}
	</div>`
}

function recordSection(
	id: string,
	title: string,
	count: number,
	body: Html,
	open: boolean,
	region = '',
	link: Html | '' = ''
) {
	if (count === 0) return html`<div id="${id}" ${region ? html`data-region="${region}"` : ''} hidden></div>`
	return fold({ key: `section:${id}`, title, headingId: `${id}-h`, bodyId: id, link, count, open, region, body })
}

function section(
	id: string,
	title: Html | string,
	count: number | null,
	body: Html,
	region = '',
	link: Html | '' = ''
) {
	if (count === 0) return html`<div id="${id}" ${region ? html`data-region="${region}"` : ''} hidden></div>`
	return html`<section
		class="sc-sec"
		id="${id}"
		aria-labelledby="${id}-h"
		${region ? html`data-region="${region}"` : ''}
	>
		<h2 class="sc-sec-h" id="${id}-h">${title}${count === null ? '' : html`<b>${count}</b>`}${link}</h2>
		${body}
	</section>`
}

function rulesTable(review: Review) {
	const board = ruleBoard(review)
	if (!board.builds.length && board.rows.length <= 1)
		return html`<p class="sc-empty is-line">No rule is tested yet. Rules come from the first exploration.</p>`
	return dataTable({
		columns: ['Rule', 'Name', { label: 'Tests', attrs: { class: 'is-num' } }, ...board.builds],
		rows: board.rows.map((row) =>
			tableRow({
				attrs: { class: row.id === outside ? 'is-dim' : undefined },
				cells: [
					{ content: row.id === outside ? 'Out' : row.id, attrs: { class: 'is-mono' } },
					row.text,
					{ content: row.storedTests || '—', attrs: { class: 'is-num' } },
					...row.cells.map((cell) => boardCell(cell)),
				],
			})
		),
		scroll: true,
	})
}

function testsTable(detail: Detail) {
	const { plan } = detail
	if (!plan.tests.length) return html`<p class="sc-empty is-line">The plan has no test yet.</p>`
	return dataTable({
		columns: ['Test', 'Name', 'Requirements', 'Readiness', 'Checks'],
		rows: plan.tests.map((test) =>
			tableRow({
				attrs: { class: test.readiness === 'blocked' ? 'is-block' : undefined },
				cells: [
					{ content: html`<a href="#${test.id}">${test.id}</a>`, attrs: { class: 'is-mono' } },
					{ content: test.title, attrs: { class: 'is-title' } },
					{ content: test.requirementIds.join(', ') || '—', attrs: { class: 'is-mono is-muted' } },
					test.gapIds.length && test.readiness === 'blocked'
						? statusMark({ state: 'blocking', label: `waits on ${test.gapIds.join(', ')}` })
						: statusMark({ state: test.readiness }),
					{ content: plural(test.assertions.length, 'check'), attrs: { class: 'is-muted' } },
				],
			})
		),
		scroll: true,
	})
}

function questionsSection(planId: string, detail: Detail, found: PlanContext, place: 'work' | 'record') {
	const open =
		found.questions.filter((question) => question.answer === null).length +
		detail.plan.gaps.filter((gap) => gap.status === 'open').length
	const all = found.questions.length + detail.plan.gaps.length
	if ((place === 'work') !== open > 0) return ''
	const body = html`${
		detail.plan.gaps.length
			? html`<h3 class="sc-sub-h" id="gaps">
						Gaps of the plan <span class="sc-count-n">${detail.plan.gaps.length}</span>
					</h3>
					<div data-region="gaps">${gapsList(detail)}</div>`
			: ''
	}
	${
		found.questions.length
			? html`<h3 class="sc-sub-h">
						Questions of the testers <span class="sc-count-n">${found.questions.length}</span>
					</h3>
					${questionsList(planId, found.questions)}`
			: ''
	}`
	return place === 'work'
		? section('questions', 'Questions', open, body, 'questions')
		: recordSection('questions', 'Questions', all, body, false, 'questions')
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
	const review = reviewOf(store, planId)
	const cost = planCost(store, planId)
	const meta = html`
		${statusMark({ state: detail.approval.state })}
		<span>target <code>${plan.target.targetId}@${plan.target.revision}</code></span>
		<span title="${detail.sha256}">sha256 <code>${short(detail.sha256)}</code></span>
	`
	const pending = detail.pendingDecisions.length
		? notice({
				kind: 'info',
				content: html`${plural(detail.pendingDecisions.length, 'decision')}
				${detail.pendingDecisions.length === 1 ? 'waits' : 'wait'} for the next revision:
				${detail.pendingDecisions.map((item) => `${item.gapId} ${words(item.kind)}`).join(', ')}.`,
			})
		: ''
	const approving = detail.approval.state === 'pending' || detail.approval.state === 'rejected'
	const versions = planHistory(store, planId).length
	const actions = html`${downloadMenu({ label: 'Export', base: `/plans/${subject}/export`, note: 'The HTML export is print-ready. Open it and print to PDF.' })}
	${latest ? formButton({ label: 'Edit plan', href: `/plans/${subject}/edit`, inline: true }) : ''}`
	const editLink = (hash: string) =>
		latest ? html`<a class="sc-h-link" href="/plans/${subject}/edit#${hash}">Edit</a>` : ''
	const rules = ruleBoard(review).rows.filter((row) => row.id !== outside).length
	const tabs = jumpLinks({
		links: [
			{ href: '#rules', label: 'Rules', count: rules },
			{ href: '#tests', label: 'Tests', count: plan.tests.length },
			{
				href: '#claims',
				label: 'Claims',
				count: found.claims.length,
				hot: found.waiting.some((item) => item.kind === 'claim'),
			},
			{
				href: '#questions',
				label: 'Questions',
				count:
					found.questions.filter((question) => question.answer === null).length +
					plan.gaps.filter((gap) => gap.status === 'open').length,
				hot: review.items.some((item) => item.needs && item.blocking),
			},
			{ href: '#explorations', label: 'Explorations', count: found.explorations.length },
			{ href: '#runs', label: 'Runs', count: detail.runs.length },
			{ href: '#history', label: 'Versions', count: versions },
		].filter((link) => link.count > 0),
	})
	const approval = approvalPanel(store, context, detail, state)
	const body = html`${heading({
			title: subject,
			crumbs: [
				['Plans', '/'],
				[planId, `/plans/${planId}`],
				[subject, null],
			],
			sub: null,
			meta,
			actions,
		})}
		${nextLine(planId, plan.gaps, review, found)} ${tabs}
		<div data-region="banners">${newerBanner(detail)} ${pending} ${explorationBanners(found.explorations)}</div>
		<div class="sc-stack is-loose">
			${approving ? approval : ''}
			<p class="sc-lead">${plan.objective}</p>
			${questionsSection(planId, detail, found, 'work')}
			${section('runs', 'Runs', detail.runs.length, runsTable(detail), 'plan-runs')}
			<section class="sc-sec" aria-labelledby="record-h">
				<h2 class="sc-sec-h" id="record-h">Record</h2>
				<div class="sc-stack is-tight">
					${approving ? '' : fold({ key: 'section:approval', title: 'Approval', body: approval })}
					${recordSection('rules', 'Rules and builds', rules, rulesTable(review), approving)}
					${recordSection(
						'tests',
						'Permanent tests',
						plan.tests.length,
						html`${testsTable(detail)}
						${fold({
							key: 'section:test-steps',
							title: 'Steps and checks of each test',
							headingId: 'test-steps',
							count: null,
							open: approving,
							body: html`<div class="sc-stack">
								${plan.tests.map((test) =>
									testCard(detail, test, latest ? removeTest(context, detail, test) : '')
								)}
							</div>`,
						})}`,
						approving,
						'tests',
						editLink('edit-tests')
					)}
					${recordSection(
						'requirements',
						'Requirements and coverage',
						plan.requirements.length,
						html`<p class="sc-help">${planSummaryLine(plan)}</p>
							${requirementsTable(plan)}`,
						approving,
						'',
						editLink('edit-requirements')
					)}
					${recordSection(
						'claims',
						'Claims',
						found.claims.length,
						html`<p class="sc-help">
								The merged claims of completed explorations.
								<a href="/plans/${planId}?view=all">Open them in All items</a>.
							</p>
							${claimsTable(planId, found.claims)}`,
						false,
						'claims'
					)}
					${questionsSection(planId, detail, found, 'record')}
					${recordSection('decisions', 'Decisions', plan.decisions.length, decisionsList(plan), approving)}
					${recordSection(
						'explorations',
						'Explorations',
						found.explorations.length,
						explorationsTable(found.explorations),
						found.explorations.some((item) => item.running),
						'explorations'
					)}
					${recordSection(
						'history',
						'Versions',
						versions,
						planHistoryList(store, detail, allHistory),
						allHistory,
						'history'
					)}
				</div>
			</section>
			<p class="sc-note" data-region="plan-cost">
				Total cost ${cost.costUsd === null ? '—' : costText(cost.costUsd, cost.costPartial)}
			</p>
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
		nav: navigator(review, 'plan', null, {
			href: `/plans/${subject}?chat=list${allHistory ? '&history=all' : ''}`,
			active: chatting,
		}),
	}
}

function storedTestsEmpty(planId: string, completed: string | undefined, harness: Context['harness']) {
	return html`<div data-key="no-tests">
		${emptyNotice({
			what: 'No stored tests yet.',
			next: html`A stored test comes from the claims of a completed exploration. To store them, run
				<code>checkmate harvest ${completed ?? '<explorationId>'}</code>. To write a plan with tests, run
				<code>${harness === 'pi' ? `checkmate delegate plan ${planId}` : `/checkmate:plan ${planId}`}</code>.`,
		})}
	</div>`
}

export function requestPage(store: Store, planId: string, harness: Context['harness']): Page {
	const { request, target } = planRequest(store, planId)
	const found = planContext(store, planId, harness)
	const targetRef = `${target.profile.targetId}@${target.revision}`
	const targetLink = html`<a
		class="sc-mono"
		href="/settings/targets/${target.profile.targetId}?revision=${target.revision}"
		>${targetRef}</a
	>`
	const instances = [...new Set(found.explorations.map((item) => item.instanceId))]
	const sources = [...(request.context?.sources ?? []), ...(request.sourceContext ?? []).map((item) => item.uri)]
	const completed = found.explorations.filter((item) => item.state === 'completed').at(-1)?.explorationId
	const meta = html` ${statusMark({ state: 'requested', label: 'no revision yet' })}
		<span>target <code>${targetRef}</code></span>`
	const overview = facts({
		rows: [
			['Objective', request.objective],
			['Target', targetLink],
			[
				'Instance',
				instances.length
					? html`<span class="sc-mono">${instances.join(', ')}</span>`
					: html`<span class="sc-muted">none yet</span>`,
			],
			[
				'Sources',
				sources.length
					? html`<ul class="sc-plain">
							${sources.map((source) => html`<li><code>${source}</code></li>`)}
						</ul>`
					: html`<span class="sc-muted">none</span>`,
			],
			['Instructions', request.context?.instructions || false],
			[
				'Requirements',
				(request.requirements ?? []).length > 0 &&
					html`<ul class="sc-plain">
						${(request.requirements ?? []).map((item) => html`<li><span class="sc-mono">${item.id}</span> ${item.text}</li>`)}
					</ul>`,
			],
		],
	})
	const review = reviewOf(store, planId)
	const body = html`${heading({ title: planId, sub: request.objective, meta })} ${planBanner([], review)}
		<section class="next-line" aria-labelledby="request-next" data-region="request-next">
			<h2 class="sc-card-h" id="request-next">Next</h2>
			${found.status.why.map((line) => html`<p>${line}</p>`)}
			${found.status.next.map((line) => html`<code>${line}</code>`)}
		</section>
		${jumpLinks({
			links: [
				{ href: '#request', label: 'Request' },
				{ href: '#claims', label: 'Claims', count: found.claims.length },
				{
					href: '#questions',
					label: 'Questions',
					count: found.questions.filter((question) => question.answer === null).length,
				},
				{ href: '#explorations', label: 'Explorations', count: found.explorations.length },
				{ href: '#tests', label: 'Stored tests', count: 0 },
			],
		})}
		<div data-region="banners">${explorationBanners(found.explorations)}</div>
		<div class="sc-stack is-loose">
			${section('request', 'Request', null, overview)}
			${section(
				'claims',
				'Claims',
				found.claims.length,
				html`<p class="sc-help">The merged claims of completed explorations.</p>
					${claimsTable(planId, found.claims)}`,
				'claims'
			)}
			${section('questions', 'Questions', found.questions.length, questionsList(planId, found.questions), 'questions')}
			${section('explorations', 'Explorations', found.explorations.length, explorationsTable(found.explorations), 'explorations')}
			${section('tests', 'Stored tests', 0, storedTestsEmpty(planId, completed, harness), 'tests')}
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
		nav: navigator(review, 'plan'),
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
		? notice({
				kind: 'info',
				content: html`This gap comes from run
					<a class="sc-mono" href="/runs/${fromRun.runId}">${fromRun.runId}</a>. Your answer adds it to
					${planId}.`,
			})
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
			html`<p class="subj">${statusMark({ state: pending.kind })} ${gap.id}</p>
				<blockquote>${pending.value}</blockquote>
				<p class="sc-help">By ${pending.actor}. The agent applies it in the next revision of ${planId}.</p>`
		)
	else if (decision)
		panel = recordPanel(
			'Decision',
			html`<p class="subj">${statusMark({ state: decision.kind })} ${gap.id}</p>
				<blockquote>${decision.value}</blockquote>
				<p class="sc-help">By ${decision.actor}. Rationale: ${decision.rationale}</p>`
		)
	else
		panel = recordPanel(
			'Answer gap',
			html`<p class="sc-help">Answer this gap on the latest revision.</p>
				<p>
					${formButton({ label: `Open ${planId}@${detail.latestRevision}`, href: `/plans/${planId}@${detail.latestRevision}/gaps/${gap.id}` })}
				</p>`
		)
	const meta = html` ${statusMark({ state: gap.severity })} ${statusMark({ state: gap.status })}
		<a class="sc-mono" href="/plans/${subject}">${subject}</a>`
	const body = html`${heading({ title: html`${planId} · ${gap.id}`, sub: gap.question, meta })}
		<div data-region="banners">${newerBanner(detail)} ${runBanner}</div>
		<div class="sc-split">
			<div class="sc-stack">
				<section aria-labelledby="consequence">
					<h2 id="consequence">Consequence</h2>
					<p class="sc-lead">${gap.consequence}</p>
				</section>
				${
					requirements.length
						? html`<section aria-labelledby="gap-requirements">
								<h2 id="gap-requirements">Requirements</h2>
								<ul class="records">
									${requirements.map(
										(requirement) =>
											html`<li>
												<div class="record-h">
													<span class="sc-mono">${requirement.id}</span>
												</div>
												<p>${requirement.text}</p>
												<p class="sc-muted sc-note">
													Source <code>${requirement.source}</code>
												</p>
											</li>`
									)}
								</ul>
							</section>`
						: ''
				}
				<section aria-labelledby="gap-tests">
					<h2 id="gap-tests">Affected tests <span class="sc-count-n">${tests.length}</span></h2>
					${
						tests.length
							? html`<div class="stack">${tests.map((test) => testCard(detail, test))}</div>`
							: html`<p class="sc-empty is-line">No test names this gap.</p>`
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
