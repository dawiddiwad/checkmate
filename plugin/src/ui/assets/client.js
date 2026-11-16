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

document.addEventListener('input', (event) => {
	const form = event.target.closest?.('form')
	if (form) syncRationale(form.parentElement ?? document)
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
	const image = event.target.closest('a[data-view-image]')
	if (image && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
		event.preventDefault()
		openViewer(image)
	}
	if (event.target.closest('[data-viewer-close]')) closeViewer()
	if (event.target.matches('[data-viewer]')) closeViewer()
	if (event.target.closest('[data-shortcuts-open]')) toggleShortcuts()
	if (event.target.closest('[data-shortcuts-close]')) toggleShortcuts(false)
})

const viewer = document.querySelector('[data-viewer]')
let viewerOpener = null

function openViewer(link) {
	viewerOpener = link
	viewer.querySelector('[data-viewer-image]').src = link.href
	viewer.querySelector('[data-viewer-image]').alt = link.querySelector('img')?.alt ?? ''
	viewer.querySelector('[data-viewer-name]').textContent = link.dataset.name ?? ''
	viewer.querySelector('[data-viewer-open]').href = link.href
	viewer.hidden = false
	document.querySelector('main').inert = true
	viewer.querySelector('[data-viewer-close]').focus()
}

function trapViewer(event) {
	if (viewer.hidden || event.key !== 'Tab') return false
	const stops = [...viewer.querySelectorAll('a[href], button')]
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
	viewer.querySelector('[data-viewer-image]').removeAttribute('src')
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

document.addEventListener('keydown', (event) => {
	if (trapViewer(event)) return
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
	return text.replace(/<time[^>]*>[\s\S]*?<\/time>/g, '').replace(/\s+/g, ' ')
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
	syncRationale(next)
	syncSource(next)
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
		if (!field.name || field === document.activeElement) continue
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

function plainClick(event) {
	return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0
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

function swapQueue(fresh, keepDetail = false) {
	const next = fresh.querySelector('[data-queue]')
	if (!next) return false
	const search = document.activeElement?.matches('[data-search]') ? document.activeElement : null
	const opened = new Map(
		[...queue.querySelectorAll('details[data-open-key]')].map((details) => [details.dataset.openKey, details.open])
	)
	for (const name of keepDetail ? ['queue-list'] : ['queue-list', 'queue-detail']) {
		const region = queue.querySelector(`[data-region="${name}"]`)
		const replacement = next.querySelector(`[data-region="${name}"]`)
		const scrolled = region.scrollTop
		const imported = document.importNode(replacement, true)
		for (const details of imported.querySelectorAll('details[data-open-key]'))
			if (opened.get(details.dataset.openKey)) details.open = true
		region.replaceWith(imported)
		imported.scrollTop = scrolled
		served.set(name, replacement.cloneNode(true))
	}
	queue.dataset.selected = next.dataset.selected
	queue.toggleAttribute('data-open', next.hasAttribute('data-open'))
	document.title = fresh.title
	const count = fresh.querySelector('[data-region="nav-count"]')
	if (count) document.querySelector('[data-region="nav-count"]').textContent = count.textContent
	for (const button of queue.querySelectorAll('[data-queue-submit]')) button.hidden = true
	if (search) {
		const field = queue.querySelector('[data-search]')
		field.value = search.value
		field.focus()
		field.setSelectionRange(field.value.length, field.value.length)
	}
	syncRationale(queue)
	syncSource(queue)
	showToast(fresh)
	return true
}

function queueFocus(focus) {
	const row = currentRow()
	row?.scrollIntoView({ block: 'nearest' })
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
		swapQueue(fresh, dirty(queueDetail()))
		if (focused) document.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })
	} catch {}
}

async function queueGo(url, mode, focus) {
	const ticket = ++queueTicket
	queueBusy = true
	try {
		const response = await fetch(url, { cache: 'no-store', headers: { 'X-Checkmate-Queue': '1' } })
		if (ticket !== queueTicket) return
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (!swapQueue(fresh)) return void location.assign(url)
		if (mode === 'push') window.history.pushState(null, '', url)
		if (mode === 'replace') window.history.replaceState(null, '', url)
		queueFocus(focus)
	} catch {
		location.assign(url)
	} finally {
		if (ticket === queueTicket) queueSettle()
	}
}

function queueStep(step) {
	const rows = queueRows()
	if (!rows.length) return
	const index = rows.indexOf(currentRow())
	const next = rows[index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + step))]
	if (index >= 0 && next === rows[index]) return
	currentRow()?.removeAttribute('aria-current')
	next.setAttribute('aria-current', 'true')
	next.focus({ preventScroll: true })
	next.scrollIntoView({ block: 'nearest' })
	queueGo(next.href, 'replace', 'row')
}

function queuePick(event, selector, field) {
	const input = queueDetail().querySelector(selector)
	if (!input) return false
	event.preventDefault()
	input.checked = true
	input.dispatchEvent(new window.Event('change', { bubbles: true }))
	queueDetail().querySelector(field)?.focus()
	return true
}

function queueKey(event) {
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
	if (event.key === 'a') return queuePick(event, '#verdict-approved', '#rationale')
	if (event.key === 'r') return queuePick(event, '#verdict-rejected', '#rationale')
	if (event.key === 'c') return queuePick(event, '#kind-clarify', '#value')
	if (event.key === 's') return queuePick(event, '#kind-accept_assumption', '#value')
	if (event.key === 'd') return queuePick(event, '#kind-defer', '#value')
	return false
}

function queueFilterUrl(form) {
	const params = new URLSearchParams()
	for (const field of form.elements) if (field.name && field.value.trim()) params.set(field.name, field.value.trim())
	const query = params.toString()
	return query ? `/?${query}` : '/'
}

async function queueSend(form) {
	const button = form.querySelector('button.primary')
	if (button) button.disabled = true
	const ticket = ++queueTicket
	queueBusy = true
	try {
		const response = await fetch(form.action, {
			method: 'POST',
			body: new URLSearchParams(new FormData(form)),
			headers: { 'X-Checkmate-Queue': '1' },
		})
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (!swapQueue(fresh)) return void form.submit()
		if (response.ok && response.redirected) window.history.replaceState(null, '', response.url)
		queueFocus(response.ok ? 'row' : 'form')
	} catch {
		form.submit()
	} finally {
		if (ticket === queueTicket) queueSettle()
	}
}

if (queue) {
	for (const button of queue.querySelectorAll('[data-queue-submit]')) button.hidden = true
	document.addEventListener('click', (event) => {
		if (!plainClick(event)) return
		const row = event.target.closest('[data-queue-link]')
		if (row) {
			event.preventDefault()
			if (row.getAttribute('aria-current') === 'true' && !narrowQueue.matches) return void queueFocus('form')
			return void queueGo(row.href, 'push', narrowQueue.matches ? 'detail' : 'row')
		}
		const back = event.target.closest('[data-queue-back]')
		if (back) {
			event.preventDefault()
			queueGo(back.href, 'push', 'row')
		}
	})
	document.addEventListener('submit', (event) => {
		const form = event.target
		if (form.matches('[data-queue-filter]')) {
			event.preventDefault()
			return void queueGo(queueFilterUrl(form), 'push', null)
		}
		if (!form.closest('[data-region="queue-detail"]') || form.method !== 'post') return
		event.preventDefault()
		queueSend(form)
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
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
		const form = event.target.closest?.('[data-region="queue-detail"] form')
		if (!form) return
		event.preventDefault()
		if (form.reportValidity()) form.requestSubmit()
	})
	window.addEventListener('popstate', () => queueGo(location.href, null, 'row'))
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
