import type { Attrs, Html } from '../html.ts'
import { attributes, html } from '../html.ts'
import { key } from './key.ts'

export type Emphasis = 'primary' | 'unblocks'

const emphasisClass: Record<Emphasis, string> = {
	primary: ' pri',
	unblocks: ' you',
}

export type Button = {
	label: Html | string
	href?: string
	keyName?: string | number
	keySpoken?: boolean
	emphasis?: Emphasis
	attrs?: Attrs
}

export function button({ label, href, keyName, keySpoken = true, emphasis, attrs }: Button) {
	const look = `sp-btn${emphasis ? emphasisClass[emphasis] : ''}`
	const inner = html`${keyName === undefined ? '' : key({ name: keyName, spoken: keySpoken })}<span>${label}</span>`
	return href === undefined
		? html`<button class="${look}" ${attributes(attrs)}>${inner}</button>`
		: html`<a class="${look}" href="${href}" ${attributes(attrs)}>${inner}</a>`
}

export type OptionButton = { n: number; label: string; name?: string; href?: string; attrs?: Attrs }

export function optionButton({ n, label, name = label, href, attrs }: OptionButton) {
	return button({
		label,
		href,
		keyName: n,
		keySpoken: false,
		attrs: { 'data-option': true, ...attrs, 'aria-label': `${n}: ${name}`, title: name },
	})
}

export type FormButton = {
	label: Html | string
	href?: string
	element?: 'summary' | 'span'
	emphasis?: 'primary'
	inline?: boolean
	quiet?: boolean
	attrs?: Attrs
}

export function formButton({ label, href, element, emphasis, inline = false, quiet = false, attrs }: FormButton) {
	const look = `btn${inline ? ' small' : ''}${emphasis ? ' primary' : ''}${quiet ? ' ghost' : ''}`
	if (href !== undefined) return html`<a class="${look}" href="${href}" ${attributes(attrs)}>${label}</a>`
	if (element === 'summary') return html`<summary class="${look}" ${attributes(attrs)}>${label}</summary>`
	if (element === 'span') return html`<span class="${look}" ${attributes(attrs)}>${label}</span>`
	return html`<button class="${look}" ${attributes(attrs)}>${label}</button>`
}
