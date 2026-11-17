const body = document.body
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const served = new Map(
	[...document.querySelectorAll('[data-region]')].map((region) => [region.dataset.region, region.cloneNode(true)])
)

function syncRationale(root = document) {
	for (const form of root.querySelectorAll('form')) {
		const rationale = form.querySelector('[data-rationale]')
		if (!rationale) continue
		const empty = !rationale.value.trim()
		for (const button of form.querySelectorAll('[data-needs-rationale]')) button.disabled = empty
	}
}

function syncSource(root = document) {
	for (const form of root.querySelectorAll('[data-quick-form], [data-bulk-questions]')) {
		const kind = form.querySelector('input[name="kind"]:checked')
		const value = form.querySelector('#value, #bulk-value')
		if (value) value.required = kind?.value !== 'defer'
	}
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

function fieldError(field, text) {
	let message = field.form.querySelector('[data-field-error]')
	if (!message) {
		message = document.createElement('p')
		message.className = 'form-error'
		message.setAttribute('role', 'alert')
		message.dataset.fieldError = ''
	}
	if (message.previousElementSibling !== field) field.after(message)
	message.textContent = text
	field.focus()
}

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

function sendKey(event) {
	if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
	const form = event.target.closest?.('[data-region="queue-detail"] form, form[data-verdict-form]')
	if (!form) return
	event.preventDefault()
	if (!form.reportValidity()) return
	const submitter = sendChoice(form)
	if (form.matches('[data-verdict-form]') && !form.dataset.confirming && !submitter)
		return void form.querySelector('[data-choose] button')?.focus()
	form.requestSubmit(submitter ?? undefined)
}

document.addEventListener('keydown', sendKey)

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

document.addEventListener('input', (event) => {
	const form = event.target.closest?.('form')
	if (form) syncRationale(form.parentElement ?? document)
	if (event.target.nextElementSibling?.matches('[data-field-error]')) event.target.nextElementSibling.remove()
	if (event.target.name === 'json' && form?.dataset.testIds !== undefined) syncRemoval(event.target)
})

document.addEventListener('change', (event) => {
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
	if (form.matches('[data-theme-form]')) {
		event.preventDefault()
		const button = form.querySelector('button[name="theme"]')
		const data = new URLSearchParams(new FormData(form))
		data.set('theme', button.value)
		fetch(form.action, { method: 'POST', body: data, redirect: 'manual' }).catch(() => {})
		applyTheme(form, button.value)
	}
})

const themeOrder = { system: 'light', light: 'dark', dark: 'system' }

function applyTheme(form, theme) {
	if (theme === 'system') delete document.documentElement.dataset.theme
	else document.documentElement.dataset.theme = theme
	const button = form.querySelector('button[name="theme"]')
	const next = themeOrder[theme]
	button.value = next
	button.dataset.current = theme
	button.title = `Theme: ${theme}. Switch to ${next}.`
	button.setAttribute('aria-label', button.title)
}

document.addEventListener('click', (event) => {
	const back = event.target.closest('[data-confirm-back]')
	if (back) return confirmStop(back.closest('form'))
	const opener = event.target.closest('a[data-view]')
	if (opener && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
		event.preventDefault()
		openViewer(opener)
	}
	const zoom = event.target.closest('[data-zoom]')
	if (zoom) zoomViewer(zoom.dataset.zoom)
	if (event.target.matches('[data-viewer-image]')) zoomViewer(viewerScale === 0 ? 'actual' : 'fit')
	if (event.target.closest('[data-viewer-close]')) closeViewer()
	if (event.target.matches('[data-viewer]')) closeViewer()
	if (event.target.closest('[data-shortcuts-open]')) toggleShortcuts()
	if (event.target.closest('[data-shortcuts-close]')) toggleShortcuts(false)
})

const viewer = document.querySelector('[data-viewer]')
const viewerImage = viewer.querySelector('[data-viewer-image]')
const viewerText = viewer.querySelector('[data-viewer-text]')
const viewerNote = viewer.querySelector('[data-viewer-note]')
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
	const box = viewer.querySelector('[data-viewer-wrap]')
	box.checked = on
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

viewerImage.addEventListener('error', () => {
	if (!viewer.hidden && viewerImage.getAttribute('src')) viewerMessage('This image cannot be shown.')
})

async function openViewer(link) {
	viewerOpener = link
	const kind = link.dataset.view
	viewer.dataset.kind = kind
	viewer.querySelector('[data-viewer-name]').textContent = link.dataset.name ?? ''
	for (const download of viewer.querySelectorAll('[data-viewer-download], [data-viewer-note-download]')) {
		download.href = link.dataset.src || link.href
		download.setAttribute('download', link.dataset.name ?? '')
	}
	for (const tools of viewer.querySelectorAll('[data-viewer-tools]'))
		tools.hidden = tools.dataset.viewerTools !== kind
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

function trapViewer(event) {
	if (viewer.hidden || event.key !== 'Tab') return false
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

function closeViewer() {
	if (viewer.hidden) return false
	viewer.hidden = true
	document.querySelector('main').inert = false
	viewerImage.removeAttribute('src')
	viewerImage.style.width = ''
	viewerText.textContent = ''
	viewerOpener?.focus()
	return true
}

const shortcuts = document.querySelector('[data-shortcuts]')

let shortcutsOpener = null

function toggleShortcuts(show = shortcuts.hidden) {
	if (show && shortcuts.hidden) shortcutsOpener = document.activeElement
	shortcuts.hidden = !show
	if (show) shortcuts.querySelector('[data-shortcuts-close]').focus()
	else shortcutsOpener?.focus()
	return true
}

function navItems() {
	return [...document.querySelectorAll('[data-nav-item]')].filter((item) => item.offsetParent !== null)
}

function move(step) {
	const items = navItems()
	if (!items.length) return
	const index = items.indexOf(document.activeElement)
	const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, index + step))
	items[next].focus()
	items[next].scrollIntoView({ block: 'nearest' })
}

let pendingG = false

function viewerKey(event) {
	if (viewer.hidden || event.ctrlKey || event.metaKey || event.altKey) return false
	if (event.target.matches?.('input[type="checkbox"]') && event.key === ' ') return false
	const zoom = { '+': 'in', '=': 'in', '-': 'out', 0: 'fit', 1: 'actual' }[event.key]
	if (zoom && !viewerImage.hidden) zoomViewer(zoom)
	else if (event.key === 'w' && !viewerText.hidden) wrapViewer(viewerText.classList.contains('nowrap'))
	else return false
	event.preventDefault()
	return true
}

document.addEventListener('change', (event) => {
	if (event.target.matches('[data-viewer-wrap]')) wrapViewer(event.target.checked)
})

document.addEventListener('keydown', (event) => {
	if (trapViewer(event) || viewerKey(event)) return
	if (!viewer.hidden && event.key !== 'Escape') return
	if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
	const target = event.target
	const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
	if (event.key === 'Escape') {
		const menu = document.querySelector('details[data-menu][open]')
		if (menu) {
			menu.open = false
			menu.querySelector('summary').focus()
			event.preventDefault()
		} else if (closeViewer() || (!shortcuts.hidden && toggleShortcuts(false))) event.preventDefault()
		else if (typing) target.blur()
		return
	}
	if (typing) return
	if (pendingG) {
		pendingG = false
		if (event.key === 'i') return void (location.href = '/')
	}
	if (queue && queueKey(event)) return
	if (event.key === '/') {
		const search = document.querySelector('[data-search]')
		if (!search) return
		event.preventDefault()
		search.focus()
		search.select()
	} else if (event.key === 'j') move(1)
	else if (event.key === 'k') move(-1)
	else if (event.key === '?') toggleShortcuts()
	else if (event.key === 'g') pendingG = true
})

function normalize(text) {
	return text
		.replace(/<time[^>]*>[\s\S]*?<\/time>/g, '')
		.replace(/(data-since="[^"]*">)[^<]*/g, '$1')
		.replace(/\s+/g, ' ')
}

function dirty(region) {
	if (region.querySelector('form[data-confirming]')) return true
	for (const field of region.querySelectorAll('textarea, input, select')) {
		if (field.type === 'hidden') continue
		if (field.type === 'radio' || field.type === 'checkbox') {
			if (field.checked !== field.defaultChecked) return true
		} else if (field.tagName === 'SELECT') {
			if ([...field.options].some((option) => option.selected !== option.defaultSelected)) return true
		} else if (field.value !== field.defaultValue) return true
	}
	return false
}

function staleNotice(region, replacement) {
	const slot = region.querySelector('[data-stale-slot]')
	if (!slot) return
	const text =
		replacement.dataset.decidedMessage ||
		region.dataset.staleMessage ||
		'This item changed. Review it before you decide.'
	let notice = slot.querySelector('[data-live-stale]')
	if (notice?.textContent === text) return
	if (!notice) {
		notice = document.createElement('div')
		notice.className = 'banner warn'
		notice.setAttribute('role', 'status')
		notice.dataset.liveStale = ''
		slot.prepend(notice)
	}
	notice.textContent = text
	announce(text)
}

function keyed(root) {
	const map = new Map()
	for (const element of root.querySelectorAll('[data-key]')) map.set(element.dataset.key, element)
	return map
}

function focusKey() {
	const active = document.activeElement
	if (!active || active === body) return null
	const owner = active.closest('[data-key]')
	return {
		id: active.id || null,
		key: owner?.dataset.key ?? null,
		navIndex: active.matches('[data-nav-item]') ? navItems().indexOf(active) : -1,
		region: active.closest('[data-region]'),
	}
}

function restoreFocus(saved) {
	if (!saved || document.activeElement !== body) return
	const byId = saved.id && document.getElementById(saved.id)
	if (byId) return byId.focus({ preventScroll: true })
	if (saved.key) {
		const owner = document.querySelector(`[data-key="${CSS.escape(saved.key)}"]`)
		const target = owner?.matches('[data-nav-item]') ? owner : owner?.querySelector('[data-nav-item], a, summary')
		if (target) return target.focus({ preventScroll: true })
	}
	if (saved.navIndex >= 0) {
		const items = navItems()
		if (items.length) items[Math.min(saved.navIndex, items.length - 1)].focus({ preventScroll: true })
	}
}

function replaceRegion(region, fresh, previous) {
	const before = keyed(previous ?? region)
	const opened = new Map(
		[...region.querySelectorAll('details[data-open-key]')].map((details) => [details.dataset.openKey, details.open])
	)
	const saved = focusKey()
	const scrolled = region.scrollTop
	const next = document.importNode(fresh, true)
	for (const details of next.querySelectorAll('details[data-open-key]'))
		if (opened.has(details.dataset.openKey)) details.open = opened.get(details.dataset.openKey)
	region.replaceWith(next)
	next.scrollTop = scrolled
	if (saved?.region === region) restoreFocus(saved)
	const messages = markChanged(before, next)
	syncRationale(next)
	syncSource(next)
	return messages
}

function markChanged(before, next) {
	const changed = [...keyed(next)]
		.filter(
			([key, element]) =>
				!before.has(key) || normalize(before.get(key).outerHTML) !== normalize(element.outerHTML)
		)
		.map(([, element]) => element)
	const innermost = changed.filter(
		(element) => !changed.some((other) => other !== element && element.contains(other))
	)
	for (const element of innermost) {
		element.classList.add('changed')
		if (!reducedMotion.matches) setTimeout(() => element.classList.remove('changed'), 2000)
	}
	return innermost.map((element) => element.dataset.announce).filter(Boolean)
}

const announcer = document.querySelector('[data-announcer]')

function announce(text) {
	if (!text) return
	announcer.textContent = ''
	setTimeout(() => (announcer.textContent = text), 50)
}

let refreshing = false
let again = false

async function refresh() {
	if (queue) return queueRefresh()
	if (refreshing) return void (again = true)
	refreshing = true
	try {
		const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
		if (!response.ok) return
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		const messages = []
		for (const region of [...document.querySelectorAll('[data-region]')]) {
			const name = region.dataset.region
			const replacement = fresh.querySelector(`[data-region="${name}"]`)
			const previous = served.get(name)
			if (!replacement || (previous && normalize(previous.outerHTML) === normalize(replacement.outerHTML)))
				continue
			if (dirty(region)) {
				staleNotice(region, replacement)
				continue
			}
			messages.push(...replaceRegion(region, replacement, previous))
			served.set(name, replacement.cloneNode(true))
		}
		document.title = fresh.title
		if (messages.length) announce(messages.join('. '))
	} catch {
	} finally {
		refreshing = false
		if (again) {
			again = false
			refresh()
		}
	}
}

function duration(ms) {
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds} s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes} min ${seconds % 60} s`
	return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

window.setInterval(() => {
	for (const element of document.querySelectorAll('[data-since]'))
		element.textContent = duration(Math.max(0, Date.now() - Date.parse(element.dataset.since)))
}, 1000)

const live = document.querySelector('[data-live]')
let source = null
let last = body.dataset.cursor ?? '0'

function setLive(up) {
	live.hidden = false
	live.classList.toggle('down', !up)
	live.textContent = up ? '● Live' : '○ Reconnecting…'
}

function connect() {
	if (source || !body.dataset.subjects || !window.EventSource) return
	const subjects = encodeURIComponent(body.dataset.subjects)
	source = new EventSource(`/events?subjects=${subjects}&after=${encodeURIComponent(last)}`)
	source.onopen = () => setLive(true)
	source.onerror = () => setLive(false)
	source.onmessage = (event) => {
		if (event.lastEventId) last = event.lastEventId
		refresh()
	}
}

function disconnect() {
	source?.close()
	source = null
}

document.addEventListener('visibilitychange', () => {
	if (document.hidden) disconnect()
	else {
		connect()
		refresh()
	}
})

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
	} catch {
		location.assign(url)
	}
}

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

function pageDepth() {
	return window.history.state?.depth ?? 0
}

function plainClick(event) {
	return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0
}

document.addEventListener('click', (event) => {
	if (!plainClick(event)) return
	const back = event.target.closest('a[data-back]')
	if (
		back &&
		document.referrer &&
		new URL(document.referrer).origin === location.origin &&
		window.history.length > 1
	) {
		event.preventDefault()
		return void window.history.go(-1 - pageDepth())
	}
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
	for (const menu of document.querySelectorAll('details[data-menu][open]'))
		if (!menu.contains(event.target)) menu.open = false
})

async function showHistory(link) {
	link.setAttribute('aria-busy', 'true')
	try {
		const response = await fetch(link.dataset.historyMore, { cache: 'no-store' })
		if (!response.ok) return void location.assign(link.href)
		const fragment = document.createRange().createContextualFragment(await response.text())
		const list = link.closest('[data-history]')
		const shown = list.querySelectorAll('ol.history > li').length
		list.replaceWith(fragment)
		const entries = document.querySelectorAll('[data-history] ol.history > li')
		entries[shown]?.querySelector('summary')?.focus()
		announce(`Showing ${entries.length} revisions`)
	} catch {
		location.assign(link.href)
	}
}

function placeMenu(menu) {
	const list = menu.querySelector('.menu-list')
	if (!list) return
	list.style.left = '0px'
	list.style.right = 'auto'
	const edge = 8
	const box = menu.getBoundingClientRect()
	const width = list.offsetWidth
	const left = Math.max(edge, Math.min(box.right - width, window.innerWidth - edge - width))
	list.style.left = `${left - box.left}px`
}

document.addEventListener(
	'toggle',
	(event) => {
		if (event.target.matches?.('details[data-menu]') && event.target.open) placeMenu(event.target)
	},
	true
)

window.addEventListener('resize', () => document.querySelectorAll('details[data-menu][open]').forEach(placeMenu))

function openTarget() {
	if (!location.hash) return
	const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
	const details = target?.closest('details')
	if (details && !details.open) details.open = true
}

function focusDecision() {
	if (location.hash !== '#decide' && location.hash !== '#answer') return
	document.querySelector(`${location.hash} textarea, ${location.hash} input:not([type="hidden"])`)?.focus()
}

window.addEventListener('hashchange', () => {
	openTarget()
	focusDecision()
})

const toast = document.querySelector('[data-toast]')
if (toast)
	setTimeout(() => {
		toast.classList.add('gone')
		setTimeout(() => toast.remove(), reducedMotion.matches ? 0 : 320)
	}, 6000)

function fitHeight(area) {
	area.style.height = 'auto'
	area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`
}

