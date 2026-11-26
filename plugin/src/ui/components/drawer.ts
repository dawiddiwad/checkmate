import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { button } from './button.ts'

export function closeButton({ href }: { href: string }) {
	return button({ label: 'Close', href, keyName: 'Esc', attrs: { 'data-close': true } })
}

export type Drawer = { back: string; key: string; path: Html | string; slot: Html; head: Html; body: Html }

export function drawer({ back, key, path, slot, head, body }: Drawer) {
	return html`<aside
		class="sp-drawer"
		aria-labelledby="record-title"
		data-drawer
		data-back="${back}"
		data-region="record"
		data-key="${key}"
	>
		<div class="sp-dh">
			<p class="sp-path">${path}</p>
			${closeButton({ href: back })}
		</div>
		<div class="sp-db">${slot} ${head} ${body}</div>
	</aside>`
}

export type DrawerHead = {
	label: string
	tags: Html
	title: string
	titleText?: string
	options?: Html[]
	onOwnPage?: boolean
}

export function drawerHead({ label, tags, title, titleText, options = [], onOwnPage = false }: DrawerHead) {
	const heading = onOwnPage
		? titleText === undefined
			? html`<h1 id="record-title" class="sp-ask-title">${title}</h1>`
			: html`<h1 id="record-title" class="sp-ask-title" title="${titleText}">${title}</h1>`
		: html`<h2 id="record-title">${title}</h2>`
	return html`<section class="sp-dhead" tabindex="-1" data-sub data-label="${label}">
		<div class="sp-pills">${tags}</div>
		${heading} ${options.length ? html`<div class="sp-dopts" aria-label="Options">${options}</div>` : ''}
	</section>`
}
