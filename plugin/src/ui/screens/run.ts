import type { Store } from '../../store.ts'
import { evidenceBytes, planDetail, runDetail } from '../../views.ts'
import { decisionToken, planRevision, planRunGaps } from '../../plans.ts'
import type { EvidenceFile } from '../evidence.ts'
import type { FormState } from '../forms.ts'
import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { banner } from '../components/banner.ts'
import { resultCell } from '../components/board.ts'
import { groupHeader, listRow } from '../components/list-row.ts'
import { downloadMenu } from '../components/menu.ts'
import { crumbBar } from '../components/page-heading.ts'
import { statusCounts, statusMark } from '../components/status-mark.ts'
import { evidenceList, shownAsText } from '../evidence.ts'
import { emptyState, recordPanel, returnFields, verdictPanel } from '../forms.ts'
import { hasMetadata, html, join, metadataList, plural, short, time, words } from '../html.ts'
import { runStatus, runUsageLine } from '../lists.ts'
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
				<p class="muted small">${words(assertion.checkKind)} · ${words(assertion.result)}</p>
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
	return html`<div class="strip" data-region="summary">
		<div><small>Completion</small><strong>${result ? words(result.completion) : 'running'}</strong></div>
		<div><small>Coverage</small><strong>${result ? words(result.coverage.status) : '–'}</strong></div>
		<div><small>Tests</small><strong>${statusCounts({ counts: outcomeCounts(detail) })}</strong></div>
		<div><small>Cleanup</small><strong>${result ? words(result.cleanup.status) : '–'}</strong></div>
	</div>`
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
	return html`<a class="mono" href="${runItemHref(runId, `test:${testId}`, `#${reference}`)}" data-go
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
		<button class="btn small">Bring into plan</button>
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
			<span class="id mono">${gap.id}</span> ${statusMark({ state: gap.severity })}
			${statusMark({ state: gap.status })}
			<span class="gap-refs muted"
				>affects ${[...gap.requirementIds, ...gap.testIds].join(', ') || 'the plan'}</span
			>
		</div>
		<p class="gap-q">${gap.question}</p>
		<p class="muted">${gap.consequence}</p>
		<div class="actions">
			${
				adopted
					? html`${statusMark({ state: 'resolved', label: 'in plan' })}
							<a href="/plans/${latest}#${gap.id}">${latest}</a>`
					: html`<a class="btn small" href="/plans/${latest}/gaps/${gap.id}#answer">Answer</a>
							${adoptForm(context, detail, gap.id, revision.sha256)}`
			}
		</div>
		${adoptError?.gapId === gap.id ? html`<p class="form-error" role="alert">${adoptError.message}</p>` : ''}
	</div>`
}

function coverage(store: Store, detail: Detail) {
	const result = detail.result
	if (!result) return html`<p class="none">Coverage is known when the run finishes.</p>`
	const plan = planDetail(store, detail.planId, detail.revision).plan
	const requirements = new Map(plan.requirements.map((item) => [item.id, item]))
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
								${requirements.get(row.requirementId)?.text ?? ''}
								${row.reason ? html`<div class="muted small">${row.reason}</div>` : ''}
								${
									hasMetadata(requirements.get(row.requirementId)?.metadata)
										? html`<div class="small">
												${metadataList(requirements.get(row.requirementId)?.metadata)}
											</div>`
										: ''
								}
							</td>
							<td class="mono">${row.testIds.join(', ') || '–'}</td>
							<td>${statusMark({ state: row.status })}</td>
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
				${result ? html`${statusMark({ state: result.cleanup.status })} ${result.cleanup.reason}` : html`<span class="muted">Not finished.</span>`}
			</dd>
		</div>
		<div>
			<dt>Attempts</dt>
			<dd>
				<ul class="plain">
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
		</div>
		<div>
			<dt>Tool session</dt>
			<dd class="mono">${detail.toolSession}</dd>
		</div>
		<div>
			<dt>Target</dt>
			<dd class="mono">${detail.target}</dd>
		</div>
		<div>
			<dt>Instance</dt>
			<dd>
				<a
					class="mono"
					href="/settings/targets/${detail.instance.targetId}#instance-${detail.instance.instanceId}"
					>${detail.instance.instanceId}</a
				>${detail.instance.environment ? html` · ${detail.instance.environment}` : ''}${detail.instance.retired ? html` · ${statusMark({ state: 'retired' })}` : ''}
			</dd>
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
			${rows.map((row) => html`<li>${assertionLink(detail.runId, row.reference)} ${row.reason}</li>`)}
		</ul>
	</div>`
}

