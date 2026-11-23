import type { Plan, Result } from './types.ts'
import type { Store } from './store.ts'
import { all } from './store.ts'
import { dataSummary } from './resets.ts'
import { targetRevision } from './targets.ts'
import type { Approval } from './plans.ts'
import type { ApprovalLabel } from './views.ts'
import { requireChoice, requireCondition, revisionReference } from './contracts.ts'
import { planApproval, planRevision } from './plans.ts'
import { outcomeCounts, resultAcceptance, retestVerdicts, runOutcomes, runResult, runState } from './runs.ts'
import { approvalLabel, evidenceBytes } from './views.ts'
import { explorationReport } from './explorers.ts'

type Block =
	| { heading: string; level?: 2 | 3 }
	| { text: string }
	| { table: string[]; rows: string[][] }
	| { list: string[]; numbered?: boolean }
	| { stats: Array<{ label: string; value: string }> }
	| { evidence: Array<EvidenceItem> }
	| { record: unknown }
type Report = { title: string; note: string; blocks: Block[] }
type EvidenceItem = { label: string; name: string; mediaType: string; size: number; image?: string; text?: string }
export type Format = 'md' | 'html' | 'json'
export type RunFormat = Format | 'junit'
export type RunReport = {
	data: ReturnType<typeof dataSummary>
	result: Result
	sha256: string
	acceptance: { state: ApprovalLabel; latest: Approval | null }
	planApproval: { state: ApprovalLabel; latest: Approval | null }
	plan: Pick<
		Plan,
		'planId' | 'revision' | 'objective' | 'requirements' | 'tests' | 'gaps' | 'decisions' | 'assumptions'
	>
	inline: Record<string, { image?: string; text?: string }>
	retest: ReturnType<typeof retestVerdicts>
	times: Record<string, number>
}

export const formats = ['md', 'html', 'json'] as const
export const runFormats = [...formats, 'junit'] as const
const maxInlineImage = 512 * 1024
const maxInlineText = 16 * 1024
const inlineImages = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const inlineTexts = ['text/plain', 'application/json', 'text/markdown', 'application/xml', 'text/csv']
const tones: Record<string, string> = {
	passed: 'pass',
	approved: 'pass',
	completed: 'pass',
	complete: 'pass',
	tested: 'pass',
	resolved: 'pass',
	failed: 'fail',
	rejected: 'fail',
	operational_error: 'fail',
	error: 'warn',
	inconclusive: 'warn',
	interrupted: 'warn',
	partial: 'warn',
	pending: 'warn',
	open: 'warn',
	blocking: 'warn',
	uncovered: 'warn',
	blocked: 'muted',
	not_run: 'muted',
	not_checked: 'muted',
	deferred: 'muted',
	not_executed: 'muted',
}
const none = '—'
const join = (values: string[]) => (values.length ? values.join(', ') : none)
const pairs = (metadata: Record<string, string | number | boolean> = {}) =>
	join(Object.entries(metadata).map(([key, value]) => `${key}=${value}`))

