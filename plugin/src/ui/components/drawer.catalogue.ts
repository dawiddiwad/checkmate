import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { optionButton } from './button.ts'
import { closeButton, drawer, drawerHead } from './drawer.ts'
import { wordMark } from './status-mark.ts'

const tags = html`${wordMark({ state: 'finding', label: 'Finding' })} <span class="sp-c-id">k1/C2</span>`

export const examples: Array<[string, Html | string]> = [
	[
		'drawer with head and options',
		drawer({
			back: '#',
			key: 'record:c:k1/C2',
			path: 'checkout › Needs you › k1/C2',
			slot: html`<div data-stale-slot></div>`,
			head: drawerHead({
				label: 'k1/C2',
				tags,
				title: 'The total ignores the coupon',
				options: [optionButton({ n: 1, label: 'Yes, a defect', attrs: { type: 'button' } })],
			}),
			body: html`<p>Expected 90.00, saw 100.00.</p>`,
		}),
	],
	[
		'drawerHead on its own page',
		drawerHead({ label: 'R1', tags, title: 'Message details', titleText: 'Message details', onOwnPage: true }),
	],
	['closeButton', closeButton({ href: '#' })],
]
