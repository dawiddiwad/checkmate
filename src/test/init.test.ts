import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURES_FILE_NAME, runInit } from '../cli/init'

const tempDirectories: string[] = []

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('runInit', () => {
	it('writes the fixtures file and creates AGENTS.md with the Checkmate section', async () => {
		const projectDir = await createTempProject()

		const result = await runInit({ cwd: projectDir })

		expect(result.fixturesFile).toEqual({ path: FIXTURES_FILE_NAME, action: 'created' })
		expect(result.instructions.target).toBe('AGENTS.md')
		expect(result.instructions.action).toBe('created')
		expect(result.instructions.detected).toEqual([])

		const fixturesContent = await readFile(path.join(projectDir, FIXTURES_FILE_NAME), 'utf8')
		expect(fixturesContent).toContain("import { mergeTests, test as base } from '@playwright/test'")
		expect(fixturesContent).toContain("import { checkmate } from '@xoxoai/checkmate/playwright'")
		expect(fixturesContent).toContain('export const test = mergeTests(base, checkmate)')

		const agentsContent = await readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')
		expect(agentsContent).toContain('<!-- checkmate:instructions:start -->')
		expect(agentsContent).toContain('<!-- checkmate:instructions:end -->')
		expect(agentsContent).toContain('When NOT to use')
		expect(agentsContent).toContain('How to write a step')
	})

	it('prints a config block built from the package defaults', async () => {
		const projectDir = await createTempProject()

		const result = await runInit({ cwd: projectDir })

		expect(result.configBlock).toBe("use: { checkmateModel: 'gpt-5-mini', checkmateTurnCap: 20 },")
	})

	it('skips an existing fixtures file rather than overwriting it', async () => {
		const projectDir = await createTempProject()
		await writeFile(path.join(projectDir, FIXTURES_FILE_NAME), '// hand-written\n')

		const result = await runInit({ cwd: projectDir })

		expect(result.fixturesFile).toEqual({ path: FIXTURES_FILE_NAME, action: 'skipped' })
		await expect(readFile(path.join(projectDir, FIXTURES_FILE_NAME), 'utf8')).resolves.toBe('// hand-written\n')
	})

	it('replaces its own delimited section on re-run, leaving the rest of the file untouched', async () => {
		const projectDir = await createTempProject()
		await writeFile(
			path.join(projectDir, 'AGENTS.md'),
			['# AGENTS.md', '', '## Coding Standards', '', 'Write code like Linus Torvalds.', ''].join('\n')
		)

		const first = await runInit({ cwd: projectDir })
		expect(first.instructions.action).toBe('appended')
		const afterFirst = await readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')
		expect(afterFirst).toContain('## Coding Standards')
		expect(afterFirst).toContain('Write code like Linus Torvalds.')
		expect(afterFirst).toContain('<!-- checkmate:instructions:start -->')

		await rm(path.join(projectDir, FIXTURES_FILE_NAME))
		const second = await runInit({ cwd: projectDir })
		expect(second.instructions.action).toBe('replaced')
		const afterSecond = await readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')

		expect(afterSecond).toContain('## Coding Standards')
		expect(afterSecond).toContain('Write code like Linus Torvalds.')
		expect((afterSecond.match(/<!-- checkmate:instructions:start -->/g) ?? []).length).toBe(1)
	})

	it('produces byte-identical output files across repeated runs', async () => {
		const projectDir = await createTempProject()
		await writeFile(path.join(projectDir, 'AGENTS.md'), '# Project instructions\n\nExisting content.\n')

		await runInit({ cwd: projectDir })
		const fixturesAfterFirst = await readFile(path.join(projectDir, FIXTURES_FILE_NAME), 'utf8')
		const agentsAfterFirst = await readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')

		await rm(path.join(projectDir, FIXTURES_FILE_NAME))
		await runInit({ cwd: projectDir })
		const fixturesAfterSecond = await readFile(path.join(projectDir, FIXTURES_FILE_NAME), 'utf8')
		const agentsAfterSecond = await readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')

		expect(fixturesAfterSecond).toBe(fixturesAfterFirst)
		expect(agentsAfterSecond).toBe(agentsAfterFirst)
	})

	it('honours --target, writing the section to the given path instead of AGENTS.md', async () => {
		const projectDir = await createTempProject()

		const result = await runInit({ cwd: projectDir, target: '.cursor/rules/checkmate.md' })

		expect(result.instructions.target).toBe('.cursor/rules/checkmate.md')
		const content = await readFile(path.join(projectDir, '.cursor/rules/checkmate.md'), 'utf8')
		expect(content).toContain('<!-- checkmate:instructions:start -->')
		await expect(readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')).rejects.toThrow()
	})

	it('reports other detected instruction-file conventions so a team can retarget', async () => {
		const projectDir = await createTempProject()
		await mkdir(path.join(projectDir, '.cursor/rules'), { recursive: true })
		await writeFile(path.join(projectDir, 'CLAUDE.md'), '# Claude instructions\n')

		const result = await runInit({ cwd: projectDir })

		expect(result.instructions.detected.sort()).toEqual(['.cursor/rules', 'CLAUDE.md'])
	})

	it('does not list the chosen target among the detected alternatives', async () => {
		const projectDir = await createTempProject()
		await mkdir(path.join(projectDir, '.cursor/rules'), { recursive: true })

		const result = await runInit({ cwd: projectDir, target: '.cursor/rules/checkmate.md' })

		expect(result.instructions.detected).not.toContain('.cursor/rules')
	})
})

async function createTempProject(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'checkmate-init-'))
	tempDirectories.push(directory)
	return directory
}
