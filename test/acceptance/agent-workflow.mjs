import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'

const tarballArgument = process.argv[2]
assert(tarballArgument, 'usage: npm run test:acceptance:agent -- <candidate.tgz>')
const tarball = resolve(process.cwd(), tarballArgument)
const installation = await mkdtemp(resolve(tmpdir(), 'checkmate-agent-workflow-'))
const server = createServer(providerResponse)
let nestedRequests = 0

try {
	await new Promise((accept, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', accept)
	})
	const address = server.address()
	assert(address && typeof address !== 'string')
	await writeFile(resolve(installation, 'package.json'), '{"private":true,"type":"module"}\n')
	await runProcess(
		'npm',
		['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball],
		installation
	)
	await writeDriver(installation)
	await writeManifest(installation, `http://127.0.0.1:${address.port}/v1`)

	const binary = resolve(installation, 'node_modules/@xoxoai/checkmate/bin/checkmate.js')
	const version = await runProcess(process.execPath, [binary, '--version'], installation)
	assert.equal(version.code, 0)
	assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/)
	const help = await runProcess(process.execPath, [binary, '--help'], installation)
	assert.equal(help.code, 0)
	assert.match(help.stdout, /run <file\|->/)

	for (const [mode, code, category] of [
		['pass', 0, 'passed'],
		['app', 1, 'app'],
		['model', 2, 'model'],
		['infra', 3, 'infra'],
	]) {
		await writeFile(resolve(installation, 'request.json'), JSON.stringify(request(mode)))
		const execution = await runProcess(
			process.execPath,
			[binary, 'run', 'request.json'],
			installation,
			executionEnvironment()
		)
		assert.equal(execution.code, code, execution.stderr)
		const result = oneDocument(execution.stdout)
		assert.equal(result.category, category)
		assert.equal(result.scenarioId, `acceptance-${mode}`)
		if (result.runId) {
			const resultPath = resolve(
				installation,
				'.checkmate/runs',
				await runDirectoryFor(installation, result.runId),
				'result.json'
			)
			assert.equal(await readFile(resultPath, 'utf8'), execution.stdout)
		}
	}

	await writeFile(resolve(installation, 'request.json'), '{}')
	const invalid = await runProcess(
		process.execPath,
		[binary, 'run', 'request.json'],
		installation,
		executionEnvironment()
	)
	assert.equal(invalid.code, 4)
	assert.equal(oneDocument(invalid.stdout).category, 'invalid')

	const manifestPath = resolve(installation, 'checkmate.config.json')
	const manifestBytes = await readFile(manifestPath, 'utf8')
	await rm(manifestPath)
	await symlink('checkmate.config.json', manifestPath)
	const operational = await runProcess(
		process.execPath,
		[binary, 'run', 'request.json'],
		installation,
		executionEnvironment()
	)
	assert.equal(operational.code, 3)
	const operationalResult = oneDocument(operational.stdout)
	assert.equal(operationalResult.category, 'infra')
	assert.equal(operationalResult.reason, 'pre-execution-error')
	assert.equal(operationalResult.status, 'error')
	assert.equal(operationalResult.targetMutation, 'not-attempted')
	assert.equal(operationalResult.diagnostics[0].code, 'input.read-failed')
	for (const field of ['runId', 'scenarioId', 'steps', 'usage', 'evidence'])
		assert.equal(field in operationalResult, false)
	await rm(manifestPath)
	await writeFile(manifestPath, manifestBytes)

	await writeFile(resolve(installation, 'request.json'), JSON.stringify(request('hang')))
	const contained = await runProcess(
		process.execPath,
		[binary, 'run', 'request.json'],
		installation,
		executionEnvironment()
	)
	assert.equal(contained.code, 3)
	const containment = oneDocument(contained.stdout)
	assert.equal(containment.status, 'contained')
	assert.equal(containment.reason, 'parent-containment')
	assert.equal('steps' in containment, false)

	await verifyGenerationDriver(binary)
} finally {
	await new Promise((accept) => server.close(accept))
	await rm(installation, { recursive: true, force: true })
}