function markdownText(value: string) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/([|[\]*_`])/g, '\\$1')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\r?\n/g, ' ')
}

function fence(text: string, language = '') {
	const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)))
	return `${ticks}${language}\n${text}\n${ticks}`
}

function jsonFence(value: unknown) {
	return fence(JSON.stringify(value, null, 2), 'json')
}

function indent(text: string) {
	return text
		.split('\n')
		.map((line) => `  ${line}`)
		.join('\n')
}

function markdown(report: Report) {
	const parts = [`# ${markdownText(report.title)}`, markdownText(report.note)]
	for (const block of report.blocks) {
		if ('heading' in block) parts.push(`${'#'.repeat(block.level ?? 2)} ${markdownText(block.heading)}`)
		else if ('text' in block) parts.push(markdownText(block.text))
		else if ('table' in block)
			parts.push(
				[
					`| ${block.table.map(markdownText).join(' | ')} |`,
					`| ${block.table.map(() => '---').join(' | ')} |`,
					...block.rows.map((row) => `| ${row.map(markdownText).join(' | ')} |`),
				].join('\n')
			)
		else if ('list' in block)
			parts.push(
				block.list.map((item, i) => `${block.numbered ? `${i + 1}.` : '-'} ${markdownText(item)}`).join('\n')
			)
		else if ('stats' in block)
			parts.push(
				block.stats.map((stat) => `- **${markdownText(stat.label)}:** ${markdownText(stat.value)}`).join('\n')
			)
		else if ('evidence' in block)
			parts.push(
				block.evidence
					.map((item) =>
						[
							`- ${markdownText(item.label)}: ${markdownText(item.name)} (${item.mediaType}, ${item.size} bytes)`,
							...(item.text === undefined ? [] : ['', indent(fence(item.text))]),
						].join('\n')
					)
					.join('\n')
			)
		else
			parts.push(`<details>\n<summary>Complete JSON record</summary>\n\n${jsonFence(block.record)}\n\n</details>`)
	}
	return parts.join('\n\n') + '\n'
}

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
	)
}

const styles = `
:root{--ink:#1b2130;--muted:#5d6678;--line:#dde2ea;--soft:#f4f6f9;--accent:#3b4fd8;
--pass:#1f7a4d;--pass-bg:#e5f4ec;--fail:#b42318;--fail-bg:#fdecea;--warn:#9a5b00;--warn-bg:#fdf3e1;--muted-bg:#eef0f4}
*{box-sizing:border-box}
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#fff;margin:0}
main{max-width:72rem;margin:0 auto;padding:2.5rem 1.5rem 4rem}
header{border-bottom:3px solid var(--accent);padding-bottom:1rem;margin-bottom:1.5rem}
h1{font-size:1.8rem;line-height:1.2;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.2rem 0 .7rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
h3{font-size:1rem;margin:1.4rem 0 .5rem}
.note{color:var(--muted);margin:0}
table{border-collapse:collapse;width:100%;margin:.4rem 0 1.2rem;font-size:.92rem}
th,td{padding:.45rem .6rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:break-word}
.token{word-break:break-all}
th{font-weight:600;background:var(--soft);font-size:.82rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
tbody tr:nth-child(even) td{background:#fafbfc}
.pill{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.8rem;font-weight:600;white-space:nowrap}
.pass{color:var(--pass);background:var(--pass-bg)}.fail{color:var(--fail);background:var(--fail-bg)}
.warn{color:var(--warn);background:var(--warn-bg)}.muted{color:var(--muted);background:var(--muted-bg)}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.6rem;margin:1rem 0 1.5rem}
.stat{border:1px solid var(--line);border-radius:.5rem;padding:.6rem .8rem}
.stat b{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
.stat span{font-size:1.05rem;font-weight:600;overflow-wrap:anywhere}
.evidence{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem;margin:.5rem 0 1.5rem}
figure{margin:0;border:1px solid var(--line);border-radius:.5rem;padding:.6rem;break-inside:avoid}
figure img{display:block;max-width:100%;height:auto;border-radius:.3rem}
figcaption{font-size:.82rem;color:var(--muted);margin-top:.4rem;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:.8rem;border-radius:.4rem;font-size:.82rem;margin:0}
details{margin-top:2.5rem}summary{cursor:pointer;font-weight:600}
@page{size:A4;margin:16mm 14mm}
@media print{
body{font-size:10.5pt}main{max-width:none;padding:0}
h2{break-after:avoid}h3{break-after:avoid}tr,figure,.stat{break-inside:avoid}thead{display:table-header-group}
tbody tr:nth-child(even) td{background:none}details{display:none}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

function cell(value: string) {
	const tone = tones[value]
	if (tone) return `<span class="pill ${tone}">${escapeHtml(value)}</span>`
	return value
		.split(/(\s+)/)
		.map((part) => (part.length > 24 ? `<span class="token">${escapeHtml(part)}</span>` : escapeHtml(part)))
		.join('')
}

function figure(item: EvidenceItem) {
	const body = item.image
		? `<img src="${item.image}" alt="${escapeHtml(item.name)}">`
		: item.text !== undefined
			? `<pre>${escapeHtml(item.text)}</pre>`
			: ''
	return `<figure>${body}<figcaption>${escapeHtml(item.label)} · ${escapeHtml(item.name)} · ${escapeHtml(item.mediaType)} · ${item.size} bytes</figcaption></figure>`
}

function html(report: Report) {
	const parts = [
		`<header><h1>${escapeHtml(report.title)}</h1><p class="note">${escapeHtml(report.note)}</p></header>`,
	]
	for (const block of report.blocks) {
		if ('heading' in block) parts.push(`<h${block.level ?? 2}>${escapeHtml(block.heading)}</h${block.level ?? 2}>`)
		else if ('text' in block) parts.push(`<p>${escapeHtml(block.text)}</p>`)
		else if ('table' in block)
			parts.push(
				`<table><thead><tr>${block.table.map((head) => `<th>${escapeHtml(head)}</th>`).join('')}</tr></thead><tbody>${block.rows
					.map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`)
					.join('')}</tbody></table>`
			)
		else if ('list' in block) {
			const tag = block.numbered ? 'ol' : 'ul'
			parts.push(`<${tag}>${block.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`)
		} else if ('stats' in block)
			parts.push(
				`<div class="stats">${block.stats
					.map(
						(stat) =>
							`<div class="stat"><b>${escapeHtml(stat.label)}</b><span>${cell(stat.value)}</span></div>`
					)
					.join('')}</div>`
			)
		else if ('evidence' in block) parts.push(`<div class="evidence">${block.evidence.map(figure).join('')}</div>`)
		else
			parts.push(
				`<details><summary>Complete JSON record</summary><pre>${escapeHtml(JSON.stringify(block.record, null, 2))}</pre></details>`
			)
	}
	return (
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
		`<title>${escapeHtml(report.title)}</title><style>${styles.trim()}</style></head><body><main>` +
		parts.join('') +
		'</main></body></html>\n'
	)
}

