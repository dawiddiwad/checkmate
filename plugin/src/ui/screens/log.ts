import type { Store } from '../../store.ts'
import { pagedOperations } from '../../views.ts'
import type { Page } from '../layout.ts'
import { listPageRow } from '../components/list-row.ts'
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
	return listPageRow({
		key: `op:${row.rowid}`,
		href: null,
		top: row.command,
		tags: html`${statusMark({ state: row.status === 'rejected' ? 'rejected_operation' : row.status, label: words(row.status) })}
		${time(row.at)}`,
		lines: [
			html`${row.actor}${via} ·
			${subjects.length ? join(subjects.map(subjectLink), ' ') : html`<span class="muted">no subject</span>`}`,
			...(row.status === 'rejected'
				? [html`<span class="reason">${reasons(row.response).join(' ')}</span>`]
				: []),
			html`<span class="mono muted">${row.id}</span>`,
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
		body: html`${heading('Log', 'Every write to the workspace.')} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(logRow))}`,
	}
}