if (!CSS.supports('field-sizing', 'content')) {
	const areas = [...document.querySelectorAll('.edit-card textarea')]
	for (const area of areas) {
		fitHeight(area)
		area.addEventListener('input', () => fitHeight(area))
	}
	window.addEventListener('resize', () => areas.forEach(fitHeight))
}

const queue = document.querySelector('[data-queue]')
const narrowQueue = window.matchMedia('(max-width: 760px)')
let queueTicket = 0
let queueTimer = null
let queueBusy = false
let queuePending = false

function queueRows() {
	return [...document.querySelectorAll('[data-queue-link]')].filter((row) => row.offsetParent !== null)
}

function currentRow() {
	return document.querySelector('[data-queue-link][aria-current="true"]')
}

function queueDetail() {
	return queue.querySelector('[data-region="queue-detail"]')
}

function firstField() {
	return queueDetail().querySelector('form input:not([type="hidden"]), form textarea')
}

function showToast(fresh) {
	const toast = fresh.querySelector('[data-toast]')
	if (!toast) return
	document.querySelector('[data-toast]')?.remove()
	const shown = document.importNode(toast, true)
	body.append(shown)
	announce(shown.textContent)
	setTimeout(() => shown.remove(), 6000)
}

function swapQueue(fresh, keepDetail = false, live = false, detailOnly = false) {
	const messages = []
	const next = fresh.querySelector('[data-queue]')
	if (!next) return false
	const search = document.activeElement?.matches('[data-search]') ? document.activeElement : null
	const opened = new Map(
		[...queue.querySelectorAll('details[data-open-key]')].map((details) => [details.dataset.openKey, details.open])
	)
	for (const name of detailOnly ? ['queue-detail'] : ['queue-list', 'queue-detail']) {
		const region = queue.querySelector(`[data-region="${name}"]`)
		const replacement = next.querySelector(`[data-region="${name}"]`)
		const previous = served.get(name)
		if (previous && normalize(previous.outerHTML) === normalize(replacement.outerHTML)) continue
		if (name === 'queue-detail' && keepDetail) {
			const decision = region.querySelector('[data-region="decision"]')
			const fresh = replacement.querySelector('[data-region="decision"]')
			if (decision && fresh) staleNotice(decision, fresh)
			continue
		}
		const scrolled = region.scrollTop
		const imported = document.importNode(replacement, true)
		for (const details of imported.querySelectorAll('details[data-open-key]'))
			if (opened.has(details.dataset.openKey)) details.open = opened.get(details.dataset.openKey)
		region.replaceWith(imported)
		imported.scrollTop = scrolled
		if (live && previous) messages.push(...markChanged(keyed(previous), imported))
		served.set(name, replacement.cloneNode(true))
	}
	if (messages.length) announce(messages.join('. '))
	queue.dataset.selected = next.dataset.selected
	queue.toggleAttribute('data-open', next.hasAttribute('data-open'))
	document.title = fresh.title
	const count = fresh.querySelector('[data-region="nav-count"]')
	if (count) document.querySelector('[data-region="nav-count"]').textContent = count.textContent
	for (const button of queue.querySelectorAll('[data-queue-submit], [data-bulk-submit]')) button.hidden = true
	if (search) {
		const field = queue.querySelector('[data-search]')
		field.value = search.value
		field.focus()
		field.setSelectionRange(field.value.length, field.value.length)
	}
	syncRationale(queue)
	syncSource(queue)
	keepMore()
	rove()
	keepAnchor()
	restoreDrafts()
	showToast(fresh)
	return true
}

