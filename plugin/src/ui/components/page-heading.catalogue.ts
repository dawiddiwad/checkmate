import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { crumbBar, heading } from './page-heading.ts'
import { statusMark } from './status-mark.ts'

export const examples: Array<[string, Html | string]> = [
	['heading title only', heading({ title: 'Runs' })],
	[
		'heading with sub and extra',
		heading({
			title: 'checkout@2',
			sub: 'Checkout applies coupons.',
			meta: html`${statusMark({ state: 'approved' })}`,
		}),
	],
	[
		'crumbBar',
		crumbBar({
			crumbs: [
				['checkout', '#'],
				['shop-local@1', null],
			],
		}),
	],
	['crumbBar empty', crumbBar({ crumbs: [] })],
]
