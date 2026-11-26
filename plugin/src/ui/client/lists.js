import { plainClick } from './navigation.js'
import { served } from './page-state.js'
import { announce, showHints } from './status-bar.js'

const listForm = document.querySelector('[data-list-form]')

let typingTimer = null

let listTicket = 0

function listUrl(form) {
	const params = new URLSearchParams()
	for (const field of form.elements) {
		if (!field.name || field.value === '' || field.value === (field.dataset.default ?? '')) continue
		params.set(field.name, field.value)
	}
	const query = params.toString()
	return form.getAttribute('action') + (query ? `?${query}` : '')
}

function syncListForm(url) {
	const params = new URL(url, location.href).searchParams
	for (const field of listForm.elements) {
		if (!field.name || (field === document.activeElement && field.type === 'search')) continue
		field.value = params.get(field.name) ?? field.dataset.default ?? ''
	}
}

async function showList(url, mode) {
	clearTimeout(typingTimer)
	const ticket = ++listTicket
	try {
		const response = await fetch(url, { cache: 'no-store' })
		if (ticket !== listTicket) return
		if (!response.ok) return void location.assign(url)
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		const region = document.querySelector('[data-list-region]')
		const replacement = fresh.querySelector('[data-list-region]')
		if (!region || !replacement) return void location.assign(url)
		if (mode === 'push') window.history.pushState(null, '', url)
		if (mode === 'replace') window.history.replaceState(null, '', url)
		region.replaceWith(document.importNode(replacement, true))
		served.set(replacement.dataset.region, replacement.cloneNode(true))
		document.title = fresh.title
		syncListForm(url)
		showHints()
	} catch {
		location.assign(url)
	}
}

async function showHistory(link) {
	link.setAttribute('aria-busy', 'true')
	try {
		const response = await fetch(link.dataset.historyMore, { cache: 'no-store' })
		if (!response.ok) return void location.assign(link.href)
		const fragment = document.createRange().createContextualFragment(await response.text())
		const list = link.closest('[data-history]')
		const before = list.querySelectorAll('ol.history > li').length
		list.replaceWith(fragment)
		const entries = document.querySelectorAll('[data-history] ol.history > li')
		entries[before]?.querySelector('summary')?.focus()
		announce(`Showing ${entries.length} revisions`)
	} catch {
		location.assign(link.href)
	}
}

export function attachLists() {
	if (listForm) {
		listForm.querySelector('[data-list-submit]').hidden = true
		listForm.addEventListener('input', (event) => {
			if (event.target.type !== 'search') return
			clearTimeout(typingTimer)
			typingTimer = setTimeout(() => showList(listUrl(listForm), 'replace'), 250)
		})
		listForm.addEventListener('change', (event) => {
			if (event.target.tagName === 'SELECT') showList(listUrl(listForm), 'push')
		})
		listForm.addEventListener('submit', (event) => {
			event.preventDefault()
			showList(listUrl(listForm), 'push')
		})
		window.addEventListener('popstate', () => showList(location.href, null))
	}
	document.addEventListener('click', (event) => {
		if (!plainClick(event)) return
		const link = event.target.closest('a[data-list-link]')
		if (link && listForm) {
			event.preventDefault()
			return void showList(link.href, 'push')
		}
		const clear = event.target.closest('[data-list-clear]')
		if (clear && listForm) {
			event.preventDefault()
			for (const field of listForm.elements) if (field.name) field.value = field.dataset.default ?? ''
			return void showList(clear.href, 'push')
		}
		const more = event.target.closest('[data-history-more]')
		if (more) {
			event.preventDefault()
			return void showHistory(more)
		}
	})
}
