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

function effectiveTheme() {
	const set = document.documentElement.dataset.theme
	if (set) return set
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(form, theme) {
	document.documentElement.dataset.theme = theme
	const button = form.querySelector('button[name="theme"]')
	button.value = theme === 'dark' ? 'light' : 'dark'
	button.dataset.current = theme
}

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
		const theme = effectiveTheme() === 'dark' ? 'light' : 'dark'
		const data = new URLSearchParams(new FormData(form))
		data.set('theme', theme)
		fetch(form.action, { method: 'POST', body: data, redirect: 'manual' }).catch(() => {})
		applyTheme(form, theme)
	}
})

const viewer = document.querySelector('[data-viewer]')
const viewerImage = viewer?.querySelector('[data-viewer-image]')
const viewerText = viewer?.querySelector('[data-viewer-text]')
const viewerNote = viewer?.querySelector('[data-viewer-note]')
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
	viewer.querySelector('[data-viewer-wrap]').checked = on
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

viewerImage?.addEventListener('error', () => {
	if (!viewer.hidden && viewerImage.getAttribute('src')) viewerMessage('This image cannot be shown.')
})

function openViewer(link) {
	viewerOpener = link
	const kind = link.dataset.view
	viewer.dataset.kind = kind
	viewer.querySelector('[data-viewer-name]').textContent = link.dataset.name ?? ''
	for (const download of viewer.querySelectorAll('[data-viewer-download], [data-viewer-note-download]')) {
		download.href = link.dataset.src || link.href
		download.setAttribute('download', link.dataset.name ?? '')
	}
	for (const tools of viewer.querySelectorAll('[data-viewer-tools]'))
		tools.hidden = tools.dataset.targeterTools !== kind
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
	if (!viewer || viewer.hidden || event.key !== 'Tab') return false
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
	if (!viewer || viewer.hidden) return false
	viewer.hidden = true
	document.querySelector('main').inert = false
	viewerImage.removeAttribute('src')
	viewerImage.style.width = ''
	viewerText.textContent = ''
	viewerOpener?.focus()
	return true
}

document.addEventListener('change', (event) => {
	if (event.target.matches('[data-viewer-wrap]')) wrapViewer(event.target.checked)
})

const say = document.querySelector('[data-say]')
const sayStrip = document.querySelector('[data-say-strip]')
let sayTimer = null
let sayText = ''
let gone = null

function setSay(text) {
	if (sayText === text) return
	sayText = text
	showHints()
}

function tell(text) {
	setSay(text)
	clearTimeout(sayTimer)
	sayTimer = setTimeout(() => setSay(''), 4000)
}

const review = document.querySelector('[data-review]')
let drawer = document.querySelector('[data-drawer]')
const viewerPane = document.querySelector('[data-viewer-pane]')
const address = new URL(location.href)
let level = viewerPane
	? 'viewer'
	: drawer
		? 'detail'
		: review
			? address.searchParams.get('focus') === 'list'
				? 'list'
				: 'nav'
			: 'list'
const picks = new Set()
let anchor = null
let sending = false
let chosenBuild = address.searchParams.get('build')

function shown(element) {
	return !element.hidden && !element.closest('[hidden], details:not([open], [data-menu]) > :not(summary)')
}

function navRows() {
	return [...document.querySelectorAll('[data-nav]')].filter(shown)
}

function panel() {
	return document.querySelector('[data-panel]:not([hidden])')
}

function listRows() {
	const root = review ? panel() : document
	return root ? [...root.querySelectorAll('[data-row]')].filter(shown) : []
}

function rowsAt(where = level) {
	if (where === 'viewer') return [...document.querySelectorAll('[data-vfile]')]
	if (where === 'detail') return [...drawer.querySelectorAll('[data-sub]')].filter(shown)
	return where === 'nav' ? navRows() : listRows()
}

function leave(target) {
	const referrer = document.referrer ? new URL(document.referrer) : null
	if (referrer && referrer.origin === location.origin && referrer.pathname + referrer.search === target)
		return window.history.back()
	location.assign(target)
}

function showFile(row) {
	for (const figure of document.querySelectorAll('[data-vfig]'))
		figure.hidden = figure.dataset.vfig !== row.dataset.vfile
	const name = document.querySelector('[data-file-name]')
	if (name) name.textContent = row.dataset.label
	window.history.replaceState(window.history.state, '', row.href)
}

function current(where = level) {
	return rowsAt(where).find((row) => row.classList.contains('hl')) ?? null
}

function currentView() {
	return panel()?.dataset.panel ?? null
}

function storeKey() {
	return `checkmate-areas:${review?.dataset.plan ?? ''}`
}

function storedAreas() {
	try {
		const kept = window.localStorage.getItem(storeKey())
		return kept === null ? null : JSON.parse(kept)
	} catch {
		return null
	}
}

function keepAreas() {
	const open = [...document.querySelectorAll('[data-nav][aria-expanded="true"]')].map((row) => row.dataset.label)
	try {
		window.localStorage.setItem(storeKey(), JSON.stringify(open))
	} catch {}
}

function areaRules(area) {
	return [...document.querySelectorAll(`[data-in-area="${CSS.escape(area.dataset.label)}"]`)]
}

function expand(row, open) {
	row.setAttribute('aria-expanded', open ? 'true' : 'false')
	row.querySelector('.sp-nid').innerHTML = glyphHtml(open ? '▾' : '▸')
	for (const rule of areaRules(row)) rule.hidden = !open
}

function areaOf(row) {
	return row.dataset.inArea
		? document.querySelector(`[data-nav][aria-expanded][data-label="${CSS.escape(row.dataset.inArea)}"]`)
		: null
}

function restoreAreas() {
	const areas = [...document.querySelectorAll('[data-nav][aria-expanded]')]
	if (!areas.length) return
	let open = storedAreas()
	if (open === null) {
		const nav = document.querySelector('[data-navigator]')
		const attention = areas.filter((area) => areaRules(area).some((rule) => rule.querySelector('.k-fail, .k-q')))
		const extra = attention.reduce((sum, area) => sum + areaRules(area).length, 0)
		const rowHeight = navRows()[0]?.offsetHeight ?? 32
		const room = nav ? nav.clientHeight + window.innerHeight - nav.getBoundingClientRect().bottom - 48 : 0
		open = nav && nav.scrollHeight + extra * rowHeight <= room ? attention.map((area) => area.dataset.label) : []
	}
	for (const area of areas)
		expand(area, area.getAttribute('aria-expanded') === 'true' || open.includes(area.dataset.label))
}

function keysOn() {
	document
		.querySelector('[data-navigator]')
		?.classList.toggle('keys-on', level === 'nav' && canChoose(current('nav')?.dataset.target))
}

function fitPath() {
	const list = document.querySelector('.sb-where ol')
	if (!list) return
	for (const item of list.children) item.hidden = false
	list.querySelector('[data-more-path]')?.remove()
	const items = [...list.children]
	const keep = window.matchMedia('(max-width: 760px)').matches ? 1 : 2
	let cut = 0
	while (list.scrollWidth > list.clientWidth && items.length - cut > keep) items[cut++].hidden = true
	if (!cut) return
	const more = document.createElement('li')
	more.dataset.morePath = ''
	more.textContent = '…'
	more.title = items.map((item) => item.textContent).join(' › ')
	list.prepend(more)
	while (list.scrollWidth > list.clientWidth && items.length - cut > keep) items[cut++].hidden = true
}

window.addEventListener('resize', fitPath)

function showPath() {
	const list = document.querySelector('.sb-where ol')
	if (!review || !list || drawer || viewerPane) return fitPath()
	const fixed = [...list.querySelectorAll('li')].slice(0, 2)
	const tail = [panel()?.dataset.title ?? '']
	const row = level === 'list' ? current('list') : null
	if (row) tail.push(row.dataset.label)
	list.replaceChildren(...fixed)
	for (const text of tail) {
		const item = document.createElement('li')
		item.textContent = text
		list.append(item)
	}
	for (const item of list.children) item.removeAttribute('aria-current')
	list.lastElementChild?.setAttribute('aria-current', 'page')
	fitPath()
}

function remember() {
	if (!review || drawer || viewerPane) return
	const url = new URL(location.href)
	url.searchParams.set('view', currentView() ?? 'needs')
	url.searchParams.delete('nav')
	const row = current('list')
	if (row) url.searchParams.set('at', row.dataset.key)
	else url.searchParams.delete('at')
	url.searchParams.set('focus', level)
	if (chosenBuild && canChoose(currentView())) url.searchParams.set('build', chosenBuild)
	else url.searchParams.delete('build')
	window.history.replaceState(window.history.state, '', url.pathname + url.search)
}

const zones = { nav: '[data-nav]', list: '[data-row]', detail: '[data-sub]', viewer: '[data-vfile]' }

function mark(row, where = level) {
	for (const other of document.querySelectorAll(zones[where])) {
		other.classList.toggle('hl', other === row)
		other.tabIndex = other === row ? 0 : -1
	}
	if (!row) return
	fitOptions(row)
	padTitle(row)
	row.focus({ preventScroll: true })
	reveal(row)
}

