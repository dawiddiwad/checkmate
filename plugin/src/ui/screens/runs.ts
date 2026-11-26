import type { Store } from '../../store.ts'
import { pagedRuns } from '../../views.ts'
import type { Page } from '../layout.ts'
import type { RunRow } from '../lists.ts'
import { dataTable, tableRow } from '../components/data-table.ts'
import { heading } from '../components/page-heading.ts'
import { statusCounts } from '../components/status-mark.ts'
import { costText, html, time, words } from '../html.ts'
import { filterBar, listHref, listPage, listRegion, listState, pageTrail, runStatus, runsSpec } from '../lists.ts'

function runRow(row: RunRow) {
	const href = `/runs/${row.runId}`
	return tableRow({
		attrs: { 'data-row': true, 'data-key': `run:${row.runId}`, 'data-href': href, 'data-label': row.runId },
		cells: [
			{ content: html`<a href="${href}">${row.runId}</a>`, attrs: { class: 'is-mono' } },
			{ content: `${row.planId}@${row.revision}`, attrs: { class: 'is-mono' } },
			runStatus(row),
			statusCounts({ counts: row.counts }),
			{ content: row.build, attrs: { class: 'is-mono' } },
			{ content: row.instanceId, attrs: { class: 'is-mono' } },
			row.coverage ? words(row.coverage) : 'running',
			{ content: row.observedModels.join(', ') || '—', attrs: { class: 'is-mono' } },
			{ content: costText(row.costUsd, row.costPartial), attrs: { class: 'is-muted' } },
			{ content: time(row.startedAt), attrs: { class: 'is-muted' } },
		],
	})
}

export function runsPage(store: Store, params: URLSearchParams): Page {
	const spec = runsSpec(store)
	const { page, state } = listPage(listState(params, spec), (query) => pagedRuns(store, query))
	return {
		title: 'Runs',
		section: 'runs',
		subjects: ['*'],
		address: listHref(spec, state),
		...pageTrail(spec, state, page.total, 'Runs'),
		body: html`${heading({ title: 'Runs', sub: 'Every run of every plan.' })} ${filterBar(spec, state)}
		${listRegion(
			spec,
			state,
			page.total,
			dataTable({
				columns: ['Run', 'Plan', 'State', 'Tests', 'Build', 'Instance', 'Coverage', 'Model', 'Cost', 'Started'],
				rows: page.rows.map(runRow),
				scroll: true,
			})
		)}`,
	}
}
