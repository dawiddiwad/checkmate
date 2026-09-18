import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { runTracked, assertProcessesExited } from './browser-processes.mjs'
import { browserAudit } from './browser-audit.mjs'

assert(process.argv[2], 'usage: node test/acceptance/stagehand-web.mjs <candidate.tgz>')
const installation = await mkdtemp(resolve(tmpdir(), 'checkmate-stagehand-installed-'))
let mode
let outer = 0
let nested = 0
let saved = false
let firstStepUsage
let interrupt
const failures = []
const server = createServer((request, response) => {
	if (request.method === 'GET') {
		if (request.url === '/saved?name=cobalt%20heron') saved = true
		response.writeHead(200, { 'content-type': 'text/html' })
		response.end(
			`<html><body><h1>Form ready</h1><form onsubmit="event.preventDefault(); const name = document.querySelector('input').value; document.querySelector('h1').textContent = 'Saved ' + name; fetch('/saved?name=' + encodeURIComponent(name))"><label>Name<input></label><button>Save</button></form></body></html>`
		)
		return
	}
	let body = ''
	request.setEncoding('utf8').on('data', (chunk) => {
		body += chunk
	})
	request.on('end', () => {
		void answer(JSON.parse(body), response).catch((error) => {
			failures.push(error)
			response.writeHead(500).end('{}')
		})
	})
})
await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
const baseUrl = `http://127.0.0.1:${server.address().port}`

try {
	await writeFile(resolve(installation, 'package.json'), '{"private":true,"type":"module"}\n')
	execFileSync(
		'npm',
		['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', resolve(process.argv[2])],
		{ cwd: installation, stdio: 'pipe' }
	)
	const binary = resolve(installation, 'node_modules/@xoxoai/checkmate/bin/checkmate.js')
	for (mode of ['allowed', 'discard', 'recovery', 'budget', 'provider-error', 'interrupted']) {
		outer = 0
		nested = 0
		saved = false
		firstStepUsage = undefined
		await writeFile(resolve(installation, 'checkmate.config.json'), JSON.stringify(manifest()))
		await writeFile(
			resolve(installation, 'request.json'),
			JSON.stringify({
				schemaVersion: 1,
				scenario: {
					id: `stagehand-${mode}`,
					driver: { id: 'web', target: { baseUrl } },
					steps: [
						{
							id: 'submit',
							action: 'Discover the form, fill Name with cobalt heron and save',
							expect: 'Saved cobalt heron',
						},
						{
							id: 'later',
							action: 'Read the saved state again without navigating',
							expect: 'Saved cobalt heron',
						},
					],
				},
			})
		)
		const audit = await browserAudit(installation)
		const execution = await runTracked(
			process.execPath,
			[binary, 'run', 'request.json'],
			installation,
			{ ...process.env, ...audit.env, CHECKMATE_STAGEHAND_KEY: 'fixture-provider-secret' },
			(child) => {
				interrupt = () => child.kill('SIGINT')
			}
		)
		assert.equal(failures.length, 0, failures.map(String).join('\n'))
		const result = JSON.parse(execution.stdout)
		assert.equal(
			execution.stdout
				.trim()
				.split('\n')
				.filter((line) => line === '{').length,
			1
		)
		assert.equal(result.driver.contractVersion, 1)
		assert(execution.browserPids.size > 0, 'No owned browser process observed')
		await assertProcessesExited(execution.browserPids)
		await audit.verify()
		const directories = await readdir(resolve(installation, '.checkmate/runs'))
		const directory = directories.find((entry) => entry.endsWith(`-${result.runId}`))
		assert(directory, 'Missing invocation directory')
		assert.equal(
			await readFile(resolve(installation, '.checkmate/runs', directory, 'result.json'), 'utf8'),
			execution.stdout
		)
		if (mode === 'budget' || mode === 'provider-error') {
			assert.equal(
				result.reason,
				mode === 'budget' ? 'token-budget-exceeded' : 'provider-error',
				execution.stdout
			)
			assert.equal(nested, 2)
			assert.equal(outer, 3)
			assert.equal(result.usage.totalTokens, 15)
			assert.equal(result.steps[0].usage.totalTokens, 15)
			assert.equal(result.steps[1].status, 'not-run')
			assert.equal(saved, false)
		} else if (mode === 'interrupted') {
			assert.equal(result.reason, 'interrupted', execution.stdout)
			assert.equal(nested, 2)
			assert.equal(result.steps[1].status, 'not-run')
		} else {
			assert.equal(execution.code, 0, execution.stderr + execution.stdout)
			assert.equal(result.status, 'passed')
			assert.equal(nested, mode === 'recovery' ? 8 : 7, 'Pinned form callback count changed')
			assert(saved, 'The real form was not submitted with the expected input')
			assert.equal(result.usage.totalTokens, (outer + nested) * 3)
			assert.equal(result.steps[0].usage.totalTokens, firstStepUsage)
			assert.equal(result.steps[1].usage.totalTokens, 12)
			assert.equal(
				result.steps.reduce((sum, step) => sum + step.usage.totalTokens, 0),
				result.usage.totalTokens
			)
			assert.equal(result.usage.cachedPromptTokens, outer + nested)
			if (mode === 'recovery') {
				assert.deepEqual(
					result.steps[0].toolCalls.filter((call) => call.name === 'browser_act').map((call) => call.status),
					['error', 'ok', 'ok']
				)
			}
			assert(result.evidence.references.length > 0)
			for (const reference of result.evidence.references) {
				assert.equal(reference.kind, 'transcript')
				const text = await readFile(resolve(installation, reference.path), 'utf8')
				assert(text.includes('cobalt heron'))
				assert.equal(
					text.includes('browser_diagnostics'),
					mode === 'allowed' && text.includes('browser_observe')
				)
				assert(!text.includes('fixture-provider-secret'))
			}
		}
	}
} finally {
	server.closeAllConnections()
	await new Promise((accept) => server.close(accept))
	await rm(installation, { recursive: true, force: true })
}