function approvalBlock(approval: RunReport['acceptance'], notRequired: string): Block {
	if (!approval.latest) return { text: approval.state === 'not_required' ? notRequired : 'No decision yet.' }
	const { verdict, actor, at, rationale, sha256 } = approval.latest
	return { table: ['Verdict', 'Actor', 'At', 'Rationale', 'Digest'], rows: [[verdict, actor, at, rationale, sha256]] }
}

function runDocument(report: RunReport): Report {
	const { result, sha256, acceptance, plan } = report
	const planned = new Map(plan.tests.map((test) => [test.id, test]))
	const evidence = new Map(result.evidence.map((entry) => [entry.id, entry]))
	const files = (ids: string[]) => join(ids.map((id) => `${evidence.get(id)?.name ?? id} (${id})`))
	const counts = outcomeCounts(result.tests.filter((test) => result.selectedTestIds.includes(test.testId)))
	const assertions = result.tests.flatMap((test) => test.assertions)
	const blocks: Block[] = [
		{
			stats: [
				{ label: 'Completion', value: result.completion },
				{ label: 'Coverage', value: result.coverage.status },
				{ label: 'Acceptance', value: acceptance.state },
				{ label: 'Selected tests', value: String(result.selectedTestIds.length) },
				...Object.entries(counts).map(([outcome, count]) => ({ label: outcome, value: String(count) })),
				{
					label: 'Assertions passed',
					value: `${assertions.filter((assertion) => assertion.result === 'passed').length} of ${assertions.length}`,
				},
				{ label: 'Findings', value: String(result.findings.length) },
				{ label: 'New gaps', value: String(result.newGaps.length) },
			],
		},
		{ heading: 'Summary' },
		{
			table: ['Field', 'Value'],
			rows: [
				['Run', result.runId],
				['Objective', plan.objective],
				['Application build', result.applicationBuild],
				['Data', `${report.data.kind}${report.data.policy ? `. Policy: ${report.data.policy}` : ''}`],
				['Plan', `${result.plan.planId}@${result.plan.revision}`],
				['Target profile', `${result.target.targetId}@${result.target.revision}`],
				['Instance', result.instanceId],
				['Started', result.startedAt],
				['Finished', result.finishedAt],
				['Attempts', String(result.attempts)],
				['Retest of', result.retestOf ?? none],
				...(result.completionCause ? [['Completion cause', result.completionCause]] : []),
				...(result.completionReason ? [['Completion reason', result.completionReason]] : []),
				['Cleanup', `${result.cleanup.status}: ${result.cleanup.reason}`],
				['Result digest', sha256],
			],
		},
		{ heading: 'Acceptance' },
		approvalBlock(acceptance, 'The target policy does not require acceptance.'),
		...(report.retest.length
			? ([
					{ heading: 'Retest verdicts' },
					{
						table: ['Finding', 'Title', 'Verdict', 'Tests'],
						rows: report.retest.map((item) => [
							`${item.runId}/${item.findingId}`,
							item.title,
							item.verdict,
							join(item.testIds),
						]),
					},
				] as Block[])
			: []),
		{ heading: `Plan approval (${plan.planId}@${plan.revision})` },
		approvalBlock(report.planApproval, 'The target policy does not require plan approval.'),
		{ heading: 'Tests' },
		{
			table: ['Test', 'Title', 'Outcome', 'Assertions', 'Reason', 'Metadata'],
			rows: result.tests
				.filter((test) => result.selectedTestIds.includes(test.testId))
				.map((test) => [
					test.testId,
					planned.get(test.testId)?.title ?? none,
					test.outcome,
					`${test.assertions.filter((assertion) => assertion.result === 'passed').length} of ${test.assertions.length} passed`,
					test.cause ? `${test.cause}: ${test.reason}` : (test.reason ?? none),
					pairs(planned.get(test.testId)?.metadata),
				]),
		},
		{ heading: 'Assertions' },
		{
			table: ['Assertion', 'Result', 'Check kind', 'Check', 'Observed', 'Reason', 'Evidence'],
			rows: result.tests.flatMap((test) =>
				test.assertions.map((assertion) => [
					`${test.testId}.${assertion.assertionId}`,
					assertion.result,
					assertion.checkKind,
					assertion.check,
					assertion.observed ?? none,
					assertion.reason ?? none,
					files(assertion.evidenceIds),
				])
			),
		},
		{ heading: 'Findings' },
	]
	if (!result.findings.length) blocks.push({ text: 'No findings.' })
	for (const finding of result.findings) {
		blocks.push({ heading: `${finding.id} · ${finding.type} · ${finding.severity}: ${finding.title}`, level: 3 })
		blocks.push({
			table: ['Field', 'Value'],
			rows: [
				['Assertions', join(finding.assertionIds)],
				['Requirements', join(finding.requirementIds)],
				['Expected', finding.expected],
				['Observed', finding.observed],
				['Evidence', files(finding.evidenceIds)],
				['Metadata', pairs(finding.metadata)],
			],
		})
		blocks.push({ list: finding.reproduction, numbered: true })
	}
	blocks.push({ heading: 'New gaps' })
	if (!result.newGaps.length) blocks.push({ text: 'No new gaps.' })
	else
		blocks.push({
			table: ['Gap', 'Severity', 'Question', 'Consequence', 'Requirements', 'Tests'],
			rows: result.newGaps.map((gap) => [
				gap.id,
				gap.severity,
				gap.question,
				gap.consequence,
				join(gap.requirementIds),
				join(gap.testIds),
			]),
		})
	blocks.push({ heading: `Plan gaps and decisions (${plan.planId}@${plan.revision})` })
	if (!plan.gaps.length) blocks.push({ text: 'The plan has no gaps.' })
	else
		blocks.push({
			table: ['Gap', 'Severity', 'Status', 'Question', 'Decision', 'Value', 'Actor', 'Rationale'],
			rows: plan.gaps.map((gap) => {
				const decision = plan.decisions.find((item) => item.id === gap.decisionId)
				return [
					gap.id,
					gap.severity,
					gap.status,
					gap.question,
					decision?.kind ?? none,
					decision?.value ?? none,
					decision?.actor ?? none,
					decision?.rationale ?? none,
				]
			}),
		})
	if (plan.assumptions.length)
		blocks.push({
			list: plan.assumptions.map((assumption) => `Assumption ${assumption.decisionId}: ${assumption.text}`),
		})
	blocks.push({ heading: 'Evidence' })
	if (!result.evidence.length) blocks.push({ text: 'No evidence.' })
	else {
		blocks.push({
			evidence: result.evidence.map((entry) => ({
				label: entry.assertionId ? `${entry.testId}.${entry.assertionId}` : entry.testId,
				name: entry.name,
				mediaType: entry.mediaType,
				size: entry.size,
				...report.inline[entry.id],
			})),
		})
		blocks.push({
			table: ['Evidence', 'Assertion', 'Kind', 'Name', 'Media type', 'Size', 'SHA-256'],
			rows: result.evidence.map((entry) => [
				entry.id,
				entry.assertionId ? `${entry.testId}.${entry.assertionId}` : entry.testId,
				entry.kind,
				entry.name,
				entry.mediaType,
				String(entry.size),
				entry.sha256,
			]),
		})
	}
	blocks.push(
		{ heading: 'Coverage' },
		{
			table: ['Requirement', 'Text', 'Status', 'Tests', 'Reason', 'Metadata'],
			rows: result.coverage.requirements.map((row) => {
				const requirement = plan.requirements.find((item) => item.id === row.requirementId)
				return [
					row.requirementId,
					requirement?.text ?? none,
					row.status,
					join(row.testIds),
					row.reason ?? none,
					pairs(requirement?.metadata),
				]
			}),
		},
		{ record: result }
	)
	return {
		title: `Test report: ${result.runId}`,
		note: `${result.plan.planId}@${result.plan.revision} on build ${result.applicationBuild}. Generated from the Checkmate database. Completion, test outcomes, and coverage are separate.`,
		blocks,
	}
}

