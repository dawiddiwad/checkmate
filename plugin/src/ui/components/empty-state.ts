import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type EmptyNotice = { what: string; next: Html | string; extra?: Html | '' }

export function emptyNotice({ what, next, extra = '' }: EmptyNotice) {
	return html`<div class="sp-empty">
		<p><b>${what}</b></p>
		<p>${next}</p>
		${extra}
	</div>`
}

export function emptyLine({ text }: { text: Html | string }) {
	return html`<p class="sp-empty">${text}</p>`
}
