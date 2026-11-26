import { refuseAt } from './actions.js'
import { ask } from './confirm-dialog.js'
import { shown } from './navigation.js'

export function syncRationale(root = document) {
	for (const form of root.querySelectorAll('form')) {
		const rationale = form.querySelector('[data-rationale]')
		if (!rationale) continue
		const empty = !rationale.value.trim()
		for (const button of form.querySelectorAll('[data-needs-rationale]')) button.disabled = empty
	}
}

export function syncSource(root = document) {
	for (const form of root.querySelectorAll('[data-gap-form]')) {
		const kind = form.querySelector('input[name="kind"]:checked')
		const source = form.querySelector('[data-source]')
		if (source) source.required = kind?.value === 'clarify'
	}
}

function confirmStart(form, button) {
	let verdict = form.querySelector('[data-verdict-input]')
	if (!verdict) {
		verdict = document.createElement('input')
		verdict.type = 'hidden'
		verdict.name = 'verdict'
		verdict.dataset.verdictInput = ''
		form.append(verdict)
	}
	verdict.value = button.value
	form.dataset.confirming = '1'
	form.querySelector('[data-confirm-summary]').textContent = button.dataset.summary
	form.querySelector('[data-confirm-submit]').textContent = button.dataset.confirmLabel
	form.querySelector('[data-confirm]').hidden = false
	form.querySelector('[data-confirm-buttons]').hidden = false
	form.querySelector('[data-choose]').hidden = true
	form.querySelector('[data-rationale]').readOnly = true
	form.querySelector('[data-confirm-submit]').focus()
}

function confirmStop(form) {
	form.querySelector('[data-verdict-input]')?.remove()
	delete form.dataset.confirming
	form.querySelector('[data-confirm]').hidden = true
	form.querySelector('[data-confirm-buttons]').hidden = true
	form.querySelector('[data-choose]').hidden = false
	const rationale = form.querySelector('[data-rationale]')
	rationale.readOnly = false
	rationale.focus()
}

export function fieldError(field, text) {
	let message = field.form.querySelector('[data-field-error]')
	if (!message) {
		message = document.createElement('p')
		message.className = 'sc-error'
		message.setAttribute('role', 'alert')
		message.dataset.fieldError = ''
	}
	if (message.previousElementSibling !== field) field.after(message)
	message.textContent = text
	field.focus()
}

function syncRemoval(area) {
	const field = area.form.querySelector('[data-removal]')
	let tests
	try {
		tests = JSON.parse(area.value).tests
	} catch {
		return
	}
	if (!Array.isArray(tests)) return
	const kept = new Set(tests.map((test) => test?.id))
	const removed = area.form.dataset.testIds.split(' ').filter((id) => id && !kept.has(id))
	field.hidden = !removed.length
	field.querySelector('[data-removal-tests]').textContent = removed.join(', ')
}

function clearRefusal(field) {
	if (!field.form || !field.name) return
	for (const message of field.form.querySelectorAll('[data-refusal]'))
		if (message.dataset.field === field.name) message.remove()
}

export function placeAlert() {
	const alert = [...document.querySelectorAll('main .sc-error[role="alert"]')].find(
		(element) => element.textContent.trim() && shown(element)
	)
	if (!alert) return false
	const pageForm = alert.closest('[data-page-form]')
	if (pageForm && alert.hasAttribute('data-refusal')) {
		refuseAt(pageForm, alert)
		return true
	}
	const field = alert.dataset.field && document.getElementById(alert.dataset.field)
	if (field) {
		alert.id ||= `${field.id}-error`
		field.closest('.sc-field, li, td')?.append(alert)
		field.setAttribute('aria-invalid', 'true')
		field.setAttribute(
			'aria-describedby',
			[field.getAttribute('aria-describedby'), alert.id].filter(Boolean).join(' ')
		)
		field.focus()
	} else {
		alert.tabIndex = -1
		alert.focus()
	}
	return true
}

const editors = [...document.querySelectorAll('[data-edit-form]')]

