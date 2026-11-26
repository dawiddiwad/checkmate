import { html } from '../html.ts'
import { button } from './button.ts'

export function confirmDialog() {
	return html`<dialog class="sc-confirm" data-confirm aria-labelledby="confirm-title">
		<h2 id="confirm-title" data-confirm-title></h2>
		<form method="dialog" class="sc-form" data-confirm-form>
			<p data-confirm-text></p>
			<div class="sc-field" data-confirm-field hidden>
				<label class="sc-label" for="confirm-input" data-confirm-label></label>
				<input class="sc-input" id="confirm-input" autocomplete="off" />
			</div>
			<div class="sc-confirm-foot">
				${button({ label: 'Cancel', keyName: 'Esc', attrs: { value: 'no', 'data-confirm-no': true } })}
				${button({ label: 'Confirm', keyName: 'Enter', emphasis: 'primary', attrs: { value: 'yes', 'data-confirm-yes': true } })}
			</div>
		</form>
	</dialog>`
}
