import { html } from '../html.ts'

export function brand() {
	return html`<a class="sc-brand" href="/" aria-label="Checkmate, home"
		><svg class="sc-brand-mark" viewBox="0 0 49 10" aria-hidden="true">
			<rect class="o" x="0.75" y="0.75" width="8.5" height="8.5" />
			<rect class="o" x="13.75" y="0.75" width="8.5" height="8.5" />
			<rect class="f" x="26" y="0" width="10" height="10" />
			<rect class="o" x="39.75" y="0.75" width="8.5" height="8.5" /></svg
		><span class="sc-brand-word">Checkmate</span></a
	>`
}
