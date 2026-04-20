import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type CreateExamplesOptions = {
	cwd?: string
}

export type CreateExamplesResult = {
	createdFiles: string[]
	skippedFiles: string[]
	addedScripts: string[]
	skippedScripts: string[]
	addedDevDependencies: string[]
	skippedDevDependencies: string[]
}

type PackageJson = {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	scripts?: Record<string, string>
	[key: string]: unknown
}

const SCAFFOLD_SCRIPTS: Record<string, string> = {
	'test:web': 'npx playwright test --project=web',
	'test:salesforce': 'npx playwright test --project=salesforce',
	'test:web:example': 'export CHECKMATE_LOG_LEVEL=info && npx playwright test --project=web --grep=ollama --headed',
	'show:report': 'npx playwright show-report test-reports/html',
}

const SCAFFOLD_FILES = [
	{ source: new URL('../../playwright.config.ts', import.meta.url), target: 'playwright.config.ts' },
	{
		source: new URL('../../test/examples/web/website-testing.spec.ts', import.meta.url),
		target: 'test/examples/web/website-testing.spec.ts',
	},
	{
		source: new URL('../../test/examples/salesforce/trial-dev-org.spec.ts', import.meta.url),
		target: 'test/examples/salesforce/trial-dev-org.spec.ts',
	},
] as const

/**
 * Scaffolds example Playwright config, example tests, and package scripts into the target project.
 *
 * @example
 * ```ts
 * await createExamples({ cwd: process.cwd() })
 * ```
 */
export async function createExamples(options: CreateExamplesOptions = {}): Promise<CreateExamplesResult> {
	const cwd = path.resolve(options.cwd ?? process.cwd())
	const packageJsonPath = path.join(cwd, 'package.json')
	const packageJson = await readPackageJson(packageJsonPath)
	const packageInfo = await readCurrentPackageInfo()
	const result: CreateExamplesResult = {
		createdFiles: [],
		skippedFiles: [],
		addedScripts: [],
		skippedScripts: [],
		addedDevDependencies: [],
		skippedDevDependencies: [],
	}

	for (const file of SCAFFOLD_FILES) {
		const targetPath = path.join(cwd, file.target)
		if (await pathExists(targetPath)) {
			result.skippedFiles.push(file.target)
			continue
		}

		await mkdir(path.dirname(targetPath), { recursive: true })
		await copyFile(fileURLToPath(file.source), targetPath)
		result.createdFiles.push(file.target)
	}

	const scripts = ensureRecord(packageJson, 'scripts')
	for (const [name, command] of Object.entries(SCAFFOLD_SCRIPTS)) {
		if (name in scripts) {
			result.skippedScripts.push(name)
			continue
		}

		scripts[name] = command
		result.addedScripts.push(name)
	}

	const dependencies = packageJson.dependencies ?? {}
	const devDependencies = ensureRecord(packageJson, 'devDependencies')
	for (const [name, version] of Object.entries(packageInfo.devDependencies)) {
		if (name in dependencies || name in devDependencies) {
			result.skippedDevDependencies.push(name)
			continue
		}

		devDependencies[name] = version
		result.addedDevDependencies.push(`${name}@${version}`)
	}

	await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

	return result
}

async function readPackageJson(filePath: string): Promise<PackageJson> {
	if (!(await pathExists(filePath))) {
		throw new Error(
			`Could not find package.json in '${path.dirname(filePath)}'. Run this command from your project root.`
		)
	}

	const content = await readFile(filePath, 'utf8')
	const parsed = JSON.parse(content) as PackageJson
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('package.json must contain a JSON object.')
	}

	return parsed
}

async function readCurrentPackageInfo(): Promise<{ devDependencies: Record<string, string> }> {
	const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url))
	const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson & {
		peerDependencies?: Record<string, string>
	}

	return {
		devDependencies: {
			'@playwright/test': packageJson.peerDependencies?.['@playwright/test'] ?? '^1.59.1',
			dotenv: packageJson.devDependencies?.dotenv ?? '^17.4.1',
		},
	}
}

function ensureRecord(packageJson: PackageJson, key: 'scripts' | 'devDependencies'): Record<string, string> {
	const value = packageJson[key]
	if (!value) {
		const nextValue: Record<string, string> = {}
		packageJson[key] = nextValue
		return nextValue
	}

	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`package.json field '${key}' must be an object.`)
	}

	return value as Record<string, string>
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}
