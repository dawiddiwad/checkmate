import { pushLayer } from './layers.js'

export const confirmDialog = document.querySelector('[data-confirm]')

let confirmation = null

export async function ask({ title, text, field = null, yes = 'Confirm', no = 'Cancel' }) {
	while (confirmation) await confirmation
	confirmation = new Promise((resolve) => {
		confirmDialog.querySelector('[data-confirm-title]').textContent = title
		confirmDialog.querySelector('[data-confirm-text]').textContent = text
		confirmDialog.querySelector('[data-confirm-yes] span').textContent = yes
		confirmDialog.querySelector('[data-confirm-no] span').textContent = no
		const box = confirmDialog.querySelector('[data-confirm-field]')
		const input = box.querySelector('input')
		box.hidden = !field
		input.value = ''
		input.required = Boolean(field)
		if (field) box.querySelector('label').textContent = field
		confirmDialog.returnValue = ''
		pushLayer('confirm')
		confirmDialog.showModal()
		if (field) input.focus()
		else confirmDialog.querySelector('[data-confirm-yes]').focus()
		confirmDialog.addEventListener(
			'close',
			() => resolve(confirmDialog.returnValue === 'yes' ? { value: input.value.trim() } : null),
			{ once: true }
		)
	})
	try {
		return await confirmation
	} finally {
		confirmation = null
	}
}

export function confirmKey(event) {
	const typing = event.target.matches?.('input')
	const cancel = event.key === 'Enter' && event.target.closest('[data-confirm-no]')
	if (cancel || event.key === 'Escape' || (event.key === 'ArrowLeft' && !typing)) {
		event.preventDefault()
		confirmDialog.close('no')
	} else if (event.key === 'Enter' || (event.key === '1' && !typing)) {
		event.preventDefault()
		const input = confirmDialog.querySelector('[data-confirm-field]:not([hidden]) input')
		if (input && !input.value.trim()) return input.focus()
		confirmDialog.close('yes')
	}
}
