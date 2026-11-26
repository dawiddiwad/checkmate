import type { Html } from '../html.ts'
import { metrics } from './metric.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'metrics waits on you, value, zero',
		metrics({
			items: [
				{ value: 2, name: 'block testing', waitsOnYou: true },
				{ value: 5, name: 'to look at', waitsOnYou: false },
				{ value: 0, name: 'defects', waitsOnYou: false },
			],
		}),
	],
]