function planReport(plan: Plan, sha256: string): Report {
	const coverage = new Map(plan.coverage.map((row) => [row.requirementId, row.status]))
	const blocks: Block[] = [
		{
			table: ['Field', 'Value'],
			rows: [
				['Plan', plan.planId],
				['Revision', String(plan.revision)],
				['Previous revision', plan.previousRevision === null ? none : String(plan.previousRevision)],
				['Target', `${plan.target.targetId}@${plan.target.revision}`],
				['Objective', plan.objective],
				['Plan digest', sha256],
			],
		},
		{ heading: 'Requirements' },
		{
			table: ['Requirement', 'Text', 'Source', 'Coverage', 'Metadata'],
			rows: plan.requirements.map((requirement) => [
				requirement.id,
				requirement.text,
				requirement.source,
				coverage.get(requirement.id) ?? none,
				pairs(requirement.metadata),
			]),
		},
		{ heading: 'Tests' },
		{
			table: ['Test', 'Title', 'Readiness', 'Requirements', 'Depends on', 'Preconditions', 'Action', 'Metadata'],
			rows: plan.tests.map((test) => [
				test.id,
				test.title,
				test.readiness,
				join(test.requirementIds),
				join(test.dependsOn),
				join(test.preconditions),
				test.action,
				pairs(test.metadata),
			]),
		},
		{ heading: 'Assertions' },
		{
			table: ['Assertion', 'Check kind', 'Check'],
			rows: plan.tests.flatMap((test) =>
				test.assertions.map((assertion) => [`${test.id}.${assertion.id}`, assertion.checkKind, assertion.check])
			),
		},
		{ heading: 'Gaps' },
	]
	if (!plan.gaps.length) blocks.push({ text: 'No gaps.' })
	else
		blocks.push({
			table: ['Gap', 'Severity', 'Status', 'Question', 'Consequence', 'Decision'],
			rows: plan.gaps.map((gap) => [
				gap.id,
				gap.severity,
				gap.status,
				gap.question,
				gap.consequence,
				gap.decisionId ?? none,
			]),
		})
	blocks.push({ heading: 'Decisions' })
	if (!plan.decisions.length) blocks.push({ text: 'No decisions.' })
	else
		blocks.push({
			table: ['Decision', 'Gap', 'Kind', 'Value', 'Actor', 'Rationale', 'Source'],
			rows: plan.decisions.map((decision) => [
				decision.id,
				decision.gapId,
				decision.kind,
				decision.value,
				decision.actor,
				decision.rationale,
				decision.source ?? none,
			]),
		})
	blocks.push({ heading: 'Assumptions' })
	if (!plan.assumptions.length) blocks.push({ text: 'No accepted assumptions.' })
	else blocks.push({ list: plan.assumptions.map((assumption) => `${assumption.decisionId}: ${assumption.text}`) })
	blocks.push({ record: plan })
	return {
		title: `Test plan: ${plan.planId} revision ${plan.revision}`,
		note: 'Generated from the Checkmate database. Record a decision and revise the plan to change it.',
		blocks,
	}
}

