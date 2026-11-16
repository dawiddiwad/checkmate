import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { run } from '../plugin/src/cli.ts'
import { directory, root } from './support.ts'

const fix =
	'hint: Run the command in the project directory, or set CHECKMATE_WORKSPACE to the project directory, or pass --workspace <path>.'

function checkmate(cwd: string, args: string[], env: Record<string, string> = {}, stdin = '') {
	const outcome = run(args, { cwd, env: { CHECKMATE_ACTOR: 'tester', ...env }, stdin: () => stdin })
	return { ...outcome, lines: outcome.output.split('\n') }
}

function project(t: TestContext) {
	const workspace = directory(t)
	const steps = [
		[
			'target',
			'open',
			'shop',
			'--entry-point',
			'web:url:The shop.',
			'--capabilities',
			'browser',
			'--operations',
			'read',
		],
		['journal', 'open', 'cart', '--target', 'shop'],
	]
	for (const step of steps) assert.equal(checkmate(workspace, step).code, 0, step.join(' '))
	return workspace
}

const entry = JSON.stringify({ kind: 'note', text: 'The cart page loads.' })

test('a write or a read outside the project is refused, names the searched directory, and creates no store', (t) => {
	const elsewhere = directory(t)
	for (const args of [
		['journal', 'log', 'cart', '--build', 'b1'],
		['journal', 'show', 'cart'],
		['query', 'SELECT 1'],
		['target', 'list'],
	]) {
		const refused = checkmate(elsewhere, args, {}, entry)
		assert.equal(refused.code, 1, args.join(' '))
		assert.deepEqual(refused.lines.slice(1), [
			'reason: Refused: prohibited in the current state.',
			`reason: No Checkmate store in ${elsewhere} and its parent directories. Nothing changed.`,
			fix,
		])
		assert(!existsSync(join(elsewhere, '.checkmate')), args.join(' '))
	}
})

test('a command in a subdirectory uses the store of the nearest ancestor', (t) => {
	const workspace = project(t)
	const nested = join(workspace, 'src', 'cart')
	mkdirSync(nested, { recursive: true })
	assert.equal(checkmate(nested, ['journal', 'log', 'cart', '--build', 'b1'], {}, entry).code, 0)
	assert(!existsSync(join(nested, '.checkmate')))
	assert.match(checkmate(workspace, ['journal', 'show', 'cart']).output, /^completed cart /)
})

test('CHECKMATE_WORKSPACE names the store, and --workspace comes before it', (t) => {
	const workspace = project(t)
	const elsewhere = directory(t)
	const env = { CHECKMATE_WORKSPACE: workspace }
	assert.equal(checkmate(elsewhere, ['journal', 'log', 'cart', '--build', 'b1'], env, entry).code, 0)
	const flagged = checkmate(elsewhere, ['journal', 'show', 'cart', '--workspace', elsewhere], env)
	assert.equal(flagged.code, 1)
	assert(
		flagged.lines.includes(
			`reason: No Checkmate store in ${elsewhere}, the directory that --workspace names. Nothing changed.`
		),
		flagged.output
	)
	const named = checkmate(workspace, ['journal', 'show', 'cart'], { CHECKMATE_WORKSPACE: elsewhere })
	assert(
		named.lines.includes(
			`reason: No Checkmate store in ${elsewhere}, the directory that CHECKMATE_WORKSPACE names. Nothing changed.`
		),
		named.output
	)
	assert(!existsSync(join(elsewhere, '.checkmate')))
})

test('only init and target open create a store', (t) => {
	const empty = directory(t)
	const opened = checkmate(empty, ['journal', 'open', 'cart', '--target', 'shop'])
	assert.equal(opened.code, 1)
	assert(!existsSync(join(empty, '.checkmate')))
	assert.equal(checkmate(empty, ['init']).code, 0)
	assert(existsSync(join(empty, '.checkmate', 'checkmate.db')))
	const other = directory(t)
	const target = ['target', 'open', 'shop', '--entry-point', 'web:url:The shop.', '--capabilities', 'browser']
	assert.equal(checkmate(other, [...target, '--operations', 'read']).code, 0)
	assert(existsSync(join(other, '.checkmate', 'checkmate.db')))
})

test('an unknown change names the store in use and its changes', (t) => {
	const workspace = project(t)
	const path = join(workspace, '.checkmate', 'checkmate.db')
	const unknown = checkmate(workspace, ['journal', 'log', 'kart', '--build', 'b1'], {}, entry)
	assert.equal(unknown.code, 1)
	assert(unknown.lines.includes(`reason: Unknown change: kart. The store ${path} has the changes cart.`))
	assert.doesNotMatch(unknown.output, /open/)
	const empty = directory(t)
	assert.equal(checkmate(empty, ['init']).code, 0)
	const none = checkmate(empty, ['journal', 'show', 'cart'])
	const emptyPath = join(empty, '.checkmate', 'checkmate.db')
	assert(none.lines.includes(`reason: Unknown change: cart. The store ${emptyPath} has no change.`), none.output)
})

test('the UI does not start, and creates no store, outside a project', (t) => {
	const elsewhere = directory(t)
	let output = ''
	try {
		execFileSync(process.execPath, [join(root, 'plugin/bin/checkmate.ts'), 'ui'], {
			cwd: elsewhere,
			env: { ...process.env, CHECKMATE_WORKSPACE: '' },
			encoding: 'utf8',
		})
		assert.fail('ui started')
	} catch (error) {
		output = (error as { stdout: string }).stdout
	}
	assert.match(output, /^rejected ui refusal=prohibited\n/)
	assert(output.includes(`No Checkmate store in ${elsewhere} and its parent directories.`), output)
	assert(!existsSync(join(elsewhere, '.checkmate')))
})