function reveal(row) {
	row.scrollIntoView({ block: 'nearest' })
	const strip = row.matches('[data-nav]')
		? 0
		: parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 0
	const top = (document.querySelector('.top')?.getBoundingClientRect().bottom ?? 0) + strip
	if (row.getBoundingClientRect().top < top) row.scrollIntoView({ block: 'start' })
}

function padTitle(row) {
	const options = row.querySelector(':scope > .sp-c-opts')
	if (!options || window.getComputedStyle(options).position !== 'absolute')
		return row.style.removeProperty('--title-pad')
	const meta = row.querySelector(':scope > .sp-c-meta')
	const beside = meta && window.getComputedStyle(meta).display !== 'none' ? meta.offsetWidth + 12 : 0
	row.style.setProperty('--title-pad', `${Math.max(0, options.offsetWidth + 12 - beside)}px`)
}

function dockRoom() {
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

function canChoose(view) {
	return Boolean(view && (view.startsWith('rule:') || view.startsWith('area:')))
}

function applyBuild() {
	const view = currentView()
	const build = canChoose(view) ? chosenBuild : null
	for (const row of document.querySelectorAll('[data-panel] [data-row]'))
		row.hidden =
			Boolean(build) &&
			row.closest('[data-panel]').dataset.panel === view &&
			!row.dataset.builds?.split(' ').includes(build)
	const list = panel()?.querySelector('[data-list]')
	for (const head of list?.querySelectorAll('.sp-gh') ?? []) {
		let count = 0
		for (let next = head.nextElementSibling; next && !next.matches('.sp-gh'); next = next.nextElementSibling)
			if (next.matches('[data-row]') && !next.hidden) count++
		head.hidden = count === 0
		const number = head.querySelector('span')
		if (number) number.textContent = String(count)
	}
	for (const mark of document.querySelectorAll('[data-nav] [data-mark]'))
		mark.classList.toggle(
			'chosen',
			Boolean(build) && mark.dataset.mark === build && mark.closest('[data-nav]').dataset.target === view
		)
	const note = panel()?.querySelector('[data-build-note]')
	if (note) note.textContent = build ? `On build ${build} only. Press the same number again for all builds.` : ''
}

function chooseBuild(n) {
	const row = current('nav')
	if (!canChoose(row?.dataset.target)) return tell('Numbers choose a build column on a rule or an area.')
	const marks = [...row.querySelectorAll('[data-mark]')]
	const mark = marks[n - 1]
	if (!mark) return tell(`The build columns go from 1 to ${marks.length}.`)
	chosenBuild = chosenBuild === mark.dataset.mark ? null : mark.dataset.mark
	if (currentView() !== row.dataset.target) showView(row.dataset.target)
	applyBuild()
	remember()
	tell(chosenBuild ? `${row.dataset.label} on build ${chosenBuild}` : `${row.dataset.label} on all builds`)
}

function showView(view) {
	if (!review) return
	for (const each of document.querySelectorAll('[data-panel]')) {
		each.hidden = each.dataset.panel !== view
		const heading = each.querySelector('[data-view-title]')
		const tag = each.hidden ? 'H2' : 'H1'
		if (heading && heading.tagName !== tag) {
			const fresh = document.createElement(tag)
			for (const { name, value } of heading.attributes) fresh.setAttribute(name, value)
			fresh.append(...heading.childNodes)
			heading.replaceWith(fresh)
		}
	}
	for (const row of document.querySelectorAll('[data-nav]')) {
		row.setAttribute('aria-selected', row.dataset.target === view ? 'true' : 'false')
		row.classList.toggle('on', row.dataset.target === view)
	}
	const title = panel()?.dataset.title
	if (title) document.title = `${title} · ${review.dataset.plan} · Checkmate`
	applyPicks()
	applyBuild()
}

function hasPanel(view) {
	return Boolean(view && document.querySelector(`[data-panel="${CSS.escape(view)}"]`))
}

function startRow() {
	const rows = listRows()
	const wanted = address.searchParams.get('at') ?? address.searchParams.get('item')
	if (location.hash === '#last') return rows.at(-1)
	return (
		rows.find((row) => row.dataset.key === wanted) ??
		rows.find((row) => row.classList.contains('cur')) ??
		rows.find((row) => 'needs' in row.dataset) ??
		rows[0]
	)
}

function placeAlert() {
	const alert = [...document.querySelectorAll('main .form-error[role="alert"]')].find(
		(element) => element.textContent.trim() && shown(element)
	)
	if (!alert) return false
	const field = alert.dataset.field && document.getElementById(alert.dataset.field)
	if (field) {
		alert.id ||= `${field.id}-error`
		field.closest('.field-group, li, td')?.append(alert)
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

function focusTarget() {
	const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)))
	if (!target || target.contains(document.activeElement)) return
	const control = target.matches('a, button, summary, input, select, textarea')
		? target
		: target.querySelector('summary, button, a[href], input, select, textarea')
	if (control) control.focus()
	else {
		target.tabIndex = -1
		target.focus()
	}
}

function settle() {
	keysOnLater()
	if (level === 'viewer' || level === 'detail') {
		const open = review?.dataset.open
		const listed = open && listRows().find((row) => row.dataset.key === open)
		if (listed) {
			listed.classList.add('cur')
			listed.scrollIntoView({ block: 'nearest' })
		}
		const rows = rowsAt()
		mark(rows.find((row) => row.classList.contains('hl')) ?? rows[0], level)
		const field = drawer?.querySelector('.form-error') ? drawer.querySelector('[data-field-form] textarea') : null
		const asked = location.hash && drawer?.querySelector(`${CSS.escape(location.hash)} textarea`)
		const typing = field || asked
		if (typing) {
			typing.focus()
			typing.setSelectionRange(typing.value.length, typing.value.length)
		}
		showPath()
		return showHints()
	}
	if (level === 'nav') {
		const wanted = address.searchParams.get('nav') ?? currentView()
		const row = navRows().find((each) => each.dataset.target === wanted) ?? navRows()[0]
		for (const each of listRows()) each.classList.remove('hl')
		mark(row, 'nav')
	} else {
		for (const each of navRows()) {
			each.classList.remove('hl')
			each.tabIndex = -1
		}
		const row = current('list') ?? startRow()
		if (row) mark(row, 'list')
		else if (review) {
			level = 'nav'
			return settle()
		}
	}
	showPath()
	showHints()
	remember()
	keysOn()
}

function keysOnLater() {
	window.requestAnimationFrame(keysOn)
}

function step(by) {
	const rows = rowsAt()
	if (!rows.length) return
	const index = rows.indexOf(current())
	const next = index < 0 ? 0 : index + by
	const region = !review && level === 'list' ? current()?.closest('[data-list-region]') : null
	const turn = region?.querySelector(`a[rel="${by > 0 ? 'next' : 'prev'}"]`)
	if ((next < 0 || next >= rows.length) && turn) return void location.assign(turn.href + (by > 0 ? '' : '#last'))
	if (next < 0 && level === 'list' && enterActions()) return
	if (next < 0 || next >= rows.length) return tell(by > 0 ? 'This is the last row.' : 'This is the first row.')
	mark(rows[next])
	if (level === 'viewer') showFile(rows[next])
	anchor = null
	rangeBase = null
	if (level === 'nav') {
		if (hasPanel(rows[next].dataset.target)) {
			chosenBuild = null
			showView(rows[next].dataset.target)
		}
		keysOn()
	}
	anchor = null
	showPath()
	showHints()
	remember()
}

let rangeBase = null

function extend(by) {
	if (level !== 'list') return
	const before = current()
	if (!before) return
	const rows = listRows()
	if (!anchor) {
		anchor = before.dataset.key
		rangeBase = new Set(picks)
	}
	const next = rows[rows.indexOf(before) + by]
	if (!next) return
	mark(next)
	const from = rows.findIndex((row) => row.dataset.key === anchor)
	const to = rows.indexOf(next)
	picks.clear()
	for (const key of rangeBase) picks.add(key)
	for (const row of rows.slice(Math.min(from, to), Math.max(from, to) + 1))
		if (row.dataset.pick) picks.add(row.dataset.key)
	applyPicks()
	showPath()
	showHints()
	remember()
}

function enterList() {
	if (chosenBuild) {
		chosenBuild = null
		applyBuild()
	}
	if (!startRow()) return enterActions() || tell('Nothing here.')
	window.history.pushState({ level: 'list' }, '', location.pathname + location.search)
	level = 'list'
	settle()
}

function open(row) {
	if (!row?.dataset.href) return tell('Nothing deeper.')
	location.assign(row.dataset.href)
}

function deeper() {
	const row = current()
	if (level === 'viewer') return tell('Nothing deeper.')
	if (level === 'detail') return row?.dataset.href ? location.assign(row.dataset.href) : tell('Nothing deeper.')
	if (level === 'nav') {
		if (!row) return
		if (row.getAttribute('aria-expanded') === 'false') {
			expand(row, true)
			keepAreas()
			window.history.pushState({ ...window.history.state, area: row.dataset.label }, '', location.href)
			return showHints()
		}
		if (!hasPanel(row.dataset.target)) return void location.assign(row.href)
		return enterList()
	}
	open(row)
}

