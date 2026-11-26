import { html } from '../html.ts'
import { button } from './button.ts'

export function confirmDialog() {
	return html`<dialog class="sp-confirm" data-confirm aria-labelledby="confirm-title">
		<div class="sp-dh"><h2 id="confirm-title" class="sp-path" data-confirm-title></h2></div>
		<form method="dialog" class="sp-form sp-confirm-b" data-confirm-form>
			<p class="sp-sub" data-confirm-text></p>
			<div data-confirm-field hidden>
				<label for="confirm-input" data-confirm-label></label>
				<input id="confirm-input" autocomplete="off" />
			</div>
			<div class="btns">
				${button({ label: 'Confirm', keyName: 'Enter', emphasis: 'primary', attrs: { value: 'yes', 'data-confirm-yes': true } })}
				${button({ label: 'Cancel', keyName: 'Esc', attrs: { value: 'no', 'data-confirm-no': true } })}
			</div>
		</form>
	</dialog>`
}
