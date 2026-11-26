import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { dataTable, tableRow } from './data-table.ts'
import { statusMark } from './status-mark.ts'

const rows = [
	tableRow({
		cells: [
			html`<a class="sc-mono" href="#">run-1</a>`,
			statusMark({ state: 'completed' }),
			{ content: 'build-2', attrs: { class: 'is-mono' } },
			3,
		],
		attrs: { 'data-key': 'run:run-1' },
	}),
	tableRow({
		cells: [
			html`<a class="sc-mono" href="#">run-2</a>`,
			statusMark({ state: 'running' }),
			{ content: 'build-3', attrs: { class: 'is-mono' } },
			0,
		],
	}),
]

export const examples: Array<[string, Html | string]> = [
	['dataTable', dataTable({ columns: ['Run', 'State', 'Build', 'Tests'], rows })],
	[
		'dataTable scrolling',
		dataTable({
			columns: ['Run', 'State', 'Build', { label: 'Tests', attrs: { class: 'is-mono' } }],
			rows,
			scroll: true,
		}),
	],
	['dataTable empty', dataTable({ columns: ['Run', 'State'], rows: [] })],
]
