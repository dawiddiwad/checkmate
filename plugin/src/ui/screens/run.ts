import type { Store } from '../../store.ts'
import { evidenceBytes, planDetail, runDetail } from '../../views.ts'
import { decisionToken, planRevision, planRunGaps } from '../../plans.ts'
import type { EvidenceFile } from '../evidence.ts'
import type { FormState } from '../forms.ts'
import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { resultCell } from '../components/board.ts'
import { button, formButton } from '../components/button.ts'
import type { TableCell } from '../components/data-table.ts'
import { dataTable, tableRow } from '../components/data-table.ts'
import { evidenceList } from '../components/evidence-viewer.ts'
import { downloadMenu } from '../components/menu.ts'
import { notice } from '../components/notice.ts'
import { statusCounts, statusMark } from '../components/status-mark.ts'
import { shownAsText } from '../evidence.ts'
import { emptyState, recordPanel, returnFields, verdictPanel } from '../forms.ts'
import { costText, hasMetadata, html, join, metadataList, plural, short, time, words } from '../html.ts'
import { runStatus } from '../lists.ts'
import { navigator, reviewOf } from '../review.ts'

type Detail = ReturnType<typeof runDetail>
type Evidence = Detail['tests'][number]['evidence'][number]
type RunTest = Detail['tests'][number]
type Assertion = RunTest['assertions'][number]

function runFiles(store: Store, items: Evidence[]): EvidenceFile[] {
	return items.map((item) => ({
		name: item.name,
		mediaType: item.mediaType,
		size: item.size,
		href: `/evidence/${item.id}`,
		text: shownAsText(item.mediaType, item.size)
			? () => new TextDecoder().decode(evidenceBytes(store, item.id).bytes)
			: null,
	}))
}

function runEvidence(store: Store, items: Evidence[]) {
	return evidenceList(runFiles(store, items))
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
		findings.map(
			(finding) =>
				html`<a href="${runItemHref(detail.runId, `finding:${finding.id}`)}" data-go>finding ${finding.id}</a>`
		),
		', '
	)}`
}

function assertionRow(store: Store, detail: Detail, test: RunTest, assertion: Assertion) {
	const reference = `${test.testId}.${assertion.assertionId}`
	if (!assertion.result)
		return html`<li class="asr waiting" id="${reference}" data-key="${reference}">
			<div class="asr-row">
				${resultCell({ result: null })}<span class="aid">${assertion.assertionId}</span>
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
				${resultCell({ result: assertion.result })}<span class="aid">${assertion.assertionId}</span>
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
				<p class="sc-muted sc-note">${words(assertion.checkKind)} · ${words(assertion.result)}</p>
				${runEvidence(store, assertion.evidence)}
			</div>
		</details>
	</li>`
}

function testState(test: RunTest, detail: Detail) {
	if (test.outcome) return statusMark({ state: test.outcome })
	if (detail.state === 'finalized') return statusMark({ state: 'not_run' })
	return test.assertions.some((assertion) => assertion.result)
		? statusMark({ state: 'running' })
		: statusMark({ state: 'waiting' })
}

function testCard(store: Store, detail: Detail, test: RunTest) {
	const passed = test.assertions.filter((assertion) => assertion.result === 'passed').length
	const recorded = test.assertions.filter((assertion) => assertion.result).length
	const announce = test.outcome ? `${test.testId} closed: ${words(test.outcome)}` : `${test.testId} running`
	return html`<article class="test" id="${test.testId}" data-key="card:${test.testId}" data-announce="${announce}">
		<header class="test-h">
			${testState(test, detail)}
			<span class="id">${test.testId}</span>
			<h3>${test.title}</h3>
			<span class="count"
				>${passed} of ${test.assertions.length}
				passed${
					recorded < test.assertions.length ? ` · ${test.assertions.length - recorded} without result` : ''
				}</span
			>
		</header>
		${hasMetadata(test.metadata) ? html`<p class="test-note">${metadataList(test.metadata)}</p>` : ''}
		${test.reason ? html`<p class="test-note">${test.reason}</p>` : ''}
		${test.evidence.length ? html`<div class="test-ev">${runEvidence(store, test.evidence)}</div>` : ''}
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
	return html`<dl class="sc-facts is-cols" data-region="summary">
		<dt>Completion</dt>
		<dd>${result ? words(result.completion) : 'running'}</dd>
		<dt>Coverage</dt>
		<dd>${result ? words(result.coverage.status) : '—'}</dd>
		<dt>Tests</dt>
		<dd>${statusCounts({ counts: outcomeCounts(detail) })}</dd>
		<dt>Cleanup</dt>
		<dd>${result ? words(result.cleanup.status) : '—'}</dd>
		<dt>${detail.observedModels.length > 1 ? 'Models' : 'Model'}</dt>
		<dd><code>${detail.observedModels.join(', ') || '—'}</code></dd>
		<dt>Cost</dt>
		<dd>${costText(detail.costUsd, detail.costPartial)}</dd>
	</dl>`
}