function queueFocus(focus) {
	const row = currentRow()
	if (row && !narrowQueue.matches) row.scrollIntoView({ block: 'nearest' })
	if (row && narrowQueue.matches && !queue.hasAttribute('data-open')) row.scrollIntoView({ block: 'center' })
	if (focus === 'row') row?.focus({ preventScroll: true })
	if (focus === 'detail') queueDetail().focus()
	if (focus === 'form') (queueDetail().querySelector('.form-error') ? queueDetail() : firstField())?.focus()
}

function queueSettle() {
	queueBusy = false
	if (!queuePending) return
	queuePending = false
	queueRefresh()
}

async function queueRefresh() {
	if (queueBusy) return void (queuePending = true)
	const ticket = queueTicket
	try {
		const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
		if (!response.ok) return
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (ticket !== queueTicket || queueBusy) return
		const focused = document.activeElement?.closest('[data-region="queue-list"] [data-key]')?.dataset.key
		swapQueue(fresh, dirty(queueDetail()), true)
		if (focused) document.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })
	} catch {}
}

async function queueGo(url, mode, focus, detailOnly = false) {
	if (!detailOnly) clearTimeout(stepTimer)
	const ticket = ++queueTicket
	queueBusy = true
	try {
		const response = await fetch(url, { cache: 'no-store', headers: { 'X-Checkmate-Queue': '1' } })
		if (ticket !== queueTicket) return
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (ticket !== queueTicket) return
		if (!swapQueue(fresh, false, false, detailOnly)) return void location.assign(url)
		if (mode === 'push') window.history.pushState({ depth: pageDepth() + 1 }, '', url)
		if (mode === 'replace') window.history.replaceState(window.history.state, '', url)
		if (mode && new URL(url, location.href).searchParams.has('pick'))
			window.history.replaceState(window.history.state, '', withPicks(location.href))
		window.dispatchEvent(new window.Event('queue-moved'))
		if (!detailOnly) window.scrollTo(0, 0)
		queueFocus(focus)
		if (location.hash) {
			openTarget()
			document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: 'center' })
		}
	} catch {
		location.assign(url)
	} finally {
		if (ticket === queueTicket) queueSettle()
	}
}

