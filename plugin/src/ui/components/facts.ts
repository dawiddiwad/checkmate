import type { Html } from '../html.ts'
import { html } from '../html.ts'

export function facts({ rows }: { rows: Array<[string, Html | string | false]> }) {
	const shown = rows.filter(([, value]) => value !== false)
	return html`<dl class="facts">
		${shown.map(
			([label, value]) =>
				html`<div>
					<dt>${label}</dt>
					<dd>${value}</dd>
				</div>`
		)}
	</dl>`
}

export function recordFacts({ rows }: { rows: Array<[string, Html | string | null]> }) {
	const shown = rows.filter(([, value]) => value)
	if (!shown.length) return ''
	return html`<dl class="sp-facts">
		${shown.map(
			([label, value]) =>
				html`<dt>${label}</dt>
					<dd>${value}</dd>`
		)}
	</dl>`
}