const xmlEntities: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;',
	'\n': '&#10;',
	'\r': '&#13;',
	'\t': '&#9;',
}

function validText(value: string) {
	return value.replace(/[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
}

function xml(value: string, pattern: RegExp) {
	return validText(value).replace(pattern, (character) => xmlEntities[character])
}

function xmlText(value: string) {
	return xml(value, /[&<>\r]/g)
}

function xmlAttribute(value: string) {
	return xml(value, /[&<>"'\n\r\t]/g)
}

function xmlTag(name: string, attributes: Record<string, string | number>, content: string | null = null) {
	const fields = Object.entries(attributes)
		.map(([key, value]) => ` ${key}="${xmlAttribute(String(value))}"`)
		.join('')
	return content === null ? `<${name}${fields}/>` : `<${name}${fields}>${content}</${name}>`
}

function xmlProperties(values: Array<[string, string | number | boolean]>) {
	if (!values.length) return ''
	return `<properties>${values.map(([name, value]) => xmlTag('property', { name, value: String(value) })).join('')}</properties>`
}

function junitStatus(report: RunReport, test: Result['tests'][number]) {
	const unpassed = test.assertions.find((assertion) => assertion.result !== 'passed')
	const reason = test.reason ?? unpassed?.reason ?? unpassed?.observed ?? test.outcome
	if (test.outcome === 'passed') return ''
	if (test.outcome === 'blocked' || test.outcome === 'not_run')
		return xmlTag('skipped', { message: `${test.outcome}: ${reason}` })
	if (test.outcome !== 'failed') return xmlTag('error', { type: test.outcome, message: reason })
	const findings = report.result.findings
		.filter((finding) => finding.testIds.includes(test.testId))
		.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
	const defect = findings.find((finding) => finding.type === 'defect')
	const text = findings.map((finding) =>
		[
			`${finding.id} ${finding.type} ${finding.severity}: ${finding.title}`,
			`Expected: ${finding.expected}`,
			`Observed: ${finding.observed}`,
			'Reproduction:',
			...finding.reproduction.map((step, i) => `${i + 1}. ${step}`),
		].join('\n')
	)
	return xmlTag(
		'failure',
		{ type: defect?.type ?? 'failed', message: defect?.title ?? reason },
		xmlText(text.join('\n\n') || reason)
	)
}

function notSelectedReason(plan: RunReport['plan'], testId: string) {
	const gap = plan.gaps.find((item) => item.status === 'open' && item.testIds.includes(testId))
	return gap ? `blocked by open gap ${gap.id}: ${gap.question}` : 'not selected for this run'
}

function junit(report: RunReport) {
	const { result, plan } = report
	const tests = result.tests.filter((test) => result.selectedTestIds.includes(test.testId))
	const notSelected = plan.tests.filter((test) => !result.selectedTestIds.includes(test.id))
	const count = (...outcomes: string[]) => tests.filter((test) => outcomes.includes(test.outcome)).length
	const totals = {
		tests: tests.length + notSelected.length,
		failures: count('failed'),
		errors: count('error', 'inconclusive'),
		skipped: count('blocked', 'not_run') + notSelected.length,
		time: (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000,
	}
	const properties = (planned: RunReport['plan']['tests'][number]) =>
		xmlProperties([
			['title', planned.title],
			['requirements', planned.requirementIds.join(',')],
			...Object.entries(planned.metadata ?? {}).map(([key, value]): [string, string | number | boolean] => [
				`metadata.${key}`,
				value,
			]),
		])
	const cases = tests.map((test) => {
		const planned = plan.tests.find((item) => item.id === test.testId)!
		return xmlTag(
			'testcase',
			{ classname: plan.planId, name: planned.id, time: report.times[test.testId] ?? 0 },
			properties(planned) + junitStatus(report, test)
		)
	})
	const skippedCases = notSelected.map((planned) =>
		xmlTag(
			'testcase',
			{ classname: plan.planId, name: planned.id, time: 0 },
			properties(planned) + xmlTag('skipped', { message: notSelectedReason(plan, planned.id) })
		)
	)
	const suite = xmlTag(
		'testsuite',
		{
			name: `${result.plan.planId}@${result.plan.revision}`,
			...totals,
			timestamp: result.startedAt.slice(0, 19),
		},
		xmlProperties([
			['runId', result.runId],
			['build', result.applicationBuild],
			['dataKind', report.data.kind],
			['dataPolicy', report.data.policy ?? ''],
			['instance', result.instanceId],
			['target', `${result.target.targetId}@${result.target.revision}`],
			['completion', result.completion],
			['coverage', result.coverage.status],
			...report.retest.flatMap((item): Array<[string, string]> => {
				const name = `retest.${item.runId}/${item.findingId}`
				return [
					[`${name}.verdict`, item.verdict],
					[`${name}.title`, item.title],
					[`${name}.tests`, item.testIds.join(',')],
				]
			}),
		]) +
			'\n' +
			[...cases, ...skippedCases].join('\n') +
			'\n'
	)
	return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlTag('testsuites', { name: result.runId, ...totals }, suite)}\n`
}

function rendered(report: Report, record: unknown, format: Format) {
	if (format === 'json') return JSON.stringify(record, null, 2) + '\n'
	return validText(format === 'md' ? markdown(report) : html(report))
}

export function renderPlan(plan: Plan, sha256: string, format: Format) {
	return rendered(planReport(plan, sha256), plan, format)
}

export function renderRun(report: RunReport, format: RunFormat) {
	if (format === 'junit') return junit(report)
	const { inline, times, ...record } = report
	return rendered(runDocument(report), record, format)
}

export function exportPlan(store: Store, reference: string, format: string) {
	const { id, revision } = revisionReference(reference, 'plan reference')
	const selected = planRevision(store, id, revision)
	return renderPlan(selected.plan, selected.sha256, requireChoice(format, formats, 'format (--format)'))
}

export function runReport(store: Store, runId: string): RunReport {
	const run = runState(store, runId)
	const finished = runResult(store, runId)
	requireCondition(finished, `Run ${runId} has no result. Finish it before you export it.`)
	const state = resultAcceptance(store, run.row, finished.sha256)
	const approval = planApproval(store, run.plan, run.row.plan_sha256)
	const { planId, revision, objective, requirements, tests, gaps, decisions, assumptions } = run.plan
	const inline: RunReport['inline'] = {}
	for (const entry of finished.result.evidence) {
		const image = inlineImages.includes(entry.mediaType) && entry.size <= maxInlineImage
		const text = inlineTexts.includes(entry.mediaType) && entry.size <= maxInlineText
		if (!image && !text) continue
		const bytes = Buffer.from(evidenceBytes(store, entry.id).bytes)
		inline[entry.id] = image
			? { image: `data:${entry.mediaType};base64,${bytes.toString('base64')}` }
			: { text: bytes.toString('utf8') }
	}
	return {
		data: dataSummary(
			store.workspace,
			targetRevision(store, run.row.target_id, run.row.target_revision).profile.reset
		),
		result: finished.result,
		sha256: finished.sha256,
		acceptance: { state: approvalLabel(state), latest: state.latest },
		planApproval: { state: approvalLabel(approval), latest: approval.latest },
		plan: { planId, revision, objective, requirements, tests, gaps, decisions, assumptions },
		inline,
		retest: retestVerdicts(run, runOutcomes(store, runId)),
		times: testTimes(store, runId),
	}
}

function testTimes(store: Store, runId: string) {
	const rows = all<{ test_id: string; first: string; closed: string }>(
		store,
		`SELECT o.test_id, coalesce(min(a.recorded_at), o.recorded_at) AS first, o.recorded_at AS closed
		FROM outcomes o LEFT JOIN assertion_results a ON a.run_id = o.run_id AND a.test_id = o.test_id
		WHERE o.run_id = ? GROUP BY o.test_id`,
		runId
	)
	return Object.fromEntries(
		rows.map((row) => [row.test_id, Math.max(0, Date.parse(row.closed) - Date.parse(row.first)) / 1000])
	)
}

export function exportRun(store: Store, runId: string, format: string) {
	return renderRun(runReport(store, runId), requireChoice(format, runFormats, 'format (--format)'))
}

export const explorationFormats = ['md', 'json'] as const

function mdCell(text: unknown) {
	return String(text ?? '')
		.replace(/\|/g, '\\|')
		.replace(/\n/g, ' ')
}

export function exportExploration(store: Store, explorationId: string, format: string) {
	const report = explorationReport(store, explorationId)
	if (requireChoice(format, explorationFormats, 'format (--format)') === 'json')
		return JSON.stringify(report, null, '\t') + '\n'
	const lines = [
		`# Exploration ${report.explorationId}`,
		'',
		`Plan ${report.planId}, build ${report.build}, instance ${report.instanceId}, mode ${report.mode}. State: ${report.state}.`,
		`Level ${report.level ?? '-'}, ${report.explorerCount ?? 0} explorers, model ${report.model ?? '-'}, verifier ${report.verifier ?? '-'}.`,
		'',
		`Goal: ${report.charter.goal}`,
		'',
		'## Claims',
		'',
		'| Claim | State | Severity | Reporters | Title | Reason |',
		'| --- | --- | --- | --- | --- | --- |',
		...report.claims.map(
			(claim) =>
				`| ${mdCell(claim.id)} | ${claim.state} | ${claim.severity} | ${claim.actors.join(', ')} | ${mdCell(claim.title)} | ${mdCell(claim.reason)} |`
		),
		'',
		'## Questions',
		'',
		...(report.questions.length
			? report.questions.map(
					(question) =>
						`- ${question.id}: ${question.question}${question.answer ? ` Answer: ${question.answer}` : ''}`
				)
			: ['None.']),
		'',
		'## Explorers',
		'',
		...report.explorers.map(
			(item) =>
				`- ${item.explorer}: ended ${item.ended ?? '-'}, recorded ${item.recorded ?? '-'}, ${item.saved} entries`
		),
	]
	return lines.join('\n') + '\n'
}
