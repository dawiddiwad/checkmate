import { showCopy } from './actions.js'
import { ask } from './confirm-dialog.js'
import { dockRoom, showToast } from './dock.js'
import { plural } from './format.js'
import { current, mark } from './navigation.js'
import { body, picks, review } from './page-state.js'
import { clearPicks } from './picks.js'
import { csrf, post } from './post.js'
import { tell } from './status-bar.js'

export const bulkBar = document.querySelector('[data-bulk]')

function picked(kind) {
	return [...picks].filter((pick) => pick.startsWith(`${kind}:`))
}

export function bulkOptions() {
	if (!bulkBar || !picks.size) return []
	return [...bulkBar.querySelectorAll('[data-bulk-action]')].filter((button) => !button.hidden)
}

export function showBulk() {
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

export function keepUndo(claims, to) {
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

let undoTimer = null

function hideUndo(note) {
	note.remove()
	dockRoom()
	try {
		window.sessionStorage.removeItem('checkmate-undo')
	} catch {}
}

export function showUndo() {
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
	undoTimer = setTimeout(() => hideUndo(note), kept.until - Date.now())
}

export async function undo() {
	const note = document.querySelector('[data-undo]')
	if (!note) return
	const button = note.querySelector('[data-undo-button]')
	if (button.disabled) return
	let kept = null
	try {
		kept = JSON.parse(window.sessionStorage.getItem('checkmate-undo') ?? 'null')
	} catch {}
	if (!kept) return
	clearTimeout(undoTimer)
	button.disabled = true
	const refused = await post(`/plans/${kept.plan}/handoff`, [
		['csrf', csrf()],
		['return', location.pathname + location.search],
		['undo', '1'],
		...kept.claims.map((claim) => ['claim', claim]),
	])
	if (refused) {
		button.disabled = false
		return tell(refused)
	}
	hideUndo(note)
	location.reload()
}

export function attachBulk() {
	document.addEventListener('click', (event) => {
		const bulkButton = event.target.closest('[data-bulk-action]')
		if (bulkButton) bulk(bulkButton.dataset.bulkAction)
		const copy = event.target.closest('[data-copy]')
		if (copy) copyDefects([copy.dataset.copy])
		if (event.target.closest('[data-undo-button]')) undo()
	})
}
