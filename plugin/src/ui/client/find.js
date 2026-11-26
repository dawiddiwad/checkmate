import { plural } from './format.js'
import { pushLayer } from './layers.js'
import { refresh } from './live.js'
import { plainClick } from './navigation.js'
import { csrf, renewToken } from './post.js'

export const findDialog = document.querySelector('[data-find]')

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
	link.href = '/chats'
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

function clearFindResults() {
	clearTimeout(findTimer)
	findTicket++
	findResults([], '')
	findDialog.querySelector('[data-find-none]').hidden = true
	findDialog.querySelector('[data-find-more]').hidden = true
	findMark()
}

async function findNow() {
	const ticket = ++findTicket
	const query = findDialog.querySelector('[data-find-input]').value.trim()
	if (findAsking) return
	if (findMode === 'ask') {
		findResults([], query)
		return findMark(findLinks()[0])
	}
	try {
		const response = await fetch(`/find?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
		const found = await response.json()
		if (!findDialog.open || ticket !== findTicket || findAsking) return
		findResults(found.results, query)
		findDialog.querySelector('[data-find-none]').hidden = found.results.length > 0 || !query
		const more = findDialog.querySelector('[data-find-more]')
		more.hidden = !found.more
		more.textContent = `${plural(found.more, 'more result')}. Type more words to narrow the list.`
		findMark(findLinks()[0])
	} catch {}
}

export function openFind(mode = 'find') {
	if (document.querySelector('dialog[open]')) return
	findMode = mode
	findAsking = null
	findDialog.dataset.mode = mode
	findDialog.querySelector('[data-find-asking]').hidden = true
	findDialog.querySelector('[data-find-error]').hidden = true
	findDialog.querySelector('[data-find-results]').hidden = false
	clearFindResults()
	const input = findDialog.querySelector('[data-find-input]')
	input.readOnly = false
	input.placeholder = mode === 'ask' ? 'Ask a follow-up' : ''
	input.setAttribute(
		'aria-label',
		mode === 'ask' ? 'Ask a follow-up' : 'Find a plan, a defect, or a question. Or ask Checkmate.'
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
	const sending = Symbol()
	findAsking = sending
	input.readOnly = true
	const error = findDialog.querySelector('[data-find-error]')
	error.hidden = true
	const send = () =>
		fetch('/requests', {
			method: 'POST',
			body: new URLSearchParams({
				csrf: csrf(),
				text,
				chat: '1',
				harness: findDialog.dataset.harness,
				screen:
					document.querySelector('[data-chat-back]')?.dataset.chatBack ?? location.pathname + location.search,
			}),
		})
	try {
		let response = await send()
		if (response.status === 403 && (await renewToken())) response = await send()
		const destination = response.ok && response.redirected ? new URL(response.url) : null
		if (
			!destination ||
			destination.origin !== location.origin ||
			!(/^\/chats\/[^/]+$/.test(destination.pathname) || /^\/plans\/[^/]+$/.test(destination.pathname))
		) {
			const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
			throw new Error(
				fresh.querySelector('[role="alert"]')?.textContent?.trim() || 'Checkmate could not send the message.'
			)
		}
		if (findAsking !== sending || !findDialog.open) return
		openFindResult(destination.href)
	} catch (problem) {
		if (findAsking !== sending) return
		findAsking = null
		input.readOnly = false
		error.textContent = problem.message
		error.hidden = false
	}
}

function openFindResult(href) {
	if (href === location.href) {
		findDialog.close('no')
		return refresh()
	}
	if (window.history.state?.layer === 'find') location.replace(href)
	else location.assign(href)
}

export function findKey(event) {
	if (event.key === 'Escape') {
		event.preventDefault()
		findAsking = null
		return findDialog.close('no')
	}
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
		if (!links[at]) return
		if (links[at].matches('[data-find-ask]')) return askNow()
		openFindResult(links[at].href)
	}
}

export function attachFind() {
	findDialog.querySelector('[data-find-input]').addEventListener('input', () => {
		if (findAsking) return
		clearFindResults()
		if (findMode === 'ask') return findNow()
		findTimer = setTimeout(findNow, 120)
	})
	findDialog.addEventListener('close', () => {
		if (!findDialog.open) findAsking = null
	})
	findDialog.addEventListener('click', (event) => {
		const link = event.target.closest('[data-find-results] a')
		if (!link || !plainClick(event)) return
		event.preventDefault()
		if (link.hasAttribute('data-find-ask')) askNow()
		else openFindResult(link.href)
	})
	document.addEventListener('click', (event) => {
		if (!event.target.closest('[data-ask-follow]') || !plainClick(event)) return
		event.preventDefault()
		openFind('ask')
	})
	document.addEventListener('click', (event) => {
		if (event.target.closest('[data-find-open]')) openFind()
	})
}
