import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { clearInterval, setInterval, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import { config as loadEnvironment } from 'dotenv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

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
	await run(resolve(installation, 'node_modules/.bin/playwright'), ['install', 'chromium'], installation)
	await writeFile(resolve(installation, 'checkmate.config.json'), JSON.stringify(manifest()))
	await writeFile(resolve(installation, 'request.json'), JSON.stringify(request()))

	const binary = resolve(installation, 'node_modules/@xoxoai/checkmate/bin/checkmate.js')
	const execution = await runTracked(process.execPath, [binary, 'run', 'request.json'], installation, {
		...process.env,
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
	})
	assert.equal(execution.code, 0, 'live Ollama scenario did not pass')
	const result = JSON.parse(execution.stdout)
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
	assert(result.evidence.references.length > 0)
	for (const reference of result.evidence.references) await access(resolve(installation, reference.path))
	assert(execution.browserPids.size > 0, 'live acceptance did not observe the built-in web driver browser process')
	await assertProcessesExited(execution.browserPids)
} finally {
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
							snapshotFilter: false,
							snapshotTopPercent: 10,
							screenshotsInModelContext: false,
							logLevel: 'info',
							logsAsEvidence: false,
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
			name: 'Find the qwen3-vl 235b model on Ollama',
			driver: { id: 'web', target: { baseUrl: 'https://ollama.com' } },
			policy: 'live',
			steps: [
				{ id: 'search', action: 'Search for qwen3-vl', expect: 'Search results include qwen3-vl' },
				{
					id: 'open-model',
					action: 'Open the qwen3-vl model page',
					expect: 'The qwen3-vl model page is visible',
				},
				{
					id: 'open-235b',
					action: 'Open the qwen3-vl:235b variant',
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

function runTracked(command, args, cwd, env) {
	return new Promise((accept, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
		const browserPids = new Set()
		let stdout = ''
		let stderr = ''
		let sampling
		const sample = async () => {
			if (sampling) return sampling
			sampling = sampleBrowserDescendants(child.pid, browserPids).finally(() => (sampling = undefined))
			return sampling
		}
		const interval = setInterval(() => void sample(), 100)
		child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
		child.stderr.setEncoding('utf8').on('data', (chunk) => {
			stderr += chunk
			process.stderr.write(chunk)
		})
		child.once('error', reject)
		child.once('close', async (code) => {
			clearInterval(interval)
			await sampling
			if (code === 0) accept({ code, stdout, stderr, browserPids })
			else reject(new Error(`${command} exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
		})
	})
}

async function sampleBrowserDescendants(rootPid, browserPids) {
	if (!rootPid) return
	const listing = await run('ps', ['-axo', 'pid=,ppid=,command='], process.cwd())
	const processes = listing.stdout
		.split('\n')
		.map((line) => /^(\s*\d+)\s+(\d+)\s+(.+)$/.exec(line))
		.filter(Boolean)
		.map((match) => ({ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }))
	const descendants = new Set([rootPid])
	for (;;) {
		const before = descendants.size
		for (const entry of processes) if (descendants.has(entry.parent)) descendants.add(entry.pid)
		if (descendants.size === before) break
	}
	for (const entry of processes) {
		if (descendants.has(entry.pid) && /chrom(?:e|ium)|headless_shell/i.test(entry.command))
			browserPids.add(entry.pid)
	}
}

async function assertProcessesExited(pids) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if ([...pids].every((pid) => !processExists(pid))) return
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
	}
	throw new Error('built-in web driver left a browser process running after worker exit')
}

function processExists(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		if (error && error.code === 'ESRCH') return false
		throw error
	}
}
