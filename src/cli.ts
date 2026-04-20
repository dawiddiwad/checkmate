import { createExamples } from './cli/create-examples.js'

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
 * await runCli(['create-examples'])
 * ```
 */
export async function runCli(argv: string[], dependencies: CliDependencies = defaultDependencies): Promise<number> {
	const [command] = argv

	if (!command || command === '--help' || command === '-h' || command === 'help') {
		dependencies.stdout.write(`${buildUsage()}\n`)
		return command ? 0 : 1
	}

	if (command !== 'create-examples') {
		dependencies.stderr.write(`Unknown command '${command}'.\n\n${buildUsage()}\n`)
		return 1
	}

	try {
		const result = await createExamples({ cwd: dependencies.getCwd() })
		dependencies.stdout.write(`${formatCreateExamplesResult(result)}\n`)
		return 0
	} catch (error) {
		dependencies.stderr.write(`${formatError(error)}\n`)
		return 1
	}
}

function buildUsage(): string {
	return [
		'Usage: checkmate <command>',
		'',
		'Commands:',
		'  create-examples   Scaffold Playwright config, example tests, and package scripts',
	].join('\n')
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
