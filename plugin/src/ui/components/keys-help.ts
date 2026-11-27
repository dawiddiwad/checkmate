import { html } from '../html.ts'
import { button } from './button.ts'

export function keysHelp() {
	return html`<dialog class="sc-confirm is-keys" data-keys aria-labelledby="keys-title">
		<div class="sc-card-h">
			<h2 id="keys-title">Keys</h2>
			${button({ label: 'Close', keyName: 'Esc', quiet: true, attrs: { type: 'button', 'data-keys-close': true } })}
		</div>
		<div data-keys-table></div>
	</dialog>`
}
