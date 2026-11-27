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
	when: null,
	waitsOn: 'waits on oracle',
	objective: 'Checkout applies coupons before tax',
	summary: '2 open defects · 3 questions open',
	cost: '$0.42',
	board: board({
		label: 'Rules against the last 2 builds',
		columns: [
			{ label: 'R1', title: 'A standard order totals 400 PLN.' },
			{ label: 'Out', title: 'Outside the rules' },
		],
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
	return html`<div class="sc-plans" role="list" aria-label="Example">${content}</div>`
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
				waitsOn: null,
				cost: null,
				next: { label: 'Watch the testers', href: '#', unblocks: false },
			})
		),
	],
	[
		'planTile long title and long head line',
		list(
			planTile({
				...tile,
				index: 3,
				planId: 'basket',
				when: 'B2 fixture-build-2-with-a-long-name · 3 h',
				objective:
					'Explore the basket, coupons, and the gift card flow: merging a guest basket at sign-in, stacking a coupon with a gift card, and the refund of a split payment.',
			})
		),
	],
	['newChangeTile', list(newChangeTile({ index: 2 }))],
]