let stepTimer = null

function rove() {
	const rows = [...queue.querySelectorAll('[data-queue-link]')]
	const current = currentRow() ?? rows[0]
	for (const row of rows) row.tabIndex = row === current ? 0 : -1
}

function queueStep(step) {
	const rows = queueRows()
	if (!rows.length) return
	const index = rows.indexOf(currentRow())
	const next = rows[index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + step))]
	if (index >= 0 && next === rows[index]) return
	currentRow()?.removeAttribute('aria-current')
	next.setAttribute('aria-current', 'true')
	rove()
	next.focus({ preventScroll: true })
	next.scrollIntoView({ block: 'nearest' })
	window.history.replaceState(window.history.state, '', next.href)
	window.dispatchEvent(new window.Event('queue-moved'))
	queueTicket++
	clearTimeout(stepTimer)
	stepTimer = setTimeout(() => queueGo(next.href, null, null, true), 90)
}

function draftPrefix(key = queue.dataset.selected) {
	return `checkmate-draft:${location.pathname}:${key}:`
}

function draftFields() {
	return [...queueDetail().querySelectorAll('form[method="post"] textarea, form[method="post"] input:not([type])')]
}

function saveDraft(field) {
	try {
		if (field.value) window.sessionStorage.setItem(draftPrefix() + field.name, field.value)
		else window.sessionStorage.removeItem(draftPrefix() + field.name)
	} catch {}
}

