import type { Store } from '../../../plugin/src/store.ts'
import type { Plan } from '../../../plugin/src/types.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import { planDetail, planHistory, runList } from '../../../plugin/src/views.ts'
import { html, join, pill, plural, short, time, words } from './html.ts'
import { banner, heading } from './layout.ts'
import { emptyState, gapPanel, recordPanel, verdictPanel } from './forms.ts'

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

export function testCard(detail: Detail, test: Test) {
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
									<span class="tag">${words(assertion.oracleKind)}</span>
								</li>`
						)}
					</ul>`
				: html`<p class="test-note">No assertions yet. A blocking gap must be answered first.</p>`
		}
	</article>`
}

function decisionFor(plan: Plan, gap: Gap) {
	return plan.decisions.find((decision) => decision.id === gap.decisionId)
}

function gapRow(detail: Detail, gap: Gap) {
	const decision = decisionFor(detail.plan, gap)
	const pending = detail.pendingDecisions.find((item) => item.gapId === gap.id)
	const answerable = gap.status === 'open' && !pending && detail.revision === detail.latestRevision
	const closed = gap.status !== 'open'
	return html`<li class="gap${closed ? ' gap-closed' : ''}" id="${gap.id}" data-key="gap:${gap.id}">
		<details data-open-key="gap:${gap.id}" ${closed ? '' : html`open`}>
			<summary>
				<div class="gap-h">
					<span class="id mono">${gap.id}</span>
					${pill(gap.severity)} ${pill(gap.status)}
					<span class="gap-refs muted"
						>${
							[...gap.requirementIds, ...gap.testIds].length
								? `affects ${[...gap.requirementIds, ...gap.testIds].join(', ')}`
								: 'affects the whole plan'
						}</span
					>
				</div>
				<span class="gap-q">${gap.question}</span>
			</summary>
			<p class="muted">${gap.consequence}</p>
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
			}
		</details>
	</li>`
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
	if (!plan.decisions.length && !plan.assumptions.length)
		return html`<p class="empty-line">No decision applied yet.</p>`
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
		<span aria-hidden="true" class="arrow">→</span><span class="sr-only">changed to</span>
		<span class="now">${line.slice(arrow + 3)}</span>
	</li>`
}

export function history(store: Store, detail: Detail, full = false) {
	const revisions = planHistory(store, detail.planId, full ? undefined : 6).reverse()
	return html`<ol class="history">
			${revisions.map(
				(item, index) =>
					html`<li class="${item.revision === detail.revision ? 'current' : ''}">
						<details data-open-key="revision:${item.revision}" ${index === 0 ? html`open` : ''}>
							<summary>
								<div class="record-h">
									<a class="mono" href="/plans/${detail.planId}@${item.revision}"
										>${detail.planId}@${item.revision}</a
									>
									<span class="muted">by ${item.actor} · ${time(item.at)}</span>
									<code class="muted small" title="${item.sha256}">${short(item.sha256)}</code>
								</div>
							</summary>
							${
								item.changes.length
									? html`<ul class="changes">
											${item.changes.map(changeLine)}
										</ul>`
									: html`<p class="muted small">First revision.</p>`
							}
						</details>
					</li>`
			)}
		</ol>
		${!full && detail.latestRevision > 6 ? html`<a class="history-more btn" href="/plans/${detail.planId}@${detail.revision}/history" data-history-more>Show full history</a>` : ''}`
}

