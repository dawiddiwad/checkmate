import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeStore } from '../plugin/src/store.ts'
import { directory, plan, root, store, target } from './support.ts'
import { fakeClaude } from './claude.ts'
import { fixture } from './fixture.ts'
import { permanentPackage } from './permanent-package.ts'
import { packageReadme } from '../scripts/build-cli.ts'

function json(path: string) {
	return JSON.parse(readFileSync(path, 'utf8'))
}

type JournalRow = { exploration_id: string; kind: string; build: string; body: string }

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
	permanentPackage(t, project)
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

	const app = await fixture()
	try {
		const workspace = directory(t)
		writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
		const replay = fakeClaude(
			t,
			{
				rules: [{ id: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md', area: 'Promotion' }],
			},
			'pi'
		)
		const replayEnv = {
			...process.env,
			...replay.env,
			CHECKMATE_ACTOR: 'oracle',
			CHECKMATE_HARNESS: 'pi',
			FAKE_CLAUDE_REPLAY: join(root, 'test/local-replay.mjs'),
			QA_REPLAY_DIR: directory(t),
			QA_APP_URL: app.baseUrl,
			QA_WORKSPACE: workspace,
			QA_CLI: join(project, 'node_modules/.bin/checkmate'),
		}
		const call = (...args: string[]) =>
			new Promise<{ code: number | null; body: ReturnType<typeof JSON.parse>; output: string }>(
				(resolve, reject) => {
					const child = spawn(process.execPath, [replayEnv.QA_CLI, ...args, '--json'], {
						cwd: workspace,
						env: replayEnv,
						timeout: 70000,
					})
					let output = ''
					let error = ''
					child.stdout.on('data', (chunk) => (output += chunk))
					child.stderr.on('data', (chunk) => (error += chunk))
					child.on('error', reject)
					child.on('close', (code) => {
						try {
							resolve({ code, body: JSON.parse(output), output: output + error })
						} catch {
							reject(new Error(output + error))
						}
					})
				}
			)
		const ok = async (...args: string[]) => {
			const result = await call(...args)
			assert.equal(result.code, 0, result.output)
			return result.body
		}
		const runBuild = async (build: string, first = false) => {
			const started = await ok(
				'test',
				'cart',
				'--build',
				build,
				'--level',
				'smoke',
				'--allow',
				'Read',
				...(first ? ['--url', app.baseUrl, '--source', 'ticket.md'] : [])
			)
			const done = await ok('explore', 'wait', started.explorationId, '--timeout', '60')
			assert.equal(done.state, 'completed')
			return started.explorationId as string
		}
		const broken = await runBuild('broken', true)
		const status = await ok('status', 'cart')
		assert.deepEqual([status.state, status.waitsOn], ['needs_triage', 'oracle'])
		assert.match(status.why.join(' '), /blocks testing.*promotion/i)
		const inbox = await ok('inbox')
		assert.ok(
			inbox.gaps.some(
				(gap: { gapId: string; severity: string }) => gap.gapId === 'a1/Q1' && gap.severity === 'blocking'
			)
		)
		const follow = await call('explore', 'follow', broken)
		assert.equal(follow.code, 1)
		assert.match(follow.output, /no answer/i)
		const before = await ok('query', 'SELECT exploration_id, kind, build, body FROM journal_entries ORDER BY rowid')
		const defect = before.rows.find((row: JournalRow) => row.kind === 'defect')
		assert.equal(defect.build, 'broken')
		assert.match(defect.body, /220/)
		assert.match(JSON.stringify(JSON.parse(defect.body).evidence), /HTTP 200.*220/)
		const shown = await ok('explore', 'show', broken)
		assert.match(JSON.stringify(shown), /220/)
		assert.equal((await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()).totalPLN, 220)
		t.diagnostic(`${broken}: broken build reported 220 PLN, a defect with evidence, and a blocking question`)
		app.fix()
		assert.equal((await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()).totalPLN, 240)
		const withoutAnswer = await runBuild('fixed')
		const unverified = await ok(
			'query',
			`SELECT body FROM journal_entries WHERE exploration_id = '${withoutAnswer}' AND kind = 'criterion'`
		)
		assert.equal(unverified.rows.length, 0)
		t.diagnostic(`${withoutAnswer}: fixed build did not pass the rule before the oracle answered`)
		await ok(
			'gap',
			'answer',
			'cart',
			'a1/Q1',
			'--kind',
			'clarify',
			'--value',
			'The promotion replaces loyalty.',
			'--source',
			'oracle',
			'--rationale',
			'Product decision.'
		)
		const answered = await ok('inbox')
		assert.ok(!answered.gaps.some((gap: { gapId: string }) => gap.gapId === 'a1/Q1'))
		const fixed = await runBuild('fixed')
		const records = await ok(
			'query',
			'SELECT exploration_id, kind, build, body FROM journal_entries ORDER BY rowid'
		)
		const criterion = records.rows.find(
			(row: JournalRow) => row.exploration_id === fixed && row.kind === 'criterion'
		)
		assert.equal(criterion.build, 'fixed')
		assert.deepEqual([JSON.parse(criterion.body).rule, JSON.parse(criterion.body).verdict], ['R1', 'ok'])
		assert.match(criterion.body, /240/)
		const verdict = records.rows.find((row: JournalRow) => row.exploration_id === fixed && row.kind === 'verdict')
		assert.equal(JSON.parse(verdict.body).result, 'fixed')
		const retested = await ok('explore', 'show', fixed)
		assert.ok(
			retested.retests.some(
				(item: { defect: string; result: string }) => item.defect === 'a1/D1' && item.result === 'fixed'
			)
		)
		assert.ok(records.rows.some((row: JournalRow) => row.exploration_id === broken && row.body === defect.body))
		t.diagnostic(`${fixed}: after the oracle answer, the fixed build reported 240 PLN and rule R1 passed`)
		assert.ok(app.actions() >= 3)
		const supervisors = await ok('query', "SELECT detail FROM exploration_events WHERE step = 'supervisor'")
		const pids = [
			...replay.called().map((item: { pid: number }) => item.pid),
			...supervisors.rows.map((row: { detail: string }) => JSON.parse(row.detail).pid as number),
		]
		const alive = (pid: number) => {
			try {
				process.kill(pid, 0)
				return true
			} catch {
				return false
			}
		}
		const deadline = Date.now() + 5000
		while (pids.some(alive) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
		assert.deepEqual(pids.filter(alive), [], 'Pi and supervisor processes must exit')
	} finally {
		await app.close()
	}
	await assert.rejects(fetch(`${app.baseUrl}/health`))
	t.diagnostic('The loopback app, Pi replay processes, and exploration supervisors exited')

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
