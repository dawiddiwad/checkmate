import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fixtureJson, root, sandbox, write } from './support.ts'

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
		[['gate', 'request.json', '--timeout', '30'], '--allow and --timeout apply only to delegate'],
	]
	for (const [args, reason] of cases) {
		const { code, output } = await checkmate(workspace, args)
		assert.equal(code, 1, args.join(' '))
		assert.deepEqual(output, { status: 'invalid_request', reasons: [reason] })
	}
})

test('validate checks a document against the named kind and never guesses', async (t) => {
	const workspace = await sandbox(t)
	await write(workspace, 'plan.json', await fixtureJson('plan'))
	const valid = await checkmate(workspace, ['validate', 'plan-candidate', 'plan.json'])
	assert.equal(valid.code, 0)
	assert.equal(valid.output.valid, true)
	assert.equal(valid.output.kind, 'plan-candidate')
	const wrong = await checkmate(workspace, ['validate', 'observation', 'plan.json'])
	assert.equal(wrong.code, 1)
	assert.match(wrong.output.reasons[0], /^Invalid observation/)
	const unknown = await checkmate(workspace, ['validate', 'scenario', 'plan.json'])
	assert.match(unknown.output.reasons[0], /^Unknown kind: scenario/)
	const missing = await checkmate(workspace, ['validate', 'plan.json'])
	assert.equal(missing.output.reasons[0], 'Usage: checkmate validate <kind> <file>')
})
