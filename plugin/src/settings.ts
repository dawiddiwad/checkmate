import type { Store } from './store.ts'
import { completed, one, write } from './store.ts'
import { requireWellFormed } from './contracts.ts'

export const defaultTesterRules = 'Read Bash'

export function ruleTokens(text: string) {
	return text.match(/(?:[^\s(]|\([^)]*(?:\)|$))+/g) ?? []
}

export function testerRulesText(store: Store) {
	const row = one<{ value: string }>(
		store,
		"SELECT value FROM workspace_settings WHERE name = 'testerRules' ORDER BY rowid DESC LIMIT 1"
	)
	return row?.value ?? defaultTesterRules
}

export function saveTesterRules(store: Store, actor: string | undefined, text: string) {
	const rules = ruleTokens(text)
	return write(store, { actor, command: 'setting set', subject: 'testerRules', input: { rules } }, (operationId) => {
		requireWellFormed(
			rules.length,
			'Give at least one tool rule, for example Read Bash.',
			'The engine needs at least one rule today. With the rule, a tester does not ask you. Without it, each call asks you in the review UI.'
		)
		store.db
			.prepare('INSERT INTO workspace_settings (name, value, operation_id) VALUES (?, ?, ?)')
			.run('testerRules', rules.join(' '), operationId)
		return { reply: completed('testerRules', { rules }), subjects: ['settings'] }
	})
}

const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/

export function requestModelText(store: Store) {
	const row = one<{ value: string }>(
		store,
		"SELECT value FROM workspace_settings WHERE name = 'requestModel' ORDER BY rowid DESC LIMIT 1"
	)
	return row?.value ?? ''
}

export function saveRequestModel(store: Store, actor: string | undefined, text: string) {
	const model = text.trim()
	return write(store, { actor, command: 'setting set', subject: 'requestModel', input: { model } }, (operationId) => {
		requireWellFormed(
			!model || modelPattern.test(model),
			`${model} is not a model alias or ID.`,
			'Use letters, digits, and the characters . : [ ] - . Leave the field empty for the model of Claude Code.'
		)
		store.db
			.prepare('INSERT INTO workspace_settings (name, value, operation_id) VALUES (?, ?, ?)')
			.run('requestModel', model, operationId)
		return { reply: completed('requestModel', { model }), subjects: ['settings'] }
	})
}
