import { html } from '../html.ts'

export type Tab = { href: string; label: string }

export function pageTabs({ label, tabs, current }: { label: string; tabs: Tab[]; current: string }) {
	return html`<nav class="settings-nav" aria-label="${label}">
		<ul class="nav">
			${tabs.map(
				(tab) =>
					html`<li>
						<a href="${tab.href}" ${tab.href === current ? html`aria-current="page"` : ''}>${tab.label}</a>
					</li>`
			)}
		</ul>
	</nav>`
}

export function jumpLinks({ links }: { links: Tab[] }) {
	return html`<nav class="jump" aria-label="On this page">
		${links.map((link) => html`<a href="${link.href}">${link.label}</a>`)}
	</nav>`
}
