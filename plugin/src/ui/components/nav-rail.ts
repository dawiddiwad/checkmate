import type { Html } from '../html.ts'
import type { BoardCell } from './board.ts'
import { html } from '../html.ts'
import { boardCell } from './board.ts'
import { key } from './key.ts'

export type RailRow = {
	target: string
	href: string
	id: Html | string
	text: string
	end: Html
	current: boolean
	focusable: boolean
	kind?: 'link' | 'area' | 'rule'
	level?: number
	area?: string
	expanded?: boolean
	hidden?: boolean
}

export function railRow(row: RailRow) {
	return html`<a
		${row.hidden ? html`hidden` : ''}
		class="sp-nrow${row.kind ? ` ${row.kind}` : ''}${row.current ? ' on' : ''}"
		role="treeitem"
		aria-level="${row.level ?? 1}"
		aria-selected="${row.current ? 'true' : 'false'}"
		${row.expanded === undefined ? '' : html`aria-expanded="${row.expanded ? 'true' : 'false'}"`}
		${row.area ? html`data-in-area="${row.area}"` : ''}
		tabindex="${row.focusable ? '0' : '-1'}"
		href="${row.href}"
		data-nav
		data-target="${row.target}"
		data-label="${row.text}"
		><span class="sp-nid">${row.id}</span
		><span class="sp-ntx ell" title="${row.text}">${row.text}</span>${row.end}</a
	>`
}

export function railCount({
	value,
	waitsOnYou = false,
	title,
}: {
	value: number | string
	waitsOnYou?: boolean
	title?: string
}) {
	return title === undefined
		? html`<span class="sp-ncount${waitsOnYou ? ' att' : ''}">${value}</span>`
		: html`<span class="sp-ncount${waitsOnYou ? ' att' : ''}" title="${title}">${value}</span>`
}

export function railCells({ cells }: { cells: BoardCell[] }) {
	return html`<span class="sp-nmarks">${cells.map(boardCell)}</span>`
}

export const railSeparator = html`<div class="sp-sep" aria-hidden="true"></div>`

export function railBuilds({ builds }: { builds: Array<{ build: string; label: string }> }) {
	return html`<div class="sp-nhead" aria-hidden="true">
		<span></span><span>Rule</span
		><span class="sp-nmarks"
			>${builds.map(
				(item, index) =>
					html`<span title="${item.build}"
						>${key({ name: index + 1 })}<span class="sp-blab">${item.label}</span></span
					>`
			)}</span
		>
	</div>`
}

export type Rail = { planId: string; builds: number; pinned: Html; rows: Html }

export function navRail({ planId, builds, pinned, rows }: Rail) {
	return html`<nav
		class="sp-nav"
		aria-label="Plan ${planId}"
		data-navigator
		data-builds="${builds}"
		data-region="navigator"
	>
		<h2 class="sr-only">Plan ${planId}</h2>
		<div class="sp-nlist" role="tree" aria-label="Views of ${planId}">
			<div class="sp-npin" role="none">${pinned} ${railSeparator}</div>
			${rows}
		</div>
	</nav>`
}
