import { closeGone } from './actions.js'
import { scrollChatToLatest } from './chat.js'
import { duration } from './format.js'
import { syncRationale, syncSource } from './forms.js'
import { watchMoveOn } from './move-on.js'
import { current, currentView, highlight, listRows, mark, navRows, rowsAt } from './navigation.js'
import { expand, remember, showView } from './navigator.js'
import { body, reducedMotion, review, served, state } from './page-state.js'
import { restoreReviewPicks } from './picks.js'
import { renewToken } from './post.js'
import { announce, showHints, tell } from './status-bar.js'

function normalize(text) {
	return text
		.replace(/<time[^>]*>[\s\S]*?<\/time>/g, '')
		.replace(/(data-since="[^"]*">)[^<]*/g, '$1')
		.replace(/ (class|tabindex|aria-selected|aria-expanded)="[^"]*"/g, '')
		.replace(/ hidden(="")?/g, '')
		.replace(/\s+/g, ' ')
}

function typingInside(region) {
	const field = document.activeElement
	return region.contains(field) && field.matches('textarea, select, input:not([type="checkbox"], [type="radio"])')
}

function dirty(region) {
	if (region.querySelector('dialog[open]')) return true
	if (region.querySelector('form[data-confirming]')) return true
	if (region.querySelector('.sc-error')) return true
	if (typingInside(region)) return true
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
		notice.className = 'sc-notice is-warn'
		notice.setAttribute('role', 'status')
		notice.dataset.liveStale = ''
		slot.prepend(notice)
	}
	notice.textContent = text
	announce(text)
}

function staleGapDrafts(region, replacement) {
	for (const form of region.querySelectorAll('[data-extra]:not([hidden]) form:has([data-stale-slot])')) {
		if (!dirty(form)) continue
		const row = form.closest('[data-row]')
		const panel = row.closest('[data-panel]').dataset.panel
		const key = row.dataset.key
		const fresh = replacement.querySelector(
			`[data-panel="${CSS.escape(panel)}"] [data-row][data-key="${CSS.escape(key)}"] [data-extra] form`
		)
		if (fresh && fresh.getAttribute('action') === form.getAttribute('action')) continue
		const label = row.dataset.label
		staleNotice(form, {
			dataset: { decidedMessage: `${label} changed or was answered in another session.` },
		})
	}
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
	const chatHistory = region.matches('[data-chat-history]')
	const active = document.activeElement
	const chatChanged =
		chatHistory &&
		JSON.stringify(
			[...region.querySelectorAll('[data-chat-content], [data-chat-terminal]')].map((item) =>
				item.hasAttribute('data-chat-terminal') ? item.getAttribute('data-chat-terminal') : item.innerHTML
			)
		) !==
			JSON.stringify(
				[...fresh.querySelectorAll('[data-chat-content], [data-chat-terminal]')].map((item) =>
					item.hasAttribute('data-chat-terminal') ? item.getAttribute('data-chat-terminal') : item.innerHTML
				)
			)
	const scrolled = region.scrollTop
	const detailMarked = state.level === 'detail' && region.matches('[data-drawer]')
	const detailLabel = detailMarked ? current('detail')?.dataset.label : null
	region.replaceWith(next)
	if (chatHistory) {
		const turns = [...next.querySelectorAll('[data-chat-turn]')]
		const selected = (!chatChanged && turns.find((row) => keyOf(row) === rowKey)) || turns.at(-1)
		if (state.chatLane === 'thread') highlight(selected, 'list')
		if (active === region) next.focus({ preventScroll: true })
		else if (region.contains(active)) {
			const turn = turns.find((row) => keyOf(row) === focusedKey)
			const control = [...(turn?.querySelectorAll('a, button, summary, [tabindex]') ?? [])].find(
				(each) => each.outerHTML === active.outerHTML
			)
			const target = control ?? selected
			target?.focus({ preventScroll: true })
		}
		if (chatChanged) scrollChatToLatest(next)
		else next.scrollTop = scrolled
		return markChanged(before, next)
	}
	next.scrollTop = scrolled
	if (next.matches('[data-drawer]')) state.drawer = next
	if (review) {
		for (const area of document.querySelectorAll('[data-nav][aria-expanded]'))
			expand(area, areas.includes(area.dataset.label))
		if (view) showView(view)
		if (state.level === 'nav') mark(navRows().find((row) => row.dataset.target === navKey) ?? navRows()[0], 'nav')
	}
	const onRow = review || document.activeElement === body || focusedKey === rowKey
	const lost = state.level === 'list' && rowKey && !current('list')
	const refocus = lost && onRow
	const place = refocus ? mark : highlight
	if (lost) {
		const rows = listRows()
		const kept = rows.find((row) => keyOf(row) === rowKey)
		if (kept) {
			const shift = kept.getBoundingClientRect().top - rowTop
			if (Math.abs(shift) > 1) window.scrollBy(0, shift)
			place(kept, 'list')
			if ((kept.dataset.ask ?? '') !== rowAsk) {
				state.gone = `The request of ${rowLabel} changed.`
				tell(state.gone)
			}
		} else {
			const at = order.indexOf(rowKey)
			const next = [...order.slice(at + 1), ...order.slice(0, at).reverse()]
				.map((key) => rows.find((row) => keyOf(row) === key))
				.find(Boolean)
			place(next ?? rows[0], 'list')
			if (review) {
				const what = rowKey.startsWith('c:')
					? 'was decided in another session'
					: rowKey.startsWith('perm:')
						? 'was answered or closed'
						: 'was answered in another session'
				state.gone = `${rowLabel} ${what}.`
				tell(state.gone)
			}
		}
		if (review) remember()
	}
	if (!refocus && !review && focusedId && document.getElementById(focusedId))
		document.getElementById(focusedId).focus()
	else if (!refocus && !review && focusedKey) {
		const owner = document.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)
		const target = owner?.matches('[data-row]') ? owner : owner?.querySelector('a, summary')
		target?.focus({ preventScroll: true })
	}
	if (actFocus) document.querySelector(`[data-actions] button[data-act="${CSS.escape(actFocus)}"]`)?.focus()
	if (detailMarked && next.matches('[data-drawer]')) {
		const sections = rowsAt('detail')
		mark(sections.find((section) => section.dataset.label === detailLabel) ?? sections[0], 'detail')
	}
	const messages = markChanged(before, next)
	syncRationale(next)
	syncSource(next)
	return messages
}

