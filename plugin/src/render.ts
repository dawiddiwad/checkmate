import type { Plan, Result } from './types.ts'
import type { Store } from './store.ts'
import { requireChoice, requireCondition, revisionReference } from './contracts.ts'
import { planRevision } from './plans.ts'
import { runResult, runState } from './runs.ts'

// A report is a list of blocks. Markdown and HTML render the same blocks,
// so both views always show the same content.
type Block =
	| { heading: string; level?: 2 | 3 }
	| { text: string }
	| { table: string[]; rows: string[][] }
	| { list: string[]; numbered?: boolean }
	| { record: unknown }
type Report = { title: string; note: string; blocks: Block[] }
export type Format = 'md' | 'html' | 'json'

const formats = ['md', 'html', 'json'] as const
const none = '—'
const join = (values: string[]) => (values.length ? values.join(', ') : none)

function markdownText(value: string) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/([|[\]*_`])/g, '\\$1')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\r?\n/g, ' ')
}

function jsonFence(value: unknown) {
	const json = JSON.stringify(value, null, 2)
	const fence = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map((match) => match[0].length + 1)))
	return `${fence}json\n${json}\n${fence}`
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

function html(report: Report) {
	const parts = [`<h1>${escapeHtml(report.title)}</h1>`, `<p class="note">${escapeHtml(report.note)}</p>`]
	for (const block of report.blocks) {
		if ('heading' in block) parts.push(`<h${block.level ?? 2}>${escapeHtml(block.heading)}</h${block.level ?? 2}>`)
		else if ('text' in block) parts.push(`<p>${escapeHtml(block.text)}</p>`)
		else if ('table' in block)
			parts.push(
				`<table><thead><tr>${block.table.map((head) => `<th>${escapeHtml(head)}</th>`).join('')}</tr></thead><tbody>${block.rows
					.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`)
					.join('')}</tbody></table>`
			)
		else if ('list' in block) {
			const tag = block.numbered ? 'ol' : 'ul'
			parts.push(`<${tag}>${block.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`)
		} else
			parts.push(
				`<details><summary>Complete JSON record</summary><pre>${escapeHtml(JSON.stringify(block.record, null, 2))}</pre></details>`
			)
	}
	return (
		'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
		`<title>${escapeHtml(report.title)}</title>` +
		'<style>:root{color-scheme:light}html{background:#f5f7f6}body{font:15px/1.65 system-ui,sans-serif;max-width:80rem;margin:3rem auto;padding:2.5rem 3rem;color:#1c3027;background:white;border:1px solid #dce6df;border-radius:14px;box-shadow:0 16px 50px #152c2310}h1{font-size:2.1rem;letter-spacing:-.04em;border-top:5px solid #2c6150;padding-top:1.25rem}h2{margin-top:2.5rem;font-size:1.25rem;color:#2c6150}h3{font-size:1rem}td{overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}' +
		'table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{padding:.45rem .6rem;text-align:left;vertical-align:top;border-bottom:1px solid #d5dae3}' +
		'th{font-weight:600;background:#f3f5f8}.note{color:#5b6475}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:1rem}' +
		'details{margin-top:2rem}summary{cursor:pointer;font-weight:600}@media(max-width:700px){body{margin:0;padding:1rem;border:0;border-radius:0}table{font-size:12px}}@media print{html{background:white}body{margin:0;padding:0;border:0;box-shadow:none;max-width:none;font-size:10pt}h2,h3{break-after:avoid}details{display:none}}</style>' +
		parts.join('') +
		'</html>\n'
	)
}

