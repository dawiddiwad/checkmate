import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type Crumbs = Array<[string, string | null]>

export function crumbBar({ crumbs }: { crumbs: Crumbs | undefined }) {
	if (!crumbs?.length) return html``
	return html`<p class="sc-crumb">
		${crumbs.map(([label, href], index) => [
			index ? html` › ` : '',
			href ? html`<a href="${href}">${label}</a>` : html`<span aria-current="page">${label}</span>`,
		])}
	</p>`
}

export type Heading = {
	title: Html | string
	sub?: Html | string | null
	crumbs?: Crumbs
	meta?: Html | ''
	actions?: Html | ''
	extra?: Html | string
}

export function heading({ title, sub = null, crumbs, meta = '', actions = '', extra = '' }: Heading) {
	return html`<header class="sc-h">
		<div class="sc-h-text">
			${crumbs ? crumbBar({ crumbs }) : ''}
			<h1>${title}</h1>
			${meta ? html`<div class="sc-h-meta">${meta}</div>` : ''} ${sub ? html`<p>${sub}</p>` : ''}
		</div>
		${actions ? html`<div class="sc-h-act">${actions}</div>` : ''} ${extra}
	</header>`
}
