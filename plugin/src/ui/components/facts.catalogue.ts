import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { facts, recordFacts } from './facts.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'facts',
		facts({
			rows: [
				['Target', 'shop-local@1'],
				['Build', html`<code>build-2</code>`],
				['Hidden', false],
			],
		}),
	],
	[
		'recordFacts',
		recordFacts({
			rows: [
				['Rule', 'R1 A coupon applies before tax'],
				['Seen by', 'a1, b1'],
				['Decision', null],
			],
		}),
	],
	['recordFacts empty', recordFacts({ rows: [['Decision', null]] })],
]
