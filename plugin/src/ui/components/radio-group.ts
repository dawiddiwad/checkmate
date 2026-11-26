import type { Attrs } from '../html.ts'
import { attributes, html } from '../html.ts'
import { key } from './key.ts'

export type RadioChoice = { value: string; title: string; checked: boolean; truncate?: boolean }

export type RadioGroup = { label: string; name: string; choices: RadioChoice[]; attrs?: Attrs }

export function radioGroup({ label, name, choices, attrs }: RadioGroup) {
	return html`<fieldset class="sp-seg" role="radiogroup" aria-label="${label}" ${attributes(attrs)}>
		<legend>${label}</legend>
		${choices.map(
			(choice, index) =>
				html`<label class="sp-seg-o" title="${choice.title}"
					><input
						type="radio"
						name="${name}"
						value="${choice.value}"
						data-stop
						data-key-n="${index + 1}"
						${choice.checked ? html`checked` : ''}
					/>${key({ name: index + 1 })}${
						choice.truncate
							? html`<span class="ell">${choice.value}</span>`
							: html`<span>${choice.value}</span>`
					}</label
				>`
		)}
	</fieldset>`
}
