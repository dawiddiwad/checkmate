import type { Html } from '../html.ts'
import { radioGroup } from './radio-group.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'radioGroup',
		radioGroup({
			label: 'Level',
			name: 'catalogue-level',
			choices: [
				{ value: 'smoke', title: '1 tester', checked: false },
				{ value: 'normal', title: '2 testers', checked: true },
				{ value: 'deep', title: '3 testers', checked: false },
			],
		}),
	],
	[
		'radioGroup truncated choices',
		radioGroup({
			label: 'Area',
			name: 'catalogue-area',
			choices: [
				{ value: 'A very long area name that does not fit', title: 'long', checked: true, truncate: true },
				{ value: 'Short', title: 'short', checked: false, truncate: true },
			],
		}),
	],
	[
		'radioGroup disabled',
		radioGroup({
			label: 'Instance',
			name: 'catalogue-instance',
			choices: [{ value: 'local', title: 'local', checked: true }],
			attrs: { disabled: true },
		}),
	],
]
