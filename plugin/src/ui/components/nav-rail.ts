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
		class="sc-rail-row${row.kind ? ` is-${row.kind}` : ''}"
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
		><span class="sc-rail-id">${row.id}</span
		><span class="sc-rail-text" title="${row.text}">${row.text}</span>${row.end}</a
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
		? html`<b class="sc-rail-count${waitsOnYou ? ' is-hot' : ''}">${value}</b>`
		: html`<b class="sc-rail-count${waitsOnYou ? ' is-hot' : ''}" title="${title}">${value}</b>`
}

export function railCells({ cells }: { cells: BoardCell[] }) {
	return html`<span class="sc-rail-cells">${cells.map(boardCell)}</span>`
}

export function railBuilds({ builds }: { builds: Array<{ build: string; label: string }> }) {
	return html`<div class="sc-rail-board-h" aria-hidden="true">
		<span>Rule</span
		><span class="sc-rail-cells"
			>${builds.map(
				(item, index) =>
					html`<span class="sc-board-col" title="${item.build}"
						>${key({ name: index + 1 })}<span class="sc-board-label">${item.label}</span></span
					>`
			)}</span
		>
	</div>`
}

export type Rail = { planId: string; buildCount: number; pinned: Html; board: Html; builds: Html; links: Html }

export function navRail({ planId, buildCount, pinned, board, builds, links }: Rail) {
	return html`<nav
		class="sc-rail"
		aria-label="Plan ${planId}"
		data-navigator
		data-builds="${buildCount}"
		data-region="navigator"
	>
		<h2 class="sc-sr">Plan ${planId}</h2>
		<div class="sc-rail-tree" role="tree" aria-label="Views of ${planId}">
			<div class="sc-rail-nav" role="none">${pinned}</div>
			<div class="sc-rail-sec" role="none">
				<p class="sc-rail-h" aria-hidden="true">Board</p>
				${board}
			</div>
			${
				buildCount
					? html`<div class="sc-rail-sec" role="none">
							<p class="sc-rail-h" aria-hidden="true">Builds</p>
							${builds}
						</div>`
					: ''
			}
			<div class="sc-rail-nav" role="none">${links}</div>
		</div>
	</nav>`
}