function back(event) {
	if (level === 'viewer') return leave(viewerPane.dataset.back)
	if (level === 'detail') return leave(drawer.dataset.back)
	if (event.key === 'Escape' && picks.size) {
		clearPicks()
		return tell('The selection is cleared.')
	}
	if (level === 'list' && review) {
		if (window.history.state?.level === 'list') return window.history.back()
		level = 'nav'
		return settle()
	}
	if (level === 'nav') {
		const row = current()
		if (row?.getAttribute('aria-expanded') === 'true') {
			expand(row, false)
			keepAreas()
			dropLayer('area')
			return showHints()
		}
		const area = row && areaOf(row)
		if (area) {
			expand(area, false)
			keepAreas()
			dropLayer('area')
			mark(area)
			if (hasPanel(area.dataset.target)) showView(area.dataset.target)
			showPath()
			showHints()
			return remember()
		}
	}
	if (body.dataset.back) return void leavePage(body.dataset.back)
	tell('This is the first page.')
}

if (body.dataset.address && location.pathname + location.search !== body.dataset.address)
	window.history.replaceState(window.history.state, '', body.dataset.address + location.hash)

const editors = [...document.querySelectorAll('[data-edit-form]')]
let edited = false
for (const form of editors) form.addEventListener('input', () => (edited = true))
for (const form of editors) form.addEventListener('submit', () => (edited = false))
window.addEventListener('beforeunload', (event) => {
	if (edited) event.preventDefault()
})

async function leavePage(address) {
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

function draftKey(field) {
	const item = new URL(location.href).searchParams.get('item') ?? ''
	return `checkmate-draft:${location.pathname}:${item}:${field.form.getAttribute('action')}:${field.name}`
}

function draftFields() {
	return [
		...document.querySelectorAll('form[method="post"] :is(textarea, input[type="text"], input:not([type]))'),
	].filter((field) => field.name && field.name !== 'actor' && !field.closest('[data-edit-form], dialog'))
}

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
		note.className = 'help draft-note'
		note.textContent = 'Draft kept.'
		field.after(note)
	}
}

document.addEventListener('submit', (event) => {
	if (event.target.matches?.('[data-act-form]')) return
	for (const field of event.target.querySelectorAll?.('textarea, input') ?? [])
		try {
			if (field.name) window.sessionStorage.removeItem(draftKey(field))
		} catch {}
})

