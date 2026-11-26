import { html, join } from '../html.ts'
import { button } from './button.ts'

const actions = ['accept', 'right', 'defer', 'handoff', 'copy', 'allow', 'deny']

export function bulkBar({ planId, csrf }: { planId: string; csrf: string }) {
	const action = (name: string, label = '') =>
		button({ label, keyName: '', attrs: { type: 'button', 'data-bulk-action': name } })
	return html`<div
		class="sp-bulk"
		data-bulk
		data-plan="${planId}"
		data-csrf="${csrf}"
		role="group"
		aria-label="Selection"
		hidden
	>
		<span class="sp-path" data-bulk-count aria-live="polite"></span>
		${join(
			actions.map((name) => action(name)),
			' '
		)}
		${action('clear', 'Clear the selection')}
	</div>`
}