function runItemHref(runId: string, key: string, hash = '') {
	return `/runs/${runId}${key === 'summary' ? '' : `?item=${encodeURIComponent(key)}`}${hash}`
}

function findingCard(store: Store, detail: Detail, finding: Detail['findings'][number]) {
	const evidence = detail.tests.flatMap((test) => [
		...test.evidence,
		...test.assertions.flatMap((assertion) => assertion.evidence),
	])
	return html`<article class="finding" id="${finding.id}" data-key="card:${finding.id}">
		<header class="test-h">
			${statusMark({ state: finding.type })} <span class="id">${finding.id}</span>
			<h3>${finding.title}</h3>
			<span class="count">${statusMark({ state: finding.severity })}</span>
		</header>
		<div class="test-b">
			<div class="sc-compare">
				<div>
					<span class="sc-kicker">Expected</span>
					<p>${finding.expected}</p>
				</div>
				<div>
					<span class="sc-kicker">Observed</span>
					<p>${finding.observed}</p>
				</div>
			</div>
			${
				finding.reproduction.length
					? html`<div>
							<span class="sc-kicker">Reproduction</span>
							<ol class="sc-steps">
								${finding.reproduction.map((step) => html`<li>${step}</li>`)}
							</ol>
						</div>`
					: ''
			}
			<p class="sc-muted sc-note">
				Assertions
				${join(
					finding.assertionIds.map((id) => assertionLink(detail.runId, id)),
					', '
				)}${finding.requirementIds.length ? ` · requirements ${finding.requirementIds.join(', ')}` : ''}
			</p>
			${hasMetadata(finding.metadata) ? html`<p>${metadataList(finding.metadata)}</p>` : ''}
			${runEvidence(
				store,
				evidence.filter((item) => finding.evidenceIds.includes(item.id))
			)}
		</div>
	</article>`
}

