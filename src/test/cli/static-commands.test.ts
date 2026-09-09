import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDescribeResult, validateValidationResult } from '../../contracts/validator.js'
import { fixtureRequest, writeStaticEnvironment } from '../fixtures/static-environment.js'

const directories: string[] = []
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('static CLI commands', () => {
	it('spawns describe and writes exactly one schema-valid document', async () => {
		const root = await environment()
		const execution = await spawnStatic(['describe'], root)
		const result = JSON.parse(execution.stdout)

		expect(execution.exitCode).toBe(0)
		expect(execution.stderr).toBe('')
		expect(validateDescribeResult(result).ok).toBe(true)
		expect(
			execution.stdout
				.trim()
				.split('\n')
				.filter((line) => line === '{')
		).toHaveLength(1)
	})

	it('spawns validate with the same preparation path and exit zero', async () => {
		const root = await environment()
		const execution = await spawnStatic(['validate', 'request.json'], root)
		const result = JSON.parse(execution.stdout)

		expect(execution.exitCode).toBe(0)
		expect(validateValidationResult(result).ok).toBe(true)
		expect(result).toMatchObject({ status: 'valid', scenarioId: 'fixture-scenario' })
	})

	it('uses exit four for expected invocation defects', async () => {
		const root = await environment()
		const execution = await spawnStatic(['validate', 'missing.json'], root)
		const result = JSON.parse(execution.stdout)

		expect(execution.exitCode).toBe(4)
		expect(result.status).toBe('invalid')
		expect(validateValidationResult(result).ok).toBe(true)
		expect(execution.stderr).toContain('input.unreadable')
	})

	it('uses exit three for unexpected operational errors without leaking their text', async () => {
		const root = await environment()
		const execution = await spawnStatic(['describe'], root, { CHECKMATE_TEST_STATIC_ERROR: '1' })
		const result = JSON.parse(execution.stdout)

		expect(execution.exitCode).toBe(3)
		expect(result.status).toBe('error')
		expect(validateDescribeResult(result).ok).toBe(true)
		expect(`${execution.stdout}${execution.stderr}`).not.toContain('sk-error-that-must-not-leak')
	})

	it('honors an explicit config path without changing the invocation root', async () => {
		const root = await environment('environments/ci.checkmate.json')
		const execution = await spawnStatic(
			['validate', 'request.json', '--config', 'environments/ci.checkmate.json'],
			root
		)
		expect(execution.exitCode).toBe(0)
		expect(JSON.parse(execution.stdout).status).toBe('valid')
	})

	it('accepts the same bounded request through validate stdin', async () => {
		const root = await environment()
		const execution = await spawnStatic(['validate', '-'], root, {}, JSON.stringify(fixtureRequest))

		expect(execution.exitCode).toBe(0)
		expect(JSON.parse(execution.stdout).status).toBe('valid')
	})

	it('maps an operational stdin read failure to error and exit three', async () => {
		const root = await environment()
		const execution = await spawnStatic(['validate', '-'], root, { CHECKMATE_TEST_STDIN_ERROR: '1' })

		expect(execution.exitCode).toBe(3)
		expect(JSON.parse(execution.stdout)).toMatchObject({
			status: 'error',
			diagnostics: [{ code: 'input.read-failed' }],
		})
		expect(`${execution.stdout}${execution.stderr}`).not.toContain('sk-stream-error-that-must-not-leak')
	})

	it('normalizes each stderr diagnostic to one sanitized physical line', async () => {
		const root = await environment()
		const execution = await spawnStatic(['describe'], root, { CHECKMATE_TEST_MULTILINE_DIAGNOSTIC: '1' })

		expect(execution.exitCode).toBe(4)
		expect(execution.stderr.trim().split('\n')).toHaveLength(1)
		expect(execution.stderr).toContain('second line')
		expect(execution.stderr).not.toContain('sk-secret')
	})
})

async function environment(configPath?: string): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-static-cli-'))
	directories.push(root)
	await writeStaticEnvironment(root, configPath)
	return root
}

async function spawnStatic(
	args: string[],
	cwd: string,
	extraEnvironment: Record<string, string> = {},
	input = ''
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((complete, reject) => {
		const child = spawn(
			resolve(repositoryRoot, 'node_modules/.bin/tsx'),
			[new URL('../fixtures/run-static-cli.ts', import.meta.url).pathname, ...args],
			{
				cwd,
				env: {
					...process.env,
					CHECKMATE_TEST_PROVIDER_KEY: 'provider-secret',
					CHECKMATE_TEST_DRIVER_SESSION: 'driver-secret',
					...extraEnvironment,
				},
				stdio: ['pipe', 'pipe', 'pipe'],
			}
		)
		let stdout = ''
		let stderr = ''
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
		child.once('error', reject)
		child.once('close', (code) => complete({ stdout, stderr, exitCode: code ?? 1 }))
		child.stdin.end(input)
	})
}
