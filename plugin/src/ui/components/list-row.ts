import type { Attrs, Html } from '../html.ts'
import { attributes, glyph, html, plural } from '../html.ts'

export type ListRow = {
	id: string
	key: string
	href: string
	label: string
	inListbox?: boolean
	settled?: boolean
	current?: boolean
	blocking?: boolean
	attrs?: Attrs
	pickLabel?: string
	tag: Html | string
	shownId: Html | string
	idTitle?: string
	title: Html | string
	titleText: string
	titleHref?: string
	meta: Html | string
	metaText?: string
	options?: Html | ''
	extra?: Html | ''
}

function rowClass({ settled, current, blocking }: ListRow) {
	return `sc-row${settled ? ' is-dim' : ''}${current ? ' is-open' : ''}${blocking ? ' is-block' : ''}`
}

export function listRow(row: ListRow) {
	const role = row.inListbox ? html`role="option" aria-selected="false"` : html`role="listitem"`
	const title = row.titleHref
		? html`<a class="sc-c-title sc-ell" title="${row.titleText}" tabindex="-1" href="${row.titleHref}"
				>${row.title}</a
			>`
		: html`<span class="sc-c-title sc-ell" title="${row.titleText}">${row.title}</span>`
	return html`<div
		class="${rowClass(row)}"
		${role}
		tabindex="-1"
		id="${row.id}"
		data-row
		data-key="${row.key}"
		data-href="${row.href}"
		data-label="${row.label}"
		${attributes(row.attrs)}
	>
		${
			row.pickLabel === undefined
				? html`<span class="sc-c-cb"></span>`
				: html`<label class="sc-c-cb"
						><input type="checkbox" tabindex="-1" aria-label="Select ${row.pickLabel}" data-pick-box
					/></label>`
		}
		<span class="sc-c-tag">${row.tag}</span>
		${
			row.idTitle === undefined
				? html`<span class="sc-c-id">${row.shownId}</span>`
				: html`<span class="sc-c-id" title="${row.idTitle}">${row.shownId}</span>`
		}
		${title}
		${
			row.metaText === undefined
				? html`<span class="sc-c-meta sc-ell">${row.meta}</span>`
				: html`<span class="sc-c-meta sc-ell" title="${row.metaText}">${row.meta}</span>`
		}
		${row.options ?? ''} ${row.extra ?? ''}
	</div>`
}

export function groupHeader({ label, count }: { label: Html | string; count: number }) {
	return html`<div class="sc-group-h" role="presentation">${label}<b>${count}</b></div>`
}

export type ListPageRow = {
	key: string
	href: string | null
	top: Html | string
	tags: Html | string
	lines: Array<Html | string>
	open?: boolean
}

export function listPageRow({ key, href, top, tags, lines, open = false }: ListPageRow) {
	const inner = html`<span class="sc-recipe-n">${top} ${tags}</span>
		${lines.map((line, index) => html`<span class="${index ? 'sc-recipe-m' : 'sc-recipe-d'}">${line}</span>`)}`
	const label = key.slice(key.indexOf(':') + 1)
	return html`<li data-key="${key}" data-nav-row>
		${
			href
				? html`<a
						class="sc-recipe${open ? ' is-open' : ''}"
						href="${href}"
						data-row
						data-href="${href}"
						data-label="${label}"
						>${inner}</a
					>`
				: html`<div class="sc-recipe" tabindex="-1" data-row data-label="${label}">${inner}</div>`
		}
	</li>`
}

export function optionsBox(items: Html[]) {
	if (!items.length) return ''
	return html`<div class="sc-c-opts" aria-label="Options" data-fit>
		${items}<span class="sc-c-more" aria-hidden="true">${glyph('→')} ${plural(items.length, 'option')}</span>
	</div>`
}
