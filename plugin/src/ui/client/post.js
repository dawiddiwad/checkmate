import { bulkBar } from './bulk.js'

export async function post(action, fields) {
	const data = new URLSearchParams()
	for (const [name, value] of fields) data.append(name, value)
	try {
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
	} catch {
		return 'Checkmate did not answer. Check the record before you try again.'
	}
}

export function csrf() {
	return document.querySelector('input[name="csrf"]')?.value ?? bulkBar?.dataset.csrf ?? ''
}

export async function renewToken() {
	const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
	if (!response.ok) return false
	const fresh = new DOMParser().parseFromString(await response.text(), 'text/html')
	const token = fresh.querySelector('input[name="csrf"]')?.value
	if (!token) return false
	for (const field of document.querySelectorAll('input[name="csrf"]')) field.value = token
	return true
}
