import { html } from '../html.ts'

export type Metric = { value: number; name: string; waitsOnYou: boolean }

export function metrics({ items }: { items: Metric[] }) {
	return html`<div class="sc-metrics">
		${items.map(
			({ value, name, waitsOnYou }) =>
				html`<div class="sc-metric${waitsOnYou ? ' is-hot' : value ? '' : ' is-zero'}">
					<span class="sc-metric-n">${value}</span><span class="sc-metric-l">${name}</span>
				</div>`
		)}
	</div>`
}
