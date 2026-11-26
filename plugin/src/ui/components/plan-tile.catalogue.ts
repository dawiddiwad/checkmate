import type { Html } from '../html.ts'
import type { PlanTile } from './plan-tile.ts'
import { html } from '../html.ts'
import { board } from './board.ts'
import { metrics } from './metric.ts'
import { newChangeTile, planTile } from './plan-tile.ts'
import { statusMark, wordMark } from './status-mark.ts'

const tile: PlanTile = {
	index: 0,
	planId: 'checkout',
	href: '#',
	status: statusMark({ state: 'needs_answers' }),
	when: 'B2 build-2 · 3 h',
	whenTitle: 'build-2',
	objective: 'Checkout applies coupons before tax',
	verdict: { head: 'Build build-2: 2 open defects.', tail: '3 questions open, 1 blocks testing.' },
	cost: '$0.42',
	board: board({
		label: 'Rules against the last 2 builds',
		builds: [
			{ build: 'build-1', label: 'B1', cells: ['passed', 'not_checked'] },
			{ build: 'build-2', label: 'B2', cells: ['failed', 'question'] },
		],
	}),
	metrics: metrics({
		items: [
			{ value: 1, name: 'block testing', waitsOnYou: true },
			{ value: 2, name: 'to look at', waitsOnYou: false },
			{ value: 0, name: 'defects', waitsOnYou: false },
		],
	}),
	next: { label: 'Answer 1 blocking question', href: '#', unblocks: true },
}

function list(content: Html) {
	return html`<div class="sp-home" role="list" aria-label="Example">${content}</div>`
}

export const examples: Array<[string, Html | string]> = [
	['planTile blocked', list(planTile(tile))],
	[
		'planTile testing',
		list(
			planTile({
				...tile,
				index: 1,
				planId: 'login',
				status: wordMark({ state: 'testing', label: 'Testing' }),
				cost: null,
				next: { label: 'Watch the testers', href: '#', unblocks: false },
			})
		),
	],
	['newChangeTile', list(newChangeTile({ index: 2 }))],
]
