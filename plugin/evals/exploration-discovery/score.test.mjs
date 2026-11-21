import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('team recall counts overlapping findings once and usage includes both bare runs', (t) => {
	const folder = mkdtempSync(join(tmpdir(), 'discovery-score-'))
	t.after(() => rmSync(folder, { recursive: true }))
	const write = (name, value) => writeFileSync(join(folder, name), JSON.stringify(value))
	const bareAgents = ['bare-a1', 'bare-a2']
	const checkmateReports = ['normal-a1', 'normal-a2']
	write('run.json', { level: 'normal', bareAgents, checkmateReports })
	write('oracle.json', [{ id: 'D01' }, { id: 'R01' }])
	const artifact = 'report.txt'
	writeFileSync(join(folder, artifact), 'Observed the failure')
	const matched = (id, observedInArm = false, origin) => ({
		id,
		outcome: 'matched',
		artifact,
		evidence: id,
		observedInArm,
		origin,
	})
	write('adjudication.json', {
		'bare-a1': [matched('R01', false, 'correct')],
		'bare-a2': [matched('R01', true, 'wrong'), matched('D01', false, 'correct')],
		'normal-a1': [matched('R01')],
		'normal-a2': [],
		normalJournal: [matched('R01')],
	})
	const usage = (costUsd, seconds) => ({ model: 'model', effort: 'medium', seconds, assistantTurns: 1, costUsd })
	write('bare-a1.json', usage(1, 70))
	write('bare-a2.json', usage(2, 20))
	write('normal.json', usage(3, 100))
	const path = fileURLToPath(new URL('./score.mjs', import.meta.url))
	const result = JSON.parse(execFileSync(process.execPath, [path, folder], { encoding: 'utf8' }))
	assert.equal(result.bare.total.caught, 2)
	assert.equal(result.bare.duplicates, 1)
	assert.deepEqual(result.bare.observedInArm, ['R01'])
	assert.deepEqual(result.bare.originCorrect, ['D01', 'R01'])
	assert.deepEqual(result.bare.originWrong, ['R01'])
	assert.equal(result.bare.usage.costUsd, 3)
	assert.equal(result.bare.usage.seconds, 70)
	assert.equal(result.normal.total.caught, 1)
	assert.equal(result.normalJournal.total.caught, 1)
})
