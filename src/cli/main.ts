import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { DescribeResultV1, Diagnostic, ValidationResultV1 } from '../contracts/types.js'
import { serializeJson } from '../contracts/serialize.js'
import { normalizeSingleLine } from '../config/ingestion.js'
import { scrub } from '../redaction/scrub.js'
import {
	describeStaticEnvironment,
	describeError,
	unexpectedDescribeError,
	unexpectedValidationError,
	validateStaticSource,
	validationError,
} from './static-commands.js'
import { runFromParent, type RunParentDependencies } from './run-parent.js'

export type CliDependencies = {
	stdout: { write: (value: string) => unknown }
	stderr: { write: (value: string) => unknown }
	stdin?: AsyncIterable<string | Uint8Array>
	getCwd: () => string
	staticCommands?: {
		describe: typeof describeStaticEnvironment
		validate: typeof validateStaticSource
	}
	runCommand?: typeof runFromParent
	runParentDependencies?: RunParentDependencies
	getVersion?: () => string | Promise<string>
}

const defaultDependencies: CliDependencies = {
	stdout: process.stdout,
	stderr: process.stderr,
	stdin: process.stdin,
	getCwd: () => process.cwd(),
}

export async function runCli(argv: string[], dependencies: CliDependencies = defaultDependencies): Promise<number> {
	const [command, ...rest] = argv

	if (!command || command === '--help' || command === '-h' || command === 'help') {
		dependencies.stdout.write(`${buildUsage()}\n`)
		return command ? 0 : 1
	}
	if (command === '--version' || command === '-v') {
		dependencies.stdout.write(`${await (dependencies.getVersion ?? packageVersion)()}\n`)
		return 0
	}

	if (command === 'describe') return runDescribe(rest, dependencies)
	if (command === 'validate') return runValidate(rest, dependencies)
	if (command === 'run') return runScenario(rest, dependencies)

	dependencies.stderr.write(`Unknown command '${stderrField(scrub(command))}'.\n\n${buildUsage()}\n`)
	return 1
}

async function runScenario(args: string[], dependencies: CliDependencies): Promise<number> {
	const parsed = parseStaticArgs(args, true, 'run')
	if (parsed.ok === false) {
		return (dependencies.runCommand ?? runFromParent)(
			{
				source: { kind: 'value', value: {} },
				cwd: dependencies.getCwd(),
				stdout: dependencies.stdout,
				stderr: dependencies.stderr,
			},
			{
				...dependencies.runParentDependencies,
				prepare: async () => ({ ok: false, status: 'invalid', diagnostics: [parsed.diagnostic] }),
			}
		)
	}
	const source =
		parsed.positional === '-'
			? { kind: 'stdin' as const, stream: dependencies.stdin ?? EMPTY_INPUT }
			: { kind: 'file' as const, path: resolve(dependencies.getCwd(), parsed.positional!) }
	return (dependencies.runCommand ?? runFromParent)(
		{
			source,
			cwd: dependencies.getCwd(),
			configPath: parsed.configPath,
			stdout: dependencies.stdout,
			stderr: dependencies.stderr,
		},
		dependencies.runParentDependencies
	)
}

async function runDescribe(args: string[], dependencies: CliDependencies): Promise<number> {
	const parsed = parseStaticArgs(args, false)
	if (parsed.ok === false) {
		return writeStaticResult(describeError(parsed.diagnostic), dependencies)
	}

	try {
		const commands = dependencies.staticCommands ?? defaultStaticCommands
		const result = await commands.describe({ cwd: dependencies.getCwd(), configPath: parsed.configPath })
		return writeStaticResult(result, dependencies)
	} catch {
		return writeStaticResult(unexpectedDescribeError(), dependencies)
	}
}

async function runValidate(args: string[], dependencies: CliDependencies): Promise<number> {
	const parsed = parseStaticArgs(args, true, 'validate')
	if (parsed.ok === false) return writeStaticResult(validationError(parsed.diagnostic), dependencies)

	try {
		const commands = dependencies.staticCommands ?? defaultStaticCommands
		const source =
			parsed.positional === '-'
				? { kind: 'stdin' as const, stream: dependencies.stdin ?? EMPTY_INPUT }
				: { kind: 'file' as const, path: resolve(dependencies.getCwd(), parsed.positional!) }
		const result = await commands.validate(source, {
			cwd: dependencies.getCwd(),
			configPath: parsed.configPath,
		})
		return writeStaticResult(result, dependencies)
	} catch {
		return writeStaticResult(unexpectedValidationError(), dependencies)
	}
}

const defaultStaticCommands = {
	describe: describeStaticEnvironment,
	validate: validateStaticSource,
}

function writeStaticResult(result: DescribeResultV1 | ValidationResultV1, dependencies: CliDependencies): number {
	dependencies.stdout.write(serializeJson(result))
	if (result.status !== 'available' && result.status !== 'valid') writeDiagnostics(result.diagnostics, dependencies)
	if (result.status === 'available' || result.status === 'valid') return 0
	return result.status === 'invalid' ? 4 : 3
}

function writeDiagnostics(diagnostics: readonly Diagnostic[], dependencies: CliDependencies): void {
	for (const diagnostic of diagnostics) {
		dependencies.stderr.write(
			`${stderrField(diagnostic.code)} ${stderrField(diagnostic.path || '/')}: ${stderrField(scrub(diagnostic.message))}\n`
		)
	}
}

function parseStaticArgs(
	args: string[],
	requiresPositional: boolean,
	command = 'describe'
): { ok: true; positional?: string; configPath?: string } | { ok: false; diagnostic: Diagnostic } {
	const positional: string[] = []
	let configPath: string | undefined

	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (argument === '--config') {
			const value = args[++index]
			if (!value || value.startsWith('--')) return argumentError("'--config' requires a path")
			if (configPath !== undefined) return argumentError("'--config' may be supplied only once")
			configPath = value
		} else if (argument.startsWith('-') && argument !== '-') {
			return argumentError(`unknown option '${argument}'`)
		} else {
			positional.push(argument)
		}
	}

	if (requiresPositional && positional.length !== 1) {
		return argumentError(`${command} requires exactly one request JSON file or '-'`)
	}
	if (!requiresPositional && positional.length > 0) {
		return argumentError('describe does not accept a positional argument')
	}

	return { ok: true, positional: positional[0], configPath }
}

function argumentError(message: string): { ok: false; diagnostic: Diagnostic } {
	return { ok: false, diagnostic: { code: 'invocation.invalid-arguments', path: '', message } }
}

function buildUsage(): string {
	return [
		'Usage: checkmate <command>',
		'',
		'Commands:',
		'  describe          Describe contracts, policies, and registered drivers as JSON',
		'  validate <file|-> Validate a file or stdin request without starting a driver',
		'  run <file|->      Execute a file or stdin scenario in an isolated worker',
		'',
		'Options:',
		'  --config <path>   Use an explicit manifest path for describe, validate, or run',
		'  --version         Print the installed Checkmate version',
	].join('\n')
}

function stderrField(value: string): string {
	return normalizeSingleLine(value)
}

const EMPTY_INPUT: AsyncIterable<Uint8Array> = {
	[Symbol.asyncIterator]() {
		return { next: async () => ({ done: true, value: undefined }) }
	},
}

async function packageVersion(): Promise<string> {
	const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
		version?: unknown
	}
	if (typeof packageJson.version !== 'string') throw new Error('Installed package version is unavailable')
	return packageJson.version
}
