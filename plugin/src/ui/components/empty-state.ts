import type { Html } from '../html.ts'
import { html } from '../html.ts'

export function emptyNotice(what: string, next: Html | string, extra: Html | '' = '') {
	return html`<div class="sp-empty">
		<p><b>${what}</b></p>
		<p>${next}</p>
		${extra}
	</div>`
}

export function emptyLine({ text }: { text: Html | string }) {
	return html`<p class="sp-empty">${text}</p>`
}