function restoreDrafts() {
	try {
		for (const field of draftFields()) {
			if (field.value) continue
			const kept = window.sessionStorage.getItem(draftPrefix() + field.name)
			if (kept) field.value = kept
		}
	} catch {}
	syncRationale(queueDetail())
}

function clearDrafts(key) {
	try {
		const prefix = draftPrefix(key)
		for (const name of Object.keys(window.sessionStorage))
			if (name.startsWith(prefix)) window.sessionStorage.removeItem(name)
	} catch {}
}

function queueKind(event, value, send) {
	const bulk = queueDetail().querySelector(`[data-bulk-questions] #bulk-kind-${value}`)
	if (bulk) {
		event.preventDefault()
		bulk.checked = true
		syncSource()
		return true
	}
	const input = queueDetail().querySelector(`[data-quick-form] #kind-${value}`)
	if (!input) return false
	event.preventDefault()
	input.checked = true
	syncSource()
	if (send) {
		input.form.requestSubmit()
		return true
	}
	queueDetail().querySelector('#value')?.focus()
	return true
}

function queueVerdict(event, accept) {
	const quick = queueDetail().querySelector('[data-quick-claim]')
	if (quick) {
		event.preventDefault()
		if (accept) quick.requestSubmit(quick.querySelector('button[value="approved"]'))
		else {
			quick.dataset.choice = 'rejected'
			quick.querySelector('#rationale').focus()
		}
		return true
	}
	const form = queueDetail().querySelector('[data-verdict-form]:not([data-confirming])')
	if (!form) return false
	event.preventDefault()
	form.dataset.choice = form.querySelectorAll('[data-choose] button[name="verdict"]')[accept ? 0 : 1].value
	form.querySelector('[data-rationale]').focus()
	return true
}