function retestList(detail: Detail) {
	if (!detail.retest.length) return ''
	const labels = { fixed: 'Fixed', not_fixed: 'Not fixed', not_retested: 'Not retested' }
	return html`<div class="field-group">
		<p class="lab">Retest verdicts</p>
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
	extra: Html | null = null
) {
	const result = detail.result
	if (!result)
		return recordPanel(
			'Decision',
			html`<p class="subj">${detail.runId} is in progress.</p>
				<p class="help">The decision opens when the run finishes. This page updates live.</p>`
		)
	if (result.acceptance === 'not_required')
		return recordPanel(
			'Decision',
			html`<p class="help">The target policy does not require result acceptance.</p>
				${retestList(detail)}`
		)
	const latest = result.latestDecision
	if (latest && !state)
		return recordPanel(
			'Decision',
			html`<p class="subj">
					${statusMark({ state: latest.verdict, label: latest.verdict === 'approved' ? 'accepted' : 'rejected' })}
					${detail.runId}
				</p>
				<p class="help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>
				${retestList(detail)}`,
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
			...(extra ? { extra } : {}),
			intro: html`${retestList(detail)}${inconclusiveList(detail)}`,
		},
		state ?? emptyState()
	)
}

function runRow(
	runId: string,
	key: string,
	selected: string,
	label: Html | string,
	tag: Html | string,
	title: Html | string,
	meta: Html | string = ''
) {
	return listRow({
		id: `run-row-${key.replace(/[^A-Za-z0-9-]/g, '-')}`,
		key,
		href: runItemHref(runId, key),
		label: typeof label === 'string' ? label : key,
		inListbox: true,
		current: key === selected,
		tag,
		shownId: label,
		title,
		titleText: typeof title === 'string' ? title : '',
		meta,
		metaText: typeof meta === 'string' ? meta : '',
	})
}

function runGroup(title: string, rows: Html[]) {
	if (!rows.length) return ''
	return html`${groupHeader({ label: title, count: rows.length })} ${rows}`
}

function passedCount(test: RunTest) {
	const passed = test.assertions.filter((assertion) => assertion.result === 'passed').length
	return `${passed} of ${test.assertions.length} checks passed`
}

function runList(detail: Detail, selected: string) {
	const result = detail.result
	const tests = detail.tests.map((test) =>
		runRow(
			detail.runId,
			`test:${test.testId}`,
			selected,
			test.testId,
			testState(test, detail),
			test.title,
			passedCount(test)
		)
	)
	const found = detail.findings.map((finding) =>
		runRow(
			detail.runId,
			`finding:${finding.id}`,
			selected,
			finding.id,
			statusMark({ state: finding.severity }),
			finding.title,
			words(finding.type)
		)
	)
	const gaps = detail.newGaps.map((gap) =>
		runRow(
			detail.runId,
			`gap:${gap.id}`,
			selected,
			gap.id,
			statusMark({ state: gap.severity }),
			gap.question,
			words(gap.status)
		)
	)
	const record = [
		runRow(
			detail.runId,
			'coverage',
			selected,
			'Coverage',
			result
				? statusMark({ state: result.coverage.status })
				: statusMark({ state: 'pending', label: 'not known yet' }),
			result ? `${plural(result.coverage.requirements.length, 'requirement')}` : 'Known when the run finishes.'
		),
		runRow(
			detail.runId,
			'cleanup',
			selected,
			'Cleanup',
			result
				? statusMark({ state: result.cleanup.status })
				: statusMark({ state: 'pending', label: 'not finished' }),
			plural(detail.attempts.length, 'attempt')
		),
	]
	return html`<div class="sp-ch">
			<p class="sp-path">
				<a href="/plans/${detail.planId}@${detail.revision}">${detail.planId}@${detail.revision}</a> · build
				<code>${detail.build}</code> · instance <code>${detail.instance.instanceId}</code>
			</p>
			<h1>${detail.runId}</h1>
			<p class="sp-sub" data-region="state">
				${runStatus({ state: detail.state, acceptance: detail.result?.acceptance ?? null })} started
				${time(detail.startedAt)}${result ? html` · finished ${time(result.finishedAt)}` : ''}
			</p>
		</div>
		<div class="sp-list" role="listbox" aria-label="Run ${detail.runId}" data-list>
			${runGroup('Run', [runRow(detail.runId, 'summary', selected, 'Overview', '', html`${statusCounts({ counts: outcomeCounts(detail) })}`)])}
			${runGroup('Tests', tests)} ${runGroup('Findings', found)} ${runGroup('New gaps', gaps)}
			${runGroup('Record', record)}
		</div>`
}

function openChecks(detail: Detail) {
	const rows = detail.tests.flatMap((test) =>
		test.assertions
			.filter((assertion) => assertion.result && assertion.result !== 'passed')
			.map((assertion) => ({ test, assertion }))
	)
	if (!rows.length) return ''
	return html`<section aria-labelledby="open-checks">
		<h3 class="lab" id="open-checks">Not passed <span class="n">${rows.length}</span></h3>
		<ul class="plist">
			${rows.map(
				({ test, assertion }) =>
					html`<li>
						${resultCell({ result: assertion.result })}
						${assertionLink(detail.runId, `${test.testId}.${assertion.assertionId}`)}
						${assertion.check}${assertion.observed ? html` <span class="muted">Observed: ${assertion.observed}</span>` : ''}
					</li>`
			)}
		</ul>
	</section>`
}

function summaryDetail(store: Store, context: Context, detail: Detail, state: FormState | null, crumbs: Html) {
	const report = detail.result
		? downloadMenu(
				'Download report',
				`/runs/${detail.runId}/report`,
				'The HTML report is self-contained and print-ready. Open it and print to PDF. JUnit XML is for CI.',
				['html', 'md', 'json', 'junit']
			)
		: html`<span class="muted small">The report is ready when the run finishes.</span>`
	return html`${crumbs}
		<h2 class="q-h">Overview</h2>
		${strip(detail)}
		<p class="muted small" data-region="run-usage">${runUsageLine(detail)}</p>
		${detail.warnings.map((warning) => banner({ kind: 'warn', content: warning }))} ${openChecks(detail)}
		${decisionPanel(store, context, detail, state, returnFields({ key: 'summary' }, `/runs/${detail.runId}`))}
		<div class="actions">${report}</div>`
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
	const crumbs = crumbBar([
		['Runs', '/runs'],
		[`${detail.planId}@${detail.revision}`, `/plans/${detail.planId}@${detail.revision}`],
		[runId, label ? list : null],
		...(label ? [[label, null] as [string, null]] : []),
	])
	const pane = test
		? html`${crumbs} ${testCard(store, detail, test)}`
		: finding
			? html`${crumbs} ${findingCard(store, detail, finding)}`
			: gap
				? html`${crumbs} ${gapCard(store, context, detail, gap, adoptError)}`
				: asked === 'coverage'
					? html`${crumbs}
							<h2 class="q-h">Coverage</h2>
							${coverage(store, detail)}`
					: asked === 'cleanup'
						? html`${crumbs}
								<h2 class="q-h">Cleanup and attempts</h2>
								${cleanup(detail)}`
						: summaryDetail(store, context, detail, state, crumbs)
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
		body: html`<div data-region="run-list">${runList(detail, selected)}</div>
			<section
				class="sp-detail q-detail"
				aria-label="${label ?? 'Overview'}"
				data-region="run-detail"
				data-key="detail:${selected}"
				data-stale-message="This run changed. Review it before you decide."
			>
				${
					!detail.result && interruption
						? banner({
								kind: 'info',
								content: html`<b>Delegated worker interrupted ${time(interruption)}.</b> Recorded
									results stay. Run <code>checkmate run resume ${runId}</code> to continue. To end the
									run, use <code>checkmate run finish ${runId}</code> with a completion and cleanup
									result.`,
							})
						: ''
				}
				${pane}
			</section>`,
	}
}
