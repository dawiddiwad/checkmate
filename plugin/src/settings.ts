import type { Store } from './store.ts'
import { completed, one, write } from './store.ts'
import { requireChoice, requireWellFormed } from './contracts.ts'
import { effortLevels } from './model-catalog.ts'
import type { Harness } from './pi.ts'
import { piSavedModelEnv } from './pi.ts'
import type { Env } from './sessions.ts'
import { piToolNames } from './sessions.ts'

export const defaultTesterRules = 'Read Bash'

function setting(store: Store, name: string) {
	return one<{ value: string }>(
		store,
		'SELECT value FROM workspace_settings WHERE name = ? ORDER BY rowid DESC LIMIT 1',
		name
	)?.value
}

function insertSetting(store: Store, name: string, value: string, operationId: string) {
	store.db
		.prepare('INSERT INTO workspace_settings (name, value, operation_id) VALUES (?, ?, ?)')
		.run(name, value, operationId)
}

export function workspaceHarness(store: Store): Harness {
	return setting(store, 'harness') === 'pi' ? 'pi' : 'claude'
}

export function workspaceEnv(store: Store, env: Env): Env {
	return env.CHECKMATE_HARNESS?.trim() ? env : { ...env, CHECKMATE_HARNESS: workspaceHarness(store) }
}

export function workspaceUiEnv(store: Store, env: Env): Env {
	const saved = setting(store, 'harness')
	return saved === 'claude' || saved === 'pi' ? { ...env, CHECKMATE_HARNESS: saved } : env
}

export function saveWorkspaceHarness(store: Store, actor: string | undefined, text: string) {
	return write(
		store,
		{ actor, command: 'setting set', subject: 'harness', input: { harness: text } },
		(operationId) => {
			const harness = requireChoice(text, ['claude', 'pi'] as const, 'agent harness')
			insertSetting(store, 'harness', harness, operationId)
			return { reply: completed('harness', { harness }), subjects: ['settings'] }
		}
	)
}

export function ruleTokens(text: string) {
	return text.match(/(?:[^\s(]|\([^)]*(?:\)|$))+/g) ?? []
}

export function testerRulesText(store: Store, harness: Harness = 'claude') {
	return setting(store, harness === 'pi' ? 'piTesterRules' : 'testerRules') ?? defaultTesterRules
}

export function saveTesterRules(store: Store, actor: string | undefined, text: string, harness: Harness = 'claude') {
	const rules = ruleTokens(text)
	const name = harness === 'pi' ? 'piTesterRules' : 'testerRules'
	return write(store, { actor, command: 'setting set', subject: name, input: { rules } }, (operationId) => {
		requireWellFormed(
			rules.length,
			'Give at least one tool rule, for example Read Bash.',
			'The engine needs at least one rule today. With the rule, a tester does not ask you. Without it, each call asks you in the review UI.'
		)
		if (harness === 'pi') piToolNames(rules)
		insertSetting(store, name, rules.join(' '), operationId)
		return { reply: completed(name, { rules }), subjects: ['settings'] }
	})
}

const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,511}$/
const piModelPattern = /^[^\p{Cc}\p{Cs}]{1,512}$/u

function piRequestModel(store: Store): { model: string; providerQualified: boolean } {
	const value = setting(store, 'piRequestModel') ?? ''
	return value.startsWith('{')
		? (JSON.parse(value) as { model: string; providerQualified: boolean })
		: { model: value, providerQualified: false }
}

export function requestModelText(store: Store, harness: Harness = 'claude') {
	return harness === 'pi' ? piRequestModel(store).model : (setting(store, 'requestModel') ?? '')
}

export function piRequestModelEnv(store: Store, env: Env): Env {
	const { model, providerQualified } = piRequestModel(store)
	return piSavedModelEnv(env, model, providerQualified)
}

export function testerModelText(store: Store, harness: Harness = 'claude') {
	return setting(store, harness === 'pi' ? 'piTesterModel' : 'testerModel') ?? ''
}

function effortSetting(kind: 'request' | 'tester', harness: Harness) {
	if (harness === 'pi') return kind === 'request' ? 'piRequestEffort' : 'piTesterEffort'
	return kind === 'request' ? 'requestEffort' : 'testerEffort'
}

export function requestEffortText(store: Store, harness: Harness = 'claude') {
	return setting(store, effortSetting('request', harness)) ?? ''
}

export function testerEffortText(store: Store, harness: Harness = 'claude') {
	return setting(store, effortSetting('tester', harness)) ?? ''
}

export function requireEffort(harness: Harness, effort: unknown): asserts effort is string {
	requireWellFormed(
		typeof effort === 'string' && (!effort || effortLevels[harness].includes(effort)),
		'Choose a reasoning effort supported by the coding harness.'
	)
}

export function saveRequestModel(store: Store, actor: string | undefined, text: string, harness: Harness = 'claude') {
	const model = text.trim()
	const name = harness === 'pi' ? 'piRequestModel' : 'requestModel'
	return write(store, { actor, command: 'setting set', subject: name, input: { model } }, (operationId) => {
		requireModel(harness, model)
		const value = harness === 'pi' ? JSON.stringify({ model, providerQualified: false }) : model
		if (value !== setting(store, name)) {
			insertSetting(store, name, value, operationId)
			if (requestEffortText(store, harness))
				insertSetting(store, effortSetting('request', harness), '', operationId)
		}
		return { reply: completed(name, { model }), subjects: ['settings'] }
	})
}

export function saveModels(
	store: Store,
	actor: string | undefined,
	harness: Harness,
	request: string,
	tester: string,
	requestEffort?: string,
	testerEffort?: string
) {
	const requestModel = request.trim()
	const testerModel = tester.trim()
	const input = { harness, requestModel, testerModel, requestEffort, testerEffort }
	return write(store, { actor, command: 'setting set', subject: 'models', input }, (operationId) => {
		requireModel(harness, requestModel)
		requireModel(harness, testerModel)
		const requestChanged = requestModel !== requestModelText(store, harness)
		const testerChanged = testerModel !== testerModelText(store, harness)
		for (const [kind, choice, changed] of [
			['request', requestEffort, requestChanged],
			['tester', testerEffort, testerChanged],
		] as const) {
			if (choice === undefined && !changed) continue
			const effort = choice?.trim() ?? ''
			requireEffort(harness, effort)
			const name = effortSetting(kind, harness)
			if (effort !== (setting(store, name) ?? '')) insertSetting(store, name, effort, operationId)
		}
		if (requestChanged) {
			const name = harness === 'pi' ? 'piRequestModel' : 'requestModel'
			insertSetting(store, name, modelValue(name, requestModel), operationId)
		}
		if (testerChanged) {
			const name = harness === 'pi' ? 'piTesterModel' : 'testerModel'
			insertSetting(store, name, testerModel, operationId)
		}
		return { reply: completed('models', input), subjects: ['settings'] }
	})
}

function modelValue(name: string, model: string) {
	return name === 'piRequestModel' ? JSON.stringify({ model, providerQualified: model.includes('/') }) : model
}

export function requireModel(harness: Harness, model: string) {
	requireWellFormed(
		!model || (harness === 'pi' ? piModelPattern : modelPattern).test(model),
		`${model} is not a model alias or ID.`,
		harness === 'pi'
			? 'Give a Pi model ID. Leave the field empty to use the model configured in Pi.'
			: 'Use letters, digits, and the characters . : / [ ] - . Use an empty field for the default model.'
	)
}
