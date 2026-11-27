import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { button, formButton, optionButton } from './button.ts'

export const examples: Array<[string, Html | string]> = [
	['button default', button({ label: 'Edit the rules', attrs: { type: 'button' } })],
	['button primary', button({ label: 'Send', emphasis: 'primary', attrs: { type: 'button' } })],
	['button unblocks', button({ label: 'Answer 2 blocking questions', emphasis: 'unblocks', href: '#' })],
	['button with key', button({ label: 'Close', keyName: 'Esc', attrs: { type: 'button' } })],
	['button link', button({ label: 'Open the plan', href: '#', keyName: 1 })],
	['button disabled', button({ label: 'Remove…', attrs: { type: 'button', disabled: true } })],
	['optionButton', optionButton({ n: 1, label: 'Right', name: 'Right as built', attrs: { type: 'button' } })],
	['optionButton link', optionButton({ n: 2, label: 'Different', href: '#' })],
	['formButton default', formButton({ label: 'Cancel', attrs: { type: 'button' } })],
	['formButton primary', formButton({ label: 'Save name', emphasis: 'primary', attrs: { type: 'button' } })],
	['formButton inline', formButton({ label: 'Answer', href: '#', inline: true })],
	['formButton quiet', formButton({ label: 'Clear', href: '#', quiet: true })],
	[
		'formButton disabled',
		formButton({ label: '« First', element: 'span', inline: true, attrs: { 'aria-disabled': 'true' } }),
	],
	[
		'formButton summary',
		html`<details>${formButton({ label: 'Retire', element: 'summary', inline: true })}</details>`,
	],
]
