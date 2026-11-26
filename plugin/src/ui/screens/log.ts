import type { Store } from '../../store.ts'
import { pagedOperations } from '../../views.ts'
import type { Page } from '../layout.ts'
import { dataTable, tableRow } from '../components/data-table.ts'
import { heading } from '../components/page-heading.ts'
import { statusMark } from '../components/status-mark.ts'
import { html, join, time, words } from '../html.ts'
import { filterBar, listHref, listPage, listRegion, listState, logSpec, pageTrail, subjectLink } from '../lists.ts'

function reasons(response: unknown) {
	const list = (response as { reasons?: unknown })?.reasons
	return Array.isArray(list) ? list.map(String) : []
}

type LogRow = ReturnType<typeof pagedOperations>['rows'][number]

function logRow(row: LogRow) {
	const subjects = row.subjects.filter((subject) => subject !== `chat:${row.viaChat}`)
	const via = row.viaChat ? html` <a href="/chats/${row.viaChat}">via chat</a>` : ''
	return tableRow({
		attrs: { 'data-row': true, 'data-key': `op:${row.rowid}`, 'data-label': String(row.rowid) },
		cells: [
			{ content: time(row.at), attrs: { class: 'is-muted' } },
			{ content: row.command, attrs: { class: 'is-mono' } },
			html`${statusMark({ state: row.status === 'rejected' ? 'rejected_operation' : row.status, label: words(row.status) })}${
				row.status === 'rejected' ? html`<p class="sc-note">${reasons(row.response).join(' ')}</p>` : ''
			}`,
			html`${row.actor}${via}`,
			subjects.length ? join(subjects.map(subjectLink), ' ') : html`<span class="sc-muted">no subject</span>`,
			{ content: row.id, attrs: { class: 'is-mono is-muted' } },
		],
	})
}

export function logPage(store: Store, params: URLSearchParams): Page {
	const spec = logSpec(store)
	const { page, state } = listPage(listState(params, spec), (query) => pagedOperations(store, query))
	return {
		title: 'Log',
		section: 'log',
		subjects: ['*'],
		address: listHref(spec, state),
		...pageTrail(spec, state, page.total, 'Log'),
		body: html`${heading({ title: 'Log', sub: 'Every write to the workspace.' })} ${filterBar(spec, state)}
		${listRegion(
			spec,
			state,
			page.total,
			dataTable({
				columns: ['Time', 'Command', 'Status', 'Actor', 'Subjects', 'Operation'],
				rows: page.rows.map(logRow),
				scroll: true,
			})
		)}`,
	}
}
