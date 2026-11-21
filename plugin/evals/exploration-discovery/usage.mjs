import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function events(path) {
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)]
			} catch {
				return []
			}
		})
}

export function nativeUsage(directory, model, thinking) {
	const sessions = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(
		(entry) => entry.isFile() && entry.name.endsWith('.jsonl')
	)
	const uniqueTurns = new Map()
	for (const file of sessions) {
		let effort
		for (const event of events(join(file.parentPath, file.name))) {
			if (event.type === 'thinking_level_change') effort = event.thinkingLevel
			const message = event.message
			if (event.type === 'message' && message?.role === 'assistant') {
				uniqueTurns.set(event.id + ':' + message.timestamp, {
					model: message.provider + '/' + message.model,
					effort,
					charge: message.usage?.cost?.total ?? null,
					stop: message.stopReason,
				})
			}
		}
	}
	const turns = [...uniqueTurns.values()]
	assert(turns.length, 'No native Pi model turn was observed')
	assert(
		turns.every((turn) => turn.model === model && turn.effort === thinking),
		'Unexpected Pi model or effort'
	)
	const charged = turns.filter((turn) => turn.charge !== null)
	return {
		model,
		effort: thinking,
		assistantTurns: turns.length,
		costUsd: charged.length ? charged.reduce((total, turn) => total + turn.charge, 0) : null,
		costPartial: charged.length !== turns.length || turns.some((turn) => ['aborted', 'error'].includes(turn.stop)),
	}
}
