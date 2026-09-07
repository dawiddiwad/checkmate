import { spawn } from 'node:child_process'
import { access, writeFile } from 'node:fs/promises'
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

describe('CLI process signals', () => {
	it('returns an interrupted infrastructure envelope after one cooperative signal', async () => {
		environment = await signalEnvironment()
		const child = startCli(environment.root)
		await waitForDriver(environment.root)
		child.kill('SIGINT')
		const execution = await collect(child)

		expect(execution.exitCode).toBe(3)
		expect(JSON.parse(execution.stdout), JSON.stringify(execution)).toMatchObject({
			status: 'interrupted',
			category: 'infra',
			reason: 'interrupted',
		})
	})

	it.each([
		['SIGINT', 'SIGTERM', 130],
		['SIGTERM', 'SIGINT', 143],
	] as const)(
		'preserves first %s native exit after second %s',
		async (first, second, exitCode) => {
			environment = await signalEnvironment()
			const child = startCli(environment.root)
			await waitForDriver(environment.root)
			child.kill(first)
			await waitForAbort(environment.root)
			child.kill(second)
			const execution = await collect(child)

			expect(execution.exitCode, JSON.stringify(execution)).toBe(exitCode)
			expect(execution.stdout).toBe('')
		},
		20_000
	)
})

async function signalEnvironment(): Promise<CliTestEnvironment> {
	const fixture = await createCliTestEnvironment()
	await writeFile(resolve(fixture.root, 'request.json'), JSON.stringify(fixture.request('signal')))
	return fixture
}

function startCli(cwd: string) {
	return spawn(
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
}

async function waitForDriver(root: string): Promise<void> {
	return waitForMarker(resolve(root, 'driver.ready'), 'CLI driver did not start before the signal test deadline')
}

async function waitForAbort(root: string): Promise<void> {
	return waitForMarker(resolve(root, 'driver.ready.aborted'), 'CLI worker did not observe the first abort')
}

async function waitForMarker(marker: string, message: string): Promise<void> {
	for (let attempt = 0; attempt < 1000; attempt++) {
		if (
			await access(marker).then(
				() => true,
				() => false
			)
		)
			return
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
	}
	throw new Error(message)
}

function collect(child: ReturnType<typeof startCli>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((complete, reject) => {
		let stdout = ''
		let stderr = ''
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
		child.once('error', reject)
		child.once('close', (code, signal) => {
			const signalCode = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1
			complete({ stdout, stderr, exitCode: code ?? signalCode })
		})
	})
}
