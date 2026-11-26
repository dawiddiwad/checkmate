import type { Html } from '../html.ts'
import { glyph, html } from '../html.ts'
import { navRail, railBuilds, railCells, railCount, railRow, railSeparator } from './nav-rail.ts'

const cells = railCells({
	cells: [
		{ state: 'passed', label: 'B1 ok', build: 'build-1', buildLabel: 'B1' },
		{ state: 'failed', label: 'B2 wrong', build: 'build-2', buildLabel: 'B2' },
		{ state: 'running', label: 'B3 under test now', build: 'build-3', buildLabel: 'B3' },
	],
})

export const examples: Array<[string, Html | string]> = [
	[
		'navRail current, waits on you, area open, rule, link',
		navRail({
			planId: 'checkout',
			builds: 3,
			pinned: html`${railRow({ target: 'needs', href: '#', id: '', text: 'Needs you', end: railCount({ value: 2, waitsOnYou: true }), current: true, focusable: false })}
			${railRow({ target: 'all', href: '#', id: '', text: 'All items', end: railCount({ value: 9 }), current: false, focusable: false })}
			${railRow({ target: 'chats', href: '#', id: '', text: 'Plan chats', end: html``, current: false, focusable: true, kind: 'link' })}`,
			rows: html`${railBuilds({
				builds: [
					{ build: 'build-1', label: 'B1' },
					{ build: 'build-2', label: 'B2' },
					{ build: 'build-3', label: 'B3' },
				],
			})}
			${railRow({ target: 'area:Coupons', href: '#', id: glyph('▾'), text: 'Coupons', end: cells, current: false, focusable: false, kind: 'area', expanded: true })}
			${railRow({ target: 'rule:R1', href: '#', id: 'R1', text: 'A coupon applies before tax', end: cells, current: false, focusable: false, kind: 'rule', level: 2, area: 'Coupons' })}
			${railRow({ target: 'rule:R2', href: '#', id: 'R2', text: 'Hidden rule of a closed area', end: cells, current: false, focusable: false, kind: 'rule', level: 2, area: 'Coupons', hidden: true })}
			${railSeparator}
			${railRow({ target: 'testers', href: '#', id: '', text: 'Testers now', end: railCount({ value: '4 min', waitsOnYou: true, title: 'Paused' }), current: false, focusable: false, kind: 'link' })}`,
		}),
	],
]
