#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const prompt = readFileSync(0, 'utf8')
const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
if (process.env.FAKE_PI_ARGS)
	appendFileSync(
		process.env.FAKE_PI_ARGS,
		JSON.stringify({ model: flag('--model'), thinking: flag('--thinking') }) + '\n'
	)
// Pi refuses a model that it does not know before the first turn.
if (flag('--model') === 'unavailable-model') {
	console.error('Error: Model "unavailable-model" not found. Use --list-models to see available models.')
	process.exit(1)
}
if (process.env.FAKE_PI_PROMPTS) appendFileSync(process.env.FAKE_PI_PROMPTS, prompt)
if (process.env.FAKE_PI_ENV) {
	const { PLAYWRIGHT_MCP_OUTPUT_DIR, PLAYWRIGHT_CLI_SESSION } = process.env
	appendFileSync(
		process.env.FAKE_PI_ENV,
		JSON.stringify({ PLAYWRIGHT_MCP_OUTPUT_DIR, PLAYWRIGHT_CLI_SESSION }) + '\n'
	)
}
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
					provider: 'fake',
					model: flag('--model') ?? 'default-model',
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
		['run', 'check', runId, testId, 'A1', '--actor', 'pi:execute', '--observed', '240', '--evidence', '-'],
		'Quote is 240.'
	)
	cli(['run', 'close', runId, testId, '--actor', 'pi:execute'])
}
reply(runId)
console.log(JSON.stringify({ type: 'agent_settled', aborted: false }))
