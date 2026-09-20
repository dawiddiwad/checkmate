import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createCliTestEnvironment, type CliTestEnvironment } from './helpers.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
let environment: CliTestEnvironment | undefined

afterEach(async () => {
	await environment?.close()
	environment = undefined
})

describe('CLI stdout isolation', () => {
	it('discards raw worker streams and sanitizes logger diagnostics', async () => {
		environment = await createCliTestEnvironment()
		await writeFile(resolve(environment.root, 'request.json'), JSON.stringify(environment.request('noisy')))
		const execution = await spawnNoisy(environment.root)

		expect(execution.exitCode).toBe(0)
		expect(JSON.parse(execution.stdout)).toMatchObject({ status: 'passed', scenarioId: 'cli-noisy' })
		expect(
			execution.stdout
				.trim()
				.split('\n')
				.filter((line) => line === '{')
		).toHaveLength(1)
		expect(execution.stderr).toContain('worker.stream-output-discarded')
		expect(execution.stderr).toContain('worker.log.warn')
		expect(`${execution.stdout}${execution.stderr}`).not.toContain('driver-secret')
		expect(execution.stderr).not.toContain('raw stdout')
		expect(execution.stderr).not.toContain('raw stderr')
	})

	it('stores selected logs as sanitized driver evidence', async () => {
		environment = await createCliTestEnvironment()
		const configPath = resolve(environment.root, 'checkmate.config.json')
		const manifest = JSON.parse(await readFile(configPath, 'utf8')) as {
			policies: {
				ci: {
					evidence: { retention: 'on' | 'retain-on-failure' | 'off' }
					drivers: { fixture: { settings: { logLevel: string; logsAsEvidence?: boolean } } }
				}
			}
		}
		manifest.policies.ci.evidence.retention = 'on'
		manifest.policies.ci.drivers.fixture.settings.logsAsEvidence = true
		await writeFile(configPath, `${JSON.stringify(manifest, null, 2)}\n`)
		await writeFile(resolve(environment.root, 'request.json'), JSON.stringify(environment.request('noisy')))

		const execution = await spawnNoisy(environment.root)
		const result = JSON.parse(execution.stdout) as {
			evidence: { references: Array<{ kind: string; path: string; stepId?: string }> }
		}
		const reference = result.evidence.references.find(({ kind }) => kind === 'web-driver-log')

		expect(execution.exitCode).toBe(0)
		expect(reference).toBeDefined()
		expect(reference).not.toHaveProperty('stepId')
		const transcript = await readFile(resolve(environment.root, reference!.path), 'utf8')
		expect(transcript).toContain('[warn] logger [secret omitted]')
		expect(transcript).not.toContain('driver-secret')
	})

	it('preserves redaction-off result bytes while diagnostic channels stay sanitized', async () => {
		environment = await createCliTestEnvironment()
		const configPath = resolve(environment.root, 'checkmate.config.json')
		const manifest = JSON.parse(await readFile(configPath, 'utf8')) as {
			policies: { ci: { evidence: { redaction: 'on' | 'off' } } }
		}
		manifest.policies.ci.evidence.redaction = 'off'
		await writeFile(configPath, `${JSON.stringify(manifest, null, 2)}\n`)
		await writeFile(resolve(environment.root, 'request.json'), JSON.stringify(environment.request('noisy')))

		const execution = await spawnNoisy(environment.root)
		const result = JSON.parse(execution.stdout) as { runId: string; steps: Array<{ actual?: string }> }
		const runs = resolve(environment.root, '.checkmate/runs')
		const { readdir } = await import('node:fs/promises')
		const directory = (await readdir(runs)).find((entry) => entry.endsWith(`-${result.runId}`))

		expect(execution.exitCode).toBe(0)
		expect(result.steps[0].actual).toBe('driver-secret')
		expect(directory).toBeDefined()
		expect(await readFile(resolve(runs, directory!, 'result.json'), 'utf8')).toBe(execution.stdout)
		expect(execution.stderr).not.toContain('driver-secret')
	})
})

function spawnNoisy(cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((complete, reject) => {
		const child = spawn(
			resolve(repositoryRoot, 'node_modules/.bin/tsx'),
			[new URL('../fixtures/run-cli.ts', import.meta.url).pathname, 'run', 'request.json'],
			{
				cwd,
				env: {
					...process.env,
					CHECKMATE_CLI_PROVIDER_KEY: 'provider-secret',
					CHECKMATE_CLI_DRIVER_KEY: 'driver-secret',
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			}
		)
		let stdout = ''
		let stderr = ''
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
		child.once('error', reject)
		child.once('close', (code) => complete({ stdout, stderr, exitCode: code ?? 1 }))
	})
}
