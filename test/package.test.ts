import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeStore } from '../plugin/src/store.ts'
import { directory, plan, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { packageReadme } from '../scripts/build-cli.ts'

function json(path: string) {
	return JSON.parse(readFileSync(path, 'utf8'))
}

test('the npm package runs from node_modules, serves the UI, and delegate loads the bundled plugin', async (t) => {
	t.after(() => {
		rmSync(join(root, 'cli/dist'), { recursive: true, force: true })
		rmSync(join(root, 'cli/plugin'), { recursive: true, force: true })
		rmSync(join(root, 'cli/README.md'), { force: true })
		rmSync(join(root, 'cli/LICENSE'), { force: true })
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
	assert(existsSync(join(root, 'plugin/evals')))
	assert.equal(existsSync(join(installed, 'plugin/evals')), false, 'The npm package ships plugin/evals')
	assert.equal(readFileSync(join(installed, 'LICENSE'), 'utf8'), readFileSync(join(root, 'LICENSE'), 'utf8'))
	const metadata = json(join(installed, 'package.json'))
	assert.equal(metadata.description, 'The QA system of record for an agent software factory')
	assert.ok(metadata.keywords.includes('software-factory'))
	assert.deepEqual(metadata.pi.skills, ['./skills'])
	assert.ok(existsSync(join(installed, 'skills/checkmate/SKILL.md')))
	assert.deepEqual(metadata.pi.extensions, ['./extensions/checkmate.mjs'])
	assert.ok(existsSync(join(installed, 'extensions/checkmate.mjs')))
	assert.deepEqual(metadata.publishConfig, { access: 'public' })
	const readme = readFileSync(join(installed, 'README.md'), 'utf8')
	assert.equal(readme, packageReadme(readFileSync(join(root, 'README.md'), 'utf8'), version))
	const targets = [...readme.matchAll(/\]\(([^)\s]+)\)|\b(?:src|href)="([^"]+)"/g)].map(
		(match) => match[1] ?? match[2]
	)
	assert.ok(targets.length > 10)
	for (const target of targets) {
		assert.match(target, /^(https:\/\/|#)/, `relative link in the package README: ${target}`)
		assert.doesNotMatch(target, /\?raw=true$/)
		const file = target.match(
			/^https:\/\/(?:github\.com\/dawiddiwad\/checkmate\/blob|raw\.githubusercontent\.com\/dawiddiwad\/checkmate)\/[^/]+\/([^#?]+)/
		)
		if (file) assert.ok(existsSync(join(root, file[1])), `missing file for ${target}`)
	}

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
	const fresh = directory(t)
	const testArgs = ['test', 'cart', '--url', 'http://127.0.0.1:9', '--build', 'b1', '--allow', 'Read', '--json']
	const attempt = (...args: string[]) =>
		spawnSync(process.execPath, [join(project, 'node_modules/.bin/checkmate'), ...testArgs, ...args], {
			cwd: fresh,
			env: { ...env, PATH: '', CHECKMATE_HARNESS: 'pi' },
			encoding: 'utf8',
		})
	assert.match(attempt('--objective', 'Check the cart.').stdout, /needs requirements or context sources/)
	assert.match(attempt('--source', 'ticket.md').stdout, /No pi executable on PATH/)
	const freshStore = store(t, fresh)
	for (const table of ['profiles', 'plan_requests', 'explorations', 'operations'])
		assert.equal(
			(freshStore.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count,
			0
		)
	closeStore(freshStore)
	const retryWorkspace = directory(t)
	const host = fakeClaude(t, { explorer: '!pi-auth' }, 'pi')
	const retryEnv = { ...env, ...host.env, CHECKMATE_HARNESS: 'pi' }
	const installedCommand = (...args: string[]) => {
		const result = spawnSync(process.execPath, [join(project, 'node_modules/.bin/checkmate'), ...args, '--json'], {
			cwd: retryWorkspace,
			env: retryEnv,
			encoding: 'utf8',
		})
		return { code: result.status, body: JSON.parse(result.stdout) }
	}
	const started = installedCommand(
		'test',
		'cart',
		'--url',
		'http://127.0.0.1:9',
		'--source',
		'ticket.md',
		'--build',
		'b1',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	assert.equal(started.code, 0)
	const failed = installedCommand('explore', 'wait', started.body.explorationId, '--timeout', '30')
	assert.equal(failed.code, 1)
	assert.deepEqual(
		[
			failed.body.state,
			failed.body.planId,
			failed.body.targetId,
			failed.body.targetRevision,
			failed.body.instanceId,
			failed.body.build,
		],
		['failed', 'cart', '127-0-0-1-9', 1, 'local', 'b1']
	)
	assert.match(failed.body.hint, /Log in with Pi/)
	assert.equal(failed.body.next.length, 1)
	const compact = spawnSync(
		process.execPath,
		[
			join(project, 'node_modules/.bin/checkmate'),
			'explore',
			'wait',
			started.body.explorationId,
			'--timeout',
			'30',
		],
		{ cwd: retryWorkspace, env: retryEnv, encoding: 'utf8' }
	)
	assert.equal(compact.status, 1)
	assert.ok(compact.stdout.includes(`next\t${failed.body.next[0]}`))
	host.reply({ recorder: [{ kind: 'note', text: 'Retry completed.' }] })
	const retried = spawnSync('/bin/sh', ['-c', `${failed.body.next[0]} --json`], {
		cwd: retryWorkspace,
		env: { ...retryEnv, PATH: `${join(project, 'node_modules/.bin')}:${retryEnv.PATH}` },
		encoding: 'utf8',
	})
	assert.equal(retried.status, 0, retried.stderr + retried.stdout)
	const retry = JSON.parse(retried.stdout)
	assert.notEqual(retry.explorationId, started.body.explorationId)
	assert.equal(installedCommand('explore', 'wait', retry.explorationId, '--timeout', '30').body.state, 'completed')
	assert.equal(installedCommand('explore', 'status', started.body.explorationId).body.state, 'failed')
	const saved = store(t, retryWorkspace)
	for (const table of ['target_requests', 'profiles', 'instances', 'plan_requests'])
		assert.equal((saved.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count, 1)
	const starts = saved.db
		.prepare("SELECT status FROM operations WHERE command = 'explore start' ORDER BY rowid")
		.all()
	assert.deepEqual(
		starts.map((row) => row.status),
		['completed', 'completed']
	)
	const done = saved.db
		.prepare("SELECT exploration_id, status FROM exploration_events WHERE step = 'done' ORDER BY rowid")
		.all()
	assert.deepEqual(
		done.map((row) => [row.exploration_id, row.status]),
		[
			[started.body.explorationId, 'failed'],
			[retry.explorationId, 'completed'],
		]
	)
	assert.equal((saved.db.prepare('SELECT count(*) AS count FROM explorations').get() as { count: number }).count, 2)
	closeStore(saved)
	assert.match(checkmate('--help'), /checkmate delegate <setup\|plan\|revise\|execute>/)
	const help = JSON.parse(checkmate('--help', '--json'))
	assert.equal(help.status, 'completed')
	assert.ok(help.usage.some((line: string) => line.startsWith('checkmate delegate ')))
	assert.match(
		checkmate('delegate', '--help'),
		/^completed delegate\ncheckmate delegate <setup\|plan\|revise\|execute>/
	)
	assert.match(checkmate('plan', 'open', '--help'), /^completed plan open\ncheckmate plan open <planId>/)
	assert.equal(checkmate('init'), 'completed .checkmate/checkmate.db')
	assert.equal(checkmate('plan', 'list'), 'completed plans count=0')
	checkmate(
		'target',
		'open',
		'checkout-local',
		'--entry-point',
		'web:url:Checkout API.',
		'--capabilities',
		'http',
		'--operations',
		'read_catalog'
	)
	assert.equal(
		checkmate('target', 'instance', 'add', 'checkout-local', 'local', '--entry', 'web=http://127.0.0.1:9'),
		'completed checkout-local/local recorded=true\nentry\tweb\thttp://127.0.0.1:9'
	)
	assert.equal(
		checkmate('delegate', 'setup', 'checkout-local', '--allow', 'Read', '--timeout', '30'),
		'needs_decision checkout-local\nreason: No browser.'
	)
	assert.equal(readFileSync(join(project, 'plugin-dir.txt'), 'utf8'), realpathSync(join(installed, 'plugin')))
	const piWorkspace = directory(t)
	const opened = store(t, piWorkspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	const fake = fakeClaude(t, { recorder: [{ kind: 'note', text: 'Pi explorer completed.' }] }, 'pi')
	const piCheckmate = (...args: string[]) =>
		JSON.parse(
			execFileSync(join(project, 'node_modules/.bin/checkmate'), [...args, '--json'], {
				cwd: piWorkspace,
				env: { ...env, ...fake.env, CHECKMATE_HARNESS: 'pi' },
				encoding: 'utf8',
			})
		)
	const exploration = piCheckmate(
		'explore',
		'start',
		'checkout',
		'--build',
		'packed',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	assert.equal(piCheckmate('explore', 'wait', exploration.explorationId, '--timeout', '30').state, 'completed')
	const explorer = fake.called().find((call) => call.role === 'explorer')
	assert.equal(
		explorer.args[explorer.args.indexOf('--extension') + 1],
		realpathSync(join(installed, 'plugin/pi/child.mjs'))
	)

	const ui = spawn(join(project, 'node_modules/.bin/checkmate'), ['ui'], { cwd: project, env })
	try {
		const [first] = (await once(ui.stdout, 'data')) as [Buffer]
		const url = /^completed ui url=(\S+)$/m.exec(first.toString())?.[1]
		assert(url, first.toString())
		for (const path of ['/', '/assets/style.css', '/assets/fonts/ibm-plex-sans-400.woff2'])
			assert.equal((await fetch(new URL(path, url))).status, 200, path)
	} finally {
		ui.kill('SIGTERM')
	}
})
