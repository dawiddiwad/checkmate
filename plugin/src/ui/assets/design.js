const shapes = {
	'--radius': 'border: var(--line-w) solid var(--edge); border-radius: var(--radius)',
	'--radius-round': 'border: var(--line-w) solid var(--edge); border-radius: var(--radius-round)',
	'--line-w': 'border: var(--line-w) solid var(--ink)',
	'--mark-w': 'border-left: var(--mark-w) solid var(--accent)',
	'--line': 'border: var(--line)',
	'--focus-ring': 'outline: var(--focus-ring); outline-offset: var(--focus-offset)',
	'--sep': 'box-shadow: var(--sep)',
	'--mark-inset': 'box-shadow: var(--mark-inset) var(--accent)',
}

const forced = { ':hover': '.is-hover', ':focus-visible': '.is-focus', ':active': '.is-active' }

function forceStates(rules, sheet) {
	for (const rule of [...rules]) {
		if (rule.cssRules && !rule.selectorText) {
			forceStates(rule.cssRules, rule)
			continue
		}
		if (!rule.selectorText) continue
		let selector = rule.selectorText
		for (const [state, name] of Object.entries(forced)) selector = selector.replaceAll(state, name)
		if (selector === rule.selectorText) continue
		sheet.insertRule(`${selector} { ${rule.style.cssText} }`, sheet.cssRules.length)
	}
}

function showSamples() {
	for (const element of document.querySelectorAll('[data-style]')) element.style.cssText = element.dataset.style
	for (const element of document.querySelectorAll('.ds-shape'))
		element.style.cssText = shapes[element.dataset.token] ?? ''
}

function gridToggle() {
	const button = document.querySelector('[data-grid-toggle]')
	if (!button) return
	button.addEventListener('click', () => {
		const on = document.documentElement.toggleAttribute('data-grid')
		button.setAttribute('aria-pressed', String(on))
	})
}

const main = [...document.styleSheets].find((sheet) => sheet.href?.endsWith('/assets/style.css'))
if (main) forceStates(main.cssRules, main)
showSamples()
gridToggle()