function assertionLink(runId: string, reference: string) {
	const testId = reference.split('.')[0]
	return html`<a class="sc-mono" href="${runItemHref(runId, `test:${testId}`, `#${reference}`)}" data-go
		>${reference}</a
	>`
}

export type AdoptError = { gapId: string; message: Html | string }

function adoptForm(context: Context, detail: Detail, gapId: string, sha256: string) {
	return html`<form method="post" action="/runs/${detail.runId}/gaps/${gapId}" class="inline-form">
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />
		${
			context.actor
				? ''
				: html`<input
						name="actor"
						required
						autocomplete="name"
						placeholder="Your name"
						aria-label="Your name"
					/>`
		}
		${formButton({ label: 'Bring into plan', inline: true })}
	</form>`
}

function gapCard(
	store: Store,
	context: Context,
	detail: Detail,
	gap: Detail['newGaps'][number],
	adoptError: AdoptError | null
) {
	const revision = planRevision(store, detail.planId)
	const latest = `${detail.planId}@${revision.plan.revision}`
	const adopted = planRunGaps(store, detail.planId).some(
		(item) => item.runId === detail.runId && item.adopted && item.gap.id === gap.id
	)
	return html`<div class="gap" id="${gap.id}" data-key="card:${gap.id}">
		<div class="gap-h">
			<span class="id sc-mono">${gap.id}</span> ${statusMark({ state: gap.severity })}
			${statusMark({ state: gap.status })}
			<span class="gap-refs sc-muted"
				>affects ${[...gap.requirementIds, ...gap.testIds].join(', ') || 'the plan'}</span
			>
		</div>
		<p class="gap-q">${gap.question}</p>
		<p class="sc-muted">${gap.consequence}</p>
		<div class="sc-row-btns">
			${
				adopted
					? html`${statusMark({ state: 'resolved', label: 'in plan' })}
							<a href="/plans/${latest}#${gap.id}">${latest}</a>`
					: html`${formButton({ label: 'Answer', href: `/plans/${latest}/gaps/${gap.id}#answer`, inline: true })}
						${adoptForm(context, detail, gap.id, revision.sha256)}`
			}
		</div>
		${adoptError?.gapId === gap.id ? html`<p class="sc-error" role="alert">${adoptError.message}</p>` : ''}
	</div>`
}

function coverage(store: Store, detail: Detail) {
	const result = detail.result
	if (!result) return html`<p class="sc-empty is-line">Coverage is known when the run finishes.</p>`
	const plan = planDetail(store, detail.planId, detail.revision).plan
	const requirements = new Map(plan.requirements.map((item) => [item.id, item]))
	return dataTable({
		columns: ['ID', 'Requirement', 'Tests', 'Coverage'],
		rows: result.coverage.requirements.map((row) =>
			tableRow({
				cells: [
					{ content: row.requirementId, attrs: { class: 'is-mono' } },
					html`${requirements.get(row.requirementId)?.text ?? ''}
					${row.reason ? html`<div class="sc-muted sc-note">${row.reason}</div>` : ''}
					${
						hasMetadata(requirements.get(row.requirementId)?.metadata)
							? html`<div class="sc-note">
									${metadataList(requirements.get(row.requirementId)?.metadata)}
								</div>`
							: ''
					}`,
					{ content: row.testIds.join(', ') || '–', attrs: { class: 'is-mono' } },
					statusMark({ state: row.status }),
				],
			})
		),
		scroll: true,
	})
}

function cleanup(detail: Detail) {
	const result = detail.result
	return html`<dl class="sc-facts">
		<dt>Cleanup</dt>
		<dd>
			${result ? html`${statusMark({ state: result.cleanup.status })} ${result.cleanup.reason}` : html`<span class="sc-muted">Not finished.</span>`}
		</dd>

		<dt>Attempts</dt>
		<dd>
			<ul class="sc-plain">
				${detail.attempts.map(
					(attempt) =>
						html`<li>
							Attempt ${attempt.attempt} · ${time(attempt.startedAt)} · ${attempt.actor}
							${
								attempt.workerInterruptedAt
									? html` · Delegated worker interrupted ${time(attempt.workerInterruptedAt)}`
									: ''
							}
						</li>`
				)}
			</ul>
		</dd>

		<dt>Tool session</dt>
		<dd class="sc-mono">${detail.toolSession}</dd>

		<dt>Target</dt>
		<dd class="sc-mono">${detail.target}</dd>

		<dt>Instance</dt>
		<dd>
			<a
				class="sc-mono"
				href="/settings/targets/${detail.instance.targetId}#instance-${detail.instance.instanceId}"
				>${detail.instance.instanceId}</a
			>${detail.instance.environment ? html` · ${detail.instance.environment}` : ''}${detail.instance.retired ? html` · ${statusMark({ state: 'retired' })}` : ''}
		</dd>

		${
			detail.request.retestOf
				? html`
						<dt>Retest of</dt>
						<dd>
							<a class="sc-mono" href="/runs/${detail.request.retestOf}">${detail.request.retestOf}</a>
						</dd>
					`
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
	return notice({
		kind: 'warn',
		content: html`<p>
			${plural(rows.length, 'check')} ${rows.length === 1 ? 'is' : 'are'} inconclusive:
			${join(
				rows.map((row) => html`${assertionLink(detail.runId, row.reference)} ${row.reason}`),
				'; '
			)}
		</p>`,
	})
}

function retestList(detail: Detail) {
	if (!detail.retest.length) return ''
	const labels = { fixed: 'Fixed', not_fixed: 'Not fixed', not_retested: 'Not retested' }
	return html`<div class="sc-field">
		<p class="sc-label">Retest verdicts</p>
		<ul class="plist retest-verdicts">
			${detail.retest.map((item) => html`<li><a href="/runs/${encodeURIComponent(item.runId)}?item=finding%3A${encodeURIComponent(item.findingId)}">${item.runId}/${item.findingId}</a> · ${item.title} · ${labels[item.verdict]} · ${item.testIds.join(', ')}</li>`)}
		</ul>
	</div>`
}

export function decisionPanel(
	store: Store,
	context: Context,
	detail: Detail,
	state: FormState | null,
	extra: Html,
	foot: Html
) {
	const result = detail.result
	if (!result)
		return recordPanel(
			'Decision',
			html`<p class="subj">${detail.runId} is in progress.</p>
				<p class="sc-help">The decision opens when the run finishes. This page updates live.</p>
				${foot}`
		)
	if (result.acceptance === 'not_required')
		return recordPanel(
			'Decision',
			html`<p class="sc-help">The target policy does not require result acceptance.</p>
				${retestList(detail)} ${foot}`
		)
	const latest = result.latestDecision
	if (latest && !state)
		return recordPanel(
			'Decision',
			html`<p class="subj">
					${statusMark({ state: latest.verdict, label: latest.verdict === 'approved' ? 'accepted' : 'rejected' })}
					${detail.runId}
				</p>
				<p class="sc-help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>
				${retestList(detail)} ${foot}`,
			`${detail.runId} was ${latest.verdict === 'approved' ? 'accepted' : 'rejected'} by ${latest.actor}. Review it before you decide.`
		)
	return verdictPanel(
		context,
		{
			action: `/runs/${detail.runId}`,
			subject: detail.runId,
			question: `Accept ${detail.runId}?`,
			sha256: result.sha256,
			token: decisionToken(store, 'result', detail.runId),
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
			extra,
			foot,
			intro: html`${retestList(detail)}${inconclusiveList(detail)}`,
		},
		state ?? emptyState()
	)
}

function itemRow(
	runId: string,
	key: string,
	selected: string,
	label: string,
	cells: TableCell[],
	href = runItemHref(runId, key)
) {
	return tableRow({
		attrs: {
			'data-row': true,
			'data-key': key,
			'data-href': href,
			'data-label': label,
			class: key === selected ? 'is-open' : undefined,
		},
		cells: cells.map((value, index) =>
			index === 1 ? { content: html`<a href="${href}">${label}</a>`, attrs: { class: 'is-mono' } } : value
		),
	})
}

function section(id: string, title: string, rows: Html[], columns: string[]) {
	if (!rows.length) return ''
	return html`<section class="sc-sec" aria-labelledby="${id}">
		<h2 class="sc-sec-h" id="${id}">${title}<b>${rows.length}</b></h2>
		${dataTable({ columns, rows, scroll: true })}
	</section>`
}

function passedCount(test: RunTest) {
	const passed = test.assertions.filter((assertion) => assertion.result === 'passed').length
	return `${passed} of ${test.assertions.length} checks passed`
}

function sentence(text: string) {
	return /[.!?]$/.test(text) ? text : `${text}.`
}

function muted(content: Html | string) {
	return { content, attrs: { class: 'is-muted' } }
}

function title(content: Html | string) {
	return { content, attrs: { class: 'is-title' } }
}

function notPassed(detail: Detail, selected: string) {
	const rows = detail.tests.flatMap((test) =>
		test.assertions
			.filter((assertion) => assertion.result && assertion.result !== 'passed')
			.map((assertion) => {
				const reference = `${test.testId}.${assertion.assertionId}`
				return itemRow(
					detail.runId,
					`check:${reference}`,
					selected,
					reference,
					[
						statusMark({ state: assertion.result ?? 'waiting' }),
						'',
						title(
							html`${sentence(assertion.check)}${assertion.observed ? html` Observed: ${assertion.observed}` : ''}`
						),
						muted(words(assertion.result ?? '')),
					],
					runItemHref(detail.runId, `test:${test.testId}`, `#${reference}`)
				)
			})
	)
	return section('not-passed', 'Not passed', rows, ['Result', 'Check', 'What happened', 'Kind'])
}

