import { html } from '../html.ts'

export function key({ name, spoken = true }: { name: string | number; spoken?: boolean }) {
	return spoken ? html`<kbd>${name}</kbd>` : html`<kbd aria-hidden="true">${name}</kbd>`
}
