import type { Attrs, Html } from '../html.ts'
import { attributes, html } from '../html.ts'

export type TableColumn = Html | string | { label: Html | string; attrs: Attrs }
export type TableCell = Html | string | number | { content: Html | string | number; attrs: Attrs }

function isWrapped<T extends object>(value: unknown, key: string): value is T {
	return typeof value === 'object' && value !== null && key in value
}

function column(value: TableColumn) {
	return isWrapped<{ label: Html | string; attrs: Attrs }>(value, 'label')
		? html`<th scope="col" ${attributes(value.attrs)}>${value.label}</th>`
		: html`<th scope="col">${value}</th>`
}

function cell(value: TableCell) {
	return isWrapped<{ content: Html | string | number; attrs: Attrs }>(value, 'content')
		? html`<td ${attributes(value.attrs)}>${value.content}</td>`
		: html`<td>${value}</td>`
}

export function tableRow({ cells, attrs }: { cells: TableCell[]; attrs?: Attrs }) {
	return html`<tr ${attributes(attrs)}>
		${cells.map(cell)}
	</tr>`
}

export type DataTable = { columns: TableColumn[]; rows: Html | Html[]; scroll?: boolean; attrs?: Attrs }

export function dataTable({ columns, rows, scroll = false, attrs }: DataTable) {
	const table = html`<table ${attributes(attrs)}>
		<thead>
			<tr>
				${columns.map(column)}
			</tr>
		</thead>
		<tbody>
			${rows}
		</tbody>
	</table>`
	return scroll ? html`<div class="scroll">${table}</div>` : table
}
