import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExamples } from '../cli/create-examples'

const tempDirectories: string[] = []

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('createExamples', () => {
	it('scaffolds example files, scripts, and devDependencies', async () => {
		const projectDir = await createTempProject()
		await writePackageJson(projectDir, { name: 'demo-project' })

		const result = await createExamples({ cwd: projectDir })

		expect(result.createdFiles).toEqual([
			'playwright.config.ts',
			'test/examples/web/website-testing.spec.ts',
			'test/examples/salesforce/trial-dev-org.spec.ts',
		])
		expect(result.addedScripts).toEqual(['test:web', 'test:salesforce', 'test:web:example', 'show:report'])
		expect(result.addedDevDependencies).toEqual(['@playwright/test@^1.59.1', 'dotenv@^17.4.1'])

		const packageJson = await readPackageJson(projectDir)
		expect(packageJson.scripts).toMatchObject({
			'test:web': 'npx playwright test --project=web',
			'test:salesforce': 'npx playwright test --project=salesforce',
			'test:web:example':
				'export CHECKMATE_LOG_LEVEL=info && npx playwright test --project=web --grep=ollama --headed',
			'show:report': 'npx playwright show-report test-reports/html',
		})
		expect(packageJson.devDependencies).toMatchObject({
			'@playwright/test': '^1.59.1',
			dotenv: '^17.4.1',
		})

		await expect(readFile(path.join(projectDir, 'playwright.config.ts'), 'utf8')).resolves.toContain('defineConfig')
		await expect(
			readFile(path.join(projectDir, 'test/examples/web/website-testing.spec.ts'), 'utf8')
		).resolves.toContain("import { test } from '@xoxoai/checkmate/playwright'")
	})

	it('preserves existing files, scripts, and dependencies', async () => {
		const projectDir = await createTempProject()
		await mkdir(path.join(projectDir, 'test/examples/web'), { recursive: true })
		await writeFile(path.join(projectDir, 'playwright.config.ts'), 'custom config\n')
		await writePackageJson(projectDir, {
			name: 'demo-project',
			dependencies: { dotenv: '^99.0.0' },
			devDependencies: { '@playwright/test': '^99.0.0' },
			scripts: {
				'test:web': 'custom test command',
			},
		})

		const result = await createExamples({ cwd: projectDir })

		expect(result.skippedFiles).toContain('playwright.config.ts')
		expect(result.skippedScripts).toContain('test:web')
		expect(result.skippedDevDependencies).toEqual(['@playwright/test', 'dotenv'])

		await expect(readFile(path.join(projectDir, 'playwright.config.ts'), 'utf8')).resolves.toBe('custom config\n')

		const packageJson = await readPackageJson(projectDir)
		expect(packageJson.scripts?.['test:web']).toBe('custom test command')
		expect(packageJson.dependencies?.dotenv).toBe('^99.0.0')
		expect(packageJson.devDependencies?.['@playwright/test']).toBe('^99.0.0')
	})

	it('fails when package.json is missing', async () => {
		const projectDir = await createTempProject()

		await expect(createExamples({ cwd: projectDir })).rejects.toThrow(
			`Could not find package.json in '${projectDir}'. Run this command from your project root.`
		)
	})
})

async function createTempProject(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'checkmate-create-examples-'))
	tempDirectories.push(directory)
	return directory
}

async function writePackageJson(directory: string, packageJson: Record<string, unknown>): Promise<void> {
	await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
}

async function readPackageJson(directory: string): Promise<Record<string, any>> {
	return JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as Record<string, any>
}
