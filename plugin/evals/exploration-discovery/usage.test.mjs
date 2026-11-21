import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { nativeUsage } from './usage.mjs'

test('a Pi recorder fork does not charge the copied exploration turns twice', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'discovery-usage-'))
	t.after(() => rmSync(directory, { recursive: true }))
	const model = 'openai-codex/gpt-6-luna'
	const thinking = { type: 'thinking_level_change', thinkingLevel: 'medium' }
	const turn = (id, total) => ({
		type: 'message',
		id,
		message: {
			role: 'assistant',
			provider: 'openai-codex',
			model: 'gpt-6-luna',
			timestamp: id,
			usage: { cost: { total } },
		},
	})
	const tester = turn('tester', 0.004)
	const recorder = turn('recorder', 0.001)
	const write = (name, entries) =>
		writeFileSync(join(directory, name), entries.map((entry) => JSON.stringify(entry)).join('\n'))
	write('tester.jsonl', [thinking, tester])
	write('recorder.jsonl', [thinking, tester, recorder])
	assert.deepEqual(nativeUsage(directory, model, 'medium'), {
		model,
		effort: 'medium',
		assistantTurns: 2,
		costUsd: 0.005,
		costPartial: false,
	})
	assert.throws(() => nativeUsage(directory, model, 'high'), /Unexpected Pi model or effort/)
})
