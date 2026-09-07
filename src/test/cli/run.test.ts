import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { validateRunResult } from '../../contracts/validator.js'
import { createCliTestEnvironment, type CliTestEnvironment } from './helpers.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const environments: CliTestEnvironment[] = []

afterEach(async () => {
	await Promise.all(environments.splice(0).map((environment) => environment.close()))
})

describe('run CLI command', () => {
	it.each([
		['pass', 0, 'passed', 'passed'],
		['app', 1, 'failed', 'app'],
		['model', 2, 'failed', 'model'],
		['infra', 3, 'failed', 'infra'],
	] as const)('writes one execution envelope for %s with exit %i', async (mode, exitCode, status, category) => {
		const environment = await fixture()
		await writeFile(resolve(environment.root, 'request.json'), JSON.stringify(environment.request(mode)))

		const execution = await spawnCli(environment.root, ['run', 'request.json'])
		const result = JSON.parse(execution.stdout)

		expect(execution.exitCode, JSON.stringify(execution)).toBe(exitCode)
		expect(result).toMatchObject({ status, category, scenarioId: `cli-${mode}` })
		expect(validateRunResult(result).ok).toBe(true)
		expect(documentsIn(execution.stdout)).toBe(1)
	})

	it('executes the identical request contract from stdin', async () => {
		const environment = await fixture()
		const execution = await spawnCli(environment.root, ['run', '-'], JSON.stringify(environment.request('pass')))

		expect(execution.exitCode).toBe(0)
		expect(JSON.parse(execution.stdout)).toMatchObject({ status: 'passed', scenarioId: 'cli-pass' })
	})

	it('uses one invalid invocation envelope and exit four', async () => {
		const environment = await fixture()
		await writeFile(resolve(environment.root, 'request.json'), '{}')
		const execution = await spawnCli(environment.root, ['run', 'request.json'])

		expect(execution.exitCode).toBe(4)
		expect(JSON.parse(execution.stdout)).toMatchObject({ status: 'invalid', category: 'invalid' })
		expect(documentsIn(execution.stdout)).toBe(1)
	})

	it('contains a worker that cannot reach a terminal result', async () => {
		const environment = await fixture()
		await writeFile(resolve(environment.root, 'request.json'), JSON.stringify(environment.request('hang')))
		const execution = await spawnCli(environment.root, ['run', 'request.json'])
		const result = JSON.parse(execution.stdout)

		expect(execution.exitCode).toBe(3)
		expect(result).toMatchObject({
			status: 'contained',
			category: 'infra',
			reason: 'parent-containment',
			targetMutation: 'possibly-mutated',
		})
		expect(result).not.toHaveProperty('steps')
		expect(validateRunResult(result).ok).toBe(true)
	})
})

async function fixture(): Promise<CliTestEnvironment> {
	const environment = await createCliTestEnvironment()
	environments.push(environment)
	return environment
}

async function spawnCli(
	cwd: string,
	args: string[],
	input = ''
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((complete, reject) => {
		const child = spawn(
			resolve(repositoryRoot, 'node_modules/.bin/tsx'),
			[new URL('../fixtures/run-cli.ts', import.meta.url).pathname, ...args],
			{
				cwd,
				env: {
					...process.env,
					CHECKMATE_CLI_PROVIDER_KEY: 'provider-secret',
					CHECKMATE_CLI_DRIVER_KEY: 'driver-secret',
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

function documentsIn(stdout: string): number {
	JSON.parse(stdout)
	return stdout
		.trim()
		.split('\n')
		.filter((line) => line === '{').length
}
