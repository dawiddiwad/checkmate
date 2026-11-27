import type { EvidenceFile, Opener } from '../evidence.ts'
import type { Html } from '../html.ts'
import { htmlType, imageTypes, shownAsText, size } from '../evidence.ts'
import { html } from '../html.ts'
import { formButton } from './button.ts'
import { emptyLine } from './empty-state.ts'
import { key } from './key.ts'

export function htmlPreview(file: EvidenceFile) {
	if (!file.href || file.mediaType !== htmlType) return null
	return html`<iframe
		class="sc-evidence-frame"
		src="${file.href}?preview=1"
		title="Preview of ${file.name}"
		loading="lazy"
		referrerpolicy="no-referrer"
		sandbox
	></iframe>`
}

function download(file: EvidenceFile) {
	if (!file.href) return ''
	return html`<a
		class="sc-evidence-act"
		href="${file.href}"
		download="${file.name}"
		aria-label="Download ${file.name}"
		>Download</a
	>`
}

function caption(file: EvidenceFile, open: Html | '' = '') {
	const acts = download(file)
	return html`<figcaption>
		<span class="sc-evidence-title"
			><span class="sc-evidence-name">${file.name}</span>
			${file.size ? html`<span class="sc-muted">${size(file.size)}</span>` : ''}</span
		>
		${open || acts ? html`<span class="sc-evidence-acts">${open} ${acts}</span>` : ''}
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
	if (file.size === 0)
		return html`<figure class="sc-evidence-item is-none">
			<p class="sc-evidence-note">Empty file</p>
			${caption(file)}
		</figure>`
	if (file.href && imageTypes.includes(file.mediaType))
		return html`<figure class="sc-evidence-item is-image">
			<a
				href="${file.href}"
				data-view="image"
				data-name="${file.name}"
				data-src="${file.href}"
				aria-label="View ${file.name}"
			>
				<img src="${file.href}" alt="Evidence ${file.name}" loading="lazy" data-ev-image />
				<span class="sc-evidence-note" hidden>This image cannot be shown.</span>
			</a>
			${caption(file)}
		</figure>`
	const frame = htmlPreview(file)
	if (frame) return html`<figure class="sc-evidence-item">${frame}${caption(file)}</figure>`
	if (file.text && (!file.href || shownAsText(file.mediaType, file.size)))
		return html`<figure class="sc-evidence-item is-text">
			<pre tabindex="0" data-view-source>${file.text()}</pre>
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
		</figure>`
	return html`<figure class="sc-evidence-item is-none">
		<p class="sc-evidence-note">No preview for this file type.</p>
		${caption(file)}
	</figure>`
}

export function evidenceList(files: EvidenceFile[], none: Html | string = '') {
	if (!files.length) return none ? html`<p class="sc-empty is-line">${none}</p>` : ''
	return html`<div class="sc-evidence">${files.map(evidenceItem)}</div>`
}

export const evidenceOverlay = html`<div
	class="sc-overlay"
	data-viewer
	hidden
	role="dialog"
	aria-modal="true"
	aria-label="Evidence viewer"
>
	<div class="sc-overlay-bar">
		<span class="sc-overlay-name" data-viewer-name></span>
		<span class="sc-overlay-tools" data-viewer-tools="image">
			${formButton({ label: '-', inline: true, attrs: { type: 'button', 'data-zoom': 'out', 'aria-label': 'Zoom out', title: 'Zoom out (-)' } })}
			<span class="sc-overlay-scale" data-viewer-scale>Fit</span>
			${formButton({ label: '+', inline: true, attrs: { type: 'button', 'data-zoom': 'in', 'aria-label': 'Zoom in', title: 'Zoom in (+)' } })}
			${formButton({ label: 'Fit', inline: true, attrs: { type: 'button', 'data-zoom': 'fit', title: 'Fit to the window (0)' } })}
		</span>
		<label class="sc-overlay-tools is-wrap" data-viewer-tools="text"
			><input type="checkbox" data-viewer-wrap checked /> Wrap lines ${key({ name: 'w' })}</label
		>
		${formButton({ label: 'Download', href: '#', inline: true, attrs: { 'data-viewer-download': true, download: true } })}
		${formButton({ label: html`Close ${key({ name: 'Esc' })}`, inline: true, attrs: { type: 'button', 'data-viewer-close': true } })}
	</div>
	<div class="sc-overlay-body" data-viewer-body>
		<img data-viewer-image alt="" hidden />
		<pre class="sc-overlay-text" data-viewer-text tabindex="0" hidden></pre>
		<div class="sc-overlay-note" data-viewer-note hidden>
			<p data-viewer-message></p>
			${formButton({ label: 'Download', href: '#', inline: true, attrs: { 'data-viewer-note-download': true, download: true } })}
		</div>
	</div>
</div>`

export type EvidenceFiles = { files: EvidenceFile[]; base: string; current: number | null; inViewer?: boolean }

export function evidenceFiles({ files, base, current, inViewer: viewer = false }: EvidenceFiles) {
	if (!files.length) return emptyLine({ text: 'The tester gave no evidence.' })
	return html`<div class="sc-files" role="listbox" aria-label="Evidence">
		${files.map(
			(file, index) =>
				html`<a
					class="sc-file${current === index ? ' hl' : ''}"
					role="option"
					aria-selected="${current === index ? 'true' : 'false'}"
					tabindex="-1"
					href="${`${base}&file=${index}`}"
					${viewer ? html`data-vfile="${index}"` : html`data-sub data-href="${`${base}&file=${index}`}"`}
					data-label="${file.name}"
					><span class="sc-file-k">${index + 1}</span
					><span class="sc-ell" title="${file.name}">${file.name}</span
					><span class="sc-file-k">${viewer ? (file.size ? size(file.size) : '') : 'View'}</span></a
				>`
		)}
	</div>`
}

export function evidencePreview({ file }: { file: EvidenceFile }) {
	if (file.size === 0 && file.href) return emptyLine({ text: 'Empty file.' })
	if (file.href && imageTypes.includes(file.mediaType))
		return html`<img src="${file.href}" alt="Evidence ${file.name}" data-ev-image /><span class="sc-empty" hidden
				>This image cannot be shown.</span
			>`
	if (file.text && (!file.href || shownAsText(file.mediaType, file.size)))
		return html`<pre tabindex="0">${file.text()}</pre>`
	return htmlPreview(file) ?? emptyLine({ text: 'No preview for this file type.' })
}
