import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../cli'

const tempDirectories: string[] = []

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('runCli', () => {
	it('scaffolds examples for the create-examples command', async () => {
		const projectDir = await createTempProject()
		await writeFile(path.join(projectDir, 'package.json'), '{"name":"demo-project"}\n')

		const stdout = createMemoryWriter()
		const stderr = createMemoryWriter()
		const exitCode = await runCli(['create-examples'], {
			stdout,
			stderr,
			getCwd: () => projectDir,
		})

		expect(exitCode).toBe(0)
		expect(stderr.output).toBe('')
		expect(stdout.output).toContain('Scaffolded Checkmate examples.')
		expect(stdout.output).toContain('Next steps:')
		await expect(readFile(path.join(projectDir, 'playwright.config.ts'), 'utf8')).resolves.toContain('defineConfig')
	})

	it('prints usage for unknown commands', async () => {
		const stdout = createMemoryWriter()
		const stderr = createMemoryWriter()

		const exitCode = await runCli(['wat'], {
			stdout,
			stderr,
			getCwd: () => process.cwd(),
		})

		expect(exitCode).toBe(1)
		expect(stdout.output).toBe('')
		expect(stderr.output).toContain("Unknown command 'wat'.")
		expect(stderr.output).toContain('Usage: checkmate <command>')
	})
})

async function createTempProject(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'checkmate-cli-'))
	tempDirectories.push(directory)
	return directory
}

function createMemoryWriter(): { output: string; write: (value: string) => boolean } {
	return {
		output: '',
		write(value: string) {
			this.output += value
			return true
		},
	}
}