function optionsNow() {
	if (level === 'detail') return [...drawer.querySelectorAll('.sp-dhead [data-option], .sp-options [data-option]')]
	const row = level === 'list' ? current('list') : null
	if (row?.classList.contains('many')) return detailOptions(row)
	return row ? [...row.querySelectorAll('[data-option]')] : []
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

function showExtra(row, field) {
	const extra = row.querySelector(`[data-extra="${CSS.escape(field)}"]`)
	if (!extra) return
	for (const other of row.querySelectorAll('[data-extra]')) other.hidden = other !== extra
	row.classList.add('ext')
	const area = extra.querySelector('textarea')
	area.focus()
	area.setSelectionRange(area.value.length, area.value.length)
	showHints()
}

function focusField(field) {
	const area = drawer?.querySelector(`#${CSS.escape(field)}-text`)
	if (!area) return tell('This option has no field here.')
	const extra = area.closest('[data-extra]')
	if (extra) extra.hidden = false
	area.scrollIntoView({ block: 'nearest' })
	area.focus()
	area.setSelectionRange(area.value.length, area.value.length)
	showHints()
}

function hideExtra(row) {
	for (const extra of row.querySelectorAll('[data-extra]')) extra.hidden = true
	row.classList.remove('ext')
}

function choose(n) {
	if (sending) return
	if (gone && level === 'list') {
		const text = `Nothing is recorded. ${gone} ${current('list')?.dataset.label ?? 'The next row'} has the highlight now.`
		gone = null
		return tell(text)
	}
	const selection = bulkOptions()
	if (selection.length && (level === 'list' || level === 'nav')) {
		const option = selection[n - 1]
		return option ? option.click() : tell(`The options go from 1 to ${selection.length}.`)
	}
	if (level === 'nav' && review) return chooseBuild(n)
	const options = optionsNow()
	if (level === 'list' && current('list')?.classList.contains('many') && !options.length)
		return tell('The options do not fit in the row. Open the row to see them.')
	if (!options.length) return tell('No options here.')
	const option = options[n - 1]
	if (!option) return tell(`The options go from 1 to ${options.length}.`)
	if (option.disabled) return tell('This option is not available here.')
	option.click()
}

function pick(row, on = !picks.has(row.dataset.key)) {
	if (!row.dataset.pick) return
	if (on) picks.add(row.dataset.key)
	else picks.delete(row.dataset.key)
	applyPicks()
}

function applyPicks() {
	showBulk()
	for (const row of document.querySelectorAll('[data-row][data-pick]')) {
		const on = picks.has(row.dataset.key)
		row.classList.toggle('sel', on)
		row.setAttribute('aria-selected', on ? 'true' : 'false')
		const box = row.querySelector('[data-pick-box]')
		if (box) box.checked = on
	}
}

function clearPicks() {
	picks.clear()
	anchor = null
	rangeBase = null
	applyPicks()
	showHints()
}

function toggleSelect() {
	if (level !== 'list') return tell('Space selects records in a list.')
	const row = current()
	if (!row?.dataset.pick) return tell('This record cannot be selected.')
	pick(row)
	anchor = null
	rangeBase = null
	showHints()
}

const bulkBar = document.querySelector('[data-bulk]')
const confirmDialog = document.querySelector('[data-confirm]')
const findDialog = document.querySelector('[data-find]')

function picked(kind) {
	return [...picks]
		.map((key) => document.querySelector(`[data-row][data-key="${CSS.escape(key)}"][data-pick]`)?.dataset.pick)
		.filter((pick) => pick?.startsWith(`${kind}:`))
}

function plural(count, one, many = `${one}s`) {
	return `${count} ${count === 1 ? one : many}`
}

function bulkOptions() {
	if (!bulkBar || !picks.size) return []
	return [...bulkBar.querySelectorAll('[data-bulk-action]')].filter((button) => !button.hidden)
}

function showBulk() {
	if (!bulkBar) return
	const was = bulkBar.hidden
	bulkBar.hidden = !picks.size
	if (was !== bulkBar.hidden) window.requestAnimationFrame(dockRoom)
	if (!picks.size) return
	const findings = picked('claim').length
	const questions = picked('question').length + picked('gap').length
	const defects = picked('defect').length
	const requests = picked('permission').length
	const labels = {
		accept: findings ? `Accept ${plural(findings, 'finding')} as defects` : null,
		right: questions ? `${plural(questions, 'question')} right as built` : null,
		defer: questions ? `Defer ${plural(questions, 'question')}` : null,
		handoff: defects ? `Hand over ${plural(defects, 'defect')}` : null,
		copy: defects ? `Copy ${plural(defects, 'defect')} for the developer` : null,
		allow: requests ? `Allow once (${requests})` : null,
		deny: requests ? `Deny… (${requests})` : null,
		clear: 'Clear the selection',
	}
	bulkBar.querySelector('[data-bulk-count]').textContent = `${picks.size} selected`
	let n = 0
	for (const button of bulkBar.querySelectorAll('[data-bulk-action]')) {
		const label = labels[button.dataset.bulkAction]
		button.hidden = !label
		if (!label) continue
		button.querySelector('span').textContent = label
		button.querySelector('kbd').textContent = String(++n)
	}
}

function ask({ title, text, field = null, yes = 'Confirm', no = 'Cancel' }) {
	return new Promise((resolve) => {
		confirmDialog.querySelector('[data-confirm-title]').textContent = title
		confirmDialog.querySelector('[data-confirm-text]').textContent = text
		confirmDialog.querySelector('[data-confirm-yes] span').textContent = yes
		confirmDialog.querySelector('[data-confirm-no] span').textContent = no
		const box = confirmDialog.querySelector('[data-confirm-field]')
		const input = box.querySelector('input')
		box.hidden = !field
		input.value = ''
		input.required = Boolean(field)
		if (field) box.querySelector('label').textContent = field
		confirmDialog.returnValue = ''
		pushLayer('confirm')
		confirmDialog.showModal()
		if (field) input.focus()
		else confirmDialog.querySelector('[data-confirm-yes]').focus()
		const closed = () => {
			if (confirmDialog.open) return
			confirmDialog.removeEventListener('close', closed)
			resolve(confirmDialog.returnValue === 'yes' ? { value: input.value.trim() } : null)
		}
		confirmDialog.addEventListener('close', closed)
	})
}

function confirmKey(event) {
	const typing = event.target.matches?.('input')
	if (event.key === 'Escape' || (event.key === 'ArrowLeft' && !typing)) {
		event.preventDefault()
		confirmDialog.close('no')
	} else if (event.key === 'Enter' || (event.key === '1' && !typing)) {
		event.preventDefault()
		const input = confirmDialog.querySelector('[data-confirm-field]:not([hidden]) input')
		if (input && !input.value.trim()) return input.focus()
		confirmDialog.close('yes')
	}
}

async function post(action, fields) {
	const data = new URLSearchParams()
	for (const [name, value] of fields) data.append(name, value)
	let response = await fetch(action, { method: 'POST', body: data })
	if (response.status === 403 && (await renewToken())) {
		data.set('csrf', document.querySelector('input[name="csrf"]').value)
		response = await fetch(action, { method: 'POST', body: data })
	}
	if (response.ok && response.redirected) return null
	const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
	return (
		fresh.querySelector('[role="alert"]')?.textContent?.trim() ||
		'Checkmate refused the action. Nothing is recorded.'
	)
}

function csrf() {
	return document.querySelector('input[name="csrf"]')?.value ?? bulkBar?.dataset.csrf ?? ''
}

function keepUndo(claims, to) {
	try {
		window.sessionStorage.setItem(
			'checkmate-undo',
			JSON.stringify({ plan: review?.dataset.plan, claims, to, until: Date.now() + 8000 })
		)
	} catch {}
}

async function bulkRequests(action) {
	const keys = picked('permission')
	const count = plural(keys.length, 'request')
	const answer = await ask(
		action === 'allow'
			? {
					title: 'Allow once',
					text: `Allow ${count} once? Each tester gets yes for its own call. Checkmate stores no rule.`,
					yes: `Allow once (${keys.length})`,
				}
			: {
					title: 'Deny',
					text: `Deny ${count}? Each tester gets your reason.`,
					field: 'Reason for the testers',
					yes: `Deny (${keys.length})`,
				}
	)
	if (!answer) return tell('Nothing is recorded. The selection stays.')
	tell('Sending…')
	const refused = await post('/permissions/bulk', [
		['csrf', csrf()],
		['return', location.pathname + location.search],
		['decision', action],
		['reason', answer.value ?? ''],
		...keys.map((key) => ['pick', key]),
	])
	if (refused) return tell(refused)
	clearPicks()
	location.reload()
}

function showToast(text) {
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

function showCopy(text, count) {
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

async function copyDefects(claims) {
	const query = claims.map((claim) => `claim=${encodeURIComponent(claim)}`).join('&')
	let text
	try {
		const response = await fetch(`/plans/${encodeURIComponent(review.dataset.plan)}/defects.txt?${query}`, {
			cache: 'no-store',
		})
		if (!response.ok) return tell('Checkmate could not make the text. Nothing is copied.')
		text = await response.text()
	} catch {
		return tell('Checkmate did not answer. Nothing is copied.')
	}
	const count = plural(claims.length, 'defect')
	try {
		await window.navigator.clipboard.writeText(text)
		showToast(`Copied ${count}`)
	} catch {
		showCopy(text, count)
	}
}

async function bulk(action) {
	const back = location.pathname + location.search
	const findings = picked('claim')
	const questions = [...picked('question'), ...picked('gap')]
	const defects = picked('defect')
	if (action === 'clear') {
		clearPicks()
		if (current('list')) mark(current('list'), 'list')
		return tell('The selection is cleared.')
	}
	if (action === 'allow' || action === 'deny') return bulkRequests(action)
	if (action === 'copy') return copyDefects(defects.map((key) => key.split(':').slice(2).join(':')))
	const plans = {
		accept: [findings, 'Accept as defects', `Accept ${plural(findings.length, 'finding')} as defects?`],
		right: [questions, 'Right as built', `Record ${plural(questions.length, 'question')} as right as built?`],
		defer: [questions, 'Defer', `Defer ${plural(questions.length, 'question')}?`],
		handoff: [defects, 'Hand over', `Hand over ${plural(defects.length, 'defect')}?`],
	}
	const [keys, title, text] = plans[action]
	const answer = await ask({ title, text, field: action === 'handoff' ? 'To whom?' : null })
	if (!answer) return tell('Nothing is recorded. The selection stays.')
	tell('Sending…')
	let refused
	if (action === 'handoff') {
		const claims = keys.map((key) => key.split(':').slice(2).join(':'))
		refused = await post(`/plans/${review.dataset.plan}/handoff`, [
			['csrf', csrf()],
			['return', back],
			['to', answer.value],
			...claims.map((claim) => ['claim', claim]),
		])
		if (!refused) keepUndo(claims, answer.value)
	} else {
		const fields =
			action === 'accept'
				? [
						['what', 'claims'],
						['verdict', 'approved'],
					]
				: action === 'right'
					? [
							['what', 'questions'],
							['kind', 'accept_assumption'],
							['value', 'Right as built.'],
						]
					: [
							['what', 'questions'],
							['kind', 'defer'],
						]
		refused = await post('/bulk', [
			['csrf', csrf()],
			['return', back],
			['confirmed', '1'],
			...fields,
			...keys.map((key) => ['pick', key]),
		])
	}
	if (refused) return tell(refused)
	clearPicks()
	location.reload()
}

function showUndo() {
	let kept = null
	try {
		kept = JSON.parse(window.sessionStorage.getItem('checkmate-undo') ?? 'null')
	} catch {}
	if (!kept || kept.until < Date.now() || kept.plan !== review?.dataset.plan) return
	const told = document.querySelector('[data-toast]')
	if (told && !told.textContent.startsWith('Handed ')) {
		try {
			window.sessionStorage.removeItem('checkmate-undo')
		} catch {}
		return
	}
	const note = document.createElement('div')
	note.className = 'toast'
	note.setAttribute('role', 'status')
	note.dataset.undo = ''
	note.innerHTML =
		'<span></span><button type="button" class="sp-btn" data-undo-button><kbd>0</kbd><span>Undo</span></button>'
	const named = kept.claims.length === 1 ? kept.claims[0] : plural(kept.claims.length, 'defect')
	note.querySelector('span').textContent = `Handed ${named} over to ${kept.to}`
	document.querySelector('[data-toast]')?.remove()
	body.append(note)
	dockRoom()
	setTimeout(() => {
		note.remove()
		dockRoom()
		try {
			window.sessionStorage.removeItem('checkmate-undo')
		} catch {}
	}, kept.until - Date.now())
}

async function undo() {
	const note = document.querySelector('[data-undo]')
	if (!note) return
	let kept = null
	try {
		kept = JSON.parse(window.sessionStorage.getItem('checkmate-undo') ?? 'null')
		window.sessionStorage.removeItem('checkmate-undo')
	} catch {}
	note.remove()
	if (!kept) return
	const refused = await post(`/plans/${kept.plan}/handoff`, [
		['csrf', csrf()],
		['return', location.pathname + location.search],
		['undo', '1'],
		...kept.claims.map((claim) => ['claim', claim]),
	])
	if (refused) return tell(refused)
	location.reload()
}

let findTimer = null
let findTicket = 0
let findMode = 'find'
let findAsking = null

function findLinks() {
	return [...findDialog.querySelectorAll('[data-find-results] a')]
}

function findMark(link) {
	for (const each of findLinks()) each.setAttribute('aria-selected', each === link ? 'true' : 'false')
	link?.scrollIntoView({ block: 'nearest' })
	findDialog.querySelector('[data-find-enter]').textContent = link?.matches('[data-find-ask]') ? 'Ask' : 'Go'
}

function askRow(query) {
	const item = document.createElement('li')
	item.setAttribute('role', 'none')
	const link = document.createElement('a')
	link.href = '/requests'
	link.dataset.findAsk = ''
	link.setAttribute('role', 'option')
	link.tabIndex = -1
	const kind = document.createElement('span')
	kind.className = 'sp-pill'
	kind.textContent = 'ask'
	const title = document.createElement('span')
	title.className = 't'
	title.textContent = `Ask Checkmate: ${query}`
	title.title = query
	link.append(kind, title)
	item.append(link)
	return item
}

function findResults(results, query) {
	const list = findDialog.querySelector('[data-find-results]')
	list.replaceChildren(
		...results.map((entry) => {
			const item = document.createElement('li')
			item.setAttribute('role', 'none')
			const link = document.createElement('a')
			link.href = entry.href
			link.setAttribute('role', 'option')
			link.tabIndex = -1
			const kind = document.createElement('span')
			kind.className = 'sp-pill'
			kind.textContent = entry.kind
			const id = document.createElement('span')
			id.className = 'k'
			id.textContent = entry.id
			const title = document.createElement('span')
			title.className = 't'
			title.textContent = entry.title
			title.title = entry.title
			link.append(kind, id, title)
			item.append(link)
			return item
		}),
		...(query ? [askRow(query)] : [])
	)
}

async function findNow() {
	const ticket = ++findTicket
	const query = findDialog.querySelector('[data-find-input]').value.trim()
	if (findAsking) return
	if (findMode === 'ask') {
		findResults([], query)
		findDialog.querySelector('[data-find-none]').hidden = true
		findDialog.querySelector('[data-find-more]').hidden = true
		return findMark(findLinks()[0])
	}
	try {
		const response = await fetch(`/find?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
		const found = await response.json()
		if (ticket !== findTicket || findAsking) return
		findResults(found.results, query)
		findDialog.querySelector('[data-find-none]').hidden = found.results.length > 0 || !query
		const more = findDialog.querySelector('[data-find-more]')
		more.hidden = !found.more
		more.textContent = `${plural(found.more, 'more result')}. Type more words to narrow the list.`
		findMark(findLinks()[0])
	} catch {}
}

function openFind(mode = 'find') {
	if (document.querySelector('dialog[open]')) return
	findMode = mode
	findAsking = null
	findDialog.dataset.mode = mode
	findDialog.querySelector('[data-find-asking]').hidden = true
	findDialog.querySelector('[data-find-error]').hidden = true
	findDialog.querySelector('[data-find-results]').hidden = false
	const input = findDialog.querySelector('[data-find-input]')
	input.readOnly = false
	input.placeholder = mode === 'ask' ? 'Ask a follow-up' : ''
	input.setAttribute(
		'aria-label',
		mode === 'ask' ? 'Ask a follow-up' : 'Find a plan, a defect, or a question. Or type a request.'
	)
	pushLayer('find')
	findDialog.showModal()
	input.focus()
	input.select()
	findNow()
}

async function askNow() {
	const input = findDialog.querySelector('[data-find-input]')
	const text = input.value.trim()
	if (!text || findAsking) return
	findAsking = 'sending'
	const error = findDialog.querySelector('[data-find-error]')
	error.hidden = true
	const send = () =>
		fetch('/requests', {
			method: 'POST',
			body: new URLSearchParams({ csrf: csrf(), text, screen: location.pathname + location.search }),
		})
	try {
		let response = await send()
		if (response.status === 403 && (await renewToken())) response = await send()
		const id =
			response.ok && response.redirected ? /^\/requests\/(R\d+)$/.exec(new URL(response.url).pathname) : null
		if (!id) {
			const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
			throw new Error(
				fresh.querySelector('[role="alert"]')?.textContent?.trim() ||
					'Checkmate refused the request. Nothing is sent.'
			)
		}
		findAsking = id[1]
		input.readOnly = true
		findDialog.querySelector('[data-find-results]').hidden = true
		findDialog.querySelector('[data-find-none]').hidden = true
		findDialog.querySelector('[data-find-more]').hidden = true
		findDialog.querySelector('[data-find-asking]').hidden = false
		findDialog.querySelector('[data-find-asking]').textContent = `Asking… ${id[1]}`
	} catch (problem) {
		findAsking = null
		error.textContent = problem.message
		error.hidden = false
	}
}

findDialog.querySelector('[data-find-input]').addEventListener('input', () => {
	clearTimeout(findTimer)
	findTimer = setTimeout(findNow, 120)
})

findDialog.addEventListener('click', (event) => {
	if (!event.target.closest('[data-find-ask]') || !plainClick(event)) return
	event.preventDefault()
	askNow()
})

document.addEventListener('click', (event) => {
	if (!event.target.closest('[data-ask-follow]') || !plainClick(event)) return
	event.preventDefault()
	openFind('ask')
})

function findKey(event) {
	const links = findLinks()
	const at = links.findIndex((link) => link.getAttribute('aria-selected') === 'true')
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault()
		const next = links[Math.min(links.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]
		return findMark(next)
	}
	if (event.key === 'Enter') {
		event.preventDefault()
		if (findAsking) return
		const query = findDialog.querySelector('[data-find-input]').value.trim()
		if (!query || !links[at]) return
		if (links[at].matches('[data-find-ask]')) return askNow()
		location.assign(links[at].href)
	}
}

const keysDialog = document.querySelector('[data-keys]')
const layers = {
	find: findDialog,
	keys: keysDialog,
	confirm: confirmDialog,
	get act() {
		return actDialog()
	},
}
let quietPop = false
let relayer = null

function pushLayer(name) {
	if (quietPop) relayer = name
	else window.history.pushState({ ...window.history.state, layer: name }, '', location.href)
}

function dropLayer(key, value = null) {
	const held = window.history.state?.[key]
	if (!held || (value && held !== value)) return
	quietPop = true
	window.history.back()
}

for (const [name, dialog] of Object.entries(layers))
	dialog?.addEventListener('close', () => {
		if (!dialog.open && dialog.returnValue !== 'yes') dropLayer('layer', name)
	})

window.addEventListener('popstate', (event) => {
	if (quietPop) {
		quietPop = false
		if (relayer && layers[relayer]?.open) pushLayer(relayer)
		relayer = null
		return event.stopImmediatePropagation()
	}
	const layer = Object.values(layers).find((dialog) => dialog?.open)
	if (layer) {
		layer.close('no')
		return event.stopImmediatePropagation()
	}
	const area = review && document.querySelector('[data-nav][aria-expanded="true"]')
	if (area && !event.state?.area && level === 'nav') {
		const row = current('nav')
		const owner = row?.getAttribute('aria-expanded') === 'true' ? row : (row && areaOf(row)) || area
		expand(owner, false)
		keepAreas()
		mark(owner, 'nav')
		showHints()
		return event.stopImmediatePropagation()
	}
})

function openKeys() {
	if (keysDialog.open) return keysDialog.close()
	pushLayer('keys')
	keysDialog.showModal()
	keysDialog.querySelector('[data-keys-close]').focus()
}

const arrows = (event) => event.key === 'ArrowUp' || event.key === 'ArrowDown'
const down = (event) => (event.key === 'ArrowDown' ? 1 : -1)

const keyTable = [
	{
		cap: '↑↓',
		caps: ['↑', '↓'],
		help: 'Move the highlight through the rows where you are: the plans, the navigator, the records, the files.',
		test: (event) => arrows(event) && !event.shiftKey && rowsAt().length > 0,
		run: (event) => step(down(event)),
		hint: () =>
			rowsAt().length > (level === 'detail' || level === 'viewer' ? 1 : 0)
				? { nav: 'views', list: review ? 'records' : 'rows', detail: 'sub-records', viewer: 'files' }[level]
				: null,
	},
	{
		cap: '→',
		caps: ['→', 'Enter'],
		help: 'Go one step deeper: open the plan, enter the list, open the record, view the file. An area of rules expands.',
		test: (event) => event.key === 'ArrowRight' || event.key === 'Enter',
		run: deeper,
		hint: () => {
			const row = current()
			if (!row) return null
			if (level === 'nav') return row.getAttribute('aria-expanded') === 'false' ? 'expand' : 'enter list'
			if (level === 'detail') return row.dataset.href ? 'view' : null
			if (level === 'viewer') return null
			if (row.classList.contains('many') || row.querySelector(':scope > .asks')) return 'options'
			return row.dataset.href ? 'open' : null
		},
	},
	{
		cap: '←',
		caps: ['←', 'Esc'],
		help: 'Go one step back: close the viewer, close the record, return to the navigator, return to the plans. An area collapses. Esc first clears a selection.',
		test: (event) => event.key === 'ArrowLeft' || event.key === 'Escape',
		run: back,
		hint: () =>
			(level === 'list' && review) || level === 'detail' || level === 'viewer' || body.dataset.back
				? 'back'
				: null,
	},
	{
		caps: ['1', '2', '3', '…', '9'],
		help: 'Choose an option of the highlighted record. The options are numbered from left to right as shown. When records are selected, the numbers act on the selection, and an action on more than one record asks first. On a rule or an area in the navigator, choose a build column; the same number again shows all builds.',
		test: (event) => /^[1-9]$/.test(event.key),
		run: (event) => choose(Number(event.key)),
		hint: () => {
			const selection = bulkOptions().length
			if (selection && (level === 'list' || level === 'nav'))
				return [selection === 1 ? '1' : `1–${selection}`, 'selection']
			if (level === 'nav' && canChoose(current('nav')?.dataset.target)) {
				const count = current('nav').querySelectorAll('[data-mark]').length
				return count ? [count === 1 ? '1' : `1–${count}`, 'builds'] : null
			}
			const count = optionsNow().length
			return count ? [count === 1 ? '1' : `1–${count}`, 'options'] : null
		},
	},
	{
		cap: 'Space',
		caps: ['Space'],
		help: 'Select or unselect the highlighted record, to act on several records at once.',
		test: (event) =>
			event.key === ' ' && !event.shiftKey && Boolean(review) && level === 'list' && listRows().length > 0,
		run: toggleSelect,
		hint: () => (level === 'list' && current()?.dataset.pick ? 'select' : null),
	},
	{
		caps: ['Shift+↑', 'Shift+↓'],
		help: 'Select the records on the way, from the highlighted record.',
		test: (event) => arrows(event) && event.shiftKey && Boolean(review) && level === 'list',
		run: (event) => extend(down(event)),
		hint: () => null,
	},
	{
		cap: '0',
		caps: ['0'],
		help: 'Undo the last hand-over while its note shows. At other times 0 does nothing.',
		test: (event) => event.key === '0',
		run: undo,
		hint: () => (document.querySelector('[data-undo]') ? 'undo' : null),
	},
	{
		cap: '/',
		caps: ['/', 'Ctrl+K'],
		help: 'Find a plan, a defect, or a question, or ask Checkmate. In the find bar, Up and Down move in the results, Enter opens one, Left and Right move the caret, and Esc closes it.',
		test: (event) => event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'),
		run: () => openFind(),
		hint: () => 'find',
	},
	{
		cap: '?',
		caps: ['?'],
		help: 'Show or close this list of keys.',
		test: (event) => event.key === '?',
		run: openKeys,
		hint: () => 'keys',
	},
]

const fieldTable = [
	{ caps: ['Enter'], help: 'Send a one-line answer, a reason, or a name.' },
	{ caps: ['Shift+Enter'], help: 'Start a new line.' },
	{ caps: ['Ctrl+Enter'], help: 'Send a larger form, for example a decision on the plan page.' },
	{ caps: ['Esc'], help: 'Leave the field. The text stays in the field.' },
	{ caps: ['←', '→'], help: 'Move the caret. The arrows do not move the highlight while you type.' },
]

const glyphNames = {
	'●': 'dot',
	'○': 'ring',
	'↑': 'up',
	'↓': 'down',
	'←': 'left',
	'→': 'right',
	'▸': 'closed',
	'▾': 'open',
}
const keyNames = { '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right' }

function glyphHtml(text) {
	return text.replace(/[●○↑↓←→▸▾]/g, (symbol) => {
		const name = keyNames[symbol] ? `<span class="sr-only">${keyNames[symbol]}</span>` : ''
		return `<span class="glyph g-${glyphNames[symbol]}" aria-hidden="true"></span>${name}`
	})
}

function keyCaps(caps) {
	return caps.map((cap) => `<kbd>${glyphHtml(cap)}</kbd>`).join('')
}

function keysTable() {
	const row = (entry) =>
		`<tr><th scope="row"><span class="sp-keyset">${keyCaps(entry.caps)}</span></th><td>${entry.help}</td></tr>`
	return `<table class="sp-ktable">${keyTable.map(row).join('')}<tr><th scope="row" colspan="2" class="sp-kexc">In a text field</th></tr>${fieldTable.map(row).join('')}</table><p class="sp-knote">Tab moves between the regions: the top bar, the navigator, the list, the record, and the status bar. Inside a region the arrows move. Each action also works with the mouse.</p>`
}

document.querySelector('[data-keys-table]').innerHTML = keysTable()

const hints = document.querySelector('[data-hints]')

const hintOrder = ['?', '↑↓', '1', '→', '←', '0', 'Space', '/']

function fitHints() {
	const rank = (hint) => hintOrder.findIndex((cap) => hint.dataset.cap.startsWith(cap))
	const order = [...hints.children].sort((a, b) => rank(b) - rank(a))
	const hintsFit = () => hints.scrollWidth <= hints.clientWidth + 0.5
	const sayFits = () => !say.textContent || (say.offsetWidth > 0 && say.scrollWidth <= say.clientWidth + 0.5)
	const drop = (fits) => {
		for (const hint of order) {
			if (fits()) return true
			if (hint.dataset.cap !== '?') hint.hidden = true
		}
		return fits()
	}
	for (const hint of order) hint.hidden = false
	say.hidden = false
	say.textContent = sayText
	const moved = !drop(() => hintsFit() && sayFits())
	if (moved) {
		for (const hint of order) hint.hidden = false
		say.hidden = true
		say.textContent = ''
		drop(hintsFit)
	}
	const text = moved ? sayText : ''
	if (sayStrip.textContent !== text) sayStrip.textContent = text
	if (sayStrip.hidden !== !text) {
		sayStrip.hidden = !text
		dockRoom()
	}
}

function showHints() {
	const list = []
	if (document.activeElement?.closest?.('[data-field-form]'))
		list.push(['Enter', 'send'], ['Shift+Enter', 'new line'], ['Esc', 'leave'])
	else
		for (const entry of keyTable) {
			const hint = entry.hint()
			if (!hint) continue
			list.push(Array.isArray(hint) ? hint : [entry.cap, hint])
		}
	const source = list
		.map(([cap, text]) =>
			cap === '?'
				? `<button type="button" class="sb-k" data-cap="?" data-keys-open><kbd>?</kbd><span class="sb-kt">${text}</span></button>`
				: `<span class="sb-k" data-cap="${cap}"><kbd>${glyphHtml(cap)}</kbd>${text}</span>`
		)
		.join('')
	if (hints.dataset.source !== source) {
		hints.innerHTML = source
		hints.dataset.source = source
	}
	fitHints()
}

window.addEventListener('resize', () => {
	dockRoom()
	showHints()
	const row = document.querySelector('.hl[data-row]')
	if (row) {
		fitOptions(row)
		padTitle(row)
	}
})

let actFrom = null
let actLast = null

function actDialog() {
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

function firstField(form) {
	return form.querySelector('input:not([type="hidden"]):not([type="radio"])') ?? form.querySelector('button')
}

function openAct(button) {
	const dialog = document.querySelector(`dialog[data-act-dialog="${CSS.escape(button.dataset.act)}"]`)
	if (!dialog || document.querySelector('dialog[open]')) return
	const form = dialog.querySelector('[data-act-form]')
	if (button.dataset.action) form.action = button.dataset.action
	if (button.dataset.title) dialog.querySelector('[data-act-title]').textContent = button.dataset.title
	if (button.dataset.fill) fillAct(form, JSON.parse(button.dataset.fill))
	dialog.querySelector('[data-act-error]').replaceChildren()
	actFrom = document.activeElement
	pushLayer('act')
	dialog.showModal()
	firstField(form).focus()
	showHints()
}

function backFromAct() {
	const from = actFrom
	actFrom = null
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

function closeGone(region, replacement) {
	for (const dialog of region.querySelectorAll('dialog[data-act-dialog][open]')) {
		if (dialog.querySelector('[data-sending]')) continue
		if (replacement.querySelector(`dialog[data-act-dialog="${CSS.escape(dialog.dataset.actDialog)}"]`)) continue
		dialog.close('gone')
		tell(dialog.dataset.gone || 'This changed. Nothing was done.')
	}
}

function actStops(dialog) {
	const stops = [...dialog.querySelectorAll('[data-stop]')].filter((element) => element.getClientRects().length)
	const radios = stops.filter((element) => element.type === 'radio')
	const kept = radios.find((radio) => radio.checked) ?? radios[0]
	return stops.filter((element) => element.type !== 'radio' || element === kept)
}

function actKey(event, dialog) {
	const target = event.target
	const typing = target.matches?.('input[type="text"], input:not([type]), textarea')
	const key = event.key
	if (key === 'Escape') {
		event.preventDefault()
		if (!typing) return dialog.close('no')
		actLast = target
		return target.blur()
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
		const choice = dialog.querySelector(`[data-key-n="${key}"]`)
		if (!choice) return
		event.preventDefault()
		if (choice.matches('input')) {
			choice.checked = true
			choice.focus()
		} else choice.click()
	}
}

function actionsKey(event) {
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

function enterActions() {
	const first = actButtons()[0]
	if (!first) return false
	first.focus()
	tell('Actions of this list. Right moves between them, Enter chooses, Down returns to the list.')
	return true
}

function fitOptions(row) {
	const opts = row.querySelector(':scope > .sp-c-opts[data-fit]')
	if (!opts) return
	row.classList.remove('many')
	const absolute = window.getComputedStyle(opts).position === 'absolute'
	opts.style.width = 'max-content'
	const need = opts.offsetWidth
	opts.style.removeProperty('width')
	const title = row.querySelector(':scope > .sp-c-title')
	const room = absolute ? row.clientWidth - 24 - (title?.offsetLeft ?? 0) - 80 : opts.clientWidth
	row.classList.toggle('many', need > room + 1)
}

document.addEventListener('click', (event) => {
	const button = event.target.closest('[data-act]')
	if (button) {
		event.preventDefault()
		openAct(button)
	}
	if (event.target.closest('[data-act-cancel]')) actDialog()?.close('no')
})

function refuseAt(form, message) {
	const named = form.elements[message.dataset.field ?? '']
	const field = named?.tagName ? named : named?.[0]
	message.dataset.refusal = ''
	if (!field) {
		form.querySelector('[data-act-error]').replaceChildren(message)
		return firstField(form).focus()
	}
	field.closest('details')?.setAttribute('open', '')
	;(field.closest('fieldset') ?? field).after(message)
	field.focus()
}

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
		text.className = 'form-error'
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
			alertText('Checkmate did not answer. Nothing is done. Start the UI again if it stopped, then try again.')
		)
	}
	delete form.dataset.sending
})

document.addEventListener(
	'close',
	(event) => {
		const dialog = event.target
		if (!dialog.matches?.('dialog[data-act-dialog]')) return
		if (!dialog.open && dialog.returnValue !== 'yes') dropLayer('layer', 'act')
		backFromAct()
	},
	true
)

function typingIn(target) {
	return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

function sendKey(event) {
	const owner = event.target.closest?.('form')
	if (!owner) return false
	event.preventDefault()
	if (!owner.reportValidity()) return true
	if (owner.matches('[data-verdict-form]') && !owner.dataset.confirming) {
		owner.querySelector('[data-choose] button')?.focus()
		return true
	}
	owner.requestSubmit(owner.dataset.confirming ? owner.querySelector('[data-confirm-submit]') : undefined)
	return true
}

function fieldKey(event) {
	const target = event.target
	const form = target.closest('[data-field-form]')
	if (event.key === 'Escape') {
		event.preventDefault()
		const row = target.closest('[data-row]')
		if (row) {
			hideExtra(row)
			mark(row, 'list')
		} else target.blur()
		return showHints()
	}
	if (form && event.key === 'Enter' && !event.shiftKey && target.tagName === 'TEXTAREA') {
		event.preventDefault()
		if (!target.value.trim()) return fieldError(target, 'Write the text first, then press Enter.')
		form.requestSubmit()
	}
}

document.addEventListener('keydown', (event) => {
	if (trapViewer(event)) return
	if (viewer && !viewer.hidden) {
		if (event.key === 'Escape' && closeViewer()) event.preventDefault()
		return
	}
	if (confirmDialog.open) return confirmKey(event)
	if (!modifierKeys.includes(event.key) && moveOn()) return event.preventDefault()
	if (actDialog()) return actKey(event, actDialog())
	if (findDialog.open) return findKey(event)
	if (pageForm && !keysDialog.open && pageFormKey(event)) return
	if (keysDialog.open) {
		if (event.key === '?' || event.key === 'ArrowLeft') {
			event.preventDefault()
			keysDialog.close()
		}
		return
	}
	if (event.defaultPrevented || event.altKey) return
	const target = event.target.closest?.('dialog:not([open])') ? body : event.target
	if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && sendKey(event)) return
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
		event.preventDefault()
		return openFind()
	}
	if (typingIn(target)) return fieldKey(event)
	if (event.ctrlKey || event.metaKey) return
	if (target.closest?.('[data-actions]') && actionsKey(event)) return
	const fold = target.matches?.('details.fold > summary') ? target.parentElement : null
	if (fold && (event.key === 'ArrowRight' || (event.key === 'ArrowLeft' && fold.open))) {
		fold.open = event.key === 'ArrowRight'
		return event.preventDefault()
	}
	const menu = document.querySelector('details[data-menu][open]') ?? target.closest?.('details[open]:not(.fold)')
	if (menu && (event.key === 'Escape' || (event.key === 'ArrowLeft' && !menu.matches('[data-menu]')))) {
		menu.open = false
		menu.querySelector('summary').focus()
		return event.preventDefault()
	}
	const inRecords =
		target.closest?.('[data-row], [data-nav], [data-sub], [data-vfile]') || target === body || target.id === 'main'
	if (!inRecords && (event.key === 'Enter' || event.key === ' ')) return
	if (!inRecords && /^Arrow/.test(event.key) && target.closest?.('form, details, .menu-list')) return
	const entry = keyTable.find((each) => each.test(event))
	if (!entry) return
	event.preventDefault()
	setSay('')
	if (!/^[1-9]$/.test(event.key)) gone = null
	entry.run(event)
})

document.addEventListener('focusin', () => showHints())

function plainClick(event) {
	return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0
}

document.addEventListener('click', (event) => {
	const confirmBack = event.target.closest('[data-confirm-back]')
	if (confirmBack) return confirmStop(confirmBack.closest('form'))
	const opener = event.target.closest('a[data-view]')
	if (opener && viewer && plainClick(event)) {
		event.preventDefault()
		return openViewer(opener)
	}
	const zoom = event.target.closest('[data-zoom]')
	if (zoom) zoomViewer(zoom.dataset.zoom)
	if (event.target.matches?.('[data-viewer-image]')) zoomViewer(viewerScale === 0 ? 'actual' : 'fit')
	if (event.target.closest('[data-viewer-close]') || event.target.matches?.('[data-viewer]')) closeViewer()
	if (event.target.closest('[data-keys-open]')) openKeys()
	if (event.target.closest('[data-find-open]')) openFind()
	const bulkButton = event.target.closest('[data-bulk-action]')
	if (bulkButton) bulk(bulkButton.dataset.bulkAction)
	const copy = event.target.closest('[data-copy]')
	if (copy) copyDefects([copy.dataset.copy])
	if (event.target.closest('[data-undo-button]')) undo()
	if (event.target.closest('[data-keys-close]')) keysDialog.close()
	for (const menu of document.querySelectorAll('details[data-menu][open]'))
		if (!menu.contains(event.target)) menu.open = false
})

document.addEventListener('click', (event) => {
	if (event.defaultPrevented) return
	const box = event.target.closest('[data-pick-box]')
	if (box) {
		const row = box.closest('[data-row]')
		level = 'list'
		if (event.shiftKey && anchor) {
			const rows = listRows()
			const from = rows.findIndex((each) => each.dataset.key === anchor)
			const to = rows.indexOf(row)
			for (const each of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) pick(each, true)
		} else {
			pick(row, box.checked)
			anchor = row.dataset.key
		}
		if (review) for (const each of navRows()) each.classList.remove('hl')
		mark(row, 'list')
		showPath()
		showHints()
		return remember()
	}
	const revealer = event.target.closest('[data-reveal]')
	if (revealer && plainClick(event)) {
		event.preventDefault()
		const row = revealer.closest('[data-row]')
		if (!row) return focusField(revealer.dataset.reveal)
		level = 'list'
		mark(row, 'list')
		return showExtra(row, revealer.dataset.reveal)
	}
	if (!plainClick(event)) return
	const markHit = event.target.closest('[data-nav] [data-mark]')
	if (markHit && review) {
		event.preventDefault()
		const row = markHit.closest('[data-nav]')
		level = 'nav'
		if (row.getAttribute('aria-expanded') === 'false') expand(row, true)
		mark(row, 'nav')
		chosenBuild = null
		showView(row.dataset.target)
		chooseBuild([...row.querySelectorAll('[data-mark]')].indexOf(markHit) + 1)
		keepAreas()
		showPath()
		showHints()
		return keysOn()
	}
	const nav = event.target.closest('[data-nav]')
	if (nav && review) {
		if (!hasPanel(nav.dataset.target)) return
		event.preventDefault()
		level = 'nav'
		if (nav.getAttribute('aria-expanded') === 'false') expand(nav, true)
		showView(nav.dataset.target)
		for (const each of listRows()) each.classList.remove('hl')
		mark(nav, 'nav')
		chosenBuild = null
		applyBuild()
		keepAreas()
		showPath()
		showHints()
		keysOn()
		return remember()
	}
	const vfile = event.target.closest('[data-vfile]')
	if (vfile) {
		event.preventDefault()
		mark(vfile, 'viewer')
		showFile(vfile)
		return showHints()
	}
	const sub = event.target.closest('[data-drawer]')
	if (sub && level !== 'detail' && !event.target.closest('a, button, input, textarea, select')) {
		level = 'detail'
		mark(event.target.closest('[data-sub]') ?? rowsAt('detail')[0], 'detail')
		return showHints()
	}
	const row = event.target.closest('[data-row]')
	if (!row || event.target.closest('a, button, input, textarea, label, select, form')) return
	level = 'list'
	if (review) for (const each of navRows()) each.classList.remove('hl')
	mark(row, 'list')
	remember()
	open(row)
})

function sendFailed(form) {
	sending = false
	let message = form.querySelector('[data-send-error]')
	if (!message) {
		message = document.createElement('p')
		message.className = 'form-error'
		message.setAttribute('role', 'alert')
		message.dataset.sendError = ''
		form.append(message)
	}
	message.textContent =
		'Checkmate did not answer. Nothing is recorded, and your text is kept. Start the UI again if it stopped, then send again.'
	announce(message.textContent)
	tell('Not sent.')
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
		sending = false
		window.HTMLFormElement.prototype.submit.call(form)
	} catch {
		sendFailed(form)
	}
}

document.addEventListener('click', async (event) => {
	const button = event.target.closest('[data-ask-title]')
	if (!button || sending) return
	event.preventDefault()
	const answer = await ask({
		title: button.dataset.askTitle,
		text: button.dataset.askText,
		yes: button.dataset.askYes,
	})
	if (!answer) return tell('Nothing is recorded.')
	button.form.requestSubmit(button)
})

const modifierKeys = ['Shift', 'Control', 'Alt', 'Meta']
let movingOn = null

function moveOn() {
	const moving = document.querySelector('[data-moves-on]')
	if (!moving) return false
	clearTimeout(movingOn)
	movingOn = null
	location.replace(moving.dataset.next)
	return true
}

function watchMoveOn() {
	if (movingOn || !document.querySelector('[data-moves-on]')) return
	movingOn = setTimeout(moveOn, 2000)
}

watchMoveOn()

document.addEventListener('submit', (event) => {
	if (event.defaultPrevented) return
	const form = event.target
	const row = form.closest('[data-row]')
	const record = form.closest('[data-drawer]')
	if (!row && !record) return
	event.preventDefault()
	if (sending) return
	sending = true
	const field = form.querySelector('[data-return]')
	const stays = form.getAttribute('action').endsWith('/handoff')
	if (field && review) field.value = row ? returnTo(row, stays) : recordReturn(stays)
	form.querySelector('[data-send-error]')?.remove()
	tell('Sending…')
	send(form, event.submitter)
})

window.addEventListener('pageshow', () => {
	sending = false
})

window.addEventListener('popstate', () => {
	if (!review) return
	const url = new URL(location.href)
	level = url.searchParams.get('focus') === 'list' ? 'list' : 'nav'
	chosenBuild = url.searchParams.get('build')
	const view = url.searchParams.get('view')
	if (hasPanel(view)) showView(view)
	const row = listRows().find((each) => each.dataset.key === url.searchParams.get('at'))
	if (level === 'list' && row) mark(row, 'list')
	settle()
})

function normalize(text) {
	return text
		.replace(/<time[^>]*>[\s\S]*?<\/time>/g, '')
		.replace(/(data-since="[^"]*">)[^<]*/g, '$1')
		.replace(/ (class|tabindex|aria-selected|aria-expanded)="[^"]*"/g, '')
		.replace(/ hidden(="")?/g, '')
		.replace(/\s+/g, ' ')
}

function dirty(region) {
	if (region.querySelector('dialog[open]')) return true
	if (region.querySelector('form[data-confirming]')) return true
	for (const field of region.querySelectorAll('textarea, input, select')) {
		if (field.type === 'hidden' || field.matches('[data-pick-box]')) continue
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

function replaceRegion(region, fresh, previous) {
	const before = keyed(previous ?? region)
	const opened = new Map(
		[...region.querySelectorAll('details[data-open-key]')].map((details) => [details.dataset.openKey, details.open])
	)
	const focusedKey = region.contains(document.activeElement)
		? (document.activeElement?.closest?.('[data-key]')?.dataset.key ?? null)
		: null
	const focusedId = region.contains(document.activeElement) ? document.activeElement.id : null
	const view = currentView()
	const navKey = current('nav')?.dataset.target
	const keyOf = (row) => row?.closest('[data-key]')?.dataset.key
	const rowKey = keyOf(current('list'))
	const rowLabel = current('list')?.dataset.label
	const rowAsk = current('list')?.dataset.ask ?? ''
	const rowTop = current('list')?.getBoundingClientRect().top ?? 0
	const order = listRows().map(keyOf)
	const areas = [...document.querySelectorAll('[data-nav][aria-expanded="true"]')].map((row) => row.dataset.label)
	const actFocus = document.activeElement?.closest?.('[data-actions]') ? document.activeElement.dataset.act : null
	const next = document.importNode(fresh, true)
	for (const details of next.querySelectorAll('details[data-open-key]'))
		if (opened.has(details.dataset.openKey)) details.open = opened.get(details.dataset.openKey)
	const scrolled = region.scrollTop
	const detailMarked = level === 'detail' && region.matches('[data-drawer]')
	region.replaceWith(next)
	next.scrollTop = scrolled
	if (next.matches('[data-drawer]')) drawer = next
	if (review) {
		for (const area of document.querySelectorAll('[data-nav][aria-expanded]'))
			expand(area, areas.includes(area.dataset.label))
		if (view) showView(view)
		if (level === 'nav') mark(navRows().find((row) => row.dataset.target === navKey) ?? navRows()[0], 'nav')
	}
	const onRow = review || document.activeElement === body || focusedKey === rowKey
	if (level === 'list' && rowKey && onRow && !current('list')) {
		const rows = listRows()
		const kept = rows.find((row) => keyOf(row) === rowKey)
		if (kept) {
			const shift = kept.getBoundingClientRect().top - rowTop
			if (Math.abs(shift) > 1) window.scrollBy(0, shift)
			mark(kept, 'list')
			if ((kept.dataset.ask ?? '') !== rowAsk) {
				gone = `The request of ${rowLabel} changed.`
				tell(gone)
			}
		} else {
			const at = order.indexOf(rowKey)
			const next = [...order.slice(at + 1), ...order.slice(0, at).reverse()]
				.map((key) => rows.find((row) => keyOf(row) === key))
				.find(Boolean)
			mark(next ?? rows[0], 'list')
			if (review) {
				const what = rowKey.startsWith('c:')
					? 'was decided in another session'
					: rowKey.startsWith('perm:')
						? 'was answered or closed'
						: 'was answered in another session'
				gone = `${rowLabel} ${what}.`
				tell(gone)
			}
		}
		if (review) remember()
	} else if (!review && focusedId && document.getElementById(focusedId)) document.getElementById(focusedId).focus()
	else if (!review && focusedKey) {
		const owner = document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)
		const target = owner?.matches('[data-row]') ? owner : owner?.querySelector('a, summary')
		target?.focus({ preventScroll: true })
	}
	if (actFocus) document.querySelector(`[data-actions] button[data-act="${CSS.escape(actFocus)}"]`)?.focus()
	if (detailMarked && next.matches('[data-drawer]')) mark(rowsAt('detail')[0], 'detail')
	const messages = markChanged(before, next)
	syncRationale(next)
	syncSource(next)
	return messages
}

let refreshing = false
let again = false

async function refresh() {
	if (refreshing || sending) return void (again = true)
	refreshing = true
	try {
		const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
		if (!response.ok) return
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (sending) return void (again = true)
		const messages = []
		for (const region of [...document.querySelectorAll('[data-region]')]) {
			const name = region.dataset.region
			const replacement = fresh.querySelector(`[data-region="${name}"]`)
			const previous = served.get(name)
			if (!replacement && region.matches('[data-drawer]')) {
				staleNotice(region, {
					dataset: { decidedMessage: 'This item does not wait for you now. Somebody decided it.' },
				})
				continue
			}
			if (!replacement || (previous && normalize(previous.outerHTML) === normalize(replacement.outerHTML)))
				continue
			closeGone(region, replacement)
			if (dirty(region)) {
				staleNotice(region, replacement)
				continue
			}
			messages.push(...replaceRegion(region, replacement, previous))
			served.set(name, replacement.cloneNode(true))
		}
		if (!review) document.title = fresh.title
		if (messages.length) announce(messages.join('. '))
		showHints()
		watchMoveOn()
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
	live.innerHTML = `${glyphHtml(up ? '●' : '○')} ${up ? 'Live' : 'Reconnecting'}`
}

function connect() {
	if (source || !body.dataset.subjects || !window.EventSource) return
	const subjects = encodeURIComponent(body.dataset.subjects)
	source = new EventSource(`/events?subjects=${subjects}&after=${encodeURIComponent(last)}`)
	source.onopen = () => {
		if (live.classList.contains('down')) renewToken().catch(() => {})
		setLive(true)
	}
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
		showHints()
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

function brokenImage(image) {
	image.hidden = true
	image.nextElementSibling.hidden = false
}

document.addEventListener(
	'error',
	(event) => {
		if (event.target.matches?.('[data-ev-image]')) brokenImage(event.target)
	},
	true
)

for (const image of document.querySelectorAll('[data-ev-image]'))
	if (image.complete && !image.naturalWidth) brokenImage(image)

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
		setTimeout(
			() => {
				toast.remove()
				dockRoom()
			},
			reducedMotion.matches ? 0 : 320
		)
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

document.querySelector('[data-keys-open]').hidden = false
const docked = new window.ResizeObserver(() => dockRoom())
for (const element of document.querySelectorAll('[data-bulk], [data-say-strip]')) docked.observe(element)
dockRoom()
document.querySelector('[data-find-open]').hidden = false
showUndo()
if (review && chosenBuild) applyBuild()
syncRationale()
syncSource()
openTarget()
restoreAreas()
if (location.hash === '#decide' || location.hash === '#answer')
	window.addEventListener('load', () => window.requestAnimationFrame(focusDecision), { once: true })
else if (review || drawer || listRows().length) settle()
else showHints()
if (!review && !drawer && !listRows().length)
	window.addEventListener('load', () => placeAlert() || focusTarget(), { once: true })
connect()

const pageForm = document.querySelector('form[data-page-form]')

function forgetDrafts(form) {
	for (const field of form.querySelectorAll('textarea, input'))
		try {
			if (field.name) window.sessionStorage.removeItem(draftKey(field))
		} catch {}
}

async function confirmAddress(form) {
	const select = form.elements.target
	const marked = select?.selectedOptions?.[0] ?? select
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
			if (seen.has(element.name)) return false
			seen.add(element.name)
			return true
		})
		.map((element) =>
			element.type === 'radio'
				? (pageForm.querySelector(`input[name="${element.name}"]:checked`) ?? element)
				: element
		)
}

function onFirstLine(area) {
	return !area.value.slice(0, area.selectionStart).includes('\n')
}

function onLastLine(area) {
	return !area.value.slice(area.selectionEnd).includes('\n')
}

function pageFormKey(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return false
	const target = event.target
	const inside = pageForm.contains(target) || target === body || target.id === 'main'
	if (!inside) return false
	const key = event.key
	const stops = pageStops()
	const own = target.type === 'radio' ? stops.find((stop) => stop.name === target.name) : target
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
		const group = [...pageForm.querySelectorAll(`input[name="${target.name}"]`)]
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

const ticketFile = document.querySelector('[data-ticket-file]')

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

const setupUrl = document.querySelector('[data-setup-url]')

if (setupUrl) {
	const assumed = pageForm.querySelector('[data-assumed]')
	const list = pageForm.querySelector('[data-assumed-list]')
	const help = pageForm.querySelector('[data-operations-help]')
	const target = pageForm.elements.target
	const radios = [...pageForm.querySelectorAll('input[name="operations"]')]
	let sequence = 0
	let timer = null
	let automatic = false
	const preview = async () => {
		const mine = ++sequence
		const data = new URLSearchParams({ csrf: csrf(), url: setupUrl.value })
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
			help.textContent = reply.error ?? 'Type the address first.'
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
	if (setupUrl.value.trim()) preview()
}
