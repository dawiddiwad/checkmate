import type { Store } from './store.ts'
import { completed, one, write } from './store.ts'
import { requireChoice, requireWellFormed } from './contracts.ts'
import type { Harness } from './pi.ts'
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

const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/
const piModelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

export function requestModelText(store: Store, harness: Harness = 'claude') {
	return setting(store, harness === 'pi' ? 'piRequestModel' : 'requestModel') ?? ''
}

export function saveRequestModel(store: Store, actor: string | undefined, text: string, harness: Harness = 'claude') {
	const model = text.trim()
	const name = harness === 'pi' ? 'piRequestModel' : 'requestModel'
	return write(store, { actor, command: 'setting set', subject: name, input: { model } }, (operationId) => {
		requireWellFormed(
			!model || (harness === 'pi' ? piModelPattern : modelPattern).test(model),
			`${model} is not a model alias or ID.`,
			harness === 'pi'
				? 'Give a Pi model ID. Leave the field empty to use the model configured in Pi.'
				: 'Use letters, digits, and the characters . : [ ] - . Leave the field empty for the model of Claude Code.'
		)
		insertSetting(store, name, model, operationId)
		return { reply: completed(name, { model }), subjects: ['settings'] }
	})
}
