import { enterActions } from './actions.js'
import { focusField, showExtra } from './drawer.js'
import { leavePage } from './forms.js'
import { dropLayer } from './layers.js'
import {
	applyBuild,
	areaOf,
	canChoose,
	chooseBuild,
	expand,
	hasPanel,
	keepAreas,
	remember,
	showView,
} from './navigator.js'
import { address, body, chatNavigator, chatPage, chatView, picks, review, state, viewerPane } from './page-state.js'
import { clearPicks, keepReviewPicks, pick } from './picks.js'
import { showHints, showPath, tell } from './status-bar.js'

export function shown(element) {
	return !element.hidden && !element.closest('[hidden], details:not([open], [data-menu]) > :not(summary)')
}

export function navRows() {
	return [...document.querySelectorAll('[data-nav]')].filter(shown)
}

export function panel() {
	return document.querySelector('[data-panel]:not([hidden])')
}

export function listRows() {
	const root = chatPage ? chatPage.querySelector(`[data-chat-lane="${state.chatLane}"]`) : review ? panel() : document
	return root ? [...root.querySelectorAll('[data-row]')].filter(shown) : []
}

export function rowsAt(where = state.level) {
	if (where === 'viewer') return [...document.querySelectorAll('[data-vfile]')]
	if (where === 'detail') return [...state.drawer.querySelectorAll('[data-sub]')].filter(shown)
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

export function current(where = state.level) {
	return rowsAt(where).find((row) => row.classList.contains('hl')) ?? null
}

export function currentView() {
	return panel()?.dataset.panel ?? null
}

function keysOn() {
	document
		.querySelector('[data-navigator]')
		?.classList.toggle('keys-on', state.level === 'nav' && canChoose(current('nav')?.dataset.target))
}

const zones = { nav: '[data-nav]', list: '[data-row]', detail: '[data-sub]', viewer: '[data-vfile]' }

export function highlight(row, where = state.level) {
	const rows = chatPage && where === 'list' ? listRows() : document.querySelectorAll(zones[where])
	for (const other of rows) {
		other.classList.toggle('hl', other === row)
		other.tabIndex = other === row ? 0 : -1
	}
	if (!row) return
	if (chatView === 'list' && where === 'list') state.chatListAt = row.dataset.key
	fitOptions(row)
	padTitle(row)
}

export function mark(row, where = state.level) {
	highlight(row, where)
	if (!row) return
	row.focus({ preventScroll: true })
	reveal(row)
}

export function reveal(row) {
	row.scrollIntoView({ block: 'nearest' })
	const strip = row.matches('[data-nav]')
		? 0
		: parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 0
	const top = strip
	if (row.getBoundingClientRect().top < top) row.scrollIntoView({ block: 'start' })
}

export function padTitle(row) {
	const options = row.querySelector(':scope > .sp-c-opts')
	if (!options || window.getComputedStyle(options).position !== 'absolute')
		return row.style.removeProperty('--title-pad')
	const meta = row.querySelector(':scope > .sp-c-meta')
	const beside = meta && window.getComputedStyle(meta).display !== 'none' ? meta.offsetWidth + 12 : 0
	row.style.setProperty('--title-pad', `${Math.max(0, options.offsetWidth + 12 - beside)}px`)
}

function startRow() {
	const rows = listRows()
	const wanted =
		chatView === 'list' ? state.chatListAt : (address.searchParams.get('at') ?? address.searchParams.get('item'))
	if (location.hash === '#last') return rows.at(-1)
	return (
		rows.find((row) => row.dataset.key === wanted) ??
		rows.find((row) => row.classList.contains('cur')) ??
		rows.find((row) => 'needs' in row.dataset) ??
		(chatView === 'thread' ? rows.at(-1) : rows[0])
	)
}

export function focusTarget() {
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

export function settle() {
	keysOnLater()
	if (state.level === 'viewer' || state.level === 'detail') {
		const open = review?.dataset.open
		const listed = open && listRows().find((row) => row.dataset.key === open)
		if (listed) {
			listed.classList.add('cur')
			listed.scrollIntoView({ block: 'nearest' })
		}
		const rows = rowsAt()
		mark(rows.find((row) => row.classList.contains('hl')) ?? rows[0], state.level)
		const field = state.drawer?.querySelector('.form-error')
			? state.drawer.querySelector('[data-field-form] textarea')
			: null
		const asked = location.hash && state.drawer?.querySelector(`${CSS.escape(location.hash)} textarea`)
		const typing = field || asked
		if (typing) {
			typing.focus()
			typing.setSelectionRange(typing.value.length, typing.value.length)
		}
		showPath()
		return showHints()
	}
	if (state.level === 'nav') {
		const wanted = chatNavigator ? 'chats' : (address.searchParams.get('nav') ?? currentView())
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
			state.level = 'nav'
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

export function step(by) {
	const rows = rowsAt()
	if (!rows.length) return
	const index = rows.indexOf(current())
	const next = index < 0 ? 0 : index + by
	const region = !review && state.level === 'list' ? current()?.closest('[data-list-region]') : null
	const turn = region?.querySelector(`a[rel="${by > 0 ? 'next' : 'prev'}"]`)
	if ((next < 0 || next >= rows.length) && turn) return void location.assign(turn.href + (by > 0 ? '' : '#last'))
	if (next < 0 && state.level === 'list' && enterActions()) return
	if (next < 0 || next >= rows.length) return tell(by > 0 ? 'This is the last row.' : 'This is the first row.')
	mark(rows[next])
	if (state.level === 'viewer') showFile(rows[next])
	state.anchor = null
	state.rangeBase = null
	if (state.level === 'nav') {
		if (hasPanel(rows[next].dataset.target)) {
			state.chosenBuild = null
			showView(rows[next].dataset.target)
		}
		keysOn()
	}
	state.anchor = null
	showPath()
	showHints()
	remember()
}

function enterList() {
	if (state.chosenBuild) {
		state.chosenBuild = null
		applyBuild()
	}
	if (!startRow()) return enterActions() || tell('Nothing here.')
	if (review) window.history.pushState({ level: 'list' }, '', location.pathname + location.search)
	state.level = 'list'
	settle()
}

function open(row) {
	if (!row?.dataset.href) return tell('Nothing deeper.')
	keepReviewPicks()
	location.assign(row.dataset.href)
}

export function deeper() {
	const row = current()
	if (state.level === 'viewer') return tell('Nothing deeper.')
	if (state.level === 'detail') return row?.dataset.href ? location.assign(row.dataset.href) : tell('Nothing deeper.')
	if (state.level === 'nav') {
		if (!row) return
		if (row.getAttribute('aria-expanded') === 'false') {
			expand(row, true)
			keepAreas()
			window.history.pushState({ ...window.history.state, area: row.dataset.label }, '', location.href)
			return showHints()
		}
		if (chatNavigator && row.dataset.target === 'chats') return enterList()
		if (!hasPanel(row.dataset.target)) return void location.assign(row.href)
		return enterList()
	}
	open(row)
}

export function back(event) {
	if (state.level === 'viewer') return leave(viewerPane.dataset.back)
	if (state.level === 'detail') return leave(state.drawer.dataset.back)
	if (event.key === 'Escape' && picks.size) {
		clearPicks()
		return tell('The selection is cleared.')
	}
	if (state.level === 'list' && chatNavigator) {
		state.level = 'nav'
		return settle()
	}
	if (state.level === 'list' && review) {
		if (window.history.state?.level === 'list') return window.history.back()
		state.level = 'nav'
		return settle()
	}
	if (state.level === 'nav') {
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

export function fitOptions(row) {
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

export function plainClick(event) {
	return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0
}

export function openTarget() {
	if (!location.hash) return
	const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
	const details = target?.closest('details')
	if (details && !details.open) details.open = true
}

export function focusDecision() {
	if (location.hash !== '#decide' && location.hash !== '#answer') return
	document.querySelector(`${location.hash} textarea, ${location.hash} input:not([type="hidden"])`)?.focus()
}

export function attachNavigation() {
	document.addEventListener('focusin', (event) => {
		const target = event.target
		const lane = chatPage?.contains(target) && target.closest('[data-chat-lane]')
		if (lane) state.chatLane = lane.dataset.chatLane
		if (lane && target.matches('[data-row]')) {
			state.level = 'list'
			if (chatNavigator) highlight(null, 'nav')
			highlight(target, 'list')
		} else if (chatNavigator && target.matches('[data-nav]:not(.hl)')) {
			state.level = 'nav'
			highlight(target, 'nav')
		}
		showHints()
	})
	document.addEventListener('click', (event) => {
		if (event.defaultPrevented) return
		const box = event.target.closest('[data-pick-box]')
		if (box) {
			const row = box.closest('[data-row]')
			state.level = 'list'
			if (event.shiftKey && state.anchor) {
				const rows = listRows()
				const from = rows.findIndex((each) => each.dataset.key === state.anchor)
				const to = rows.indexOf(row)
				for (const each of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) pick(each, true)
			} else {
				pick(row, box.checked)
				state.anchor = row.dataset.key
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
			state.level = 'list'
			mark(row, 'list')
			return showExtra(row, revealer.dataset.reveal)
		}
		if (!plainClick(event)) return
		const markHit = event.target.closest('[data-nav] [data-mark]')
		if (markHit && review) {
			event.preventDefault()
			const row = markHit.closest('[data-nav]')
			state.level = 'nav'
			if (row.getAttribute('aria-expanded') === 'false') expand(row, true)
			mark(row, 'nav')
			state.chosenBuild = null
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
			state.level = 'nav'
			if (nav.getAttribute('aria-expanded') === 'false') expand(nav, true)
			showView(nav.dataset.target)
			for (const each of listRows()) each.classList.remove('hl')
			mark(nav, 'nav')
			state.chosenBuild = null
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
		if (sub && state.level !== 'detail' && !event.target.closest('a, button, input, textarea, select')) {
			state.level = 'detail'
			mark(event.target.closest('[data-sub]') ?? rowsAt('detail')[0], 'detail')
			return showHints()
		}
		const row = event.target.closest('[data-row]')
		const link = event.target.closest('a[href]')
		if (link && row?.dataset.href === link.getAttribute('href')) keepReviewPicks()
		if (
			!row ||
			row.hasAttribute('data-chat-turn') ||
			event.target.closest('a, button, input, textarea, label, select, form')
		)
			return
		state.level = 'list'
		if (review) for (const each of navRows()) each.classList.remove('hl')
		mark(row, 'list')
		remember()
		open(row)
	})
	window.addEventListener('popstate', () => {
		if (!review) return
		const url = new URL(location.href)
		state.level = url.searchParams.get('focus') === 'list' ? 'list' : 'nav'
		state.chosenBuild = url.searchParams.get('build')
		const view = url.searchParams.get('view')
		if (hasPanel(view)) showView(view)
		const row = listRows().find((each) => each.dataset.key === url.searchParams.get('at'))
		if (state.level === 'list' && row) mark(row, 'list')
		settle()
	})
	window.addEventListener('hashchange', () => {
		openTarget()
		focusDecision()
	})
}
