async function fetchModelCatalog(harness) {
	const response = await fetch(`/settings/harness/models?harness=${encodeURIComponent(harness)}`)
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'Could not load models. Try again.')
	return data
}

function modelEfforts(catalog, value) {
	return (value ? catalog?.models.find((model) => model.value === value) : catalog?.defaultModel)?.effortLevels ?? []
}

function showEffort(select, levels, identity, automatic, label) {
	const current = select.dataset.model === undefined ? (select.dataset.savedEffort ?? '') : select.value
	const chosen = select.dataset.model === undefined || select.dataset.model === identity ? current : ''
	select.dataset.model = identity
	select.parentElement.hidden = !levels.length
	select.disabled = !levels.length
	select.replaceChildren(
		newOption(automatic ? `${label} (${automatic})` : label, ''),
		...levels.map((level) => newOption(level, level))
	)
	select.value = levels.includes(chosen) ? chosen : ''
}

function modelCatalog(panel) {
	const status = panel.querySelector('[data-model-status]')
	const refresh = panel.querySelector('[data-model-refresh]')
	const filter = panel.querySelector('#model-filter')
	const fields = [...panel.querySelectorAll('[data-model-select]')]
	let catalog = null
	function showModels() {
		const query = filter.value.trim().toLowerCase()
		for (const field of fields) {
			const models = catalog?.models
			const selected = field.value
			const found = models?.find((model) => model.value === selected)
			setModelOptions(field, models ?? [], query, field.options[0].textContent)
			const note = panel.querySelector(`[data-model-unavailable="${field.id}"]`)
			const missing = models && selected && !found
			note.hidden = !missing
			note.textContent = missing
				? 'This saved model is not in the current list. You can keep it or choose another.'
				: ''
			const value = selected || (field.id === 'tester-model' ? panel.dataset.testerDefault : '')
			const levels = modelEfforts(catalog, value)
			const effort = panel.querySelector(`[data-effort-for="${field.id}"]`)
			showEffort(effort, levels, value, levels.includes('medium') ? 'medium' : '', 'Default')
		}
	}
	async function load() {
		refresh.disabled = true
		status.textContent = 'Loading models…'
		try {
			catalog = await fetchModelCatalog(panel.dataset.modelCatalog)
			const models = catalog.models
			status.textContent = models.length
				? `${models.length} models available. Use the filter to narrow the list.`
				: 'No models found. Check the host settings and refresh.'
			showModels()
		} catch (error) {
			status.textContent = error.message || 'Could not load models. Try again.'
		} finally {
			refresh.disabled = false
		}
	}
	for (const field of fields) field.addEventListener('change', showModels)
	filter.addEventListener('input', showModels)
	refresh.addEventListener('click', load)
	load()
}

const modelPanel = document.querySelector('[data-model-catalog]')

export const testerModelState = new WeakMap()

function showTesterModels(details) {
	const state = testerModelState.get(details)
	if (!state) return
	const query = details.querySelector('[data-tester-model-filter]').value.trim().toLowerCase()
	for (const row of details.querySelectorAll('[data-tester-model-row]')) {
		if (row.hidden) continue
		const select = row.querySelector('[data-tester-model-select]')
		setModelOptions(select, state.catalog?.models ?? [], query, 'Use workspace tester model')
		const value = select.value || state.model || ''
		const levels = modelEfforts(state.catalog, value)
		const automatic =
			!select.value && state.effort
				? levels.includes(state.effort)
					? state.effort
					: ''
				: levels.includes('medium')
					? 'medium'
					: ''
		const effort = row.querySelector('[data-tester-effort-select]')
		showEffort(effort, levels, value, automatic, select.value ? 'Default' : 'Use workspace effort')
	}
}

export function newOption(label, value) {
	const option = document.createElement('option')
	option.textContent = label
	option.value = value
	return option
}

export function setModelOptions(select, models, query, defaultLabel) {
	const selected = select.value
	// The list comes first; the host default is the last entry.
	const options = []
	if (selected && !models.some((model) => model.value === selected))
		options.push(newOption(`${selected} (not in list)`, selected))
	for (const model of models) {
		if (model.value === selected || !query || `${model.value} ${model.label}`.toLowerCase().includes(query))
			options.push(newOption(model.label, model.value))
	}
	options.push(newOption(defaultLabel, ''))
	select.replaceChildren(...options)
	select.value = selected
}

