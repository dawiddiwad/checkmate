import { glyphHtml } from './format.js'
import { current, currentView, navRows, panel } from './navigation.js'
import { chatNavigator, planChat, review, state, viewerPane } from './page-state.js'
import { applyPicks } from './picks.js'
import { tell } from './status-bar.js'

function storeKey() {
	return `checkmate-areas:${review?.dataset.plan ?? planChat?.dataset.planChat ?? ''}`
}

function storedAreas() {
	try {
		const kept = window.localStorage.getItem(storeKey())
		return kept === null ? null : JSON.parse(kept)
	} catch {
		return null
	}
}

export function keepAreas() {
	const open = [...document.querySelectorAll('[data-nav][aria-expanded="true"]')].map((row) => row.dataset.label)
	try {
		window.localStorage.setItem(storeKey(), JSON.stringify(open))
	} catch {}
}

function areaRules(area) {
	return [...document.querySelectorAll(`[data-in-area="${CSS.escape(area.dataset.label)}"]`)]
}

export function expand(row, open) {
	row.setAttribute('aria-expanded', open ? 'true' : 'false')
	row.querySelector('.sp-nid').innerHTML = glyphHtml(open ? '▾' : '▸')
	for (const rule of areaRules(row)) rule.hidden = !open
}

export function areaOf(row) {
	return row.dataset.inArea
		? document.querySelector(`[data-nav][aria-expanded][data-label="${CSS.escape(row.dataset.inArea)}"]`)
		: null
}

export function restoreAreas() {
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

export function remember() {
	if (!review || state.drawer || viewerPane) return
	const url = new URL(location.href)
	url.searchParams.set('view', currentView() ?? 'needs')
	url.searchParams.delete('nav')
	const row = current('list')
	if (row) url.searchParams.set('at', row.dataset.key)
	else url.searchParams.delete('at')
	url.searchParams.set('focus', state.level)
	if (state.chosenBuild && canChoose(currentView())) url.searchParams.set('build', state.chosenBuild)
	else url.searchParams.delete('build')
	window.history.replaceState(window.history.state, '', url.pathname + url.search)
}

export function canChoose(view) {
	return Boolean(view && (view.startsWith('rule:') || view.startsWith('area:')))
}

export function applyBuild() {
	const view = currentView()
	const build = canChoose(view) ? state.chosenBuild : null
	for (const row of document.querySelectorAll('[data-panel] [data-row]'))
		row.hidden =
			Boolean(build) &&
			row.closest('[data-panel]').dataset.panel === view &&
			!JSON.parse(row.dataset.builds ?? '[]').includes(build)
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

export function chooseBuild(n) {
	const row = current('nav')
	if (!canChoose(row?.dataset.target)) return tell('Numbers choose a build column on a rule or an area.')
	const marks = [...row.querySelectorAll('[data-mark]')]
	const mark = marks[n - 1]
	if (!mark) return tell(`The build columns go from 1 to ${marks.length}.`)
	if (chatNavigator) {
		const destination = new URL(row.href)
		destination.searchParams.set('build', mark.dataset.mark)
		return location.assign(destination.href)
	}
	state.chosenBuild = state.chosenBuild === mark.dataset.mark ? null : mark.dataset.mark
	if (currentView() !== row.dataset.target) showView(row.dataset.target)
	applyBuild()
	remember()
	tell(
		state.chosenBuild ? `${row.dataset.label} on build ${state.chosenBuild}` : `${row.dataset.label} on all builds`
	)
}

export function showView(view) {
	if (!review) return
	const chats = document.querySelector('[data-nav][data-target="chats"]')
	if (chats) {
		const destination = new URL(chats.href)
		destination.searchParams.set('view', view)
		chats.href = destination.href
	}
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

export function hasPanel(view) {
	return Boolean(view && document.querySelector(`[data-panel="${CSS.escape(view)}"]`))
}
