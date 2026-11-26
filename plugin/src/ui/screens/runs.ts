import type { Store } from '../../store.ts'
import { pagedRuns } from '../../views.ts'
import type { Page } from '../layout.ts'
import type { RunRow } from '../lists.ts'
import { listPageRow } from '../components/list-row.ts'
import { heading } from '../components/page-heading.ts'
import { statusCounts } from '../components/status-mark.ts'
import { html, time, words } from '../html.ts'
import {
	filterBar,
	listHref,
	listPage,
	listRegion,
	listState,
	pageTrail,
	runStatus,
	runUsageLine,
	runsSpec,
} from '../lists.ts'

function runRow(row: RunRow) {
	return listPageRow({
		key: `run:${row.runId}`,
		href: `/runs/${row.runId}`,
		top: `${row.runId} · ${row.planId}@${row.revision}`,
		tags: html`${runStatus(row)} ${time(row.startedAt)}`,
		lines: [
			html`${statusCounts({ counts: row.counts })}
				<span class="muted"
					>· build <code>${row.build}</code> · ${row.instanceId} ·
					${row.coverage ? `coverage ${words(row.coverage)}` : 'running'}</span
				>`,
			html`<span class="muted">${runUsageLine(row)}</span>`,
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
		body: html`${heading('Runs', 'Every run of every plan.')} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(runRow))}`,
	}
}
