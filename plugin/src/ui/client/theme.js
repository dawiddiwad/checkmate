function effectiveTheme() {
	const set = document.documentElement.dataset.theme
	if (set) return set
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(form, theme) {
	document.documentElement.dataset.theme = theme
	const button = form.querySelector('button[name="theme"]')
	button.value = theme === 'dark' ? 'light' : 'dark'
	button.dataset.current = theme
	for (const frame of document.querySelectorAll('.sc-evidence-frame')) {
		const url = new URL(frame.src)
		url.searchParams.set('theme', theme)
		frame.src = url.href
	}
}

export function attachTheme() {
	document.addEventListener('submit', (event) => {
		const form = event.target
		if (!form.matches('[data-theme-form]')) return
		event.preventDefault()
		const theme = effectiveTheme() === 'dark' ? 'light' : 'dark'
		const data = new URLSearchParams(new FormData(form))
		data.set('theme', theme)
		fetch(form.action, { method: 'POST', body: data, redirect: 'manual' }).catch(() => {})
		applyTheme(form, theme)
	})
}
