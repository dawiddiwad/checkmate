import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { field, textArea, textInput } from './field.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'field with text input',
		field({
			id: 'catalogue-name',
			label: 'Your name',
			control: textInput({ id: 'catalogue-name', name: 'actor', value: 'qa-lead' }),
		}),
	],
	[
		'field with help',
		field({
			id: 'catalogue-build',
			label: html`Build <span class="req">optional</span>`,
			control: textInput({
				id: 'catalogue-build',
				name: 'build',
				attrs: { 'aria-describedby': 'catalogue-build-help' },
			}),
			help: 'The name of the build under test.',
			helpId: 'catalogue-build-help',
		}),
	],
	[
		'field with text area',
		field({
			id: 'catalogue-why',
			label: 'Rationale',
			control: textArea({ id: 'catalogue-why', name: 'rationale', rows: 3, value: 'The policy says so.' }),
		}),
	],
	[
		'field required and empty',
		field({
			id: 'catalogue-required',
			label: 'Answer',
			control: textInput({ id: 'catalogue-required', name: 'answer', attrs: { required: true } }),
		}),
	],
	[
		'field disabled',
		field({
			id: 'catalogue-disabled',
			label: 'Instance',
			control: textInput({
				id: 'catalogue-disabled',
				name: 'instance',
				value: 'local',
				attrs: { disabled: true },
			}),
		}),
	],
]