function providerResponse(requestMessage, response) {
	let body = ''
	requestMessage.setEncoding('utf8').on('data', (chunk) => (body += chunk))
	requestMessage.on('end', () => {
		const request = JSON.parse(body)
		if (request.response_format) {
			nestedRequests++
			assert.equal(request.model, 'fixture')
			assert.equal(request.response_format.type, 'json_schema')
			assert.equal(request.response_format.json_schema.strict, true)
			assert.equal(request.response_format.json_schema.name, 'fixture_fact')
			assert.equal('tools' in request, false)
			assert.equal('tool_choice' in request, false)
			assert(!body.includes('provider-secret'))
			assert(body.includes('[secret omitted]'))
			const result = completion()
			result.choices[0].message.content = JSON.stringify({ fact: 'ready' })
			result.usage = {
				prompt_tokens: 5,
				completion_tokens: 2,
				total_tokens: 7,
				prompt_tokens_details: { cached_tokens: 3 },
			}
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(result))
			return
		}
		if (body.includes('execute nested')) {
			const tool = request.messages.some((message) => message.role === 'tool')
				? 'pass_test_step'
				: 'fixture_generate'
			const result = completion(tool)
			if (tool === 'fixture_generate') result.choices[0].message.tool_calls[0].function.arguments = '{}'
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(result))
			return
		}
		const mode = body.includes('execute app')
			? 'app'
			: body.includes('execute model')
				? 'model'
				: body.includes('execute infra')
					? 'infra'
					: 'pass'
		if (mode === 'infra') {
			response.writeHead(401, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ error: { message: 'fixture provider failure' } }))
			return
		}
		const tool = mode === 'app' ? 'fail_test_step' : mode === 'model' ? undefined : 'pass_test_step'
		response.writeHead(200, { 'content-type': 'application/json' })
		response.end(JSON.stringify(completion(tool)))
	})
}

async function verifyGenerationDriver(binary) {
	const directory = resolve(installation, 'node_modules/@checkmate-test/generation-driver')
	await cp(new URL('../../src/test/fixtures/drivers/generation-driver', import.meta.url), directory, {
		recursive: true,
	})
	const manifestPath = resolve(installation, 'checkmate.config.json')
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
	manifest.drivers.fixture = { package: '@checkmate-test/generation-driver', secrets: {} }
	manifest.policies.ci.bounds.turnsPerStep = 3
	await writeFile(manifestPath, JSON.stringify(manifest))
	const nested = request('nested')
	nested.scenario.driver.target = {}
	nested.scenario.steps.push({ id: 'second', action: 'execute nested again', expect: 'ready' })
	await writeFile(resolve(installation, 'request.json'), JSON.stringify(nested))
	for (const args of [['describe'], ['validate', 'request.json']]) {
		const result = await runProcess(process.execPath, [binary, ...args], installation, {
			...executionEnvironment(),
			CHECKMATE_ASSERT_STATIC: '1',
		})
		assert.equal(result.code, 0, result.stderr)
		const document = oneDocument(result.stdout)
		assert.equal(
			args[0] === 'describe' ? document.environment.drivers[0].contractVersion : document.driver.contractVersion,
			1
		)
	}
	await writeFile(
		resolve(installation, 'api-probe.mjs'),
		`import { run } from '@xoxoai/checkmate'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
const result = await run(JSON.parse(await readFile('request.json', 'utf8')))
process.stdout.write(JSON.stringify(result, null, 2) + '\\n')
`
	)
	for (const args of [[binary, 'run', 'request.json'], ['api-probe.mjs']]) {
		nestedRequests = 0
		const execution = await runProcess(process.execPath, args, installation, executionEnvironment())
		assert.equal(execution.code, 0, execution.stderr)
		const result = oneDocument(execution.stdout)
		assert.equal(result.status, 'passed', execution.stdout)
		assert.equal(result.driver.contractVersion, 1)
		assert.equal(nestedRequests, 4)
		assert.deepEqual(
			result.steps.map((step) => step.usage.totalTokens),
			[20, 20]
		)
		assert.deepEqual(
			result.steps.map((step) => step.usage.cachedPromptTokens),
			[6, 6]
		)
		assert.equal(result.usage.totalTokens, 40)
		assert.equal(result.usage.cachedPromptTokens, 12)
		assert.equal(result.usage.state, 'complete')
		assert.equal(
			await readFile(
				resolve(
					installation,
					'.checkmate/runs',
					await runDirectoryFor(installation, result.runId),
					'result.json'
				),
				'utf8'
			),
			execution.stdout
		)
	}
	nested.scenario.limits = { budgetTokens: 8 }
	await writeFile(resolve(installation, 'request.json'), JSON.stringify(nested))
	nestedRequests = 0
	const execution = await runProcess(
		process.execPath,
		[binary, 'run', 'request.json'],
		installation,
		executionEnvironment()
	)
	assert.equal(execution.code, 3, execution.stderr)
	const result = oneDocument(execution.stdout)
	assert.equal(result.reason, 'token-budget-exceeded')
	assert.equal(result.steps[1].status, 'not-run')
	assert.equal(result.steps[0].usage.totalTokens, 10)
	assert.equal(result.usage.totalTokens, 10)
	assert.equal(nestedRequests, 1)
	assert.equal(
		await readFile(
			resolve(installation, '.checkmate/runs', await runDirectoryFor(installation, result.runId), 'result.json'),
			'utf8'
		),
		execution.stdout
	)
}

