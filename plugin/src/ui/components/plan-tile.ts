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
		class="sc-plan"
		role="listitem"
		tabindex="-1"
		id="plan-${tile.index}"
		data-row
		data-key="plan:${tile.planId}"
		data-href="${tile.href}"
		data-label="${tile.planId}"
	>
		<div class="sc-plan-main">
			<div class="sc-plan-top">
				<span class="sc-plan-id">${tile.planId}</span>
				${tile.status}
				<span class="sc-plan-when" title="${tile.whenTitle}">${tile.when}</span>
			</div>
			<h2 class="sc-plan-title" title="${tile.objective}">${tile.objective}</h2>
			<p class="sc-plan-sum">${tile.verdict.head} ${tile.verdict.tail}</p>
			${
				tile.cost === null
					? ''
					: html`<p
							class="sc-plan-sum"
							title="Reported cost across this plan’s explorations, chats, and structured runs"
						>
							Total cost ${tile.cost}
						</p>`
			}
		</div>
		${tile.board} ${tile.metrics}
		<div class="sc-plan-act">
			${button({
				label: tile.next.label,
				href: tile.next.href,
				keyName: 1,
				emphasis: tile.next.unblocks ? 'unblocks' : 'primary',
				mainAction: true,
				attrs: { 'data-option': true },
			})}
		</div>
	</div>`
}

export function newChangeTile({ index }: { index: number }) {
	return html`<div
		class="sc-plan is-new"
		role="listitem"
		tabindex="-1"
		id="plan-${index}"
		data-row
		data-key="new:change"
		data-href="/new"
		data-label="New change"
	>
		<div class="sc-plan-main">
			<h2 class="sc-plan-title">New change</h2>
			<p class="sc-plan-sum">Give a ticket. Checkmate makes a plan and starts the first test.</p>
		</div>
		<div class="sc-plan-act">
			${button({
				label: 'New change',
				href: '/new',
				keyName: 1,
				emphasis: 'primary',
				mainAction: true,
				attrs: { 'data-option': true },
			})}
		</div>
	</div>`
}
