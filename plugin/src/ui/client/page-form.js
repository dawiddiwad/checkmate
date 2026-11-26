import { showInstances } from './actions.js'
import { ask } from './confirm-dialog.js'
import { typingIn } from './keyboard.js'
import { body } from './page-state.js'
import { csrf, renewToken } from './post.js'
import { showHints } from './status-bar.js'

export const pageForm = document.querySelector('form[data-page-form]')

export async function confirmAddress(form) {
	const select = form.elements.target
	const picked = form.querySelector('fieldset[data-instances]:not([hidden]) input[name="instance"]:checked')
	const marked = picked ?? select?.selectedOptions?.[0] ?? select
	const address = form.dataset.nonlocal || (marked?.hasAttribute?.('data-nonlocal') ? marked.dataset.address : '')
	if (!address) return true
	const setup = form.getAttribute('action') === '/setup'
	const sure = await ask({
		title: 'Use an address that is not local?',
		text: setup
			? `${address} is not a local address. Checkmate will set up a target there, and the testers will open it from this computer.`
			: `${address} is not a local address. The testers will test the application there.`,
		yes: setup ? 'Set up the target' : 'Start the test',
		no: 'Cancel',
	})
	if (sure) form.elements.confirmed.value = '1'
	return Boolean(sure)
}

function pageStops() {
	const seen = new Set()
	return [...pageForm.querySelectorAll('input:not([type="hidden"]), textarea, select, summary, button, a[href]')]
		.filter((element) => element.getClientRects().length)
		.filter((element) => {
			if (element.type !== 'radio') return true
			if (seen.has(element.closest('fieldset'))) return false
			seen.add(element.closest('fieldset'))
			return true
		})
		.map((element) =>
			element.type === 'radio' ? (element.closest('fieldset').querySelector(':checked') ?? element) : element
		)
}

function onFirstLine(area) {
	return !area.value.slice(0, area.selectionStart).includes('\n')
}

function onLastLine(area) {
	return !area.value.slice(area.selectionEnd).includes('\n')
}

export function pageFormKey(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return false
	const target = event.target
	const inside = pageForm.contains(target) || target === body || target.id === 'main'
	if (!inside) return false
	const key = event.key
	const stops = pageStops()
	const own =
		target.type === 'radio' ? stops.find((stop) => stop.closest('fieldset') === target.closest('fieldset')) : target
	const at = stops.indexOf(own)
	const move = (to) => {
		event.preventDefault()
		const next = stops[Math.max(0, Math.min(stops.length - 1, to))]
		next.focus()
		if (next.matches('input[type="text"], input:not([type])'))
			next.setSelectionRange(next.value.length, next.value.length)
		showHints()
		return true
	}
	if (at < 0) {
		if (['ArrowDown', 'ArrowRight', 'Enter'].includes(key) && !typingIn(target)) return move(0)
		if (key === 'ArrowUp' && !typingIn(target)) return move(stops.length - 1)
		return false
	}
	if (key === 'ArrowDown' || key === 'ArrowUp') {
		if (target.tagName === 'TEXTAREA' && !(key === 'ArrowUp' ? onFirstLine(target) : onLastLine(target)))
			return false
		return move(at + (key === 'ArrowDown' ? 1 : -1))
	}
	if (target.tagName === 'SUMMARY' && (key === 'ArrowRight' || key === 'ArrowLeft')) {
		event.preventDefault()
		target.parentElement.open = key === 'ArrowRight'
		return true
	}
	if (/^[1-9]$/.test(key) && target.type === 'radio') {
		const group = [...target.closest('fieldset').querySelectorAll('input[type="radio"]')]
		const choice = group[Number(key) - 1]
		if (!choice) return false
		event.preventDefault()
		choice.checked = true
		choice.dispatchEvent(new window.Event('change', { bubbles: true }))
		choice.focus()
		return true
	}
	return false
}

function planName(text) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^[^a-z0-9]+/, '')
		.replace(/-+$/, '')
		.slice(0, 96)
}

const newTarget = pageForm?.querySelector('select[data-new-target]')

