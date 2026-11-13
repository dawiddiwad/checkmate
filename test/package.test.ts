import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { directory, root } from './support.ts'

function json(path: string) {
	return JSON.parse(readFileSync(path, 'utf8'))
}

test('the npm package runs from node_modules, serves the UI, and delegate loads the bundled plugin', async (t) => {
	t.after(() => {
		rmSync(join(root, 'cli/dist'), { recursive: true, force: true })
		rmSync(join(root, 'cli/plugin'), { recursive: true, force: true })
	})
	execFileSync(process.execPath, ['scripts/build-cli.ts'], { cwd: root, stdio: 'ignore' })
	const packs = directory(t)
	const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packs], {
		cwd: join(root, 'cli'),
		encoding: 'utf8',
	})
	const tarball = join(packs, JSON.parse(packed)[0].filename)
	const project = directory(t)
	writeFileSync(join(project, 'package.json'), '{ "private": true }\n')
	execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: project, stdio: 'ignore' })

	const installed = join(project, 'node_modules/@xoxoai/checkmate')
	const version = json(join(root, 'cli/package.json')).version
	assert.equal(json(join(installed, 'package.json')).version, version)
	assert.equal(json(join(installed, 'plugin/.claude-plugin/plugin.json')).version, version)

	const fakes = join(project, 'fakes')
	mkdirSync(fakes)
	writeFileSync(
		join(fakes, 'claude'),
		`#!/usr/bin/env node
const plugin = process.argv[process.argv.indexOf('--plugin-dir') + 1]
require('node:fs').writeFileSync('plugin-dir.txt', plugin)
const output = { status: 'needs_decision', subject: 'checkout-local', reasons: ['No browser.'] }
console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: output }))
`
	)
	chmodSync(join(fakes, 'claude'), 0o700)
	const env = { ...process.env, PATH: `${fakes}:${process.env.PATH}`, CHECKMATE_ACTOR: 'tester' }
	const checkmate = (...args: string[]) =>
		execFileSync(join(project, 'node_modules/.bin/checkmate'), args, { cwd: project, env, encoding: 'utf8' }).trim()

	assert.equal(checkmate('--version'), version)
	assert.match(checkmate('--help'), /checkmate delegate <setup\|plan\|revise\|execute>/)
	assert.equal(checkmate('init'), 'completed .checkmate/checkmate.db')
	assert.equal(checkmate('plan', 'list'), 'completed plans count=0')
	checkmate(
		'target',
		'open',
		'checkout-local',
		'--base-url',
		'http://127.0.0.1:9',
		'--capabilities',
		'http',
		'--operations',
		'read_catalog'
	)
	assert.equal(
		checkmate('delegate', 'setup', 'checkout-local', '--allow', 'Read', '--timeout', '30'),
		'needs_decision checkout-local\nreason: No browser.'
	)
	assert.equal(readFileSync(join(project, 'plugin-dir.txt'), 'utf8'), realpathSync(join(installed, 'plugin')))
	const ui = spawn(join(project, 'node_modules/.bin/checkmate'), ['ui'], { cwd: project, env })
	try {
		const [first] = (await once(ui.stdout, 'data')) as [Buffer]
		const url = /^completed ui url=(\S+)$/m.exec(first.toString())?.[1]
		assert(url, first.toString())
		for (const path of ['/', '/assets/style.css', '/assets/fonts/space-grotesk.woff2'])
			assert.equal((await fetch(new URL(path, url))).status, 200, path)
	} finally {
		ui.kill('SIGTERM')
	}
})