function runSections(detail: Detail, selected: string) {
	const result = detail.result
	const tests = detail.tests.map((test) =>
		itemRow(detail.runId, `test:${test.testId}`, selected, test.testId, [
			testState(test, detail),
			'',
			title(test.title),
			muted(passedCount(test)),
		])
	)
	const found = detail.findings.map((finding) =>
		itemRow(detail.runId, `finding:${finding.id}`, selected, finding.id, [
			statusMark({ state: finding.severity }),
			'',
			title(finding.title),
			muted(words(finding.type)),
		])
	)
	const gaps = detail.newGaps.map((gap) =>
		itemRow(detail.runId, `gap:${gap.id}`, selected, gap.id, [
			statusMark({ state: gap.severity }),
			'',
			title(gap.question),
			muted(words(gap.status)),
		])
	)
	const record = [
		itemRow(detail.runId, 'coverage', selected, 'Coverage', [
			result
				? statusMark({ state: result.coverage.status })
				: statusMark({ state: 'pending', label: 'not known yet' }),
			'',
			title(result ? plural(result.coverage.requirements.length, 'requirement') : 'Known when the run finishes.'),
		]),
		itemRow(detail.runId, 'cleanup', selected, 'Cleanup', [
			result
				? statusMark({ state: result.cleanup.status })
				: statusMark({ state: 'pending', label: 'not finished' }),
			'',
			title(plural(detail.attempts.length, 'attempt')),
		]),
	]
	return html`<section class="sc-sec" aria-labelledby="overview">
			<h2 class="sc-sec-h" id="overview">Overview</h2>
			${strip(detail)}
		</section>
		${detail.warnings.map((warning) => notice({ kind: 'warn', content: warning }))} ${notPassed(detail, selected)}
		${section('tests', 'Tests', tests, ['Result', 'Test', 'Name', 'Checks'])}
		${section('findings', 'Findings', found, ['Severity', 'Finding', 'Title', 'Kind'])}
		${section('new-gaps', 'New gaps', gaps, ['State', 'Gap', 'Question', 'Kind'])}
		${section('record', 'Record', record, ['State', 'Record', 'Detail'])}`
}

