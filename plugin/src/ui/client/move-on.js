export const modifierKeys = ['Shift', 'Control', 'Alt', 'Meta']

let movingOn = null

export function moveOn() {
	const moving = document.querySelector('[data-moves-on]')
	if (!moving) return false
	clearTimeout(movingOn)
	movingOn = null
	location.replace(moving.dataset.next)
	return true
}

export function watchMoveOn() {
	if (movingOn || !document.querySelector('[data-moves-on]')) return
	movingOn = setTimeout(moveOn, 2000)
}

export function attachMoveOn() {
	watchMoveOn()
}
