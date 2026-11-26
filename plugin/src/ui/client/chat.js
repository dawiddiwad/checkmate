import { draftKey, forgetDrafts } from './forms.js'
import { newOption, setModelOptions } from './models.js'
import { current } from './navigation.js'
import { address } from './page-state.js'
import { csrf, renewToken } from './post.js'

export function scrollChatToLatest(history) {
	const bottom = () => (history.scrollTop = history.scrollHeight)
	bottom()
	for (const image of history.querySelectorAll('.chat-turn:last-child [data-chat-content] img'))
		if (!image.complete) image.addEventListener('load', bottom, { once: true })
}

export function attachChat() {
	const activePlanChat = document.querySelector('[data-navigator] [data-target="chats"][aria-selected="true"]')
	if (activePlanChat && window.matchMedia('(max-width: 900px)').matches) {
		const nav = activePlanChat.closest('[data-navigator]')
		const shift = activePlanChat.getBoundingClientRect().right - nav.getBoundingClientRect().right + 8
		if (shift > 0) nav.scrollLeft += shift
	}
	for (const history of document.querySelectorAll('[data-chat-history]'))
		if (current('list')?.dataset.key !== address.searchParams.get('at')) scrollChatToLatest(history)
	for (const form of document.querySelectorAll('[data-chat-composer]')) {
		const harness = form.querySelector('[data-chat-harness]')
		const model = form.querySelector('[data-chat-model]')
		const effort = form.querySelector('[data-chat-effort]')
		const effortLabel = effort.closest('label')
		const status = form.querySelector('[data-chat-model-status]')
		const error = form.querySelector('[data-chat-error]')
		const submit = form.querySelector('[type=submit]')
		let sendingChat = false
		const search = form.querySelector('[data-chat-model-search]')
		let models = []
		let primary = null
		let defaultModel = null
		let sequence = 0
		// The primary provider's models show first. A search filters all models.
		function showModels() {
			const query = search.value.trim().toLowerCase()
			const shown = query || !primary ? models : models.filter((item) => item.value.startsWith(`${primary}/`))
			const matches = query
				? models.filter((item) => `${item.value} ${item.label}`.toLowerCase().includes(query))
				: shown
			setModelOptions(model, shown, query, 'Host default')
			status.textContent = query && !matches.length ? 'No model matches this search.' : ''
		}
		search.addEventListener('input', () => {
			showModels()
			showEffort()
		})
		function showEffort() {
			const selected = models.find((item) => item.value === (model.value || defaultModel))
			const levels = selected?.effortLevels ?? []
			const selectedEffort = effort.value || effort.dataset.selected
			effort.replaceChildren(newOption('Host default', ''))
			for (const level of levels) effort.append(newOption(level, level))
			effort.value = levels.includes(selectedEffort) ? selectedEffort : ''
			effort.dataset.selected = ''
			effortLabel.hidden = !levels.length
		}
		async function loadChatModels() {
			const ticket = ++sequence
			status.textContent = 'Loading models…'
			try {
				const response = await fetch(
					`/settings/harness/models?harness=${encodeURIComponent(harness.value)}&scope=chat`
				)
				const data = await response.json()
				if (!response.ok) throw new Error(data.error || 'Could not load models.')
				if (ticket !== sequence) return
				models = data.models
				primary = data.primary ?? null
				defaultModel = data.defaultModel?.value ?? null
				showModels()
				showEffort()
			} catch (error) {
				if (ticket !== sequence) return
				models = []
				primary = null
				setModelOptions(model, [], '', 'Host default')
				showEffort()
				status.textContent = error.message || 'Could not load models.'
			}
		}
		form.addEventListener('submit', async (event) => {
			event.preventDefault()
			if (sendingChat) return
			sendingChat = true
			submit.disabled = true
			error.hidden = true
			const fields = new URLSearchParams(new FormData(form))
			const send = () => {
				fields.set('csrf', csrf())
				return fetch(form.action, { method: 'POST', body: fields })
			}
			try {
				let response = await send()
				if (response.status === 403 && (await renewToken())) response = await send()
				const destination = response.ok && response.redirected ? new URL(response.url) : null
				if (
					!destination ||
					destination.origin !== location.origin ||
					!(/^\/chats\/[^/]+$/.test(destination.pathname) || /^\/plans\/[^/]+$/.test(destination.pathname))
				) {
					const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
					throw new Error(
						fresh.querySelector('[role="alert"]')?.textContent?.trim() || 'Could not send the message.'
					)
				}
				const message = form.elements.text
				if (message.value === fields.get('text') || !message.value.trim()) forgetDrafts(form)
				else {
					try {
						const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
						const next = fresh.querySelector('[data-chat-composer] textarea')
						if (next) {
							const previous = draftKey(message)
							const target = draftKey(next, destination)
							window.sessionStorage.setItem(target, message.value)
							if (previous !== target) window.sessionStorage.removeItem(previous)
						}
					} catch {}
				}
				location.assign(destination.pathname + destination.search)
			} catch (problem) {
				error.textContent = problem.message || 'Could not send the message.'
				error.hidden = false
				sendingChat = false
				submit.disabled = false
			}
		})
		harness.addEventListener('change', loadChatModels)
		model.addEventListener('change', () => {
			if (model.value) showEffort()
			else loadChatModels()
		})
		loadChatModels()
	}
}
