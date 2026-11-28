import { bulkOptions, keepUndo } from './bulk.js'
import { current, currentView, listRows } from './navigation.js'
import { chooseBuild } from './navigator.js'
import { review, state } from './page-state.js'
import { renewToken } from './post.js'
import { announce, showHints, tell } from './status-bar.js'

export function optionsNow() {
	if (state.level === 'detail')
		return [...state.drawer.querySelectorAll('.sc-drawer-top [data-option], .sc-opt-section [data-option]')]
	const row = state.level === 'list' ? current('list') : null
	if (row?.classList.contains('is-many')) return detailOptions(row)
	const options = row ? [...row.querySelectorAll('[data-option]')] : []
	return options.length ? options : [...document.querySelectorAll('[data-choose]:not([hidden]) [data-option]')]
}

function detailOptions(row) {
	const detail = document.querySelector(
		`[data-region="exploration-detail"][data-key="detail:${CSS.escape(row.dataset.key)}"]`
	)
	return detail ? [...detail.querySelectorAll('[data-option]')] : []
}

function nextKey(row) {
	const rows = listRows()
	const at = rows.indexOf(row)
	const later = [...rows.slice(at + 1), ...rows.slice(0, at)]
	const next = later.find((each) => 'needs' in each.dataset) ?? rows[at + 1] ?? rows[at - 1]
	return next?.dataset.key ?? null
}

function recordReturn(stays) {
	const url = new URL(location.href)
	const open = review.dataset.open
	const row = listRows().find((each) => each.dataset.key === open)
	const waiting = row && listRows().find((each) => each !== row && 'needs' in each.dataset)
	const next = stays ? open : waiting ? nextKey(row) : null
	url.searchParams.delete('file')
	if (next) url.searchParams.set('item', next)
	else {
		url.searchParams.delete('item')
		if (row && nextKey(row)) url.searchParams.set('at', nextKey(row))
		url.searchParams.set('focus', 'list')
	}
	return url.pathname + url.search
}

function returnTo(row, stays = false) {
	const url = new URL(location.href)
	url.searchParams.set('view', currentView() ?? 'needs')
	const key = stays ? row.dataset.key : nextKey(row)
	if (key) url.searchParams.set('at', key)
	else url.searchParams.delete('at')
	url.searchParams.set('focus', key ? 'list' : 'nav')
	return url.pathname + url.search
}

export function showExtra(row, field) {
	const extra = row.querySelector(`[data-extra="${CSS.escape(field)}"]`)
	if (!extra) return
	for (const other of row.querySelectorAll('[data-extra]')) other.hidden = other !== extra
	row.classList.add('is-ext')
	const area = extra.querySelector('textarea')
	area.focus()
	area.setSelectionRange(area.value.length, area.value.length)
	showHints()
}

export function focusField(field) {
	const area = state.drawer?.querySelector(`#${CSS.escape(field)}-text`)
	if (!area) return tell('This option has no field here.')
	const extra = area.closest('[data-extra]')
	if (extra) extra.hidden = false
	area.scrollIntoView({ block: 'nearest' })
	area.focus()
	area.setSelectionRange(area.value.length, area.value.length)
	showHints()
}

export function hideExtra(row) {
	for (const extra of row.querySelectorAll('[data-extra]')) extra.hidden = true
	row.classList.remove('is-ext')
}

export function choose(n) {
	if (state.sending) return
	if (state.gone && state.level === 'list') {
		const text = `Nothing is recorded. ${state.gone} ${current('list')?.dataset.label ?? 'The next row'} has the highlight now.`
		state.gone = null
		return tell(text)
	}
	const selection = bulkOptions()
	if (selection.length && (state.level === 'list' || state.level === 'nav')) {
		const option = selection[n - 1]
		return option ? option.click() : tell(`The options go from 1 to ${selection.length}.`)
	}
	if (state.level === 'nav' && review) return chooseBuild(n)
	const options = optionsNow()
	if (state.level === 'list' && current('list')?.classList.contains('is-many') && !options.length)
		return tell('The options do not fit in the row. Open the row to see them.')
	if (!options.length) return tell('No options here.')
	const option = options[n - 1]
	if (!option) return tell(`The options go from 1 to ${options.length}.`)
	const rationale = option.disabled && option.form?.querySelector('[data-rationale]')
	if (rationale) {
		rationale.focus()
		return tell('Write the rationale first. Then press Ctrl+Enter.')
	}
	if (option.disabled) return tell('This option is not available here.')
	option.click()
}

function sendFailed(form) {
	state.sending = false
	let message = form.querySelector('[data-send-error]')
	if (!message) {
		message = document.createElement('p')
		message.className = 'sc-error'
		message.setAttribute('role', 'alert')
		message.dataset.sendError = ''
		form.append(message)
	}
	message.textContent =
		'Checkmate did not answer. Nothing is recorded, and your text is kept. Start the UI again if it stopped, then send again.'
	announce(message.textContent)
	tell('Not sent.')
}

async function send(form, submitter) {
	const post = () => {
		const data = new URLSearchParams(new FormData(form))
		if (submitter?.name) data.set(submitter.name, submitter.value)
		return fetch(form.action, { method: 'POST', body: data })
	}
	try {
		let response = await post()
		if (response.status === 403 && (await renewToken())) response = await post()
		if (response.redirected && response.ok) {
			if (form.action.endsWith('/handoff') && !form.querySelector('[name="undo"]'))
				keepUndo(
					form.querySelectorAll('[name="claim"]').length
						? [...form.querySelectorAll('[name="claim"]')].map((field) => field.value)
						: [],
					form.querySelector('[name="to"]')?.value ?? ''
				)
			if (
				form
					.closest('[data-drawer]')
					?.matches('[data-region="permission-record"], [data-region="request-record"]')
			) {
				window.history.replaceState(null, '', location.href)
				return location.replace(response.url)
			}
			return location.assign(response.url)
		}
		state.sending = false
		window.HTMLFormElement.prototype.submit.call(form)
	} catch {
		sendFailed(form)
	}
}

export function attachDrawer() {
	document.addEventListener('submit', (event) => {
		if (event.defaultPrevented) return
		const form = event.target
		const row = form.closest('[data-row]')
		const record = form.closest('[data-drawer]')
		if ((!row && !record) || row?.hasAttribute('data-chat-turn')) return
		event.preventDefault()
		if (state.sending) return
		state.sending = true
		const field = form.querySelector('[data-return]')
		const stays = form.getAttribute('action').endsWith('/handoff')
		if (field && review) field.value = row ? returnTo(row, stays) : recordReturn(stays)
		form.querySelector('[data-send-error]')?.remove()
		tell('Sending…')
		send(form, event.submitter)
	})
}

export function trapDrawerFocus(event) {
	if (event.key !== 'Tab' || !state.drawer || state.level !== 'detail') return false
	const focusable = [
		...state.drawer.querySelectorAll(
			'a[href], button:not([disabled]), textarea, input:not([type="hidden"]), select, [tabindex="0"]'
		),
	].filter((element) => !element.closest('[hidden]') && element.getClientRects().length)
	if (!focusable.length) return false
	const first = focusable[0]
	const last = focusable.at(-1)
	const inside = state.drawer.contains(document.activeElement)
	if (!inside || (event.shiftKey && document.activeElement === first)) {
		event.preventDefault()
		;(event.shiftKey ? last : first).focus()
		return true
	}
	if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault()
		first.focus()
		return true
	}
	return false
}
