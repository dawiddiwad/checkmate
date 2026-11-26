import { reveal } from './navigation.js'
import { body, reducedMotion } from './page-state.js'

export function dockRoom() {
	const bulk = document.querySelector('[data-bulk]:not([hidden])')?.offsetHeight ?? 0
	const message = document.querySelector('[data-say-strip]:not([hidden])')?.offsetHeight ?? 0
	const note = document.querySelector('.toast')
	if (note) note.hidden = false
	let toast = note?.offsetHeight ?? 0
	if (note && bulk && bulk + message + toast > window.innerHeight / 3) {
		note.hidden = true
		toast = 0
	}
	document.documentElement.style.setProperty('--bulk-h', `${bulk}px`)
	document.documentElement.style.setProperty('--say-h', `${message}px`)
	document.documentElement.style.setProperty('--dock-h', `${bulk + message + toast}px`)
	const row = document.querySelector('.hl[data-row]')
	if (row) reveal(row)
}

export function showToast(text) {
	document.querySelector('[data-toast]')?.remove()
	const note = document.createElement('div')
	note.className = 'toast'
	note.setAttribute('role', 'status')
	note.dataset.toast = ''
	note.textContent = text
	body.append(note)
	dockRoom()
	setTimeout(() => {
		note.remove()
		dockRoom()
	}, 6000)
}

const toast = document.querySelector('[data-toast]')

export function attachDock() {
	if (toast)
		setTimeout(() => {
			toast.classList.add('gone')
			setTimeout(
				() => {
					toast.remove()
					dockRoom()
				},
				reducedMotion.matches ? 0 : 320
			)
		}, 6000)
}