function completion(tool) {
	return {
		id: 'acceptance',
		object: 'chat.completion',
		created: 1,
		model: 'fixture',
		choices: [
			{
				index: 0,
				message: tool
					? {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'call',
									type: 'function',
									function: { name: tool, arguments: JSON.stringify({ actualResult: tool }) },
								},
							],
						}
					: { role: 'assistant', content: 'no tool' },
				finish_reason: tool ? 'tool_calls' : 'stop',
			},
		],
		usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
	}
}

function request(mode) {
	return {
		schemaVersion: 1,
		scenario: {
			id: `acceptance-${mode}`,
			driver: { id: 'fixture', target: { mode } },
			policy: 'ci',
			...(mode === 'hang' ? { limits: { timeoutMs: 1000 } } : {}),
			steps: [{ id: 'step', action: `execute ${mode}`, expect: `${mode} result` }],
		},
	}
}

async function writeManifest(root, baseUrl) {
	await writeFile(
		resolve(root, 'checkmate.config.json'),
		JSON.stringify({
			schemaVersion: 1,
			outputDirectory: '.checkmate/runs',
			defaultPolicy: 'ci',
			secretBindings: {
				provider: { source: 'environment', name: 'CHECKMATE_ACCEPTANCE_PROVIDER_KEY' },
				driver: { source: 'environment', name: 'CHECKMATE_ACCEPTANCE_DRIVER_KEY' },
			},
			policies: {
				ci: {
					modelEgress: {
						provider: { id: 'openai', model: 'fixture', baseUrl, apiKeyBinding: 'provider' },
						textRedaction: 'on',
						allowOpaque: false,
						maxStepBytes: 1048576,
						maxMessageBytes: 262144,
					},
					bounds: {
						scenarioTimeoutMs: 5000,
						stepTimeoutMs: 1000,
						turnsPerStep: 1,
						requestTimeoutMs: 500,
						maxRetries: 0,
						loopMaxRepetitions: 2,
						cleanupTimeoutMs: 500,
						budgetTokens: 100,
					},
					evidence: { retention: 'retain-on-failure', redaction: 'on', allowOpaque: false },
					drivers: { fixture: { settings: {}, tools: { allowed: ['*'] } } },
				},
			},
			drivers: { fixture: { package: '@checkmate-test/acceptance-driver', secrets: { session: 'driver' } } },
		})
	)
}

async function writeDriver(root) {
	const directory = resolve(root, 'node_modules/@checkmate-test/acceptance-driver')
	await mkdir(directory, { recursive: true })
	await writeFile(
		resolve(directory, 'package.json'),
		JSON.stringify({
			name: '@checkmate-test/acceptance-driver',
			version: '1.0.0',
			type: 'module',
			exports: { '.': './index.js', './checkmate-driver.json': './checkmate-driver.json' },
		})
	)
	await writeFile(
		resolve(directory, 'checkmate-driver.json'),
		JSON.stringify({
			schemaVersion: 1,
			id: 'fixture',
			driverContractVersion: 1,
			targetSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['mode'],
				properties: { mode: { enum: ['pass', 'app', 'model', 'infra', 'hang'] } },
			},
			settingsSchema: { type: 'object', additionalProperties: false },
			requiredSecretSlots: ['session'],
			tools: [],
			evidenceKinds: [],
		})
	)
	await writeFile(
		resolve(directory, 'index.js'),
		`export const checkmateDriver = {
  id: 'fixture', driverContractVersion: 1,
  async start(input) {
    input.secrets.read('session')
    if (input.target.mode === 'hang') while (true) {}
    return { tools: [], instructions: [], buildInitialContext: async () => [], handleToolResponses: async () => [], close: async () => undefined }
  },
}\n`
	)
}

function runProcess(command, args, cwd, env = process.env) {
	return new Promise((accept, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
		let stdout = ''
		let stderr = ''
		child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
		child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
		child.once('error', reject)
		child.once('close', (code) => accept({ code: code ?? 1, stdout, stderr }))
	})
}

function executionEnvironment() {
	return {
		...process.env,
		CHECKMATE_ACCEPTANCE_PROVIDER_KEY: 'provider-secret',
		CHECKMATE_ACCEPTANCE_DRIVER_KEY: 'driver-secret',
	}
}

function oneDocument(stdout) {
	const result = JSON.parse(stdout)
	assert.equal(
		stdout
			.trim()
			.split('\n')
			.filter((line) => line === '{').length,
		1
	)
	return result
}

async function runDirectoryFor(root, runId) {
	const { readdir } = await import('node:fs/promises')
	const entries = await readdir(resolve(root, '.checkmate/runs'))
	const directory = entries.find((entry) => entry.endsWith(`-${runId}`))
	assert(directory)
	return directory
}
