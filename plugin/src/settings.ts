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
			'The engine needs at least one rule today. A tester cannot answer a permission prompt.'
		)
		store.db
			.prepare('INSERT INTO workspace_settings (name, value, operation_id) VALUES (?, ?, ?)')
			.run('testerRules', rules.join(' '), operationId)
		return { reply: completed('testerRules', { rules }), subjects: ['settings'] }
	})
}
