import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type EmptyNotice = { what: string; next: Html | string; extra?: Html | '' }

export function emptyNotice({ what, next, extra = '' }: EmptyNotice) {
	return html`<div class="sc-empty">
		<b>${what}</b>
		<p>${next}</p>
		${extra}
	</div>`
}

export function emptyLine({ text }: { text: Html | string }) {
	return html`<p class="sc-empty is-line">${text}</p>`
}
