import type { Plan, Result } from './types.ts'

// A report is a list of blocks. Markdown and HTML render the same blocks,
// so both views always show the same content.
type Link = { text: string; link: string }
type Cell = string | Link[]
type Block =
	| { heading: string; level?: 2 | 3 }
	| { text: string }
	| { table: string[]; rows: Cell[][] }
	| { list: string[]; numbered?: boolean }
	| { record: unknown }
type Report = { title: string; note: string; blocks: Block[] }

const none = '—'
const join = (values: string[]) => (values.length ? values.join(', ') : none)

type Usage = NonNullable<Result['usage']>
const number = (value: number) => value.toLocaleString('en-US')
const dollars = (value: number) => `$${value.toFixed(4)}`
function context(usage: Usage) {
	if (usage.peakContextTokens === null) return 'not reported'
	const share = usage.contextWindowTokens
		? ` (${((usage.peakContextTokens / usage.contextWindowTokens) * 100).toFixed(1)}% of ${number(usage.contextWindowTokens)})`
		: ''
	return `${number(usage.peakContextTokens)}${share}`
}
function usageRow(stage: string, usage: Usage | null): Cell[] {
	if (!usage) return [stage, 'not measured', none, none, none, none, none]
	return [
		stage,
		number(usage.inputTokens),
		`${number(usage.cacheReadTokens)} / ${number(usage.cacheWriteTokens)}`,
		number(usage.outputTokens),
		context(usage),
		usage.costUSD === null ? 'not reported' : dollars(usage.costUSD),
		usage.costSource ?? none,
	]
}
const usageColumns = [
	'Stage',
	'Input tokens',
	'Cache read / write',
	'Output tokens',
	'Peak context',
	'Cost (USD)',
	'Cost source',
]
function usageBlocks(stages: Array<{ stage: string; usage: Usage | null }>): Block[] {
	const measured = stages.flatMap((entry) => (entry.usage ? [entry.usage] : []))
	const rows = stages.map((entry) => usageRow(entry.stage, entry.usage))
	const notes: string[] = []
	if (stages.length > 1 && measured.length) {
		const sum = (key: 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'outputTokens') =>
			measured.reduce((total, usage) => total + usage[key], 0)
		const costs = measured.flatMap((usage) => (usage.costUSD === null ? [] : [usage.costUSD]))
		rows.push([
			'Total',
			number(sum('inputTokens')),
			`${number(sum('cacheReadTokens'))} / ${number(sum('cacheWriteTokens'))}`,
			number(sum('outputTokens')),
			none,
			costs.length ? dollars(costs.reduce((total, cost) => total + cost, 0)) : 'not reported',
			none,
		])
		if (measured.length < stages.length) notes.push('The total includes only the measured stages.')
		if (costs.length && costs.length < measured.length)
			notes.push('The total cost includes only the stages with a reported cost.')
	}
	if (!measured.length)
		notes.push("No stage was measured. A stage run in the agent's own session has no usage record.")
	else
		notes.push(
			'Input tokens include cached input. Peak context is the largest model request that the host reports. Cost is as the host reports it.'
		)
	return [{ table: usageColumns, rows }, ...notes.map((text) => ({ text }))]
}

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
	const cell = (value: Cell) =>
		typeof value === 'string'
			? markdownText(value)
			: value.map((link) => `[${markdownText(link.text)}](${encodeURI(link.link)})`).join(', ')
	const parts = [`# ${markdownText(report.title)}`, markdownText(report.note)]
	for (const block of report.blocks) {
		if ('heading' in block) parts.push(`${'#'.repeat(block.level ?? 2)} ${markdownText(block.heading)}`)
		else if ('text' in block) parts.push(markdownText(block.text))
		else if ('table' in block)
			parts.push(
				[
					`| ${block.table.map(markdownText).join(' | ')} |`,
					`| ${block.table.map(() => '---').join(' | ')} |`,
					...block.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
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
	const cell = (value: Cell) =>
		typeof value === 'string'
			? escapeHtml(value)
			: value
					.map((link) => `<a href="${escapeHtml(encodeURI(link.link))}">${escapeHtml(link.text)}</a>`)
					.join(', ')
	const parts = [`<h1>${escapeHtml(report.title)}</h1>`, `<p class="note">${escapeHtml(report.note)}</p>`]
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
		} else
			parts.push(
				`<details><summary>Complete JSON record</summary><pre>${escapeHtml(JSON.stringify(block.record, null, 2))}</pre></details>`
			)
	}
	return (
		'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
		`<title>${escapeHtml(report.title)}</title>` +
		'<style>body{font:16px/1.5 system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#1d2330}' +
		'table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{padding:.45rem .6rem;text-align:left;vertical-align:top;border-bottom:1px solid #d5dae3}' +
		'th{font-weight:600;background:#f3f5f8}.note{color:#5b6475}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:1rem}' +
		'details{margin-top:2rem}summary{cursor:pointer;font-weight:600}</style>' +
		parts.join('') +
		'</html>\n'
	)
}

