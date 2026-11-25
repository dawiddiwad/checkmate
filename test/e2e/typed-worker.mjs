#!/usr/bin/env node
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
// The model catalog request of Checkmate. The tester model advertises two effort levels.
if (args.includes('--input-format')) {
	const models = [{ value: 'default' }, { value: 'tester-model', supportedEffortLevels: ['low', 'high'] }]
	const response = { request_id: 'checkmate-models', subtype: 'success', response: { models } }
	console.log(JSON.stringify({ type: 'control_response', response }))
	process.exit(0)
}
if (process.env.QA_ARGS_LOG)
	appendFileSync(
		process.env.QA_ARGS_LOG,
		JSON.stringify({ role: process.env.CHECKMATE_TOOL_ROLE, model: flag('--model'), effort: flag('--effort') }) +
			'\n'
	)
// Claude Code refuses a model that does not exist before the first turn.
if (flag('--model') === 'unavailable-model') {
	const result =
		"There's an issue with the selected model (unavailable-model). It may not exist or you may not have access to it."
	console.log(
		JSON.stringify({
			type: 'result',
			subtype: 'success',
			is_error: true,
			api_error_status: 404,
			api_error_type: 'not_found_error',
			result,
			total_cost_usd: 0,
			modelUsage: {},
		})
	)
	process.exit(1)
}
const root = args[args.indexOf('--plugin-dir') + 1]
const { callActionTool } = await import(pathToFileURL(join(root, 'dist/checkmate.js')).href)
const stage = process.env.CHECKMATE_TOOL_ROLE
const subject = process.env.CHECKMATE_TOOL_SUBJECT
const prompt = readFileSync(0, 'utf8')
const call = (name, input) => callActionTool('checkmate_' + name, input, process.cwd(), process.env)
const ok = async (name, input) => {
	const reply = await call(name, input)
	assert.equal(reply.status, 'completed', JSON.stringify(reply))
	return reply
}
const test = {
	id: 'T1',
	title: 'Read health',
	requirementIds: ['R1'],
	capability: 'http',
	operations: ['read_health'],
	dependsOn: [],
	preconditions: [],
	action: 'GET /health',
	assertions: [
		{ id: 'A1', check: 'HTTP status is 200.', checkKind: 'deterministic', observe: 'HTTP status', expected: '200' },
	],
}
process.on('uncaughtException', (error) => {
	console.error(error.message)
	process.exit(1)
})
let reply
if (stage === 'plan') {
	assert.match(prompt, /independent Checkmate plan worker/)
	await ok('read_plan_request', { planId: subject })
	reply = await call('save_plan', {
		planId: subject,
		candidate: {
			tests: [test],
			gaps: [
				{
					id: 'G1',
					question: 'Which status does health return?',
					consequence: 'The status is unknown.',
					severity: 'blocking',
					status: 'open',
					decisionId: null,
					requirementIds: [],
					testIds: ['T1'],
				},
			],
		},
	})
} else if (stage === 'revise') {
	assert.match(prompt, /independent Checkmate revise worker/)
	const pending = await ok('read_pending', { planId: subject })
	assert.match(JSON.stringify(pending), /It returns HTTP 200\./)
	const { id, assertions, ...fields } = test
	reply = await ok('revise_plan', {
		planId: subject,
		delta: { tests: { [id]: { ...fields, assertions: assertions.map(({ id: _id, ...assertion }) => assertion) } } },
	})
} else if (stage === 'probe') {
	assert.match(prompt, /at most 10 probe actions/)
	reply = { status: 'completed', reasons: [] }
} else {
	assert.equal(stage, 'execute')
	// The CLI path of delegate gives the shell prompt, and its worker closes the test itself.
	const native = /independent tester/.test(prompt)
	assert(native || /delegated Checkmate execute step/.test(prompt))
	const run = await ok('read_run', { runId: subject, includePlan: true })
	const response = await fetch(run.instance.entries.web + '/health')
	const request = 'GET /health'
	const fields = { runId: subject, testId: process.env.CHECKMATE_TOOL_TEST, assertionId: 'A1', request }
	const evidence = { text: `GET /health returned ${response.status} ${await response.text()}`, kind: 'http_exchange' }
	const badEvidence = await call('record_check', { ...fields, observed: '200', evidence: ['inline text'] })
	assert.equal(badEvidence.refusal, 'malformed')
	assert.match(badEvidence.nextAction.instruction, /inline|text/)
	const badValue = await call('record_check', { ...fields, observed: '200; {"ok":true}', evidence: [evidence] })
	assert.equal(badValue.refusal, 'malformed')
	const unobserved = await call('record_check', {
		...fields,
		observed: '200',
		result: 'not_checked',
		reason: 'Placeholder',
	})
	assert.equal(unobserved.refusal, 'malformed')
	assert.match(unobserved.reasons.join(' '), /observed value/)
	reply = await ok('record_check', {
		...fields,
		observed: String(response.status),
		evidence: [evidence, { text: 'Read-only check.' }],
	})
	assert.equal(reply.result, 'passed')
	// The launcher closes a fully recorded test even if this worker did not close it.
	if (!native) reply = await ok('close_test', { runId: subject, testId: process.env.CHECKMATE_TOOL_TEST })
}
console.log(
	JSON.stringify({
		type: 'result',
		subtype: 'success',
		structured_output: { status: reply.status, subject, reasons: reply.reasons },
		modelUsage: { [flag('--model') ?? 'default-model']: { costUSD: 0 } },
	})
)
