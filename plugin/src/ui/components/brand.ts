import { html } from '../html.ts'

function mark() {
	return html`<span class="mark" aria-hidden="true"><i></i><i></i><i class="on"></i><i></i></span>`
}

export function brand() {
	return html`<a class="brand" href="/" aria-label="Checkmate, home">${mark()}<span>Checkmate</span></a>`
}
