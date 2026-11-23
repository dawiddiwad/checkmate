#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const plugin = args[args.indexOf('--plugin-dir') + 1]
if (!plugin) throw Error('Plugin was not supplied')
const prompt = readFileSync(0, 'utf8')
const run = (arguments_, payload) =>
	JSON.parse(
		execFileSync(process.execPath, [plugin + '/dist/checkmate.js', ...arguments_, '--json'], {
			input: JSON.stringify(payload),
			encoding: 'utf8',
		})
	)
let result
if (process.env.QA_LIE === '1') {
	console.log(
		JSON.stringify({
			type: 'result',
			subtype: 'success',
			structured_output: { status: 'completed', subject: 'ticket', reasons: [] },
		})
	)
	process.exit(0)
}
if (process.env.QA_STAGE === 'setup') {
	if (!prompt.includes('target save')) throw Error('Setup command missing')
	result = run(['target', 'save', 'shop'], {
		contractVersion: 'toolkit-2',
		targetId: 'shop',
		revision: 1,
		entryPoints: [{ name: 'web', kind: 'url', purpose: 'Shop HTTP API.' }],
		capabilities: ['http'],
		tools: [],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['read_catalog'],
		startup: { owner: 'factory', command: null },
		cleanup: 'No test data.',
		readyForLiveExecution: true,
		reset: { owner: 'factory', command: null },
		approvals: { plan: 'required', result: 'required' },
	})
} else if (process.env.QA_STAGE === 'plan') {
	if (!prompt.includes('plan save') || !readFileSync('ticket.md', 'utf8').includes('The quote is 240.'))
		throw Error('Ticket or plan command missing')
	result = run(['plan', 'save', 'ticket', ...(process.env.QA_LIE === 'actor' ? ['--actor', 'impostor'] : [])], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [
			{
				id: 'T1',
				title: 'Quote',
				requirementIds: ['R1'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Read the quote.',
				assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
			},
		],
		gaps: [],
	})
} else if (process.env.QA_STAGE === 'permanent') {
	const testId = /Test (T\d+):/.exec(prompt)[1]
	if (!prompt.includes('This is a permanent run') || !prompt.includes('Do not explore'))
		throw Error('Permanent-only instructions missing')
	const detail = run(['run', 'show', 'permanent-1'])
	if (
		detail.tests.length !== 1 ||
		detail.tests[0].title !== 'Quote' ||
		detail.request.permanent.reference !== 'ticket@3'
	)
		throw Error('Wrong permanent snapshot')
	const response = await fetch(`${process.env.QA_APP_URL}/quote?promotion=true&loyalty=true`)
	const quote = await response.json()
	if (response.status !== 200 || quote.totalPLN !== 240) throw Error('The selected build does not pass')
	run(
		[
			'run',
			'check',
			'permanent-1',
			testId,
			'A1',
			'--result',
			'passed',
			'--observed',
			String(quote.totalPLN),
			'--evidence',
			'-',
		],
		'HTTP 200: 240'
	)
	run(['run', 'close', 'permanent-1', testId])
	result = { status: 'completed', subject: 'permanent-1', reasons: [] }
} else throw Error('Unknown fixture stage')
console.log(
	JSON.stringify({
		type: 'result',
		subtype: 'success',
		structured_output: { status: result.status, subject: result.subject, reasons: result.reasons },
	})
)