let refreshing = false

let again = false

let leaving = false

export async function refresh() {
	if (leaving) return
	if (refreshing || state.sending) return void (again = true)
	refreshing = true
	try {
		const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
		if (!response.ok) return
		const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
		if (state.sending) return void (again = true)
		if (leaving) return
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
				if (name === 'review') staleGapDrafts(region, replacement)
				else staleNotice(region, replacement)
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

const live = document.querySelector('[data-live]')

let source = null

let last = body.dataset.cursor ?? '0'

function setLive(up) {
	live.hidden = false
	live.classList.toggle('is-off', !up)
	live.textContent = up ? 'Live' : 'Reconnecting'
}

export function connect() {
	if (source || !body.dataset.subjects || !window.EventSource) return
	const subjects = encodeURIComponent(body.dataset.subjects)
	source = new EventSource(`/events?subjects=${subjects}&after=${encodeURIComponent(last)}`)
	source.onopen = () => {
		if (live.classList.contains('is-off')) renewToken().catch(() => {})
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

export function attachLive() {
	window.addEventListener('pageshow', (event) => {
		state.sending = false
		leaving = false
		if (event.persisted) {
			restoreReviewPicks()
			connect()
			refresh()
			for (const history of document.querySelectorAll('[data-chat-history]')) scrollChatToLatest(history)
		}
	})
	window.navigation?.addEventListener('navigate', (event) => {
		if (event.destination.sameDocument) return
		leaving = true
		setTimeout(() => (leaving = false), 5000)
	})
	window.setInterval(() => {
		for (const element of document.querySelectorAll('[data-since]'))
			element.textContent = duration(Math.max(0, Date.now() - Date.parse(element.dataset.since)))
	}, 1000)
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) disconnect()
		else {
			connect()
			refresh()
		}
	})
}
