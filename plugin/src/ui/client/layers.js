import { actDialog } from './actions.js'
import { confirmDialog } from './confirm-dialog.js'
import { findDialog } from './find.js'
import { keysDialog } from './keyboard.js'
import { current, mark } from './navigation.js'
import { areaOf, expand, keepAreas } from './navigator.js'
import { chatNavigator, review, state } from './page-state.js'
import { showHints } from './status-bar.js'

function layers() {
	return { find: findDialog, keys: keysDialog, confirm: confirmDialog, act: actDialog() }
}

let quietPop = false

let relayer = null

export function pushLayer(name) {
	if (quietPop) relayer = name
	else if (window.history.state?.layer !== name)
		window.history.pushState({ ...window.history.state, layer: name }, '', location.href)
}

export function dropLayer(key, value = null) {
	const held = window.history.state?.[key]
	if (!held || (value && held !== value)) return
	quietPop = true
	window.history.back()
}

export function attachLayers() {
	for (const [name, dialog] of Object.entries(layers()))
		dialog?.addEventListener('close', () => {
			if (!dialog.open && dialog.returnValue !== 'yes') dropLayer('layer', name)
		})
	window.addEventListener('popstate', (event) => {
		if (quietPop) {
			quietPop = false
			if (relayer && layers()[relayer]?.open) pushLayer(relayer)
			relayer = null
			return event.stopImmediatePropagation()
		}
		const layer = Object.values(layers()).find((dialog) => dialog?.open)
		if (layer) {
			layer.close('no')
			return event.stopImmediatePropagation()
		}
		const area = (review || chatNavigator) && document.querySelector('[data-nav][aria-expanded="true"]')
		if (area && !event.state?.area && state.level === 'nav') {
			const row = current('nav')
			const owner = row?.getAttribute('aria-expanded') === 'true' ? row : (row && areaOf(row)) || area
			expand(owner, false)
			keepAreas()
			mark(owner, 'nav')
			showHints()
			return event.stopImmediatePropagation()
		}
	})
}
