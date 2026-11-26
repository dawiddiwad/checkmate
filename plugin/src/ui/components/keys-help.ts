import { html } from '../html.ts'
import { button } from './button.ts'

export function keysHelp() {
	return html`<dialog class="sp-keys" data-keys aria-labelledby="keys-title">
		<div class="sp-dh">
			<h2 id="keys-title" class="sp-path">Keys</h2>
			${button({ label: 'Close', keyName: 'Esc', attrs: { type: 'button', 'data-keys-close': true } })}
		</div>
		<div data-keys-table></div>
	</dialog>`
}
