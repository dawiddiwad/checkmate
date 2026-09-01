import { createExamples } from './cli/create-examples.js'
import { InitResult, runInit } from './cli/init.js'

export type CliDependencies = {
	stdout: Pick<NodeJS.WriteStream, 'write'>
	stderr: Pick<NodeJS.WriteStream, 'write'>
	getCwd: () => string
}

const defaultDependencies: CliDependencies = {
	stdout: process.stdout,
	stderr: process.stderr,
	getCwd: () => process.cwd(),
}

/**
 * Runs the Checkmate CLI.
 *
 * @example
 * ```ts
 * await runCli(['init'])
 * ```
 */
export async function runCli(argv: string[], dependencies: CliDependencies = defaultDependencies): Promise<number> {
	const [command, ...rest] = argv

	if (!command || command === '--help' || command === '-h' || command === 'help') {
		dependencies.stdout.write(`${buildUsage()}\n`)
		return command ? 0 : 1
	}

	if (command !== 'init' && command !== 'create-examples') {
		dependencies.stderr.write(`Unknown command '${command}'.\n\n${buildUsage()}\n`)
		return 1
	}

	try {
		if (command === 'init') {
			const result = await runInit({ cwd: dependencies.getCwd(), target: parseTarget(rest) })
			dependencies.stdout.write(`${formatInitResult(result)}\n`)
			return 0
		}

		const result = await createExamples({ cwd: dependencies.getCwd() })
		dependencies.stdout.write(`${formatCreateExamplesResult(result)}\n`)
		return 0
	} catch (error) {
		dependencies.stderr.write(`${formatError(error)}\n`)
		return 1
	}
}

function parseTarget(args: string[]): string | undefined {
	const flagIndex = args.indexOf('--target')
	if (flagIndex === -1) {
		return undefined
	}

	const value = args[flagIndex + 1]
	if (!value) {
		throw new Error('--target requires a path, e.g. --target .cursor/rules/checkmate.md')
	}

	return value
}

function buildUsage(): string {
	return [
		'Usage: checkmate <command>',
		'',
		'Commands:',
		'  init              Write the mergeTests fixtures file and the agent instruction file',
		'  create-examples   Scaffold Playwright config, example tests, and package scripts',
		'',
		'Options:',
		'  --target <path>   Where init writes the agent instruction section (default: AGENTS.md)',
	].join('\n')
}

function formatInitResult(result: InitResult): string {
	const fixturesLabel = result.fixturesFile.action === 'created' ? 'wrote  ' : 'skipped'

	const lines = [
		`✓ ${fixturesLabel}  ${result.fixturesFile.path}`,
		`✓ updated  ${result.instructions.target}  (${instructionsLabel(result.instructions.action)})`,
	]

	if (result.instructions.detected.length > 0) {
		lines.push(
			`           also detected: ${result.instructions.detected.join(', ')} — pass --target to install there instead`
		)
	}

	lines.push(
		'',
		'Add to playwright.config.ts:',
		'',
		`  ${result.configBlock}`,
		'',
		`Then import \`test\` from ./${result.fixturesFile.path.replace(/\.ts$/, '')} in your specs.`
	)

	return lines.join('\n')
}

function instructionsLabel(action: 'created' | 'replaced' | 'appended'): string {
	if (action === 'created') {
		return 'Checkmate section created'
	}
	if (action === 'replaced') {
		return 'Checkmate section replaced'
	}
	return 'Checkmate section added'
}

function formatCreateExamplesResult(result: Awaited<ReturnType<typeof createExamples>>): string {
	const lines = ['Scaffolded Checkmate examples.']

	pushSection(lines, 'Created files', result.createdFiles)
	pushSection(lines, 'Skipped existing files', result.skippedFiles)
	pushSection(lines, 'Added scripts', result.addedScripts)
	pushSection(lines, 'Skipped existing scripts', result.skippedScripts)
	pushSection(lines, 'Added devDependencies', result.addedDevDependencies)
	pushSection(lines, 'Skipped existing dependencies', result.skippedDevDependencies)

	lines.push('', 'Next steps:', '1. npm install', '2. npx playwright install', '3. npm run test:web:example')

	return lines.join('\n')
}

function pushSection(lines: string[], title: string, entries: string[]): void {
	if (entries.length === 0) {
		return
	}

	lines.push('', `${title}:`)
	for (const entry of entries) {
		lines.push(`- ${entry}`)
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}

	return String(error)
}
