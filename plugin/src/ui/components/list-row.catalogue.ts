import type { Html } from '../html.ts'
import type { ListRow } from './list-row.ts'
import { html } from '../html.ts'
import { optionButton } from './button.ts'
import { groupHeader, listPageRow, listRow, optionsBox } from './list-row.ts'
import { statusMark, wordMark } from './status-mark.ts'

const base: ListRow = {
	id: 'catalogue-row',
	key: 'q:catalogue',
	href: '#',
	label: 'k1/Q1',
	tag: wordMark({ state: 'question', label: 'Question' }),
	shownId: 'k1/Q1',
	idTitle: 'k1/Q1',
	title: 'Does the coupon apply before tax?',
	titleText: 'Does the coupon apply before tax?',
	meta: 'open · ×2',
	metaText: 'open · ×2',
}

const options = optionsBox([
	optionButton({ n: 1, label: 'Right', attrs: { type: 'button' } }),
	optionButton({ n: 2, label: 'Different', attrs: { type: 'button' } }),
])

function list(row: Html) {
	return html`<div class="sp-list" role="list" aria-label="Example">${row}</div>`
}

export const examples: Array<[string, Html | string]> = [
	['listRow plain', list(listRow({ ...base, id: 'catalogue-row-plain' }))],
	['listRow selected (current)', list(listRow({ ...base, id: 'catalogue-row-current', current: true }))],
	[
		'listRow needs you',
		list(
			listRow({
				...base,
				id: 'catalogue-row-needs',
				tag: wordMark({ state: 'blocks', label: 'Blocks', live: true }),
				attrs: { 'data-needs': true },
				pickLabel: 'k1/Q1',
			})
		),
	],
	['listRow with options', list(listRow({ ...base, id: 'catalogue-row-options', options }))],
	[
		'listRow settled',
		list(
			listRow({
				...base,
				id: 'catalogue-row-settled',
				settled: true,
				tag: wordMark({ state: 'answered', label: 'Answered' }),
			})
		),
	],
	['listRow with title link', list(listRow({ ...base, id: 'catalogue-row-link', titleHref: '#' }))],
	[
		'listRow in a listbox',
		html`<div class="sp-list" role="listbox" aria-label="Example">
			${listRow({ ...base, id: 'catalogue-row-option', inListbox: true, tag: statusMark({ state: 'running' }) })}
		</div>`,
	],
	['groupHeader', list(groupHeader({ label: 'Questions that block testing', count: 3 }))],
	[
		'listPageRow link',
		html`<ul class="q-items l-rows">
			${listPageRow({ key: 'run:run-1', href: '#', top: 'run-1 · checkout@2', tags: statusMark({ state: 'approved', label: 'accepted' }), lines: ['3 passed', html`<span class="muted">Model sonnet</span>`] })}
		</ul>`,
	],
	[
		'listPageRow without link',
		html`<ul class="q-items l-rows">
			${listPageRow({ key: 'op:1', href: null, top: 'plan open', tags: statusMark({ state: 'completed' }), lines: ['qa-lead · plan:checkout'] })}
		</ul>`,
	],
]