const ticketFile = document.querySelector('[data-ticket-file]')

const setupUrl = document.querySelector('[data-setup-url]')

export function attachPageForm() {
	if (newTarget) {
		showInstances(pageForm, newTarget.value)
		newTarget.addEventListener('change', () => showInstances(pageForm, newTarget.value))
	}
	if (ticketFile) {
		const ticketText = document.querySelector('[data-ticket-text]')
		const plan = document.querySelector('[data-plan-name]')
		const derive = () => {
			const file = ticketFile.value.trim().split('/').filter(Boolean).at(-1) ?? ''
			const line = ticketText.value.split('\n').find((each) => each.trim()) ?? ''
			const named = planName(file ? file.replace(/\.[^.]*$/, '') : line)
			if (plan.value === '' || plan.value === plan.dataset.derived) plan.value = plan.dataset.derived = named
		}
		ticketFile.addEventListener('input', derive)
		ticketText.addEventListener('input', derive)
		derive()
	}
	if (setupUrl) {
		const assumed = pageForm.querySelector('[data-assumed]')
		const list = pageForm.querySelector('[data-assumed-list]')
		const help = pageForm.querySelector('[data-operations-help]')
		const target = pageForm.elements.target
		const radios = [...pageForm.querySelectorAll('input[name="operations"]')]
		const entryFields = [...pageForm.querySelectorAll('[data-setup-entry]')]
		// The address is required unless the person gives the entries of an application that is not a web application.
		const requireAddress = () => {
			setupUrl.required = !entryFields.some((entry) => entry.value.trim())
		}
		let sequence = 0
		let timer = null
		let automatic = false
		const preview = async () => {
			const mine = ++sequence
			const data = new URLSearchParams({ csrf: csrf(), url: setupUrl.value })
			for (const entry of entryFields) data.set(entry.name, entry.value)
			if (target.dataset.touched) data.set('target', target.value)
			data.set('environment', pageForm.elements.environment.value)
			data.set('operations', pageForm.querySelector('input[name="operations"]:checked')?.value ?? '')
			const reply = await fetch('/setup/assumed', { method: 'POST', body: data })
				.then(async (response) => {
					if (response.status !== 403 || !(await renewToken())) return response
					data.set('csrf', csrf())
					return fetch('/setup/assumed', { method: 'POST', body: data })
				})
				.then((response) => response.json())
				.catch(() => null)
			if (!reply) return
			if (mine !== sequence) return
			if (!reply.address) {
				assumed.hidden = true
				pageForm.dataset.nonlocal = ''
				help.textContent = reply.error ?? 'Type the address, or the entries, first.'
				return
			}
			assumed.hidden = false
			if (!target.dataset.touched) target.value = reply.targetId
			list.replaceChildren(
				...reply.assumed.flatMap(([label, value]) => {
					const term = document.createElement('dt')
					term.textContent = label
					const detail = document.createElement('dd')
					detail.textContent = value
					return [term, detail]
				})
			)
			pageForm.dataset.nonlocal = reply.local ? '' : reply.address
			const chosen = radios.find((radio) => radio.checked)
			if (reply.local && !chosen) {
				radios[0].checked = true
				automatic = true
			}
			if (!reply.local && automatic) {
				radios[0].checked = false
				automatic = false
			}
			help.textContent = reply.local
				? 'A local address: testers may change data unless you choose No.'
				: `${reply.address} is not a local address. Choose Yes or No. Checkmate asks once more before it sets up the target.`
		}
		const later = () => {
			clearTimeout(timer)
			timer = setTimeout(preview, 250)
		}
		setupUrl.addEventListener('input', later)
		for (const entry of entryFields)
			entry.addEventListener('input', () => {
				requireAddress()
				later()
			})
		requireAddress()
		pageForm.elements.environment.addEventListener('input', later)
		target.addEventListener('input', () => {
			target.dataset.touched = '1'
			later()
		})
		for (const radio of radios)
			radio.addEventListener('change', () => {
				automatic = false
				later()
			})
		if (setupUrl.value.trim() || entryFields.some((entry) => entry.value.trim())) preview()
	}
}
