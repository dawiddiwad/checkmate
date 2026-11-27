import type { Html } from '../html.ts'
import { glyph, html } from '../html.ts'
import { key } from './key.ts'

export const examples: Array<[string, Html | string]> = [
	['key spoken', key({ name: 'Enter' })],
	['key hidden from screen readers', key({ name: 1, spoken: false })],
	[
		'arrow keys as separate caps',
		html`<span class="sc-key-hint">${key({ name: glyph('↑') })}${key({ name: glyph('↓') })}rows</span>
			<span class="sc-key-hint">${key({ name: glyph('↑') })}up only</span>
			<span class="sc-key-hint">${key({ name: glyph('←') })}${key({ name: glyph('→') })}back and open</span>
			<span class="sc-key-hint">${key({ name: 'Enter' })}open</span>`,
	],
]
