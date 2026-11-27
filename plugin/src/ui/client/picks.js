import { showBulk } from './bulk.js'
import { current, currentView, listRows, mark } from './navigation.js'
import { remember } from './navigator.js'
import { picks, review, state, viewerPane } from './page-state.js'
import { showHints, showPath, tell } from './status-bar.js'

const reviewPicksKey = 'checkmate-review-picks'

export function extend(by) {
	if (state.level !== 'list') return
	const before = current()
	if (!before) return
	const rows = listRows()
	if (!state.anchor) {
		state.anchor = before.dataset.key
		state.rangeBase = new Set(picks)
	}
	const next = rows[rows.indexOf(before) + by]
	if (!next) return
	mark(next)
	const from = rows.findIndex((row) => row.dataset.key === state.anchor)
	const to = rows.indexOf(next)
	picks.clear()
	for (const item of state.rangeBase) picks.add(item)
	for (const row of rows.slice(Math.min(from, to), Math.max(from, to) + 1))
		if (row.dataset.pick) picks.add(row.dataset.pick)
	applyPicks()
	showPath()
	showHints()
	remember()
}

export function pick(row, on = !picks.has(row.dataset.pick)) {
	if (!row.dataset.pick) return
	if (on) picks.add(row.dataset.pick)
	else picks.delete(row.dataset.pick)
	applyPicks()
}

export function keepReviewPicks() {
	if (!review || state.drawer || viewerPane || !picks.size) return
	const items = listRows()
		.map((row) => row.dataset.pick)
		.filter((item) => picks.has(item))
	try {
		window.sessionStorage.setItem(
			reviewPicksKey,
			JSON.stringify({ plan: review.dataset.plan, view: currentView(), items })
		)
	} catch {}
}

export function restoreReviewPicks() {
	if (!review || state.drawer || viewerPane) return
	let kept
	try {
		kept = JSON.parse(window.sessionStorage.getItem(reviewPicksKey))
		window.sessionStorage.removeItem(reviewPicksKey)
	} catch {
		return
	}
	if (kept?.plan !== review.dataset.plan || kept.view !== currentView() || !Array.isArray(kept.items)) return
	if (window.performance.getEntriesByType('navigation')[0]?.type === 'reload') return
	picks.clear()
	state.anchor = null
	state.rangeBase = null
	const items = new Set(kept.items)
	for (const row of listRows()) if (items.has(row.dataset.pick)) picks.add(row.dataset.pick)
	applyPicks()
}

export function applyPicks() {
	const rows = [...document.querySelectorAll('[data-row][data-pick]')]
	const eligible = new Set(rows.map((row) => row.dataset.pick))
	for (const item of picks) if (!eligible.has(item)) picks.delete(item)
	showBulk()
	for (const row of rows) {
		const on = picks.has(row.dataset.pick)
		row.classList.toggle('is-picked', on)
		const box = row.querySelector('[data-pick-box]')
		if (box) box.checked = on
	}
}

export function clearPicks() {
	picks.clear()
	state.anchor = null
	state.rangeBase = null
	applyPicks()
	showHints()
}

export function toggleSelect() {
	if (state.level !== 'list') return tell('Space selects records in a list.')
	const row = current()
	if (!row?.dataset.pick) return tell('This record cannot be selected.')
	pick(row)
	state.anchor = null
	state.rangeBase = null
	showHints()
}
