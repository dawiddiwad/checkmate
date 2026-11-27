import { ask } from './confirm-dialog.js'
import { forgetDrafts } from './forms.js'
import { dropLayer, pushLayer } from './layers.js'
import { testerModelCount, testerModelState } from './models.js'
import { current, listRows, mark, panel, shown } from './navigation.js'
import { confirmAddress } from './page-form.js'
import { body, state } from './page-state.js'
import { renewToken } from './post.js'
import { showHints, tell } from './status-bar.js'

export function showCopy(text, count) {
	const dialog = document.querySelector('dialog[data-act-dialog="copy"]')
	if (!dialog || document.querySelector('dialog[open]')) return tell('Checkmate could not copy the text.')
	dialog.querySelector('[data-copy-title]').textContent = `Copy ${count}`
	const field = dialog.querySelector('[data-copy-text]')
	field.value = text
	actFrom = document.activeElement
	pushLayer('act')
	dialog.showModal()
	field.focus()
	field.select()
	showHints()
}

let actFrom = null

let actLast = null

export function actDialog() {
	return document.querySelector('dialog[data-act-dialog][open]')
}

function actButtons() {
	return [
		...(panel() ?? document).querySelectorAll(
			'[data-actions] button[data-act], [data-actions] button[data-ask-title]'
		),
	].filter(shown)
}

function fillAct(form, values) {
	for (const [name, value] of Object.entries(values)) {
		const field = form.elements[name]
		if (field) field.value = value
	}
	if (['since', 'until', 'repo'].some((name) => values[name])) form.querySelector('[data-more]').open = true
}

export function showInstances(form, key) {
	for (const group of form.querySelectorAll('fieldset[data-instances]')) {
		const shown = group.dataset.instances === key
		group.hidden = !shown
		group.disabled = !shown
	}
}

function firstField(form) {
	return form.querySelector('input:not([type="hidden"]):not([type="radio"])') ?? form.querySelector('button')
}

function openAct(button) {
	const dialog = document.querySelector(`dialog[data-act-dialog="${CSS.escape(button.dataset.act)}"]`)
	if (!dialog || document.querySelector('dialog[open]')) return
	const form = dialog.querySelector('[data-act-form]')
	if (button.dataset.action) form.action = button.dataset.action
	if (button.dataset.title) dialog.querySelector('[data-act-title]').textContent = button.dataset.title
	showInstances(form, button.dataset.plan)
	if (button.dataset.fill) fillAct(form, JSON.parse(button.dataset.fill))
	const testerModels = form.querySelector('[data-tester-models]')
	if (testerModels?.open && testerModelState.has(testerModels)) testerModelCount(testerModels)
	dialog.querySelector('[data-act-error]').replaceChildren()
	actFrom = document.activeElement
	pushLayer('act')
	dialog.showModal()
	firstField(form).focus()
	showHints()
}

function backFromAct(dialog) {
	const from = actFrom
	actFrom = null
	if (!dialogHadFocus(dialog)) return showHints()
	const key = from?.closest?.('[data-key]')?.dataset.key
	const target = from?.isConnected
		? from
		: key
			? document.querySelector(`[data-row][data-key="${CSS.escape(key)}"]`)
			: from?.dataset?.act
				? document.querySelector(`[data-act="${CSS.escape(from.dataset.act)}"]`)
				: null
	target?.focus({ preventScroll: true })
	showHints()
}

export function closeGone(region, replacement) {
	for (const dialog of region.querySelectorAll('dialog[data-act-dialog][open]')) {
		if (dialog.querySelector('[data-sending], [data-refusal]')) continue
		if (replacement.querySelector(`dialog[data-act-dialog="${CSS.escape(dialog.dataset.actDialog)}"]`)) continue
		dialog.close('gone')
		tell(dialog.dataset.gone || 'This changed. Nothing was done.')
	}
}

function actStops(dialog) {
	const stops = [...dialog.querySelectorAll('[data-stop]')].filter(
		(element) =>
			element.getClientRects().length && (!element.closest('details:not([open])') || element.matches('summary'))
	)
	const kept = new Map()
	for (const radio of stops.filter((element) => element.type === 'radio')) {
		const group = radio.closest('fieldset')
		if (!kept.has(group) || radio.checked) kept.set(group, radio)
	}
	return stops.filter((element) => element.type !== 'radio' || kept.get(element.closest('fieldset')) === element)
}

