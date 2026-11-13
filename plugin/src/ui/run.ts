import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import { evidenceBytes, planDetail, runDetail } from '../views.ts'
import { clock, html, icon, join, pill, plural, short, time, words } from './html.ts'
import { downloads, heading } from './layout.ts'
import { emptyState, recordPanel, verdictPanel } from './forms.ts'
import { counts } from './lists.ts'

type Detail = ReturnType<typeof runDetail>
type Evidence = Detail['tests'][number]['evidence'][number]
type RunTest = Detail['tests'][number]
type Assertion = RunTest['assertions'][number]

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const textTypes = ['text/plain', 'application/json', 'text/markdown']
const inlineLimit = 64 * 1024

export function size(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function evidenceItem(store: Store, item: Evidence) {
	const href = `/evidence/${item.id}`
	const caption = html`<span class="ev-name">${item.name}</span> <span class="muted">${size(item.size)}</span>`
	if (imageTypes.includes(item.mediaType))
		return html`<figure class="ev ev-image">
			<a href="${href}" data-view-image data-name="${item.name}">
				<img src="${href}" alt="Evidence ${item.name}" loading="lazy" />
			</a>
			<figcaption>${caption}</figcaption>
		</figure>`
	if (textTypes.includes(item.mediaType) && item.size <= inlineLimit) {
		const text = new TextDecoder().decode(evidenceBytes(store, item.id).bytes)
		return html`<figure class="ev ev-text">
			<figcaption>${caption} <a href="${href}" download="${item.name}">Download</a></figcaption>
			<pre tabindex="0">${text}</pre>
		</figure>`
	}
	return html`<a class="chip" href="${href}" download="${item.name}">↓ ${item.name} · ${size(item.size)}</a>`
}

function evidenceChips(items: Evidence[]) {
	if (!items.length) return ''
	return html`<p class="evidence">
		${items.map(
			(item) =>
				html`<a
					class="chip"
					href="/evidence/${item.id}"
					${imageTypes.includes(item.mediaType) ? html`data-view-image data-name="${item.name}"` : html`download="${item.name}"`}
					>${item.name} · ${size(item.size)}</a
				>`
		)}
	</p>`
}

function evidenceList(store: Store, items: Evidence[]) {
	if (!items.length) return ''
	return html`<div class="evidence">${items.map((item) => evidenceItem(store, item))}</div>`
}

function tone(result: string | null) {
	if (result === 'failed') return 'failed'
	if (result === 'inconclusive') return 'unsure'
	if (result === 'not_checked') return 'warn'
	return ''
}

function findingRefs(detail: Detail, reference: string) {
	const findings = detail.findings.filter((finding) => finding.assertionIds.includes(reference))
	if (!findings.length) return ''
	return html` ·
	${join(
		findings.map((finding) => html`<a href="#${finding.id}">finding ${finding.id}</a>`),
		', '
	)}`
}

function assertionRow(store: Store, detail: Detail, test: RunTest, assertion: Assertion) {
	const reference = `${test.testId}.${assertion.assertionId}`
	if (!assertion.result)
		return html`<li class="asr waiting" id="${reference}" data-key="${reference}">
			<div class="asr-row">
				${icon(null)}<span class="aid">${assertion.assertionId}</span>
				<div class="asr-text">
					${assertion.check}
					<div class="obs">No result yet.</div>
				</div>
			</div>
		</li>`
	const open = assertion.result !== 'passed'
	return html`<li
		class="asr ${tone(assertion.result)}"
		id="${reference}"
		data-key="${reference}"
		data-announce="${reference} ${words(assertion.result)}"
	>
		<details ${open ? html`open` : ''} data-open-key="${reference}">
			<summary class="asr-row">
				${icon(assertion.result)}<span class="aid">${assertion.assertionId}</span>
				<div class="asr-text">
					${assertion.check}
					${
						assertion.observed
							? html`<div class="obs">
									Observed: <code>${assertion.observed}</code>${findingRefs(detail, reference)}
								</div>`
							: ''
					}
				</div>
			</summary>
			<div class="asr-body">
				${assertion.reason ? html`<p class="reason"><strong>Reason</strong> ${assertion.reason}</p>` : ''}
				<p class="muted small">${words(assertion.checkKind)} · ${words(assertion.result)}</p>
				${evidenceList(store, assertion.evidence)}
			</div>
		</details>
	</li>`
}

function testState(test: RunTest, detail: Detail) {
	if (test.outcome) return pill(test.outcome)
	if (detail.state === 'finalized') return pill('not_run')
	return test.assertions.some((assertion) => assertion.result)
		? pill('started', 'running')
		: pill('pending', 'waiting')
}

function testCard(store: Store, detail: Detail, test: RunTest) {
	const passed = test.assertions.filter((assertion) => assertion.result === 'passed').length
	const recorded = test.assertions.filter((assertion) => assertion.result).length
	const announce = test.outcome ? `${test.testId} closed: ${words(test.outcome)}` : `${test.testId} running`
	return html`<article class="test" id="${test.testId}" data-key="test:${test.testId}" data-announce="${announce}">
		<header class="test-h">
			${testState(test, detail)}
			<a class="id" href="#${test.testId}">${test.testId}</a>
			<h3>${test.title}</h3>
			<span class="count"
				>${passed} of ${test.assertions.length}
				passed${
					recorded < test.assertions.length ? ` · ${test.assertions.length - recorded} without result` : ''
				}</span
			>
		</header>
		${test.reason ? html`<p class="test-note">${test.reason}</p>` : ''}
		${test.evidence.length ? html`<div class="test-ev">${evidenceList(store, test.evidence)}</div>` : ''}
		<ul class="asrs">
			${test.assertions.map((assertion) => assertionRow(store, detail, test, assertion))}
		</ul>
	</article>`
}

function outcomeCounts(detail: Detail) {
	const values: Record<string, number> = {}
	for (const test of detail.tests) if (test.outcome) values[test.outcome] = (values[test.outcome] ?? 0) + 1
	return values
}

function strip(detail: Detail) {
	const result = detail.result
	return html`<div class="strip" data-region="summary">
		<div><small>Completion</small><strong>${result ? words(result.completion) : 'running'}</strong></div>
		<div><small>Coverage</small><strong>${result ? words(result.coverage.status) : '–'}</strong></div>
		<div><small>Tests</small><strong>${counts(outcomeCounts(detail))}</strong></div>
		<div><small>Cleanup</small><strong>${result ? words(result.cleanup.status) : '–'}</strong></div>
	</div>`
}

function findings(store: Store, detail: Detail) {
	if (!detail.findings.length) return html`<p class="empty-line">No findings.</p>`
	const evidence = detail.tests.flatMap((test) => [
		...test.evidence,
		...test.assertions.flatMap((assertion) => assertion.evidence),
	])
	return html`<div class="stack">
		${detail.findings.map(
			(finding) =>
				html`<article class="finding" id="${finding.id}" data-key="finding:${finding.id}">
					<header class="test-h">
						${pill(finding.type)} <span class="id">${finding.id}</span>
						<h3>${finding.title}</h3>
						<span class="count">${pill(finding.severity)}</span>
					</header>
					<div class="test-b">
						<div class="compare">
							<div>
								<small>Expected</small>
								<p>${finding.expected}</p>
							</div>
							<div>
								<small>Observed</small>
								<p>${finding.observed}</p>
							</div>
						</div>
						${
							finding.reproduction.length
								? html`<h4 class="minor">Reproduction</h4>
										<ol class="steps">
											${finding.reproduction.map((step) => html`<li>${step}</li>`)}
										</ol>`
								: ''
						}
						<p class="muted small">
							Assertions
							${join(
								finding.assertionIds.map((id) => html`<a class="mono" href="#${id}">${id}</a>`),
								', '
							)}${finding.requirementIds.length ? ` · requirements ${finding.requirementIds.join(', ')}` : ''}
						</p>
						${evidenceChips(evidence.filter((item) => finding.evidenceIds.includes(item.id)))}
					</div>
				</article>`
		)}
	</div>`
}

function newGaps(detail: Detail) {
	if (!detail.newGaps.length) return html`<p class="empty-line">No new gaps.</p>`
	return html`<ul class="gaps">
		${detail.newGaps.map(
			(gap) =>
				html`<li class="gap" id="${gap.id}" data-key="gap:${gap.id}">
					<div class="gap-h">
						<span class="id mono">${gap.id}</span> ${pill(gap.severity)} ${pill(gap.status)}
						<span class="gap-refs muted"
							>affects ${[...gap.requirementIds, ...gap.testIds].join(', ') || 'the plan'}</span
						>
					</div>
					<p class="gap-q">${gap.question}</p>
					<p class="muted">${gap.consequence}</p>
				</li>`
		)}
	</ul>`
}

function coverage(store: Store, detail: Detail) {
	const result = detail.result
	if (!result) return html`<p class="empty-line">Coverage is known when the run finishes.</p>`
	const plan = planDetail(store, detail.planId, detail.revision).plan
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
				${result.coverage.requirements.map(
					(row) =>
						html`<tr>
							<td class="mono">${row.requirementId}</td>
							<td>
								${plan.requirements.find((item) => item.id === row.requirementId)?.text ?? ''}
								${row.reason ? html`<div class="muted small">${row.reason}</div>` : ''}
							</td>
							<td class="mono">${row.testIds.join(', ') || '–'}</td>
							<td>${pill(row.status)}</td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function cleanup(detail: Detail) {
	const result = detail.result
	return html`<dl class="facts">
		<div>
			<dt>Cleanup</dt>
			<dd>
				${result ? html`${pill(result.cleanup.status)} ${result.cleanup.reason}` : html`<span class="muted">Not finished.</span>`}
			</dd>
		</div>
		<div>
			<dt>Attempts</dt>
			<dd>
				<ul class="plain">
					${detail.attempts.map(
						(attempt) =>
							html`<li>Attempt ${attempt.attempt} · ${clock(attempt.startedAt)} · ${attempt.actor}</li>`
					)}
				</ul>
			</dd>
		</div>
		<div>
			<dt>Browser session</dt>
			<dd class="mono">${detail.browserSession}</dd>
		</div>
		<div>
			<dt>Target</dt>
			<dd class="mono">${detail.target}</dd>
		</div>
		${
			detail.request.retestOf
				? html`<div>
						<dt>Retest of</dt>
						<dd><a class="mono" href="/runs/${detail.request.retestOf}">${detail.request.retestOf}</a></dd>
					</div>`
				: ''
		}
	</dl>`
}

function inconclusiveList(detail: Detail) {
	const rows = detail.tests.flatMap((test) =>
		test.assertions
			.filter((assertion) => assertion.result === 'inconclusive')
			.map((assertion) => ({
				reference: `${test.testId}.${assertion.assertionId}`,
				reason: assertion.reason ?? '',
			}))
	)
	if (!rows.length) return ''
	return html`<div class="field-group">
		<p class="lab">Inconclusive · ${rows.length}</p>
		<ul class="plist">
			${rows.map(
				(row) =>
					html`<li>
						<a href="#${row.reference}"><code>${row.reference}</code></a> ${row.reason}
					</li>`
			)}
		</ul>
	</div>`
}

function decisionPanel(context: Context, detail: Detail, state: FormState | null) {
	const result = detail.result
	if (!result)
		return recordPanel(
			'Decision',
			html`<p class="subj">${detail.runId} is in progress.</p>
				<p class="help">The decision opens when the run finishes. This page updates live.</p>`
		)
	if (result.acceptance === 'not_required')
		return recordPanel('Decision', html`<p class="help">The target policy does not require result acceptance.</p>`)
	const latest = result.latestDecision
	if (latest && !state)
		return recordPanel(
			'Decision',
			html`<p class="subj">
					${pill(latest.verdict, latest.verdict === 'approved' ? 'accepted' : 'rejected')} ${detail.runId}
				</p>
				<p class="help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>`
		)
	return verdictPanel(
		context,
		{
			action: `/runs/${detail.runId}`,
			subject: detail.runId,
			question: `Accept ${detail.runId}?`,
			sha256: result.sha256,
			digestLabel: 'Result',
			approve: {
				value: 'accept',
				label: `Accept ${detail.runId}`,
				confirm: 'Confirm acceptance',
				summary: `Accept ${detail.runId} as the record of build ${detail.build}.`,
			},
			reject: {
				value: 'reject',
				label: 'Reject',
				confirm: 'Confirm rejection',
				summary: `Reject ${detail.runId}. Dependent plans stay blocked.`,
			},
			staleMessage: `${detail.runId} has a new result. Review it before you decide.`,
			intro: inconclusiveList(detail),
		},
		state ?? emptyState()
	)
}

function runBadge(detail: Detail) {
	const acceptance = detail.result?.acceptance
	if (!acceptance) return pill('started', 'in progress')
	if (acceptance === 'approved') return pill('approved', 'accepted')
	if (acceptance === 'pending') return pill('pending', 'awaiting acceptance')
	return pill(acceptance)
}

export function runPage(store: Store, context: Context, runId: string, state: FormState | null = null): Page {
	const detail = runDetail(store, runId)
	const sub = html`<a class="mono" href="/plans/${detail.planId}@${detail.revision}"
			>${detail.planId}@${detail.revision}</a
		>
		· build <code>${detail.build}</code> · started ${clock(detail.startedAt)} ·
		${plural(detail.attempts.length, 'attempt')}
		${detail.result ? html`· finished ${time(detail.result.finishedAt)} ago` : ''}`
	const badge = runBadge(detail)
	const report = detail.result
		? downloads(
				'Download report',
				`/runs/${runId}/report`,
				'The HTML report is self-contained and print-ready. Open it and print to PDF.'
			)
		: html`<span class="muted small">The report is ready when the run finishes.</span>`
	const body: Html = html`${heading(
			runId,
			sub,
			html`<div class="meta" data-region="state">${badge} <span class="head-actions">${report}</span></div>`
		)}
		<div class="split">
			<div class="main-col">
				${strip(detail)}
				<nav class="jump" aria-label="On this page">
					<a href="#tests">Tests</a><a href="#findings">Findings</a><a href="#new-gaps">New gaps</a
					><a href="#coverage">Coverage</a><a href="#cleanup">Cleanup</a>
				</nav>
				<section aria-labelledby="tests" data-region="tests">
					<h2 id="tests">Tests <span class="n">${detail.tests.length}</span></h2>
					<div class="stack">${detail.tests.map((test) => testCard(store, detail, test))}</div>
				</section>
				<section aria-labelledby="findings" data-region="findings">
					<h2 id="findings">Findings <span class="n">${detail.findings.length}</span></h2>
					${findings(store, detail)}
				</section>
				<section aria-labelledby="new-gaps" data-region="new-gaps">
					<h2 id="new-gaps">New gaps <span class="n">${detail.newGaps.length}</span></h2>
					${newGaps(detail)}
				</section>
				<section aria-labelledby="coverage" data-region="coverage">
					<h2 id="coverage">Coverage</h2>
					${coverage(store, detail)}
				</section>
				<section aria-labelledby="cleanup" data-region="cleanup">
					<h2 id="cleanup">Cleanup and attempts</h2>
					${cleanup(detail)}
				</section>
			</div>
			<aside class="side" aria-label="Decision">
				${decisionPanel(context, detail, state)}
				<p class="back"><a href="/">← Back to inbox</a></p>
			</aside>
		</div>`
	return { title: runId, section: 'runs', subjects: [`run:${runId}`, 'inbox'], body }
}