let pickAnchor = null

function pickUrl() {
	const form = document.querySelector('[data-bulk-form]')
	const params = new URLSearchParams()
	for (const field of form.querySelectorAll('input[type="hidden"]'))
		if (field.name !== 'item' && field.value) params.set(field.name, field.value)
	for (const box of document.querySelectorAll('[data-pick]:checked')) params.append('pick', box.value)
	const current = currentRow()?.dataset.key
	if (current) params.set('item', current)
	const query = params.toString()
	return form.getAttribute('action') + (query ? `?${query}` : '')
}

function withPicks(url) {
	const address = new URL(url, location.href)
	address.searchParams.delete('pick')
	for (const box of document.querySelectorAll('[data-pick]:checked')) address.searchParams.append('pick', box.value)
	return address.pathname + address.search
}

function keepAnchor() {
	const box = [...document.querySelectorAll('[data-pick]:checked')].find(
		(each) => each.closest('li')?.querySelector('[data-queue-link]')?.dataset.key === pickAnchor
	)
	if (!box || !document.querySelector('[data-pick]:checked')) pickAnchor = null
}

function pickBoxOf(row) {
	return row?.closest('li')?.querySelector('[data-pick]') ?? null
}

function pickRange(row) {
	const rows = queueRows()
	const from = rows.findIndex((each) => each.dataset.key === pickAnchor)
	const to = rows.indexOf(row)
	if (from < 0 || to < 0) return false
	for (const each of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
		const box = pickBoxOf(each)
		if (box) box.checked = true
	}
	return true
}

