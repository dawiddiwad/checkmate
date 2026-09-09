import { runCli, type CliDependencies } from '../../cli/main.js'

const FAILING_INPUT: AsyncIterable<Uint8Array> = {
	[Symbol.asyncIterator]() {
		return {
			next: async () => {
				throw new Error('sk-stream-error-that-must-not-leak')
			},
		}
	},
}

const dependencies: CliDependencies = {
	stdout: process.stdout,
	stderr: process.stderr,
	stdin: process.stdin,
	getCwd: () => process.cwd(),
}

if (process.env.CHECKMATE_TEST_STATIC_ERROR === '1') {
	dependencies.staticCommands = {
		describe: async () => {
			throw new Error('sk-error-that-must-not-leak')
		},
		validate: async () => {
			throw new Error('sk-error-that-must-not-leak')
		},
	}
}

if (process.env.CHECKMATE_TEST_STDIN_ERROR === '1') {
	dependencies.stdin = FAILING_INPUT
}

if (process.env.CHECKMATE_TEST_MULTILINE_DIAGNOSTIC === '1') {
	dependencies.staticCommands = {
		describe: async () => ({
			kind: 'describe-result',
			schemaVersion: 1,
			status: 'invalid',
			diagnostics: [{ code: 'fixture.error', path: '/fixture', message: 'Bearer sk-secret\r\nsecond line' }],
		}),
		validate: async () => ({
			kind: 'validation-result',
			schemaVersion: 1,
			status: 'invalid',
			diagnostics: [{ code: 'fixture.error', path: '/fixture', message: 'invalid' }],
		}),
	}
}

process.exitCode = await runCli(process.argv.slice(2), dependencies)
