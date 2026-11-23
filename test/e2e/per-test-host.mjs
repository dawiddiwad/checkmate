#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const prompt = readFileSync(0, 'utf8')
const runId = process.env.FAKE_RUN
const cli = (args, input = '') =>
	execFileSync(process.execPath, [process.env.FAKE_CHECKMATE_CLI, ...args], { encoding: 'utf8', input })
const reply = (subject) =>
	console.log(
		JSON.stringify({
			type: 'agent_end',
			messages: [
				{
					role: 'assistant',
					stopReason: 'stop',
					content: [{ type: 'text', text: JSON.stringify({ status: 'completed', subject, reasons: [] }) }],
				},
			],
			willRetry: false,
		})
	)
if (prompt.includes('exploration probe')) {
	appendFileSync(process.env.FAKE_PI_LOG, 'PROBE\n')
	cli(
		['run', 'finding', runId, '--actor', 'pi:execute'],
		JSON.stringify({
			id: 'P-1',
			type: 'potential_issue',
			severity: 'medium',
			assertionIds: [],
			requirementIds: [],
			title: 'Probe title',
			expected: 'The stated value',
			observed: 'Another value',
			reproduction: ['Probe step'],
			evidenceIds: [],
		})
	)
	reply(runId)
	console.log(JSON.stringify({ type: 'agent_settled', aborted: false }))
	process.exit(0)
}
const testId = /Test (T\d+):/.exec(prompt)[1]
appendFileSync(process.env.FAKE_PI_LOG, `${testId}\n`)
const attempt = readFileSync(process.env.FAKE_PI_LOG, 'utf8')
	.split('\n')
	.filter((line) => line === testId).length
if (testId === 'T1' || (testId === 'T2' && attempt === 2)) {
	cli(
		[
			'run',
			'check',
			runId,
			testId,
			'A1',
			'--actor',
			'pi:execute',
			'--result',
			'passed',
			'--observed',
			'Quote is 240.',
			'--evidence',
			'-',
		],
		'Quote is 240.'
	)
	cli(['run', 'close', runId, testId, '--actor', 'pi:execute'])
}
reply(runId)
console.log(JSON.stringify({ type: 'agent_settled', aborted: false }))
