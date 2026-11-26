import { html } from '../html.ts'

const downloadNames: Record<string, [string, string]> = {
	html: ['HTML', 'print-ready'],
	md: ['Markdown', '.md'],
	json: ['JSON', 'data'],
	junit: ['JUnit XML', 'for CI'],
}

export function downloadMenu(label: string, base: string, note: string, formats = ['html', 'md', 'json']) {
	const item = (format: string) =>
		html`<a href="${base}.${format}" download data-download="${format}"
			>${downloadNames[format][0]} <span class="muted">${downloadNames[format][1]}</span></a
		>`
	return html`<details class="menu" data-menu>
		<summary class="sp-btn" title="${note}">${label}</summary>
		<div class="menu-list">
			${formats.map(item)}
			<p class="menu-note">${note}</p>
		</div>
	</details>`
}