async function answer(request, response) {
	assert.equal(request.model, 'fixture')
	let message
	if (request.response_format) {
		nested++
		assert.equal(request.response_format.type, 'json_schema')
		assert.equal(request.response_format.json_schema.strict, true)
		assert(!request.tools)
		if (mode === 'interrupted' && nested === 2) {
			interrupt()
			return
		}
		const name = request.response_format.json_schema.name
		const text = request.messages
			.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
			.join('\n')
		assert(['Observation', 'Act', 'Extraction', 'Metadata'].includes(name))
		let value
		if (name === 'Observation' || name === 'Act') {
			const fill = !text.includes('Click Save')
			const elementId = text.match(fill ? /\[(\d+-\d+)\] textbox: Name/ : /\[(\d+-\d+)\] button: Save/)?.[1]
			assert(elementId, 'Expected form element missing from actual accessibility tree')
			const action = {
				elementId,
				description: fill ? 'Fill Name' : 'Save',
				method: fill ? 'fill' : 'click',
				arguments: fill ? ['cobalt heron'] : [],
			}
			value =
				name === 'Observation'
					? { elements: [action] }
					: { action: text.includes('Click missing button') ? null : action, twoStep: false }
		} else {
			assert(text.includes('Saved cobalt heron'), 'Extraction did not receive the mutated DOM')
			assert(saved, 'Expected real form submission before extraction')
			value =
				name === 'Metadata' ? { progress: 'Complete', completed: true } : { extraction: 'Saved cobalt heron' }
		}
		message = {
			role: 'assistant',
			content: mode === 'provider-error' && nested === 2 ? '{invalid' : JSON.stringify(value),
		}
	} else {
		const names = request.tools.map((tool) => tool.function.name)
		assert.equal(names.includes('browser_diagnostics'), mode === 'allowed')
		assert.deepEqual(
			names.filter((name) => name.startsWith('browser_')).sort(),
			[
				'browser_navigate',
				'browser_observe',
				'browser_act',
				'browser_extract',
				...(mode === 'allowed' ? ['browser_diagnostics'] : []),
			].sort()
		)
		const calls = [
			['browser_navigate', { url: baseUrl }],
			['browser_observe', {}],
			...(mode === 'recovery' ? [['browser_act', { instruction: 'Click missing button' }]] : []),
			['browser_act', { instruction: 'Fill Name with cobalt heron' }],
			['browser_act', { instruction: 'Click Save' }],
			['browser_extract', { instruction: 'Read the saved form status' }],
		]
		if (mode === 'allowed') calls.push(['browser_diagnostics', { limit: 1 }])
		calls.push(['pass_test_step', { actualResult: 'Saved cobalt heron' }])
		const firstVerdict = calls.length
		calls.push(
			['browser_extract', { instruction: 'Read the saved form status again' }],
			['pass_test_step', { actualResult: 'Saved cobalt heron persists' }]
		)
		const [name, args] = calls[outer++]
		if (name === 'browser_act') {
			const history = request.messages
				.filter((entry) => entry.role === 'tool')
				.map((entry) => entry.content)
				.join('\n')
			assert(history.includes('selector'), 'Observation candidates were not returned to the outer model')
			if (mode === 'recovery' && args.instruction.startsWith('Fill')) assert(history.includes('"success":false'))
		}
		if (name === 'browser_diagnostics') await delay(2500)
		if (name === 'pass_test_step') {
			const tools = request.messages.filter((entry) => entry.role === 'tool')
			assert(tools.some((entry) => entry.content.includes('cobalt heron')))
			if (outer === firstVerdict) firstStepUsage = (outer + nested) * 3
			if (mode === 'allowed' && outer === firstVerdict) {
				const diagnostics = tools
					.map((entry) => {
						try {
							return JSON.parse(entry.content)
						} catch {
							return null
						}
					})
					.find((entry) => entry?.partial === true)
				assert(
					diagnostics && diagnostics.events.length > 0,
					'Expected real received diagnostics in tool history'
				)
				assert(!JSON.stringify(diagnostics).includes('fixture-provider-secret'))
			}
		}
		message = {
			role: 'assistant',
			content: null,
			tool_calls: [
				{ id: `call-${outer}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
			],
		}
	}
	response.writeHead(200, { 'content-type': 'application/json' })
	response.end(
		JSON.stringify({
			id: 'fixture',
			object: 'chat.completion',
			created: 1,
			model: 'fixture',
			choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
			usage: {
				prompt_tokens: 2,
				completion_tokens: 1,
				total_tokens: 3,
				prompt_tokens_details: { cached_tokens: 1 },
			},
		})
	)
}

function manifest() {
	return {
		schemaVersion: 1,
		outputDirectory: '.checkmate/runs',
		defaultPolicy: 'ci',
		secretBindings: { provider: { source: 'environment', name: 'CHECKMATE_STAGEHAND_KEY' } },
		drivers: { web: { package: '@xoxoai/checkmate/driver-web', secrets: {} } },
		policies: {
			ci: {
				modelEgress: {
					provider: { id: 'openai', model: 'fixture', baseUrl: `${baseUrl}/v1`, apiKeyBinding: 'provider' },
					textRedaction: 'off',
					allowOpaque: false,
					maxStepBytes: 1048576,
					maxMessageBytes: 262144,
				},
				bounds: {
					scenarioTimeoutMs: 60000,
					stepTimeoutMs: 30000,
					requestTimeoutMs: 15000,
					cleanupTimeoutMs: 10000,
					turnsPerStep: 8,
					maxRetries: 0,
					loopMaxRepetitions: 3,
					budgetTokens: mode === 'budget' ? 13 : 1000,
				},
				evidence: { retention: 'on', redaction: 'off', allowOpaque: false },
				drivers: {
					web: {
						settings: { headless: true },
						tools: {
							allowed:
								mode === 'allowed'
									? ['*']
									: ['browser_navigate', 'browser_observe', 'browser_act', 'browser_extract'],
						},
					},
				},
			},
		},
	}
}
