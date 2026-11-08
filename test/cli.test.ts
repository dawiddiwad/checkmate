import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { root, sandbox, write } from './support.ts'

const exec = promisify(execFile)
const cli = join(root, 'plugin/bin/checkmate.ts')

// Run the CLI and return its exit code and JSON output.
async function checkmate(workspace: string, args: string[]) {
	try {
		const { stdout } = await exec(process.execPath, [cli, ...args], { cwd: workspace })
		return { code: 0, output: JSON.parse(stdout) }
	} catch (error) {
		const failure = error as { code: number; stdout: string }
		return { code: failure.code, output: JSON.parse(failure.stdout) }
	}
}

test('the CLI names unknown commands, unknown options, and missing option values', async (t) => {
	const workspace = await sandbox(t)
	await write(workspace, 'request.json', {})
	const cases: Array<[string[], string]> = [
		[['deploy', 'request.json'], 'Unknown command: deploy'],
		[['gate', 'request.json', '--verbose'], 'Unknown option: --verbose'],
		[['gate', 'request.json', '--workspace'], 'Missing value for --workspace'],
		[['delegate', 'request.json', '--allow'], 'Missing value for --allow'],
		[['delegate', 'request.json', '--timeout', '--allow', 'Read'], 'Missing value for --timeout'],
	]
	for (const [args, reason] of cases) {
		const { code, output } = await checkmate(workspace, args)
		assert.equal(code, 1, args.join(' '))
		assert.deepEqual(output, { status: 'invalid_request', reasons: [reason] })
	}
})