function approvalPanel(context: Context, detail: Detail, state: FormState | null) {
	const subject = `${detail.planId}@${detail.revision}`
	const latest = detail.approval.latest
	if (detail.approval.policy === 'none')
		return recordPanel('Approval', html`<p class="help">The target policy does not require plan approval.</p>`)
	if (latest && !state)
		return recordPanel(
			'Approval',
			html`<p class="subj">${pill(latest.verdict)} ${subject}</p>
				<p class="help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>
				${latest.sha256 !== detail.sha256 ? banner('warn', 'This decision was for another digest.') : ''}`
		)
	return verdictPanel(
		context,
		{
			action: `/plans/${subject}`,
			subject,
			question: `Approve ${subject}?`,
			sha256: detail.sha256,
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
	return html`<aside class="side" aria-label="Decision">
		${content}
		<p class="back"><a href="/">← Back to inbox</a></p>
	</aside>`
}

export function planPage(
	store: Store,
	context: Context,
	planId: string,
	revision: number,
	state: FormState | null = null
): Page {
	const detail = planDetail(store, planId, revision)
	const { plan } = detail
	const subject = `${planId}@${revision}`
	const meta = html`<div class="meta">
		${pill(detail.approval.state)}
		<span class="pill">target <span class="mono">${plan.target.targetId}@${plan.target.revision}</span></span>
		<span class="pill" title="${detail.sha256}">sha256 <span class="mono">${short(detail.sha256)}</span></span>
	</div>`
	const pending = detail.pendingDecisions.length
		? banner(
				'info',
				html`${plural(detail.pendingDecisions.length, 'decision')}
				${detail.pendingDecisions.length === 1 ? 'waits' : 'wait'} for the next revision:
				${detail.pendingDecisions.map((item) => `${item.gapId} ${words(item.kind)}`).join(', ')}.`
			)
		: ''
	const runs = runList(store, { planId }).slice().reverse()
	const body = html`${heading(subject, plan.objective, meta)}
		${revision === detail.latestRevision ? html`<p class="actions"><a class="btn" href="/plans/${subject}/edit">Edit plan, tests and requirements</a></p>` : ''}
		<div data-region="banners">${newerBanner(detail)} ${pending}</div>
		<div class="split">
			<div class="main-col">
				<nav class="jump" aria-label="On this page">
					<a href="#tests">Tests</a><a href="#gaps">Gaps</a><a href="#requirements">Requirements</a
					><a href="#decisions">Decisions</a><a href="#plan-runs">Runs</a><a href="#history">History</a>
				</nav>
				<section aria-labelledby="tests" data-region="tests">
					<h2 id="tests">Tests <span class="n">${plan.tests.length}</span></h2>
					<div class="stack">${plan.tests.map((test) => testCard(detail, test))}</div>
				</section>
				<section aria-labelledby="gaps" data-region="gaps">
					<h2 id="gaps">Gaps <span class="n">${plan.gaps.length}</span></h2>
					${
						plan.gaps.length
							? html`<ul class="gaps">
									${plan.gaps.map((gap) => gapRow(detail, gap))}
								</ul>`
							: html`<p class="empty-line">No gaps.</p>`
					}
				</section>
				<section aria-labelledby="requirements">
					<h2 id="requirements">Requirements and coverage</h2>
					${requirementsTable(plan)}
				</section>
				<section aria-labelledby="decisions">
					<h2 id="decisions">Decisions</h2>
					${decisionsList(plan)}
				</section>
				<section aria-labelledby="plan-runs" data-region="plan-runs">
					<h2 id="plan-runs">Runs <span class="n">${runs.length}</span></h2>
					${
						runs.length
							? html`<ul class="records">
									${runs.map((run) => html`<li><a class="mono" href="/runs/${run.runId}">${run.runId}</a> <span class="muted">· revision ${run.revision} · ${run.build} · ${time(run.startedAt)}</span> ${pill(run.completion ?? run.state)}</li>`)}
								</ul>`
							: html`<p class="empty-line">No runs yet.</p>`
					}
				</section>
				<section aria-labelledby="history" data-region="history">
					<h2 id="history">History</h2>
					${history(store, detail)}
				</section>
			</div>
			${side(approvalPanel(context, detail, state))}
		</div>`
	return { title: subject, section: 'plans', subjects: [`plan:${planId}`, 'inbox'], body }
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
	const gap = plan.gaps.find((item) => item.id === gapId)
	if (!gap) throw new Error(`Unknown gap ${gapId} in ${planId}@${revision}`)
	const subject = `${planId}@${revision}`
	const pending = detail.pendingDecisions.find((item) => item.gapId === gap.id)
	const decision = decisionFor(plan, gap)
	const tests = plan.tests.filter((test) => test.gapIds.includes(gap.id))
	const requirements = plan.requirements.filter((requirement) => gap.requirementIds.includes(requirement.id))
	const latest = detail.revision === detail.latestRevision
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
		<div data-region="banners">${newerBanner(detail)}</div>
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
							: html`<p class="empty-line">No test names this gap.</p>`
					}
				</section>
			</div>
			${side(panel)}
		</div>`
	return { title: `${planId} ${gap.id}`, section: 'inbox', subjects: [`plan:${planId}`, 'inbox'], body }
}
