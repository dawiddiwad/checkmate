function placeMenu(menu) {
	const list = menu.querySelector('.menu-list')
	if (!list) return
	const edge = 8
	const box = menu.getBoundingClientRect()
	const top = edge
	const bottom = document.querySelector('.sc-bar').getBoundingClientRect().top - edge
	const above = Math.min(bottom, box.top - edge)
	const below = Math.max(top, box.bottom + edge)
	const roomAbove = Math.max(0, above - top)
	const roomBelow = Math.max(0, bottom - below)
	list.style.position = 'fixed'
	list.style.left = '0px'
	list.style.right = 'auto'
	list.style.bottom = 'auto'
	const height = list.scrollHeight + list.offsetHeight - list.clientHeight
	const up = roomBelow < height && roomAbove > roomBelow
	list.style.maxHeight = `${up ? roomAbove : roomBelow}px`
	list.style.top = `${up ? above - list.offsetHeight : below}px`
	const width = list.offsetWidth
	const left = Math.max(edge, Math.min(box.right - width, window.innerWidth - edge - width))
	list.style.left = `${left}px`
}

function placeOpenMenus(event) {
	if (event.target.closest?.('.menu-list')) return
	document.querySelectorAll('details[data-menu][open]').forEach(placeMenu)
}

function keepsMenusOpen(event) {
	if (event.target.closest('[data-confirm-back]')) return true
	return event.defaultPrevented && Boolean(event.target.closest('a[data-view]'))
}

export function attachMenus() {
	document.addEventListener(
		'toggle',
		(event) => {
			if (event.target.matches?.('details[data-menu]') && event.target.open) placeMenu(event.target)
		},
		true
	)
	window.addEventListener('resize', placeOpenMenus)
	window.addEventListener('scroll', placeOpenMenus, true)
	document.addEventListener('click', (event) => {
		if (keepsMenusOpen(event)) return
		for (const menu of document.querySelectorAll('details[data-menu][open]'))
			if (!menu.contains(event.target)) menu.open = false
	})
}
