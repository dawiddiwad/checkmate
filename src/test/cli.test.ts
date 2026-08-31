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

	it('routes the init command, printing what it wrote and the config block to paste', async () => {
		const projectDir = await createTempProject()

		const stdout = createMemoryWriter()
		const stderr = createMemoryWriter()
		const exitCode = await runCli(['init'], {
			stdout,
			stderr,
			getCwd: () => projectDir,
		})

		expect(exitCode).toBe(0)
		expect(stderr.output).toBe('')
		expect(stdout.output).toContain('checkmate.fixtures.ts')
		expect(stdout.output).toContain('AGENTS.md')
		expect(stdout.output).toContain('Add to playwright.config.ts:')
		expect(stdout.output).toContain("checkmateModel: 'gpt-5-mini'")
		expect(stdout.output).toContain('Then import `test` from ./checkmate.fixtures in your specs.')
		await expect(readFile(path.join(projectDir, 'checkmate.fixtures.ts'), 'utf8')).resolves.toContain('mergeTests')
	})

	it('routes --target through to init', async () => {
		const projectDir = await createTempProject()

		const stdout = createMemoryWriter()
		const stderr = createMemoryWriter()
		const exitCode = await runCli(['init', '--target', 'CLAUDE.md'], {
			stdout,
			stderr,
			getCwd: () => projectDir,
		})

		expect(exitCode).toBe(0)
		expect(stderr.output).toBe('')
		await expect(readFile(path.join(projectDir, 'CLAUDE.md'), 'utf8')).resolves.toContain(
			'<!-- checkmate:instructions:start -->'
		)
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

	it('lists both commands in --help usage', async () => {
		const stdout = createMemoryWriter()
		const stderr = createMemoryWriter()

		const exitCode = await runCli(['--help'], {
			stdout,
			stderr,
			getCwd: () => process.cwd(),
		})

		expect(exitCode).toBe(0)
		expect(stdout.output).toContain('init')
		expect(stdout.output).toContain('create-examples')
		expect(stdout.output.indexOf('init')).toBeLessThan(stdout.output.indexOf('create-examples'))
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