let edited = false

export async function leavePage(address) {
	if (edited) {
		const sure = await ask({
			title: 'Leave the editor?',
			text: 'Your changes are not saved.',
			yes: 'Leave and lose the changes',
			no: 'Keep editing',
		})
		if (!sure) return
		edited = false
	}
	location.assign(address)
}

export function draftKey(field, address = new URL(location.href)) {
	const item = address.searchParams.get('item') ?? ''
	return `checkmate-draft:${address.pathname}:${item}:${field.form.getAttribute('action')}:${field.name}`
}

function draftFields() {
	return [
		...document.querySelectorAll('form[method="post"] :is(textarea, input[type="text"], input:not([type]))'),
	].filter((field) => field.name && field.name !== 'actor' && !field.closest('[data-edit-form], dialog'))
}

function fitHeight(area) {
	area.style.height = 'auto'
	area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`
}

export function forgetDrafts(form) {
	for (const field of form.querySelectorAll('textarea, input'))
		try {
			if (field.name) window.sessionStorage.removeItem(draftKey(field))
		} catch {}
}

export function attachForms() {
	document.addEventListener(
		'invalid',
		(event) => {
			const field = event.target
			event.preventDefault()
			const first = [...field.form.elements].find((element) => element.willValidate && !element.validity.valid)
			if (first === field) fieldError(field, field.dataset.missing || field.validationMessage)
		},
		true
	)
	document.addEventListener('input', (event) => {
		clearRefusal(event.target)
		const form = event.target.closest?.('form')
		if (form) syncRationale(form.parentElement ?? document)
		if (event.target.nextElementSibling?.matches('[data-field-error]')) event.target.nextElementSibling.remove()
		if (event.target.name === 'json' && form?.dataset.testIds !== undefined) syncRemoval(event.target)
	})
	document.addEventListener('change', (event) => {
		clearRefusal(event.target)
		if (event.target.name === 'kind') syncSource()
	})
	document.addEventListener('submit', (event) => {
		const form = event.target
		if (form.matches('[data-verdict-form]') && !form.dataset.confirming) {
			const button = event.submitter
			if (!button || button.name !== 'verdict') return
			event.preventDefault()
			confirmStart(form, button)
		}
	})
	document.addEventListener('click', (event) => {
		const confirmBack = event.target.closest('[data-confirm-back]')
		if (confirmBack) confirmStop(confirmBack.closest('form'))
	})
	for (const form of editors) form.addEventListener('input', () => (edited = true))
	for (const form of editors) form.addEventListener('submit', () => (edited = false))
	window.addEventListener('beforeunload', (event) => {
		if (edited) event.preventDefault()
	})
	for (const field of draftFields()) {
		field.addEventListener('input', () => {
			try {
				if (field.value.trim()) window.sessionStorage.setItem(draftKey(field), field.value)
				else window.sessionStorage.removeItem(draftKey(field))
			} catch {}
		})
		let kept = null
		try {
			kept = window.sessionStorage.getItem(draftKey(field))
		} catch {}
		if (kept && (!field.value.trim() || (field.value === field.defaultValue && kept !== field.value))) {
			field.value = kept
			const note = document.createElement('p')
			note.className = 'sc-help draft-note'
			note.textContent = 'Draft kept.'
			field.after(note)
		}
	}
	document.addEventListener('submit', (event) => {
		if (event.target.matches?.('[data-act-form], [data-chat-composer]')) return
		for (const field of event.target.querySelectorAll?.('textarea, input') ?? [])
			try {
				if (field.name) window.sessionStorage.removeItem(draftKey(field))
			} catch {}
	})
	if (!CSS.supports('field-sizing', 'content')) {
		const areas = [...document.querySelectorAll('.edit-card textarea')]
		for (const area of areas) {
			fitHeight(area)
			area.addEventListener('input', () => fitHeight(area))
		}
		window.addEventListener('resize', () => areas.forEach(fitHeight))
	}
}
