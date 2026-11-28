import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type Fold = {
	key: string
	title: Html | string
	headingId?: string
	bodyId?: string
	link?: Html | ''
	count?: number | null
	open?: boolean
	region?: string
	listRegion?: boolean
	body: Html
}

export function fold({
	key,
	title,
	headingId,
	bodyId,
	link = '',
	count = null,
	open = false,
	region = '',
	listRegion = false,
	body,
}: Fold) {
	const heading = html`${title}${count === null ? '' : html`<b>${count}</b>`}`
	return html`<details
		class="sc-fold"
		data-open-key="${key}"
		${region ? html`data-region="${region}"` : ''}
		${open ? html`open` : ''}
	>
		<summary>
			${headingId === undefined ? html`<h2>${heading}</h2>` : html`<h2 id="${headingId}">${heading}</h2>`}${link}
		</summary>
		<div
			class="sc-fold-b"
			${bodyId === undefined ? '' : html`id="${bodyId}"`}
			${listRegion ? html`data-list-region` : ''}
		>
			${body}
		</div>
	</details>`
}
