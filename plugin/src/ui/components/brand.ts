import { html } from '../html.ts'

export function brand() {
	return html`<a class="sc-brand" href="/" aria-label="Checkmate, home"
		><svg class="sc-brand-mark" viewBox="0 0 40 10" aria-hidden="true">
			<rect class="o" x="0.5" y="0.5" width="9" height="9" />
			<rect class="o" x="10.5" y="0.5" width="9" height="9" />
			<rect class="f" x="20" y="0" width="10" height="10" />
			<rect class="o" x="30.5" y="0.5" width="9" height="9" /></svg
		><span class="sc-brand-word">Checkmate</span></a
	>`
}
