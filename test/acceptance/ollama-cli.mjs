import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { config as loadEnvironment } from 'dotenv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { runTracked, assertProcessesExited } from './browser-processes.mjs'
import { browserAudit } from './browser-audit.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
loadEnvironment({ path: resolve(repositoryRoot, '.env'), quiet: true })

const required = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']
for (const name of required) {
	if (typeof process.env[name] !== 'string' || process.env[name].trim() === '') {
		throw new Error(`${name} is required for the selected live Ollama acceptance test`)
	}
}

const installation = await mkdtemp(resolve(tmpdir(), 'checkmate-ollama-cli-'))
const packageDirectory = await mkdtemp(resolve(tmpdir(), 'checkmate-ollama-package-'))
let submitted = false
const form = createServer((request, response) => {
	if (request.url === '/saved?name=cobalt%20heron') submitted = true
	response.writeHead(200, { 'content-type': 'text/html' })
	response.end(
		`<html><body><h1>Form ready</h1><form onsubmit="event.preventDefault(); const name = document.querySelector('input').value; document.querySelector('h1').textContent = 'Saved ' + name; fetch('/saved?name=' + encodeURIComponent(name))"><label>Name<input></label><button>Save</button></form></body></html>`
	)
})
await new Promise((accept) => form.listen(0, '127.0.0.1', accept))
const baseUrl = `http://127.0.0.1:${form.address().port}`

try {
	const tarball = process.argv[2]
		? resolve(process.cwd(), process.argv[2])
		: await buildCandidate(repositoryRoot, packageDirectory)
	await writeFile(resolve(installation, 'package.json'), '{"private":true,"type":"module"}\n')
	await run(
		'npm',
		['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball],
		installation
	)
	await writeFile(resolve(installation, 'checkmate.config.json'), JSON.stringify(manifest()))
	await writeFile(resolve(installation, 'request.json'), JSON.stringify(request()))

	const binary = resolve(installation, 'node_modules/@xoxoai/checkmate/bin/checkmate.js')
	const audit = await browserAudit(installation)
	const execution = await runTracked(process.execPath, [binary, 'run', 'request.json'], installation, {
		...process.env,
		...audit.env,
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
	})
	const result = JSON.parse(execution.stdout)
	await assertProcessesExited(execution.browserPids)
	await audit.verify()
	if (execution.code !== 0) {
		const { DiagnosticSanitizer } = await import('../../dist/redaction/diagnostic-sanitizer.js')
		const sanitizer = new DiagnosticSanitizer(required.map((name) => process.env[name]))
		throw new Error(
			sanitizer.text(
				JSON.stringify({
					reason: result.reason,
					diagnostics: result.diagnostics,
					steps: result.steps?.map(({ reason, actual, toolCalls }) => ({ reason, actual, toolCalls })),
				})
			)
		)
	}
	const schema = JSON.parse(
		await readFile(resolve(installation, 'node_modules/@xoxoai/checkmate/schemas/run-result.v1.json'), 'utf8')
	)
	const validator = new Ajv2020({ strict: true, allErrors: true })
	addFormats(validator)
	const validate = validator.compile(schema)
	assert.equal(validate(result), true, JSON.stringify(validate.errors))
	assert.equal(result.status, 'passed')
	assert.equal(result.category, 'passed')
	assert.equal(result.scenarioId, 'ollama-qwen3-vl')
	assert(submitted, 'Live model did not submit the real form with the expected input')
	assert.equal(result.steps.length, 3)
	for (const name of [
		'browser_navigate',
		'browser_observe',
		'browser_act',
		'browser_extract',
		'browser_diagnostics',
	]) {
		assert(
			result.steps.flatMap((step) => step.toolCalls).some((call) => call.name === name),
			`Live workflow did not exercise ${name}`
		)
	}
	const directories = await readdir(resolve(installation, '.checkmate/runs'))
	const directory = directories.find((entry) => entry.endsWith(`-${result.runId}`))
	assert(directory)
	assert.equal(
		await readFile(resolve(installation, '.checkmate/runs', directory, 'result.json'), 'utf8'),
		execution.stdout
	)
	assert(result.evidence.references.length > 0)
	assert.equal(result.driver.contractVersion, 1)
	assert(result.steps.every((step) => step.toolCalls.some((call) => call.name === 'browser_extract')))
	for (const reference of result.evidence.references) {
		assert.equal(reference.kind, 'transcript')
		await access(resolve(installation, reference.path))
	}
	assert(execution.browserPids.size > 0, 'live acceptance did not observe the built-in web driver browser process')
} finally {
	form.closeAllConnections()
	await new Promise((accept) => form.close(accept))
	await Promise.all([
		rm(installation, { recursive: true, force: true }),
		rm(packageDirectory, { recursive: true, force: true }),
	])
}

async function buildCandidate(root, destination) {
	await run('npm', ['run', 'build:package'], root)
	const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], root)
	const output = JSON.parse(packed.stdout)
	assert.equal(output.length, 1)
	return resolve(destination, output[0].filename)
}

function manifest() {
	return {
		schemaVersion: 1,
		outputDirectory: '.checkmate/runs',
		defaultPolicy: 'live',
		secretBindings: {
			'provider-key': { source: 'environment', name: 'OPENAI_API_KEY' },
		},
		policies: {
			live: {
				modelEgress: {
					provider: {
						id: 'openai',
						model: process.env.OPENAI_MODEL,
						baseUrl: process.env.OPENAI_BASE_URL,
						apiKeyBinding: 'provider-key',
						temperature: 0,
					},
					textRedaction: 'on',
					allowOpaque: false,
					maxStepBytes: 1048576,
					maxMessageBytes: 262144,
				},
				bounds: {
					scenarioTimeoutMs: 300000,
					stepTimeoutMs: 120000,
					turnsPerStep: 20,
					requestTimeoutMs: 60000,
					maxRetries: 1,
					loopMaxRepetitions: 5,
					cleanupTimeoutMs: 10000,
					budgetTokens: 200000,
				},
				evidence: { retention: 'on', redaction: 'on', allowOpaque: false },
				drivers: {
					web: {
						settings: {
							headless: true,
						},
						tools: { allowed: ['*'] },
					},
				},
			},
		},
		drivers: { web: { package: '@xoxoai/checkmate/driver-web', secrets: {} } },
	}
}

function request() {
	return {
		schemaVersion: 1,
		scenario: {
			id: 'ollama-qwen3-vl',
			name: 'Submit a form then inspect the qwen3-vl 235b model on Ollama',
			driver: { id: 'web', target: { baseUrl } },
			policy: 'live',
			steps: [
				{
					id: 'submit-form',
					action: 'Use browser_observe to discover the form controls. Fill Name with cobalt heron and click Save using separate browser_act calls. Extract the resulting heading and read browser_diagnostics before issuing a verdict.',
					expect: 'The page heading says Saved cobalt heron',
				},
				{
					id: 'persisted-form',
					action: 'Without navigating or modifying the page, extract the heading again',
					expect: 'The page still says Saved cobalt heron',
				},
				{
					id: 'inspect-235b',
					action: 'Navigate to https://ollama.com/library/qwen3-vl:235b and extract the model name and variant',
					expect: 'The qwen3-vl:235b details are visible',
				},
			],
		},
	}
}

function run(command, args, cwd, env = process.env) {
	return new Promise((accept, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
		let stdout = ''
		let stderr = ''
		child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
		child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
		child.once('error', reject)
		child.once('close', (code) => {
			if (code === 0) accept({ code, stdout, stderr })
			else reject(new Error(`${command} exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
		})
	})
}
