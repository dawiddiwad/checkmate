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
let sayTimer = null

function tell(text) {
	say.textContent = text
	clearTimeout(sayTimer)
	sayTimer = setTimeout(() => (say.textContent = ''), 4000)
}

const review = document.querySelector('[data-review]')
const drawer = document.querySelector('[data-drawer]')
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
	return !element.hidden && !element.closest('[hidden]')
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
	padTitle(row)
	row.focus({ preventScroll: true })
	row.scrollIntoView({ block: 'nearest' })
}

function padTitle(row) {
	const options = row.querySelector(':scope > .sp-c-opts')
	if (!options || window.getComputedStyle(options).position !== 'absolute')
		return row.style.removeProperty('--title-pad')
	const meta = row.querySelector(':scope > .sp-c-meta')
	const beside = meta && window.getComputedStyle(meta).display !== 'none' ? meta.offsetWidth + 12 : 0
	row.style.setProperty('--title-pad', `${Math.max(0, options.offsetWidth + 12 - beside)}px`)
}

function floatRoom() {
	const floating = [document.querySelector('[data-bulk]:not([hidden])'), document.querySelector('.toast')]
		.filter(Boolean)
		.map((element) => element.offsetHeight + 16)
	document.documentElement.style.setProperty('--float-h', `${Math.max(0, ...floating)}px`)
	const row = document.querySelector('.hl[data-row]')
	if (row) row.scrollIntoView({ block: 'nearest' })
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
	for (const each of document.querySelectorAll('[data-panel]')) each.hidden = each.dataset.panel !== view
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
	const wanted = address.searchParams.get('at')
	return (
		rows.find((row) => row.dataset.key === wanted) ??
		rows.find((row) => row.classList.contains('cur')) ??
		rows.find((row) => 'needs' in row.dataset) ??
		rows[0]
	)
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
		const view = currentView()
		const row = navRows().find((each) => each.dataset.target === view) ?? navRows()[0]
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
	if (!startRow()) return tell('Nothing here.')
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
			return showHints()
		}
		const area = row && areaOf(row)
		if (area) {
			expand(area, false)
			keepAreas()
			mark(area)
			if (hasPanel(area.dataset.target)) showView(area.dataset.target)
			showPath()
			showHints()
			return remember()
		}
	}
	if (body.dataset.back) return void location.assign(body.dataset.back)
	tell('This is the first page.')
}

function optionsNow() {
	if (level === 'detail') return [...drawer.querySelectorAll('.sp-dhead [data-option]')]
	const row = level === 'list' ? current('list') : null
	return row ? [...row.querySelectorAll('[data-option]')] : []
}

function nextKey(row) {
	const rows = listRows()
	const at = rows.indexOf(row)
	const later = [...rows.slice(at + 1), ...rows.slice(0, at)]
	const next = later.find((each) => 'needs' in each.dataset) ?? rows[at + 1] ?? rows[at - 1]
	return next?.dataset.key ?? null
}

