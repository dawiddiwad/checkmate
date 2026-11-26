import { actDialog, actKey, actionsKey } from './actions.js'
import { bulkOptions, undo } from './bulk.js'
import { confirmDialog, confirmKey } from './confirm-dialog.js'
import { choose, hideExtra, optionsNow } from './drawer.js'
import { closeViewer, trapViewer, viewer } from './evidence-viewer.js'
import { findDialog, findKey, openFind } from './find.js'
import { glyphHtml } from './format.js'
import { fieldError } from './forms.js'
import { pushLayer } from './layers.js'
import { modifierKeys, moveOn } from './move-on.js'
import { back, current, deeper, listRows, mark, rowsAt, step } from './navigation.js'
import { canChoose } from './navigator.js'
import { pageForm, pageFormKey } from './page-form.js'
import { body, chatPage, chatView, review, state } from './page-state.js'
import { extend, toggleSelect } from './picks.js'
import { setSay, showHints } from './status-bar.js'

export const keysDialog = document.querySelector('[data-keys]')

function openKeys() {
	if (keysDialog.open) return keysDialog.close()
	pushLayer('keys')
	keysDialog.showModal()
	keysDialog.querySelector('[data-keys-close]').focus()
}

const arrows = (event) => event.key === 'ArrowUp' || event.key === 'ArrowDown'

const down = (event) => (event.key === 'ArrowDown' ? 1 : -1)

export const keyTable = [
	{
		cap: '↑↓',
		caps: ['↑', '↓'],
		help: 'Move the highlight through the rows where you are: the plans, the navigator, the records, the files.',
		test: (event) => arrows(event) && !event.shiftKey && rowsAt().length > 0,
		run: (event) => step(down(event)),
		hint: () =>
			rowsAt().length > (state.level === 'detail' || state.level === 'viewer' ? 1 : 0)
				? {
						nav: 'views',
						list:
							chatView === 'thread' && state.chatLane === 'thread'
								? 'turns'
								: chatPage
									? 'chats'
									: review
										? 'records'
										: 'rows',
						detail: 'sub-records',
						viewer: 'files',
					}[state.level]
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
			if (state.level === 'nav') return row.getAttribute('aria-expanded') === 'false' ? 'expand' : 'enter list'
			if (state.level === 'detail') return row.dataset.href ? 'view' : null
			if (state.level === 'viewer') return null
			if (row.classList.contains('is-many') || row.querySelector(':scope > .asks')) return 'options'
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
			(state.level === 'list' && review) ||
			state.level === 'detail' ||
			state.level === 'viewer' ||
			body.dataset.back
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
			if (selection && (state.level === 'list' || state.level === 'nav'))
				return [selection === 1 ? '1' : `1–${selection}`, 'selection']
			if (state.level === 'nav' && canChoose(current('nav')?.dataset.target)) {
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
			event.key === ' ' && !event.shiftKey && Boolean(review) && state.level === 'list' && listRows().length > 0,
		run: toggleSelect,
		hint: () => (state.level === 'list' && current()?.dataset.pick ? 'select' : null),
	},
	{
		caps: ['Shift+↑', 'Shift+↓'],
		help: 'Select the records on the way, from the highlighted record.',
		test: (event) => arrows(event) && event.shiftKey && Boolean(review) && state.level === 'list',
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

function keyCaps(caps) {
	return caps.map((cap) => `<kbd class="sc-key">${glyphHtml(cap)}</kbd>`).join('')
}

function keysTable() {
	const row = (entry) =>
		`<tr><th scope="row"><span class="sp-keyset">${keyCaps(entry.caps)}</span></th><td>${entry.help}</td></tr>`
	return `<table class="sp-ktable">${keyTable.map(row).join('')}<tr><th scope="row" colspan="2" class="sp-kexc">In a text field</th></tr>${fieldTable.map(row).join('')}</table><p class="sp-knote">Tab moves between the regions: the top bar, the navigator, the list, the record, and the status bar. Inside a region the arrows move. Each action also works with the mouse.</p>`
}

export function typingIn(target) {
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
		} else if (target.closest('[data-chat-composer]') && current('list')) mark(current('list'), 'list')
		else target.blur()
		return showHints()
	}
	if (form && event.key === 'Enter' && !event.shiftKey && target.tagName === 'TEXTAREA') {
		event.preventDefault()
		if (!target.value.trim()) return fieldError(target, 'Write the text first, then press Enter.')
		form.requestSubmit()
	}
}

export function attachKeyboard() {
	document.querySelector('[data-keys-table]').innerHTML = keysTable()
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
			target.closest?.('[data-row], [data-nav], [data-sub], [data-vfile]') ||
			target === body ||
			target.id === 'main'
		const chatTurn = target.closest?.('[data-chat-turn]')
		const chatControl = target.closest?.('a, button, summary, [role="region"]')
		if (chatTurn?.contains(chatControl) && (event.key === 'Enter' || event.key === ' ' || /^Arrow/.test(event.key)))
			return
		if (!inRecords && (event.key === 'Enter' || event.key === ' ')) return
		if (!inRecords && /^Arrow/.test(event.key) && target.closest?.('form, details, .menu-list')) return
		const entry = keyTable.find((each) => each.test(event))
		if (!entry) return
		event.preventDefault()
		setSay('')
		if (!/^[1-9]$/.test(event.key)) state.gone = null
		entry.run(event)
	})
	document.addEventListener('click', (event) => {
		if (event.target.closest('[data-keys-open]')) openKeys()
		if (event.target.closest('[data-keys-close]')) keysDialog.close()
	})
}
