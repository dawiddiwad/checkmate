import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type Crumbs = Array<[string, string | null]>

export function crumbBar(crumbs: Crumbs | undefined) {
	if (!crumbs?.length) return html``
	return html`<p class="sp-path">
		${crumbs.map(([label, href], index) => [
			index ? html` › ` : '',
			href ? html`<a href="${href}">${label}</a>` : html`<span aria-current="page">${label}</span>`,
		])}
	</p>`
}

export function heading(title: Html | string, sub: Html | string | null = null, extra: Html | string = '') {
	return html`<div class="sp-h">
		<div>
			<h1>${title}</h1>
			${sub ? html`<p class="sp-sub">${sub}</p>` : ''}
		</div>
		${extra}
	</div>`
}
