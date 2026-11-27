import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type InstanceCard = {
	id: string
	mark: Html
	added: Html | string
	action: Html | string
	entries: Array<[string, string]>
	rows: Array<[string, Html | string]>
}

export function instanceCard({ id, mark, added, action, entries, rows }: InstanceCard) {
	return html`<article
		class="sc-instance"
		id="instance-${id}"
		data-key="instance:${id}"
		aria-labelledby="instance-${id}-id"
	>
		<header class="sc-instance-h">
			<h3 class="sc-instance-id" id="instance-${id}-id">${id}</h3>
			${mark}
			<span class="sc-instance-added">${added}</span>
			<span class="sc-instance-act">${action}</span>
		</header>
		<dl class="sc-instance-facts">
			${entries.map(
				([name, value]) =>
					html`<dt class="is-entry">${name}</dt>
						<dd><code>${value}</code></dd>`
			)}
			${rows.map(
				([label, value]) =>
					html`<dt>${label}</dt>
						<dd>${value}</dd>`
			)}
		</dl>
	</article>`
}

export function instanceCards(cards: Html[]) {
	return html`<div class="sc-instances">${cards}</div>`
}
