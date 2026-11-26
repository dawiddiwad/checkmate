import { dockRoom } from './dock.js'
import { glyphHtml } from './format.js'
import { keyTable } from './keyboard.js'
import { current, fitOptions, padTitle, panel } from './navigation.js'
import { review, state, viewerPane } from './page-state.js'

const say = document.querySelector('[data-say]')

const sayStrip = document.querySelector('[data-say-strip]')

let sayTimer = null

let sayText = ''

export function setSay(text) {
	if (sayText === text) return
	sayText = text
	showHints()
}

export function tell(text) {
	setSay(text)
	clearTimeout(sayTimer)
	sayTimer = setTimeout(() => setSay(''), 4000)
}

function fitPath() {
	const list = document.querySelector('[data-where] ol')
	if (!list) return
	for (const item of list.children) item.hidden = false
	list.querySelector('[data-more-path]')?.remove()
	const items = [...list.children]
	for (const item of items) item.title = item.textContent.trim()
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

export function showPath() {
	const list = document.querySelector('[data-where] ol')
	if (!review || !list || state.drawer || viewerPane) return fitPath()
	const fixed = [...list.querySelectorAll('li')].slice(0, 2)
	const tail = [panel()?.dataset.title ?? '']
	const row = state.level === 'list' ? current('list') : null
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

export function showHints() {
	const list = []
	if (document.activeElement?.closest?.('[data-field-form]'))
		list.push(['Enter', 'send'], ['Shift+Enter', 'new line'], ['Esc', 'leave'])
	else
		for (const entry of keyTable) {
			const hint = entry.hint()
			if (!hint) continue
			list.push(Array.isArray(hint) ? hint : [entry.cap, hint])
		}
	const keys = list.find(([cap]) => cap === '?')
	const shown =
		list.length > 3
			? [...list.filter(([cap]) => cap !== '?').slice(0, keys ? 2 : 3), ...(keys ? [keys] : [])]
			: list
	const source = shown
		.map(([cap, text]) =>
			cap === '?'
				? `<button type="button" class="sc-key-hint" data-cap="?" data-keys-open><kbd class="sc-key">?</kbd><span class="sc-key-text">${text}</span></button>`
				: `<span class="sc-key-hint" data-cap="${cap}"><kbd class="sc-key">${glyphHtml(cap)}</kbd>${text}</span>`
		)
		.join('')
	if (hints.dataset.source !== source) {
		hints.innerHTML = source
		hints.dataset.source = source
	}
	fitHints()
}

const announcer = document.querySelector('[data-announcer]')

export function announce(text) {
	if (!text) return
	announcer.textContent = ''
	setTimeout(() => (announcer.textContent = text), 50)
}

export function attachStatusBar() {
	window.addEventListener('resize', fitPath)
	window.addEventListener('resize', () => {
		dockRoom()
		showHints()
		const row = document.querySelector('.is-sel[data-row]')
		if (row) {
			fitOptions(row)
			padTitle(row)
		}
	})
}
