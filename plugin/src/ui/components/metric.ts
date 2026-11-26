import { html } from '../html.ts'

export type Metric = { value: number; name: string; waitsOnYou: boolean }

export function metrics({ items }: { items: Metric[] }) {
	return html`<div class="sp-nums">
		${items.map(
			({ value, name, waitsOnYou }) =>
				html`<div><b class="${waitsOnYou ? 'att' : value ? '' : 'zero'}">${value}</b><span>${name}</span></div>`
		)}
	</div>`
}
