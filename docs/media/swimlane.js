function drawSwimlane(track) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.classList.add('wires')
	svg.setAttribute('width', track.offsetWidth)
	svg.setAttribute('height', track.offsetHeight)
	track.prepend(svg)
	const add = (tag, className, attributes) => {
		const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
		element.setAttribute('class', className)
		for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
		svg.append(element)
		return element
	}
	const timed = (element, from, to) => {
		if (!Number.isNaN(from)) element.dataset.draw = `${from} ${to}`
	}
	const steps = [...track.querySelectorAll('.step')]
	steps.forEach((step, index) => {
		const left = step.offsetLeft
		const middle = step.offsetTop + step.offsetHeight / 2
		const time = step.dataset.t === undefined ? NaN : Number(step.dataset.t)
		const records = [...track.querySelectorAll(`.record[data-of="${step.id}"]`)]
		for (const record of records) record.style.left = `${left}px`
		if (index > 0) {
			const previous = steps[index - 1]
			const start = previous.offsetLeft + previous.offsetWidth
			const from = previous.offsetTop + previous.offsetHeight / 2
			const bend = left - 14
			const path =
				from === middle
					? `M${start} ${from} H${left - 7}`
					: `M${start} ${from} H${bend} V${middle} H${left - 7}`
			const flow = add('path', 'flow', { d: path, pathLength: 1 })
			const head = add('polygon', 'flow-head', {
				points: `${left - 1} ${middle} ${left - 9} ${middle - 5} ${left - 9} ${middle + 5}`,
			})
			timed(flow, time - 0.4, time - 0.05)
			timed(head, time - 0.1, time)
		}
		if (records.length) {
			const x = left + 16
			const bottom = step.offsetTop + step.offsetHeight
			const top = records[0].offsetTop - 1
			const drop = add('path', `drop ${step.dataset.role}`, { d: `M${x} ${bottom} V${top - 6}`, pathLength: 1 })
			const head = add('polygon', `drop-head ${step.dataset.role}`, {
				points: `${x} ${top} ${x - 5} ${top - 8} ${x + 5} ${top - 8}`,
			})
			const written = Number(records[0].dataset.t)
			timed(drop, time + 0.2, written - 0.1)
			timed(head, written - 0.15, written - 0.05)
		}
	})
}
