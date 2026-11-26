import { plainClick } from './navigation.js'

export const viewer = document.querySelector('[data-viewer]')

const viewerImage = viewer?.querySelector('[data-viewer-image]')

const viewerText = viewer?.querySelector('[data-viewer-text]')

const viewerNote = viewer?.querySelector('[data-viewer-note]')

const viewerScales = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

let viewerOpener = null

let viewerScale = 0

function zoomViewer(step) {
	if (viewerImage.hidden) return
	const index = viewerScales.indexOf(viewerScale)
	if (step === 'fit') viewerScale = 0
	else if (step === 'actual') viewerScale = 1
	else if (step === 'in') viewerScale = index === 0 ? 1 : viewerScales[Math.min(viewerScales.length - 1, index + 1)]
	else if (step === 'out') viewerScale = index <= 1 ? 0 : viewerScales[index - 1]
	viewer.querySelector('[data-viewer-scale]').textContent = viewerScale ? `${Math.round(viewerScale * 100)} %` : 'Fit'
	viewer.dataset.zoomed = viewerScale ? '1' : ''
	viewerImage.style.width = viewerScale ? `${Math.round(viewerImage.naturalWidth * viewerScale)}px` : ''
}

function wrapViewer(on) {
	viewer.querySelector('[data-viewer-wrap]').checked = on
	viewerText.classList.toggle('nowrap', !on)
}

async function viewerSource(link) {
	const inline = link.closest('figure')?.querySelector('[data-view-source]')
	if (inline) return inline.textContent
	const response = await fetch(link.dataset.src, { cache: 'no-store' })
	if (!response.ok) throw new Error(String(response.status))
	return response.text()
}

function viewerMessage(text) {
	for (const tools of viewer.querySelectorAll('[data-viewer-tools]')) tools.hidden = true
	viewerImage.hidden = true
	viewerText.hidden = true
	viewerNote.querySelector('[data-viewer-message]').textContent = text
	viewerNote.hidden = false
}

function openViewer(link) {
	viewerOpener = link
	const kind = link.dataset.view
	viewer.dataset.kind = kind
	viewer.querySelector('[data-viewer-name]').textContent = link.dataset.name ?? ''
	for (const download of viewer.querySelectorAll('[data-viewer-download], [data-viewer-note-download]')) {
		download.href = link.dataset.src || link.href
		download.setAttribute('download', link.dataset.name ?? '')
	}
	for (const tools of viewer.querySelectorAll('[data-viewer-tools]'))
		tools.hidden = tools.dataset.targeterTools !== kind
	viewerImage.hidden = kind !== 'image'
	viewerText.hidden = kind !== 'text'
	viewerNote.hidden = true
	if (kind === 'image') {
		viewerImage.src = link.dataset.src || link.href
		viewerImage.alt = link.querySelector('img')?.alt ?? link.dataset.name ?? ''
		zoomViewer('fit')
	} else {
		viewerText.textContent = 'Loading…'
		wrapViewer(true)
		viewerSource(link)
			.then((text) => (text ? (viewerText.textContent = text) : viewerMessage('Empty file.')))
			.catch(() => viewerMessage('Checkmate could not load this file.'))
	}
	viewer.hidden = false
	document.querySelector('main').inert = true
	viewer.querySelector('[data-viewer-close]').focus()
}

export function trapViewer(event) {
	if (!viewer || viewer.hidden || event.key !== 'Tab') return false
	const stops = [...viewer.querySelectorAll('a[href], button, input, pre[tabindex]')].filter(
		(element) => !element.closest('[hidden]')
	)
	const first = stops[0]
	const last = stops[stops.length - 1]
	if (event.shiftKey && document.activeElement === first) last.focus()
	else if (!event.shiftKey && document.activeElement === last) first.focus()
	else if (!viewer.contains(document.activeElement)) first.focus()
	else return false
	event.preventDefault()
	return true
}

export function closeViewer() {
	if (!viewer || viewer.hidden) return false
	viewer.hidden = true
	document.querySelector('main').inert = false
	viewerImage.removeAttribute('src')
	viewerImage.style.width = ''
	viewerText.textContent = ''
	viewerOpener?.focus()
	return true
}

function brokenImage(image) {
	image.hidden = true
	image.nextElementSibling.hidden = false
}

export function attachEvidenceViewer() {
	viewerImage?.addEventListener('error', () => {
		if (!viewer.hidden && viewerImage.getAttribute('src')) viewerMessage('This image cannot be shown.')
	})
	document.addEventListener('change', (event) => {
		if (event.target.matches('[data-viewer-wrap]')) wrapViewer(event.target.checked)
	})
	document.addEventListener(
		'error',
		(event) => {
			if (event.target.matches?.('[data-ev-image]')) brokenImage(event.target)
		},
		true
	)
	for (const image of document.querySelectorAll('[data-ev-image]'))
		if (image.complete && !image.naturalWidth) brokenImage(image)
	document.addEventListener('click', (event) => {
		const opener = event.target.closest('a[data-view]')
		if (opener && viewer && plainClick(event)) {
			event.preventDefault()
			return openViewer(opener)
		}
		const zoom = event.target.closest('[data-zoom]')
		if (zoom) zoomViewer(zoom.dataset.zoom)
		if (event.target.matches?.('[data-viewer-image]')) zoomViewer(viewerScale === 0 ? 'actual' : 'fit')
		if (event.target.closest('[data-viewer-close]') || event.target.matches?.('[data-viewer]')) closeViewer()
	})
}
