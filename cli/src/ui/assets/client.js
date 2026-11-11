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
	viewer.querySelector('[data-viewer-close]').focus()
}

function closeViewer() {
	if (viewer.hidden) return false
	viewer.hidden = true
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
	if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
	const target = event.target
	const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
	if (event.key === 'Escape') {
		if (closeViewer() || (!shortcuts.hidden && toggleShortcuts(false))) event.preventDefault()
		else if (typing) target.blur()
		return
	}
	if (typing) return
	if (pendingG) {
		pendingG = false
		if (event.key === 'i') return void (location.href = '/')
	}
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

function staleNotice(region) {
	const slot = region.querySelector('[data-stale-slot]')
	if (!slot || slot.querySelector('[data-live-stale]')) return
	const notice = document.createElement('div')
	notice.className = 'banner warn'
	notice.setAttribute('role', 'status')
	notice.dataset.liveStale = ''
	notice.textContent = region.dataset.staleMessage || 'This item changed. Review it before you decide.'
	slot.prepend(notice)
	announce(notice.textContent)
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
	const next = document.importNode(fresh, true)
	for (const details of next.querySelectorAll('details[data-open-key]'))
		if (opened.has(details.dataset.openKey)) details.open = opened.get(details.dataset.openKey)
	region.replaceWith(next)
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
				staleNotice(region)
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

const toast = document.querySelector('[data-toast]')
if (toast)
	setTimeout(() => {
		toast.classList.add('gone')
		setTimeout(() => toast.remove(), reducedMotion.matches ? 0 : 320)
	}, 6000)

document.querySelector('[data-shortcuts-open]').hidden = false
syncRationale()
syncSource()
if (location.hash === '#decide' || location.hash === '#answer')
	document.querySelector(`${location.hash} textarea, ${location.hash} input:not([type="hidden"])`)?.focus({
		preventScroll: false,
	})
else if (body.dataset.subjects === 'inbox' && navItems().length) navItems()[0].focus({ preventScroll: true })
connect()