function runHead(detail: Detail, label: string | null) {
	const result = detail.result
	const run = html`<a href="/runs/${detail.runId}">${detail.runId}</a>`
	return html`<header class="sc-h">
		<div class="sc-h-text">
			<p class="sc-crumb">
				<a href="/runs">Runs</a> ›
				<a href="/plans/${detail.planId}@${detail.revision}">${detail.planId}@${detail.revision}</a> · build
				${detail.build} · instance ${detail.instance.instanceId}${label ? html` › ${run}` : ''}
			</p>
			<h1>${label ? `${detail.runId} · ${label}` : detail.runId}</h1>
			<p class="sc-h-meta" data-region="state">
				${runStatus({ state: detail.state, acceptance: detail.result?.acceptance ?? null })}
				<span
					>started
					${time(detail.startedAt)}${result ? html` · finished ${time(result.finishedAt)}` : ''}</span
				>
			</p>
		</div>
		${
			result?.acceptance === 'pending'
				? html`<div class="sc-h-act">
						${button({ label: `Decide on ${detail.runId}`, href: '#decide', emphasis: 'unblocks' })}
					</div>`
				: ''
		}
	</header>`
}

function decisionSide(store: Store, context: Context, detail: Detail, state: FormState | null, selected: string) {
	const report = detail.result
		? downloadMenu({
				label: 'Download report',
				base: `/runs/${detail.runId}/report`,
				note: 'The HTML report is self-contained and print-ready. Open it and print to PDF. JUnit XML is for CI.',
				formats: ['html', 'md', 'json', 'junit'],
			})
		: html`<span class="sc-muted sc-note">The report is ready when the run finishes.</span>`
	return html`<div class="sc-side">
		${decisionPanel(
			store,
			context,
			detail,
			state,
			returnFields({ key: selected }, runItemHref(detail.runId, selected)),
			html`<div class="sc-row-btns">${report}</div>`
		)}
	</div>`
}