export async function testerModelCount(details) {
	const form = details.closest('form')
	const state = testerModelState.get(details)
	if (!form || !state) return
	const sequence = ++state.sequence
	state.countLoading = true
	for (const select of details.querySelectorAll('[data-tester-model-row] select')) select.disabled = true
	const level = form.querySelector('[name="level"]:checked')?.value ?? 'normal'
	const params = new URLSearchParams({ harness: details.dataset.harness, level })
	const plan = new URL(form.action).pathname.match(/^\/plans\/([^/]+)\/test$/)
	if (plan) params.set('plan', decodeURIComponent(plan[1]))
	else params.set('target', form.elements.target?.value ?? '')
	try {
		const response = await fetch(`/settings/harness/tester-count?${params}`)
		const data = await response.json()
		if (!response.ok) throw new Error(data.error || 'Could not load testers.')
		if (sequence !== state.sequence) return
		state.countError = false
		state.model = data.model
		state.effort = data.effort
		details.querySelector('[data-tester-count-status]').textContent = ''
		for (const row of details.querySelectorAll('[data-tester-model-row]')) {
			const visible = Number(row.dataset.testerModelRow) <= data.count
			row.hidden = !visible
			const select = row.querySelector('[data-tester-model-select]')
			select.disabled = !visible
			if (!visible) row.querySelector('[data-tester-effort-select]').disabled = true
		}
		showTesterModels(details)
		state.countLoading = false
	} catch (error) {
		if (sequence !== state.sequence) return
		for (const row of details.querySelectorAll('[data-tester-model-row]')) {
			row.hidden = true
			for (const select of row.querySelectorAll('select')) select.disabled = true
		}
		state.countLoading = false
		state.countError = true
		details.querySelector('[data-tester-count-status]').textContent = error.message || 'Could not load testers.'
	}
}

async function loadTesterModels(details) {
	let state = testerModelState.get(details)
	if (!state) {
		state = { catalog: null, sequence: 0, loading: false }
		testerModelState.set(details, state)
	}
	testerModelCount(details)
	if (state.loading) return
	state.loading = true
	const status = details.querySelector('[data-tester-model-status]')
	const refresh = details.querySelector('[data-tester-model-refresh]')
	refresh.disabled = true
	status.textContent = 'Loading models…'
	try {
		state.catalog = await fetchModelCatalog(details.dataset.harness)
		showTesterModels(details)
		const { models } = state.catalog
		status.textContent = models.length
			? `${models.length} models available.`
			: 'No models found. Check the host settings and refresh.'
	} catch (error) {
		status.textContent = error.message || 'Could not load models. Try again.'
	} finally {
		state.loading = false
		refresh.disabled = false
	}
}

export function attachModels() {
	if (modelPanel) modelCatalog(modelPanel)
	document.addEventListener(
		'toggle',
		(event) => {
			const details = event.target
			if (details.matches?.('[data-tester-models]') && details.open) loadTesterModels(details)
		},
		true
	)
	document.addEventListener('change', (event) => {
		const form = event.target.form
		if (event.target.matches?.('[data-tester-model-select]')) {
			showTesterModels(event.target.closest('[data-tester-models]'))
			return
		}
		if (!form || !['level', 'target'].includes(event.target.name)) return
		const details = form.querySelector('[data-tester-models]')
		if (details && testerModelState.has(details)) testerModelCount(details)
	})
	document.addEventListener('input', (event) => {
		if (event.target.matches?.('[data-tester-model-filter]'))
			showTesterModels(event.target.closest('[data-tester-models]'))
	})
	document.addEventListener('click', (event) => {
		if (event.target.closest?.('[data-tester-model-refresh]'))
			loadTesterModels(event.target.closest('[data-tester-models]'))
	})
	document.addEventListener(
		'submit',
		(event) => {
			const details = event.target.querySelector?.('[data-tester-models]')
			if (!details) return
			const state = testerModelState.get(details)
			const hasChoices = [
				...details.querySelectorAll('[data-tester-model-select], [data-tester-effort-select]'),
			].some((field) => field.value)
			if (!state?.countLoading && !(state?.countError && hasChoices)) return
			event.preventDefault()
			event.stopImmediatePropagation()
			details.open = true
			details.querySelector('[data-tester-count-status]').textContent = state.countError
				? 'Could not check the tester count. Refresh or reload before starting.'
				: 'Wait for the tester count before starting.'
		},
		true
	)
}