function pickRow(row, range) {
	const box = pickBoxOf(row)
	if (!box) return false
	if (!range || !pickRange(row)) box.checked = !box.checked
	pickAnchor = row.dataset.key
	queueGo(pickUrl(), 'replace', 'row')
	return true
}

function queueKey(event) {
	if (event.key === 'x' || event.key === 'X') {
		event.preventDefault()
		pickRow(event.target.closest?.('[data-queue-link]') ?? currentRow(), event.key === 'X')
		return true
	}
	if (queueSending && 'adrcs'.includes(event.key)) {
		event.preventDefault()
		return true
	}
	const onRow = event.target.matches?.('[data-queue-link]')
	if (event.key === 'j' || (onRow && event.key === 'ArrowDown')) {
		event.preventDefault()
		queueStep(1)
		return true
	}
	if (event.key === 'k' || (onRow && event.key === 'ArrowUp')) {
		event.preventDefault()
		queueStep(-1)
		return true
	}
	if (event.key === 'a') return queueVerdict(event, true)
	if (event.key === 'r') return queueVerdict(event, false)
	if (event.key === 'c') return queueKind(event, 'clarify', false)
	if (event.key === 's') return queueKind(event, 'accept_assumption', false)
	if (event.key === 'd') return queueKind(event, 'defer', true)
	return false
}

function queueFilterUrl(form) {
	const params = new URLSearchParams()
	for (const field of form.elements) if (field.name && field.value.trim()) params.set(field.name, field.value.trim())
	const query = params.toString()
	return withPicks(query ? `${form.getAttribute('action')}?${query}` : form.getAttribute('action'))
}

function keepMore() {
	try {
		if (window.sessionStorage.getItem('checkmate-more') !== '1') return
	} catch {
		return
	}
	for (const details of queue.querySelectorAll('details[data-more]')) details.open = true
}

function sendChoice(form) {
	if (form.matches('[data-bulk-confirm]')) return form.querySelector('[data-bulk-send]')
	if (form.dataset.confirming) return form.querySelector('[data-confirm-submit]')
	if (form.dataset.choice) return form.querySelector(`button[name="verdict"][value="${form.dataset.choice}"]`)
	if (form.matches('[data-quick-claim]')) return form.querySelector('button[value="approved"]')
	return null
}

function rejectWithoutReason(form, submitter) {
	if (!form.matches('[data-quick-claim], [data-bulk-claims]') || submitter?.value !== 'rejected') return false
	const reason = form.querySelector('#rationale, #bulk-reason')
	if (reason.value.trim()) return false
	fieldError(reason, 'Write a short reason for the reject.')
	return true
}

let queueSending = false

function sendFailed(form, button) {
	if (button) button.disabled = false
	let message = form.querySelector('[data-send-error]')
	if (!message) {
		message = document.createElement('p')
		message.className = 'form-error'
		message.setAttribute('role', 'alert')
		message.dataset.sendError = ''
		const buttons = form.querySelector('.btns')
		if (buttons) buttons.before(message)
		else form.append(message)
	}
	message.textContent =
		'Checkmate did not answer. Nothing is recorded, and your text is kept. Start the UI again if it stopped, then send again.'
	announce(message.textContent)
}

async function renewToken() {
	const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
	if (!response.ok) return false
	const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
	const token = fresh.querySelector('input[name="csrf"]')?.value
	if (!token) return false
	for (const field of document.querySelectorAll('input[name="csrf"]')) field.value = token
	return true
}

