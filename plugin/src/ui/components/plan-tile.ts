import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { button } from './button.ts'

export type PlanTile = {
	index: number
	planId: string
	href: string
	status: Html | ''
	when: Html | string
	whenTitle: string
	objective: string
	verdict: { head: string; tail: string }
	cost: string | null
	board: Html
	metrics: Html
	next: { label: string; href: string; unblocks: boolean }
}

export function planTile(tile: PlanTile) {
	return html`<div
		class="sp-ct"
		role="listitem"
		tabindex="-1"
		id="plan-${tile.index}"
		data-row
		data-key="plan:${tile.planId}"
		data-href="${tile.href}"
		data-label="${tile.planId}"
	>
		<div class="sp-ct-main">
			<div class="sp-ct-head">
				<span class="sp-c-id">${tile.planId}</span>
				${tile.status}
				<span class="sp-ct-when ell" title="${tile.whenTitle}">${tile.when}</span>
			</div>
			<h2 class="sp-ct-title ell" title="${tile.objective}">${tile.objective}</h2>
			<p class="sp-ct-verdict"><b>${tile.verdict.head}</b> ${tile.verdict.tail}</p>
			${
				tile.cost === null
					? ''
					: html`<p
							class="sp-ct-cost"
							title="Reported cost across this plan’s explorations, chats, and structured runs"
						>
							Total cost ${tile.cost}
						</p>`
			}
		</div>
		${tile.board} ${tile.metrics}
		<div class="sp-ct-opts">
			${button({
				label: tile.next.label,
				href: tile.next.href,
				keyName: 1,
				emphasis: tile.next.unblocks ? 'unblocks' : undefined,
				attrs: { 'data-option': true },
			})}
		</div>
	</div>`
}

export function newChangeTile({ index }: { index: number }) {
	return html`<div
		class="sp-ct sp-ct-new"
		role="listitem"
		tabindex="-1"
		id="plan-${index}"
		data-row
		data-key="new:change"
		data-href="/new"
		data-label="New change"
	>
		<div class="sp-ct-main">
			<h2 class="sp-ct-title ell">New change</h2>
			<p class="sp-ct-verdict">Give a ticket. Checkmate makes a plan and starts the first test.</p>
		</div>
		<div class="sp-ct-opts">
			${button({ label: 'New change', href: '/new', keyName: 1, attrs: { 'data-option': true } })}
		</div>
	</div>`
}
