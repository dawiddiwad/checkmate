import type { Html } from './html.ts'
import { html } from './html.ts'

export type EvidenceFile = {
	name: string
	mediaType: string
	size: number
	href: string | null
	text: (() => string) | null
}

export type Opener = { name: string; kind: 'image' | 'text'; page: string; src: string }

export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const textTypes = ['text/plain', 'text/markdown', 'application/json', 'application/xml', 'text/csv']
const inlineLimit = 64 * 1024

export function size(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function shownAsText(mediaType: string, bytes: number) {
	return textTypes.includes(mediaType) && bytes <= inlineLimit
}

function download(file: EvidenceFile) {
	if (!file.href) return ''
	return html`<a class="ev-act" href="${file.href}" download="${file.name}" aria-label="Download ${file.name}"
		>Download</a
	>`
}

function caption(file: EvidenceFile, open: Html | '' = '') {
	return html`<figcaption>
		<span class="ev-name">${file.name}</span>
		${file.size ? html`<span class="muted">${size(file.size)}</span>` : ''} ${open} ${download(file)}
	</figcaption>`
}

export function viewLink(opener: Opener, content: Html | string, label = `View ${opener.name}`, extra = '') {
	return html`<a
		class="${extra}"
		href="${opener.page}"
		data-view="${opener.kind}"
		data-name="${opener.name}"
		data-src="${opener.src}"
		aria-label="${label}"
		>${content}</a
	>`
}

export function evidenceItem(file: EvidenceFile) {
	if (file.href && imageTypes.includes(file.mediaType))
		return html`<figure class="ev ev-image">
			<a
				href="${file.href}"
				data-view="image"
				data-name="${file.name}"
				data-src="${file.href}"
				aria-label="View ${file.name}"
			>
				<img src="${file.href}" alt="Evidence ${file.name}" loading="lazy" />
			</a>
			${caption(file)}
		</figure>`
	if (file.text && (!file.href || shownAsText(file.mediaType, file.size)))
		return html`<figure class="ev ev-text">
			${caption(
				file,
				file.href
					? viewLink(
							{ name: file.name, kind: 'text', page: file.href, src: file.href },
							'View',
							undefined,
							'ev-act'
						)
					: ''
			)}
			<pre tabindex="0" data-view-source>${file.text()}</pre>
		</figure>`
	return html`<a class="chip" href="${file.href}" download="${file.name}" aria-label="Download ${file.name}"
		>↓ ${file.name} · ${size(file.size)}</a
	>`
}

export function evidenceList(files: EvidenceFile[], none: Html | string = '') {
	if (!files.length) return none ? html`<p class="none">${none}</p>` : ''
	return html`<div class="evidence">${files.map(evidenceItem)}</div>`
}

export const viewer = html`<div
	class="viewer"
	data-viewer
	hidden
	role="dialog"
	aria-modal="true"
	aria-label="Evidence viewer"
>
	<div class="viewer-bar">
		<span class="viewer-name" data-viewer-name></span>
		<span class="viewer-tools" data-viewer-tools="image">
			<button class="btn small" type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (-)">
				−
			</button>
			<span class="viewer-scale" data-viewer-scale aria-live="polite">Fit</span>
			<button class="btn small" type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
			<button class="btn small" type="button" data-zoom="fit" title="Fit to the window (0)">Fit</button>
		</span>
		<label class="viewer-tools viewer-wrap" data-viewer-tools="text"
			><input type="checkbox" data-viewer-wrap checked /> Wrap lines <kbd>w</kbd></label
		>
		<a class="btn small" data-viewer-download href="#" download>Download</a>
		<button class="btn small" type="button" data-viewer-close>Close <kbd>Esc</kbd></button>
	</div>
	<div class="viewer-body" data-viewer-body>
		<img data-viewer-image alt="" hidden />
		<pre class="viewer-text" data-viewer-text tabindex="0" hidden></pre>
		<div class="viewer-note" data-viewer-note hidden>
			<p data-viewer-message></p>
			<a class="btn small" data-viewer-note-download href="#" download>Download</a>
		</div>
	</div>
</div>`