async function queueSend(form, submitter) {
	if (queueSending) return
	queueSending = true
	const button = form.querySelector('button.primary')
	if (button) button.disabled = true
	const ticket = ++queueTicket
	queueBusy = true
	const sentKey = queue.dataset.selected
	const post = () => {
		const body = new URLSearchParams(new FormData(form))
		if (submitter?.name) body.set(submitter.name, submitter.value)
		return fetch(form.action, { method: 'POST', body, headers: { 'X-Checkmate-Queue': '1' } })
	}
	try {
		let response = await post()
		if (response.status === 403 && (await renewToken())) response = await post()
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (!swapQueue(fresh)) return void sendFailed(form, button)
		if (response.ok) clearDrafts(sentKey)
		if (response.ok && response.redirected) window.history.replaceState(window.history.state, '', response.url)
		window.dispatchEvent(new window.Event('queue-moved'))
		window.scrollTo(0, 0)
		const confirm = queueDetail().querySelector('[data-bulk-send]')
		if (confirm) confirm.focus()
		else queueFocus(response.ok ? 'row' : 'form')
	} catch {
		sendFailed(form, button)
	} finally {
		queueSending = false
		if (ticket === queueTicket) queueSettle()
	}
}

if (queue) {
	for (const button of queue.querySelectorAll('[data-queue-submit]')) button.hidden = true
	for (const button of queue.querySelectorAll('[data-bulk-submit]')) button.hidden = true
	document.addEventListener('click', (event) => {
		if (event.target.matches?.('[data-pick]')) {
			const row = event.target.closest('li').querySelector('[data-queue-link]')
			if (event.shiftKey && pickRange(row)) event.target.checked = true
			pickAnchor = row.dataset.key
			return void queueGo(pickUrl(), 'replace', null)
		}
		if (!plainClick(event)) return
		const row = event.target.closest('[data-queue-link]')
		if (row) {
			event.preventDefault()
			if (row.getAttribute('aria-current') === 'true' && !narrowQueue.matches) return void queueFocus('form')
			return void queueGo(row.href, 'push', narrowQueue.matches ? 'detail' : 'row')
		}
		const more = event.target.closest('[data-more-rows]')
		if (more) {
			event.preventDefault()
			const count = queueRows().length
			return void queueGo(withPicks(more.href), 'replace', null).then(() => queueRows()[count]?.focus())
		}
		const back = event.target.closest('[data-queue-back], [data-queue-go]')
		if (back) {
			event.preventDefault()
			queueGo(back.href, 'push', back.matches('[data-queue-go]') ? 'detail' : 'row')
		}
	})
	document.addEventListener('submit', (event) => {
		const form = event.target
		if (event.defaultPrevented) return
		if (form.matches('[data-bulk-form]')) {
			event.preventDefault()
			return void queueGo(pickUrl(), 'push', 'detail')
		}
		if (form.matches('[data-queue-filter]')) {
			event.preventDefault()
			return void queueGo(queueFilterUrl(form), 'push', null)
		}
		if (!form.closest('[data-region="queue-detail"]') || form.method !== 'post') return
		event.preventDefault()
		if (rejectWithoutReason(form, event.submitter)) return
		queueSend(form, event.submitter)
	})
	document.addEventListener(
		'toggle',
		(event) => {
			if (!event.target.matches?.('details[data-more]') || !event.target.open) return
			try {
				window.sessionStorage.setItem('checkmate-more', '1')
			} catch {}
		},
		true
	)
	keepMore()
	rove()
	restoreDrafts()
	document.addEventListener('input', (event) => {
		if (draftFields().includes(event.target)) saveDraft(event.target)
	})
	document.addEventListener('change', (event) => {
		const form = event.target.closest?.('[data-queue-filter]')
		if (form && event.target.tagName === 'SELECT') queueGo(queueFilterUrl(form), 'push', null)
	})
	document.addEventListener('input', (event) => {
		const form = event.target.closest?.('[data-queue-filter]')
		if (!form || event.target.type !== 'search') return
		clearTimeout(queueTimer)
		queueTimer = setTimeout(() => queueGo(queueFilterUrl(form), 'replace', null), 250)
	})
	let queueAddress = location.pathname + location.search
	window.addEventListener('popstate', () => {
		if (location.pathname + location.search === queueAddress) return
		queueGo(location.href, null, 'row')
	})
	window.addEventListener('queue-moved', () => (queueAddress = location.pathname + location.search))
}

document.querySelector('[data-shortcuts-open]').hidden = false
syncRationale()
syncSource()
openTarget()
if (location.hash === '#decide' || location.hash === '#answer')
	window.addEventListener('load', () => window.requestAnimationFrame(focusDecision), { once: true })
else if (queue && currentRow()) {
	currentRow().scrollIntoView({ block: 'nearest' })
	currentRow().focus({ preventScroll: true })
} else if (body.dataset.subjects === 'inbox' && navItems().length) navItems()[0].focus({ preventScroll: true })
connect()