function returnTo(row) {
	const url = new URL(location.href)
	url.searchParams.set('view', currentView() ?? 'needs')
	const key = nextKey(row)
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
	const selection = bulkOptions()
	if (selection.length && (level === 'list' || level === 'nav')) {
		const option = selection[n - 1]
		return option ? option.click() : tell(`The options go from 1 to ${selection.length}.`)
	}
	if (level === 'nav' && review) return chooseBuild(n)
	const options = optionsNow()
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
	if (was !== bulkBar.hidden) window.requestAnimationFrame(floatRoom)
	if (!picks.size) return
	const findings = picked('claim').length
	const questions = picked('question').length + picked('gap').length
	const defects = picked('defect').length
	const labels = {
		accept: findings ? `Accept ${plural(findings, 'finding')} as defects` : null,
		right: questions ? `${plural(questions, 'question')} right as built` : null,
		defer: questions ? `Defer ${plural(questions, 'question')}` : null,
		handoff: defects ? `Hand over ${plural(defects, 'defect')}` : null,
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

function ask({ title, text, field = null }) {
	return new Promise((resolve) => {
		confirmDialog.querySelector('[data-confirm-title]').textContent = title
		confirmDialog.querySelector('[data-confirm-text]').textContent = text
		const box = confirmDialog.querySelector('[data-confirm-field]')
		const input = box.querySelector('input')
		box.hidden = !field
		input.value = ''
		input.required = Boolean(field)
		if (field) box.querySelector('label').textContent = field
		confirmDialog.returnValue = ''
		confirmDialog.showModal()
		if (field) input.focus()
		else confirmDialog.querySelector('[data-confirm-yes]').focus()
		confirmDialog.addEventListener(
			'close',
			() => resolve(confirmDialog.returnValue === 'yes' ? { value: input.value.trim() } : null),
			{ once: true }
		)
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

async function bulk(action) {
	const back = location.pathname + location.search
	const findings = picked('claim')
	const questions = [...picked('question'), ...picked('gap')]
	const defects = picked('defect')
	if (action === 'clear') {
		clearPicks()
		return tell('The selection is cleared.')
	}
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
	floatRoom()
	setTimeout(() => {
		note.remove()
		floatRoom()
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

function findLinks() {
	return [...findDialog.querySelectorAll('[data-find-results] a')]
}

function findMark(link) {
	for (const each of findLinks()) each.setAttribute('aria-selected', each === link ? 'true' : 'false')
	link?.scrollIntoView({ block: 'nearest' })
}

async function findNow() {
	const ticket = ++findTicket
	const query = findDialog.querySelector('[data-find-input]').value
	try {
		const response = await fetch(`/find?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
		const found = await response.json()
		if (ticket !== findTicket) return
		const list = findDialog.querySelector('[data-find-results]')
		list.replaceChildren(
			...found.results.map((entry) => {
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
			})
		)
		findDialog.querySelector('[data-find-none]').hidden = found.results.length > 0
		const more = findDialog.querySelector('[data-find-more]')
		more.hidden = !found.more
		more.textContent = `${plural(found.more, 'more result')}. Type more words to narrow the list.`
		findMark(findLinks()[0])
	} catch {}
}

function openFind() {
	if (document.querySelector('dialog[open]')) return
	findDialog.showModal()
	const input = findDialog.querySelector('[data-find-input]')
	input.focus()
	input.select()
	findNow()
}

findDialog.querySelector('[data-find-input]').addEventListener('input', () => {
	clearTimeout(findTimer)
	findTimer = setTimeout(findNow, 120)
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
		const query = findDialog.querySelector('[data-find-input]').value.trim()
		if (query && links[at]) location.assign(links[at].href)
	}
}

const keysDialog = document.querySelector('[data-keys]')

function openKeys() {
	if (keysDialog.open) return keysDialog.close()
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
		help: 'Find a plan, a defect, or a question. In the find bar, Up and Down move in the results, Enter opens one, Left and Right move the caret, and Esc closes it.',
		test: (event) => event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'),
		run: openFind,
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
	const shown = [...hints.children].sort((a, b) => rank(b) - rank(a))
	for (const hint of shown) {
		if (hints.scrollWidth <= hints.clientWidth + 0.5) return
		if (hint.dataset.cap !== '?') hint.hidden = true
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
	hints.innerHTML = list
		.map(([cap, text]) =>
			cap === '?'
				? `<button type="button" class="sb-k" data-cap="?" data-keys-open><kbd>?</kbd>${text}</button>`
				: `<span class="sb-k" data-cap="${cap}"><kbd>${glyphHtml(cap)}</kbd>${text}</span>`
		)
		.join('')
	fitHints()
}

window.addEventListener('resize', () => {
	showHints()
	const row = document.querySelector('.hl[data-row]')
	if (row) padTitle(row)
})

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
	if (findDialog.open) return findKey(event)
	if (keysDialog.open) {
		if (event.key === '?' || event.key === 'ArrowLeft') {
			event.preventDefault()
			keysDialog.close()
		}
		return
	}
	if (event.defaultPrevented || event.altKey) return
	const target = event.target
	if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && sendKey(event)) return
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
		event.preventDefault()
		return openFind()
	}
	if (typingIn(target)) return fieldKey(event)
	if (event.ctrlKey || event.metaKey) return
	const menu = document.querySelector('details[data-menu][open]')
	if (menu && event.key === 'Escape') {
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
	say.textContent = ''
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
			return location.assign(response.url)
		}
		sending = false
		window.HTMLFormElement.prototype.submit.call(form)
	} catch {
		sendFailed(form)
	}
}

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
	if (field && row) field.value = returnTo(row)
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
	const focusedKey = document.activeElement?.closest?.('[data-key]')?.dataset.key ?? null
	const focusedId = region.contains(document.activeElement) ? document.activeElement.id : null
	const view = currentView()
	const navKey = current('nav')?.dataset.target
	const rowKey = current('list')?.dataset.key
	const rowLabel = current('list')?.dataset.label
	const order = listRows().map((row) => row.dataset.key)
	const areas = [...document.querySelectorAll('[data-nav][aria-expanded="true"]')].map((row) => row.dataset.label)
	const next = document.importNode(fresh, true)
	for (const details of next.querySelectorAll('details[data-open-key]'))
		if (opened.has(details.dataset.openKey)) details.open = opened.get(details.dataset.openKey)
	const scrolled = region.scrollTop
	region.replaceWith(next)
	next.scrollTop = scrolled
	if (review) {
		for (const area of document.querySelectorAll('[data-nav][aria-expanded]'))
			expand(area, areas.includes(area.dataset.label))
		if (view) showView(view)
		if (level === 'nav') mark(navRows().find((row) => row.dataset.target === navKey) ?? navRows()[0], 'nav')
		else if (level === 'list') {
			const rows = listRows()
			const kept = rows.find((row) => row.dataset.key === rowKey)
			if (kept) mark(kept, 'list')
			else {
				const at = order.indexOf(rowKey)
				const next = [...order.slice(at + 1), ...order.slice(0, at).reverse()]
					.map((key) => rows.find((row) => row.dataset.key === key))
					.find(Boolean)
				mark(next ?? rows[0], 'list')
				if (rowKey)
					tell(`${rowLabel} ${rowKey.startsWith('c:') ? 'was decided' : 'was answered'} in another session.`)
			}
			remember()
		}
	} else if (focusedId && document.getElementById(focusedId)) document.getElementById(focusedId).focus()
	else if (focusedKey) {
		const owner = document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)
		const target = owner?.matches('[data-row]') ? owner : owner?.querySelector('a, summary')
		target?.focus({ preventScroll: true })
	}
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
				floatRoom()
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
floatRoom()
document.querySelector('[data-find-open]').hidden = false
showUndo()
if (review && chosenBuild) applyBuild()
syncRationale()
syncSource()
openTarget()
restoreAreas()
if (location.hash === '#decide' || location.hash === '#answer')
	window.addEventListener('load', () => window.requestAnimationFrame(focusDecision), { once: true })
else if (review || listRows().length) settle()
else showHints()
connect()