function resultReport(result: Result, sha256: string): Report {
	const evidence = new Map(result.evidence.map((entry) => [entry.id, entry]))
	const files = (ids: string[]) => join(ids.map((id) => `${evidence.get(id)?.name ?? id} (${id})`))
	const blocks: Block[] = [
		{
			table: ['Field', 'Value'],
			rows: [
				['Completion', result.completion],
				['Coverage', result.coverage.status],
				['Run', result.runId],
				['Application build', result.applicationBuild],
				['Plan', `${result.plan.planId}@${result.plan.revision}`],
				['Target profile', `${result.target.targetId}@${result.target.revision}`],
				['Started', result.startedAt],
				['Finished', result.finishedAt],
				['Attempts', String(result.attempts)],
				['Retest of', result.retestOf ?? none],
				['Result digest', sha256],
			],
		},
		{ heading: 'Tests' },
		{
			table: ['Test', 'Outcome', 'Reason'],
			rows: result.tests.map((test) => [test.testId, test.outcome, test.reason ?? none]),
		},
		{ heading: 'Assertions' },
		{
			table: ['Assertion', 'Result', 'Oracle', 'Check', 'Observed', 'Reason', 'Evidence'],
			rows: result.tests.flatMap((test) =>
				test.assertions.map((assertion) => [
					`${test.testId}.${assertion.assertionId}`,
					assertion.result,
					assertion.oracleKind,
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
	blocks.push({ heading: 'Evidence' })
	if (!result.evidence.length) blocks.push({ text: 'No evidence.' })
	else
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
	blocks.push(
		{ heading: 'Coverage' },
		{
			table: ['Requirement', 'Status', 'Tests', 'Reason'],
			rows: result.coverage.requirements.map((row) => [
				row.requirementId,
				row.status,
				join(row.testIds),
				row.reason ?? none,
			]),
		},
		{ heading: 'Cleanup' },
		{ text: `${result.cleanup.status}: ${result.cleanup.reason}` },
		{ record: result }
	)
	return {
		title: `Test result: ${result.runId}`,
		note: 'Generated from the Checkmate database. Completion, test outcomes, and coverage are separate. Use checkmate evidence get to read evidence.',
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
			table: ['Requirement', 'Text', 'Source', 'Coverage'],
			rows: plan.requirements.map((requirement) => [
				requirement.id,
				requirement.text,
				requirement.source,
				coverage.get(requirement.id) ?? none,
			]),
		},
		{ heading: 'Tests' },
		{
			table: ['Test', 'Title', 'Readiness', 'Requirements', 'Depends on', 'Preconditions', 'Action'],
			rows: plan.tests.map((test) => [
				test.id,
				test.title,
				test.readiness,
				join(test.requirementIds),
				join(test.dependsOn),
				join(test.preconditions),
				test.action,
			]),
		},
		{ heading: 'Assertions' },
		{
			table: ['Assertion', 'Oracle', 'Check'],
			rows: plan.tests.flatMap((test) =>
				test.assertions.map((assertion) => [
					`${test.id}.${assertion.id}`,
					assertion.oracleKind,
					assertion.check,
				])
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
		note: 'Generated from the Checkmate database. Save a new revision to change this plan.',
		blocks,
	}
}

function rendered(report: Report, record: unknown, format: Format) {
	if (format === 'json') return JSON.stringify(record, null, 2) + '\n'
	return format === 'md' ? markdown(report) : html(report)
}

export function renderPlan(plan: Plan, sha256: string, format: Format) {
	return rendered(planReport(plan, sha256), plan, format)
}

export function renderResult(result: Result, sha256: string, format: Format) {
	return rendered(resultReport(result, sha256), result, format)
}

export function exportPlan(store: Store, reference: string, format: string) {
	const { id, revision } = revisionReference(reference, 'plan reference')
	const selected = planRevision(store, id, revision)
	return renderPlan(selected.plan, selected.sha256, requireChoice(format, formats, 'format (--format)'))
}

export function exportRun(store: Store, runId: string, format: string) {
	runState(store, runId)
	const finished = runResult(store, runId)
	requireCondition(finished, `Run ${runId} has no result. Finish it before you export it.`)
	return renderResult(finished.result, finished.sha256, requireChoice(format, formats, 'format (--format)'))
}
