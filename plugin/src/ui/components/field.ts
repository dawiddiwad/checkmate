import type { Attrs, Html } from '../html.ts'
import { attributes, html } from '../html.ts'

export type Field = {
	id: string
	label: Html | string
	control: Html
	help?: Html | string
	helpId?: string
	attrs?: Attrs
}

export function field({ id, label, control, help, helpId, attrs }: Field) {
	const note =
		help === undefined
			? ''
			: helpId === undefined
				? html`<p class="sc-help">${help}</p>`
				: html`<p class="sc-help" id="${helpId}">${help}</p>`
	return html`<div class="sc-field" ${attributes(attrs)}>
		<label class="sc-label" for="${id}">${label}</label>
		${control} ${note}
	</div>`
}

export type TextInput = { id: string; name?: string; value?: string; attrs?: Attrs }

export function textInput({ id, name, value, attrs }: TextInput) {
	return html`<input class="sc-input" id="${id}" ${attributes({ name, value, ...attrs })} />`
}

export type TextArea = { id: string; name: string; rows: number; value?: string; attrs?: Attrs }

export function textArea({ id, name, rows, value = '', attrs }: TextArea) {
	return html`<textarea class="sc-textarea" id="${id}" name="${name}" rows="${rows}" ${attributes(attrs)}>
${value}</textarea>`
}