function resultReport(result: Result, chain: Plan[]): Report {
	const evidence = new Map(result.evidence.map((entry) => [entry.id, entry]))
	// Evidence paths are relative to the run directory, where the report is saved.
	const links = (ids: string[]): Cell => {
		const files = ids.flatMap((id) => {
			const entry = evidence.get(id)
			return entry ? [{ text: entry.path, link: entry.path }] : []
		})
		return files.length ? files : none
	}
	const blocks: Block[] = [
		{
			table: ['Field', 'Value'],
			rows: [
				['Completion', result.completion],
				['Coverage', result.coverage.status],
				['Run', result.runId],
				['Application build', result.applicationBuild],
				['Host', [result.host.name, result.host.version].filter(Boolean).join(' ')],
				['Model', result.host.model ?? 'not reported'],
				['Host record', `${result.host.source}, permissions: ${result.host.permissions}`],
				['Plan', result.plan.path],
				['Target profile', result.target.path],
				['Started', result.startedAt],
				['Finished', result.finishedAt],
				...(result.retestOf ? [['Retest of', result.retestOf.path]] : []),
			],
		},
		{ heading: 'Tests' },
		{
			table: ['Test', 'Outcome', 'Expected', 'Observed', 'Reason', 'Evidence'],
			rows: result.tests.map((test) => [
				test.testId,
				test.outcome,
				test.expected ?? none,
				test.observed ?? none,
				test.reason ?? none,
				links(test.evidenceIds),
			]),
		},
		{ heading: 'Findings' },
	]
	if (!result.findings.length) blocks.push({ text: 'No findings.' })
	for (const finding of result.findings) {
		blocks.push({ heading: `${finding.id} · ${finding.type} · ${finding.severity}: ${finding.title}`, level: 3 })
		blocks.push({
			table: ['Field', 'Value'],
			rows: [
				['Tests', join(finding.testIds)],
				['Requirements', join(finding.requirementIds)],
				['Expected', finding.expected ?? none],
				['Observed', finding.observed ?? none],
				['Evidence', links(finding.evidenceIds)],
			],
		})
		if (finding.reproduction.length) blocks.push({ list: finding.reproduction, numbered: true })
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
		{ heading: 'Usage' },
		...usageBlocks([
			...chain.map((plan) => ({
				stage: `${plan.revision === 1 ? 'plan' : 'revise'} (revision ${plan.revision})`,
				usage: plan.usage,
			})),
			{ stage: `execute (${result.runId})`, usage: result.usage },
		]),
		{ record: result }
	)
	return {
		title: `Test result: ${result.runId}`,
		note: 'Generated from result.json. Completion, test outcomes, and coverage are separate. Edit the JSON record, not this view.',
		blocks,
	}
}

function planReport(plan: Plan): Report {
	const coverage = new Map(plan.coverage.map((row) => [row.requirementId, row.status]))
	const blocks: Block[] = [
		{
			table: ['Field', 'Value'],
			rows: [
				['Plan', plan.planId],
				['Revision', String(plan.revision)],
				['Previous revision', plan.previousRevision === null ? none : String(plan.previousRevision)],
				['Target', `${plan.targetId} (${plan.target.path})`],
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
			table: ['Test', 'Readiness', 'Requirements', 'Depends on', 'Action', 'Expected', 'Oracle'],
			rows: plan.tests.map((test) => [
				test.id,
				test.readiness,
				join(test.requirementIds),
				join(test.dependsOn),
				test.action,
				test.expected ?? none,
				test.oracleKind,
			]),
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
	blocks.push(
		{ heading: 'Usage' },
		...usageBlocks([{ stage: plan.revision === 1 ? 'plan' : 'revise', usage: plan.usage }])
	)
	blocks.push({ record: plan })
	return {
		title: `Test plan: ${plan.planId} revision ${plan.revision}`,
		note: 'Generated from the saved JSON plan. Save a new plan revision to change it.',
		blocks,
	}
}

export function renderPlan(plan: Plan) {
	return markdown(planReport(plan))
}
export function renderResult(result: Result, chain: Plan[]) {
	const report = resultReport(result, chain)
	return { md: markdown(report), html: html(report) }
}