export function runPage(
	store: Store,
	context: Context,
	runId: string,
	params: URLSearchParams = new URLSearchParams(),
	state: FormState | null = null,
	adoptError: AdoptError | null = null
): Page {
	const detail = runDetail(store, runId)
	const interruption = detail.attempts.at(-1)?.workerInterruptedAt
	const asked = adoptError ? `gap:${adoptError.gapId}` : (params.get('item') ?? 'summary')
	const test = detail.tests.find((item) => `test:${item.testId}` === asked)
	const finding = detail.findings.find((item) => `finding:${item.id}` === asked)
	const gap = detail.newGaps.find((item) => `gap:${item.id}` === asked)
	const record = asked === 'coverage' || asked === 'cleanup'
	const selected = test || finding || gap || record ? asked : 'summary'
	const label =
		test?.testId ?? finding?.id ?? gap?.id ?? (asked === 'coverage' ? 'Coverage' : record ? 'Cleanup' : null)
	const list = `/runs/${runId}`
	const main = test
		? testCard(store, detail, test)
		: finding
			? findingCard(store, detail, finding)
			: gap
				? gapCard(store, context, detail, gap, adoptError)
				: asked === 'coverage'
					? html`<section class="sc-sec" aria-labelledby="coverage">
							<h2 class="sc-sec-h" id="coverage">Coverage</h2>
							${coverage(store, detail)}
						</section>`
					: asked === 'cleanup'
						? html`<section class="sc-sec" aria-labelledby="cleanup">
								<h2 class="sc-sec-h" id="cleanup">Cleanup and attempts</h2>
								${cleanup(detail)}
							</section>`
						: runSections(detail, selected)
	return {
		viewer: true,
		title: label ? `${runId} · ${label}` : runId,
		section: 'runs',
		subjects: [`run:${runId}`, 'inbox', ...(detail.result ? [] : [`plan:${detail.planId}`])],
		status: adoptError ? 422 : undefined,
		crumbs: [
			['Plans', '/'],
			[detail.planId, `/plans/${detail.planId}`],
			[runId, label ? list : null],
			...(label ? [[label, null] as [string, null]] : []),
		],
		back: label ? list : `/plans/${detail.planId}@${detail.revision}`,
		nav: navigator(reviewOf(store, detail.planId), 'plan'),
		body: html`${runHead(detail, label)}
			${
				!detail.result && interruption
					? notice({
							kind: 'info',
							content: html`<b>Delegated worker interrupted ${time(interruption)}.</b> Recorded results
								stay. Run <code>checkmate run resume ${runId}</code> to continue. To end the run, use
								<code>checkmate run finish ${runId}</code> with a completion and cleanup result.`,
						})
					: ''
			}
			<div class="sc-split">
				<div
					class="sc-stack is-loose"
					aria-label="${label ?? 'Overview'}"
					data-region="run-detail"
					data-key="detail:${selected}"
					data-stale-message="This run changed. Review it before you decide."
				>
					${main}
				</div>
				${decisionSide(store, context, detail, state, selected)}
			</div>`,
	}
}