export function actKey(event, dialog) {
	const target = event.target
	const typing = target.matches?.('input[type="text"], input[type="search"], input:not([type]), textarea')
	const key = event.key
	if (key === 'Escape') {
		event.preventDefault()
		if (!typing) return dialog.close('no')
		actLast = target
		return target.blur()
	}
	if (target.matches('select')) {
		if (key === 'ArrowDown' || key === 'ArrowUp') {
			event.preventDefault()
			const direction = key === 'ArrowDown' ? 1 : -1
			target.selectedIndex = Math.max(0, Math.min(target.options.length - 1, target.selectedIndex + direction))
			target.dispatchEvent(new window.Event('change', { bubbles: true }))
		}
		return
	}
	if (key === 'ArrowUp' || key === 'ArrowDown') {
		event.preventDefault()
		const stops = actStops(dialog)
		const at = stops.indexOf(stops.includes(target) ? target : actLast)
		const next = at < 0 ? 0 : at + (key === 'ArrowDown' ? 1 : -1)
		return stops[Math.max(0, Math.min(stops.length - 1, next))].focus()
	}
	if (typing) return
	const fold = target.matches('summary') ? target.parentElement : null
	if (key === 'ArrowRight') {
		event.preventDefault()
		if (fold) fold.open = true
	} else if (key === 'ArrowLeft') {
		event.preventDefault()
		if (fold?.open) fold.open = false
		else dialog.close('no')
	} else if (/^[1-9]$/.test(key)) {
		const choice = (target.closest('fieldset') ?? dialog).querySelector(`[data-key-n="${key}"]`)
		if (!choice) return
		event.preventDefault()
		if (choice.matches('input')) {
			choice.checked = true
			choice.dispatchEvent(new window.Event('change', { bubbles: true }))
			choice.focus()
		} else choice.click()
	}
}

export function actionsKey(event) {
	const buttons = actButtons()
	const at = buttons.indexOf(event.target)
	const toList = () => {
		const row = current('list') ?? listRows()[0]
		if (row) mark(row, 'list')
	}
	if (event.key === 'ArrowRight' && at < buttons.length - 1) buttons[at + 1].focus()
	else if (event.key === 'ArrowLeft' && at > 0) buttons[at - 1].focus()
	else if (['ArrowDown', 'ArrowLeft', 'Escape'].includes(event.key)) toList()
	else return false
	event.preventDefault()
	return true
}

export function enterActions() {
	const first = actButtons()[0]
	if (!first) return false
	first.focus()
	tell('Actions of this list. Right moves between them, Enter chooses, Down returns to the list.')
	return true
}

export function refuseAt(form, message) {
	const named = form.elements[message.dataset.field ?? '']
	const field = named?.tagName ? named : [...(named ?? [])].find((element) => !element.disabled)
	message.dataset.refusal = ''
	if (!field) {
		form.querySelector('[data-act-error]').replaceChildren(message)
		return firstField(form).focus()
	}
	field.closest('details')?.setAttribute('open', '')
	;(field.closest('fieldset') ?? field).after(message)
	field.focus()
}

function dialogHadFocus(dialog) {
	return dialog.matches?.('dialog') && (document.activeElement === body || dialog.contains(document.activeElement))
}

export function attachActions() {
	document.addEventListener('click', (event) => {
		const button = event.target.closest('[data-act]')
		if (button) {
			event.preventDefault()
			openAct(button)
		}
		if (event.target.closest('[data-act-cancel]')) actDialog()?.close('no')
	})
	document.addEventListener('submit', async (event) => {
		const form = event.target
		if (!form.matches('[data-act-form]')) return
		event.preventDefault()
		if (form.dataset.sending) return
		form.dataset.sending = '1'
		if (form.matches('[data-page-form]') && !(await confirmAddress(form))) return void delete form.dataset.sending
		form.querySelector('[data-act-error]').replaceChildren()
		for (const old of form.querySelectorAll('[data-refusal]')) old.remove()
		const send = () => fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) })
		const alertText = (message) => {
			const text = document.createElement('p')
			text.className = 'sc-error'
			text.setAttribute('role', 'alert')
			text.textContent = message
			return text
		}
		try {
			let response = await send()
			if (response.status === 403 && (await renewToken())) response = await send()
			if (response.redirected && response.ok) {
				forgetDrafts(form)
				return location.replace(response.url)
			}
			const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
			const alert = fresh.querySelector('main [role="alert"]')
			refuseAt(
				form,
				alert ? document.importNode(alert, true) : alertText('Checkmate refused the action. Nothing is done.')
			)
		} catch {
			refuseAt(
				form,
				alertText(
					'Checkmate did not answer. Nothing is done. Start the UI again if it stopped, then try again.'
				)
			)
		}
		delete form.dataset.sending
	})
	document.addEventListener(
		'close',
		(event) => {
			const dialog = event.target
			if (!dialog.matches?.('dialog[data-act-dialog]') || dialog.open) return
			if (dialog.returnValue !== 'yes') dropLayer('layer', 'act')
			backFromAct(dialog)
		},
		true
	)
	document.addEventListener(
		'close',
		(event) => {
			if (dialogHadFocus(event.target)) current()?.focus({ preventScroll: true })
		},
		true
	)
	document.addEventListener('click', async (event) => {
		const button = event.target.closest('[data-ask-title]')
		if (!button || state.sending) return
		event.preventDefault()
		const answer = await ask({
			title: button.dataset.askTitle,
			text: button.dataset.askText,
			yes: button.dataset.askYes,
		})
		if (!answer) return tell('Nothing is recorded.')
		button.form.requestSubmit(button)
	})
}
