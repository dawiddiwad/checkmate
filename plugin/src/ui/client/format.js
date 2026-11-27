export function plural(count, one, many = `${one}s`) {
	return `${count} ${count === 1 ? one : many}`
}

const glyphNames = {
	'●': 'dot',
	'○': 'ring',
	'↑': 'up',
	'↓': 'down',
	'←': 'left',
	'→': 'right',
	'▸': 'closed',
	'▾': 'open',
}

const keyNames = { '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right' }

export function glyphHtml(text) {
	return text.replace(/[●○↑↓←→▸▾]/g, (symbol) => {
		const name = keyNames[symbol] ? `<span class="sc-sr">${keyNames[symbol]}</span>` : ''
		return `<span class="glyph g-${glyphNames[symbol]}" aria-hidden="true"></span>${name}`
	})
}

export function duration(ms) {
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds} s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes} min ${seconds % 60} s`
	return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
