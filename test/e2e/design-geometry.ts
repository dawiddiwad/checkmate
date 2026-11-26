export type Problems = Record<'rows' | 'centre' | 'line' | 'column' | 'whole', string[]>

export function measure(): Problems {
	const problems: Problems = { rows: [], centre: [], line: [], column: [], whole: [] }
	const art = '.sr-only, svg, .mark, .glyph, .dot, .sb-kt, .sb-all, .sp-sep, .ds-sec table, [data-grid-toggle]'
	const small = 'kbd, .sp-pill, .tag, .sp-mk, .sp-btn, .sb-btn, input, select, button, summary.sp-btn'
	const shown = (element: Element) => {
		const box = element.getBoundingClientRect()
		return box.width > 1 && box.height > 1 && element.checkVisibility({ visibilityProperty: true })
	}
	const label = (element: Element) =>
		`${element.tagName.toLowerCase()}${element.classList.length ? '.' + [...element.classList].join('.') : ''} "${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`
	const onRow = (value: number) => Math.abs(value - 4 * Math.round(value / 4)) < 0.01
	const whole = (value: number) => Math.abs(value - Math.round(value)) < 0.01
	const blockish = /^(block|flex|grid|list-item|table|table-row|flow-root|inline-block|inline-flex|inline-grid)$/

	for (const element of document.querySelectorAll('body *')) {
		if (!shown(element) || element.closest(art)) continue
		const style = getComputedStyle(element)
		if (!blockish.test(style.display) || style.position === 'fixed') continue
		const box = element.getBoundingClientRect()
		const top = box.top + scrollY
		const inStage = element.closest('.ds-stage')
		if (!onRow(box.height)) problems.rows.push(`${label(element)} height ${box.height}`)
		const parent = element.parentElement ? getComputedStyle(element.parentElement) : null
		const stacked =
			!parent ||
			/^(block|list-item|flow-root)$/.test(parent.display) ||
			(/flex$/.test(parent.display) && parent.flexDirection.startsWith('column'))
		if (
			stacked &&
			!inStage &&
			!element.matches(small) &&
			!element.closest('.sp-drawer, .top, .statusbar') &&
			!onRow(top)
		)
			problems.rows.push(`${label(element)} top ${top}`)
		if (!whole(top) || !whole(box.height)) problems.whole.push(`${label(element)} top ${top} height ${box.height}`)
	}

	const content = (element: Element) => {
		const boxes: DOMRect[] = []
		const walk = (node: Node) => {
			for (const child of node.childNodes) {
				if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
					const range = document.createRange()
					range.selectNodeContents(child)
					boxes.push(...range.getClientRects())
				} else if (child instanceof Element) {
					const style = getComputedStyle(child)
					if (child.matches('.sr-only') || style.display === 'none' || style.position === 'absolute') continue
					if (child.matches('.glyph, svg, input, kbd, .dot')) boxes.push(child.getBoundingClientRect())
					else walk(child)
				}
			}
		}
		walk(element)
		const real = boxes.filter((box) => box.width > 0 && box.height > 0)
		if (!real.length) return null
		return {
			top: Math.min(...real.map((box) => box.top)),
			bottom: Math.max(...real.map((box) => box.bottom)),
			left: Math.min(...real.map((box) => box.left)),
			right: Math.max(...real.map((box) => box.right)),
		}
	}
	for (const element of document.querySelectorAll(
		'kbd, .sp-pill, .sp-mk, .tag, .icon-btn, .sb-btn, .sp-btn, .sp-c-cb'
	)) {
		if (!shown(element)) continue
		const box = element.getBoundingClientRect()
		const style = getComputedStyle(element)
		const inner = content(element)
		if (!inner) continue
		const middle =
			(box.top + parseFloat(style.borderTopWidth) + box.bottom - parseFloat(style.borderBottomWidth)) / 2
		const dy = (inner.top + inner.bottom) / 2 - middle
		if (Math.abs(dy) > 0.5) problems.centre.push(`${label(element)} off centre by ${dy.toFixed(2)}px down`)
		if (element.matches('kbd, .sp-mk, .icon-btn, .sp-c-cb')) {
			const dx = (inner.left + inner.right) / 2 - (box.left + box.right) / 2
			if (Math.abs(dx) > 0.5) problems.centre.push(`${label(element)} off centre by ${dx.toFixed(2)}px right`)
		}
	}

	const rows =
		'.sp-row, .sp-nrow, .sp-gh, .top-in, .statusbar, .sb-links, .sb-keys, .sb-k, .sp-ct-head, .sp-pills, .btns, .actions, .sp-c-opts, .sp-dh, .q-top, .chips, .pager, .viewer-bar, .menu-list a, .seg, .sp-dopts, .sp-bulk, .toast, .ds-row-inline'
	for (const row of document.querySelectorAll(rows)) {
		if (!shown(row)) continue
		const rowTop = row.getBoundingClientRect().top
		const items = [...row.children].filter((child) => {
			if (!shown(child) || child.matches('.sr-only')) return false
			const box = child.getBoundingClientRect()
			return getComputedStyle(child).position !== 'absolute' && box.height <= 48 && box.top < rowTop + 40
		})
		const lines = new Map<number, Element[]>()
		for (const item of items) {
			const box = item.getBoundingClientRect()
			const key = Math.round(box.top / 8)
			lines.set(key, [...(lines.get(key) ?? []), item])
		}
		for (const group of lines.values()) {
			if (group.length < 2) continue
			const middles = group.map((item) => {
				const box = item.getBoundingClientRect()
				return (box.top + box.bottom) / 2
			})
			if (Math.max(...middles) - Math.min(...middles) > 0.5)
				problems.line.push(
					`${label(row)}: ${group.map((item, index) => `${label(item)} @${middles[index].toFixed(1)}`).join(', ')}`
				)
		}
	}

	const lists = [...document.querySelectorAll('.sp-list')].filter(shown)
	const columns = ['.sp-c-cb', '.sp-c-tag', '.sp-c-id', '.sp-c-title']
	for (const column of columns) {
		const lefts = new Map<number, number[]>()
		for (const list of lists) {
			const width = Math.round(list.getBoundingClientRect().width)
			for (const cell of list.querySelectorAll(`:scope > .sp-row > ${column}`)) {
				if (!shown(cell)) continue
				lefts.set(width, [...(lefts.get(width) ?? []), cell.getBoundingClientRect().left])
			}
		}
		for (const [width, values] of lefts)
			if (Math.max(...values) - Math.min(...values) > 0.01)
				problems.column.push(`${column} in lists ${width}px wide starts at ${[...new Set(values)].join(', ')}`)
	}
	for (const list of lists) {
		const header = list.querySelector(':scope > .sp-gh')
		const box = list.querySelector(':scope > .sp-row > .sp-c-cb input')
		if (!header || !box || !shown(header) || !shown(box)) continue
		const range = document.createRange()
		range.selectNodeContents(header.firstChild ?? header)
		const text = range.getClientRects()[0]
		if (text && Math.abs(text.left - box.getBoundingClientRect().left) > 0.5)
			problems.column.push(`group text at ${text.left} but row checkbox at ${box.getBoundingClientRect().left}`)
	}
	for (const panel of document.querySelectorAll('.panel, .sp-ct, .sp-empty, .q-detail')) {
		if (!shown(panel) || panel.closest('.ds-stage')) continue
		const first = [...panel.children].find(
			(child) => shown(child) && getComputedStyle(child).position !== 'absolute'
		)
		if (!first) continue
		const inset = first.getBoundingClientRect().left - panel.getBoundingClientRect().left
		if (Math.abs(inset - 16) > 0.01) problems.column.push(`${label(panel)} text inset ${inset}px, not 16px`)
	}
	for (const key of Object.keys(problems) as Array<keyof Problems>) problems[key] = [...new Set(problems[key])]
	return problems
}

export function boxes(selector: string) {
	return [...document.querySelectorAll(selector)].map((element) => {
		const box = element.getBoundingClientRect()
		return [box.left, box.top + scrollY, box.width, box.height].map((value) => Math.round(value * 100) / 100)
	})
}

export function overflow() {
	const width = document.documentElement.clientWidth
	const out: string[] = []
	if (document.documentElement.scrollWidth > width)
		out.push(`document is ${document.documentElement.scrollWidth}px wide`)
	for (const element of document.querySelectorAll('body *')) {
		if (!element.checkVisibility()) continue
		const box = element.getBoundingClientRect()
		if (box.right <= width + 0.5 || box.width === 0) continue
		let clipped = false
		for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
			const style = getComputedStyle(parent)
			if (
				/(auto|scroll|hidden|clip)/.test(style.overflowX) &&
				parent.getBoundingClientRect().right <= width + 0.5
			) {
				clipped = true
				break
			}
		}
		if (!clipped && !element.closest('.sr-only, .skip'))
			out.push(`${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ends at ${box.right}`)
	}
	return out
}
