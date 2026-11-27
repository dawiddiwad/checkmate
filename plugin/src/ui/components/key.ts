import type { Html } from '../html.ts'
import { html } from '../html.ts'

export function key({ name, spoken = true }: { name: Html | string | number; spoken?: boolean }) {
	return spoken ? html`<kbd class="sc-key">${name}</kbd>` : html`<kbd class="sc-key" aria-hidden="true">${name}</kbd>`
}
