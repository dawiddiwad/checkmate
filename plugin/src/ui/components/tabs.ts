import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type Tab = { href: string; label: Html | string; count?: number; hot?: boolean }

function tabLabel(tab: Tab) {
	return html`${tab.label}${tab.count === undefined ? '' : html`<b>${tab.count}</b>`}`
}

export function pageTabs({ label, tabs, current }: { label: string; tabs: Tab[]; current: string }) {
	return html`<nav class="sc-tabs" aria-label="${label}">
		${tabs.map(
			(tab) =>
				html`<a class="sc-tab" href="${tab.href}" ${tab.href === current ? html`aria-current="page"` : ''}
					>${tabLabel(tab)}</a
				>`
		)}
	</nav>`
}

export function jumpLinks({ links }: { links: Tab[] }) {
	return html`<nav class="sc-tabs" aria-label="On this page">
		${links.map((link) => html`<a class="sc-tab${link.hot ? ' is-hot' : ''}" href="${link.href}">${tabLabel(link)}</a>`)}
	</nav>`
}
