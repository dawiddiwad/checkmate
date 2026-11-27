import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { button } from './button.ts'

export function closeButton({ href }: { href: string }) {
	return button({ label: 'Close', href, keyName: 'Esc', quiet: true, attrs: { 'data-close': true } })
}

export type Drawer = { back: string; key: string; path: Html | string; slot: Html; head: Html; body: Html }

export function drawer({ back, key, path, slot, head, body }: Drawer) {
	return html`<aside
		class="sc-drawer"
		aria-labelledby="record-title"
		data-drawer
		data-back="${back}"
		data-region="record"
		data-key="${key}"
	>
		<div class="sc-drawer-head">
			<p class="sc-crumb">${path}</p>
			${closeButton({ href: back })}
		</div>
		<div class="sc-drawer-body">${slot} ${head} ${body}</div>
	</aside>`
}

export type DrawerHead = {
	label: string
	tags: Html
	title: string
	titleText?: string
	facts?: Html | ''
	options?: Html[]
	onOwnPage?: boolean
}

export function drawerHead({ label, tags, title, titleText, facts = '', options = [], onOwnPage = false }: DrawerHead) {
	const heading = onOwnPage
		? html`<h1
				id="record-title"
				class="sc-drawer-title"
				${titleText === undefined ? '' : html`title="${titleText}"`}
			>
				${title}
			</h1>`
		: html`<h2 id="record-title" class="sc-drawer-title">${title}</h2>`
	return html`<section class="sc-drawer-top" tabindex="-1" data-sub data-label="${label}">
		<div class="sc-drawer-id">${tags}</div>
		${heading} ${options.length ? html`<div class="sc-opts" aria-label="Options">${options}</div>` : ''} ${facts}
	</section>`
}
