import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { directory, root } from '../support.ts'
import { fakeClaude } from '../claude.ts'
import { fixture } from '../fixture.ts'

const project = directory()
let binary = ''
test.before(() => {
	execFileSync(process.execPath, ['scripts/build-cli.ts'], { cwd: root, stdio: 'ignore' })
	const packed = JSON.parse(
		execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', project], {
			cwd: join(root, 'cli'),
			encoding: 'utf8',
		})
	)[0].filename as string
	writeFileSync(join(project, 'package.json'), '{"private":true}\n')
	execFileSync('npm', ['install', '--no-audit', '--no-fund', join(project, packed)], {
		cwd: project,
		stdio: 'ignore',
	})
	binary = join(project, 'node_modules/.bin/checkmate')
})
test.after(async () => {
	const { rmSync } = await import('node:fs')
	rmSync(project, { recursive: true, force: true })
})

function command(workspace: string, env: NodeJS.ProcessEnv, ...args: string[]) {
	return inputCommand(workspace, env, '', ...args)
}

function inputCommand(workspace: string, env: NodeJS.ProcessEnv, input: string, ...args: string[]) {
	return new Promise<{ code: number | null; body: ReturnType<typeof JSON.parse>; output: string }>(
		(resolve, reject) => {
			const child = spawn(process.execPath, [binary, ...args, '--json'], { cwd: workspace, env, timeout: 70000 })
			child.stdin.end(input)
			let output = ''
			let error = ''
			child.stdout.on('data', (part) => (output += part))
			child.stderr.on('data', (part) => (error += part))
			child.on('error', reject)
			child.on('close', (code) => {
				try {
					resolve({ code, body: JSON.parse(output), output: output + error })
				} catch {
					reject(Error(output + error))
				}
			})
		}
	)
}

test('Install packed npm CLI and open the empty UI — installed assets or skills missing.', async (t) => {
	const workspace = directory(t)
	const installed = join(project, 'node_modules/@xoxoai/checkmate')
	assert(existsSync(join(installed, 'skills/checkmate/SKILL.md')))
	assert(existsSync(join(installed, 'plugin/dist/checkmate.js')))
	const child = spawn(process.execPath, [binary, 'ui'], { cwd: workspace, env: process.env })
	try {
		const [data] = (await once(child.stdout, 'data')) as [Buffer]
		const url = /^completed ui url=(\S+)$/m.exec(data.toString())?.[1]
		assert(url, data.toString())
		const page = await fetch(url)
		assert.equal(page.status, 200)
		assert.match(await page.text(), /target|setup|start/i)
	} finally {
		child.kill('SIGTERM')
		await once(child, 'close')
	}
})

test('Recover after missing host or missing ticket source — unexplained partial records or duplicates.', async (t) => {
	const workspace = directory(t)
	const env = { ...process.env, PATH: '', CHECKMATE_HARNESS: 'pi', CHECKMATE_ACTOR: 'oracle' }
	const base = ['test', 'cart', '--url', 'http://127.0.0.1:9', '--build', 'b1', '--allow', 'Read']
	const source = await command(workspace, env, ...base, '--objective', 'Check the cart.')
	assert.equal(source.code, 1)
	assert.match(source.output, /needs requirements or context sources/)
	const host = await command(workspace, env, ...base, '--source', 'ticket.md')
	assert.equal(host.code, 1)
	assert.match(host.output, /No pi executable on PATH/)
	assert.equal(existsSync(join(workspace, '.checkmate', 'checkmate.db')), true)
	const result = await command(
		workspace,
		env,
		'query',
		'SELECT (SELECT count(*) FROM target_requests) AS targets, (SELECT count(*) FROM plan_requests) AS plans, (SELECT count(*) FROM explorations) AS explorations, (SELECT count(*) FROM operations) AS operations'
	)
	assert.equal(result.code, 0, result.output)
	assert.deepEqual(result.body.rows, [{ targets: 0, plans: 0, explorations: 0, operations: 0 }])
})

test('Record a defect with replayable evidence — report text cannot become a reviewable claim.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(
		t,
		{ rules: [{ id: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md', area: 'Promotion' }] },
		'pi'
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		FAKE_CLAUDE_REPLAY: join(root, 'test/local-replay.mjs'),
		QA_REPLAY_DIR: directory(t),
		QA_APP_URL: app.baseUrl,
		QA_WORKSPACE: workspace,
		QA_CLI: binary,
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const start = await ok(
		'test',
		'cart',
		'--url',
		app.baseUrl,
		'--source',
		'ticket.md',
		'--build',
		'broken',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	assert.equal((await ok('explore', 'wait', start.explorationId, '--timeout', '60')).state, 'completed')
	const status = await ok('status', 'cart')
	assert.deepEqual([status.state, status.waitsOn], ['needs_triage', 'oracle'])
	const records = await ok('query', 'SELECT exploration_id, build, kind, body FROM journal_entries ORDER BY rowid')
	const defect = records.rows.find((row: { kind: string }) => row.kind === 'defect')
	assert.deepEqual([defect.exploration_id, defect.build], [start.explorationId, 'broken'])
	assert.match(defect.body, /HTTP 200.*220/)
	assert.equal((await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()).totalPLN, 220)
	assert.match(JSON.stringify(await ok('explore', 'show', start.explorationId)), /220/)
	app.fix()
	const without = await ok('test', 'cart', '--build', 'fixed', '--level', 'smoke', '--allow', 'Read')
	assert.equal((await ok('explore', 'wait', without.explorationId, '--timeout', '60')).state, 'completed')
	const beforeAnswer = await ok(
		'query',
		`SELECT body FROM journal_entries WHERE exploration_id = '${without.explorationId}' AND kind = 'criterion'`
	)
	assert.equal(beforeAnswer.rows.length, 0)
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
	const after = await ok('test', 'cart', '--build', 'fixed', '--level', 'smoke', '--allow', 'Read')
	assert.equal((await ok('explore', 'wait', after.explorationId, '--timeout', '60')).state, 'completed')
	const latest = await ok('query', 'SELECT exploration_id, build, kind, body FROM journal_entries ORDER BY rowid')
	const criterion = latest.rows.find(
		(row: { exploration_id: string; kind: string }) =>
			row.exploration_id === after.explorationId && row.kind === 'criterion'
	)
	assert.deepEqual(
		[criterion.build, JSON.parse(criterion.body).rule, JSON.parse(criterion.body).verdict],
		['fixed', 'R1', 'ok']
	)
	assert.match(criterion.body, /240/)
	const report = await ok('explore', 'show', after.explorationId)
	assert.ok(
		report.retests.some(
			(item: { defect: string; result: string }) => item.defect === 'a1/D1' && item.result === 'fixed'
		)
	)
	const supervisors = await ok('query', "SELECT detail FROM exploration_events WHERE step = 'supervisor'")
	const pids: number[] = [
		...host.called().map((item: { pid: number }) => item.pid),
		...supervisors.rows.map((row: { detail: string }) => JSON.parse(row.detail).pid),
	]
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	}
	const until = Date.now() + 5000
	while (pids.some(alive) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50))
	assert.deepEqual(pids.filter(alive), [])
	assert.ok(
		latest.rows.some(
			(row: { exploration_id: string; body: string }) =>
				row.exploration_id === start.explorationId && row.body === defect.body
		)
	)
	assert.ok(readFileSync(join(workspace, '.checkmate/checkmate.db')).length > 0)
})

test('Explore a clean fixture — invented defect or missing observed coverage.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(
		t,
		{ rules: [{ id: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md', area: 'Promotion' }] },
		'pi'
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		FAKE_CLAUDE_REPLAY: join(root, 'test/e2e/clean-replay.mjs'),
		QA_REPLAY_DIR: directory(t),
		QA_APP_URL: app.baseUrl,
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	app.fix()
	assert.equal((await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()).totalPLN, 240)
	const start = await ok(
		'test',
		'cart',
		'--url',
		app.baseUrl,
		'--source',
		'ticket.md',
		'--build',
		'clean',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	assert.equal((await ok('explore', 'wait', start.explorationId, '--timeout', '60')).state, 'completed')
	const rows = (await ok('query', 'SELECT build, kind, body FROM journal_entries ORDER BY rowid')).rows
	assert.equal(rows.filter((row: { kind: string }) => row.kind === 'defect').length, 0)
	const criterion = rows.find((row: { kind: string }) => row.kind === 'criterion')
	assert.deepEqual(
		[criterion.build, JSON.parse(criterion.body).rule, JSON.parse(criterion.body).verdict],
		['clean', 'R1', 'ok']
	)
	assert.match(criterion.body, /240/)
})

test('Retry a held database transaction — lost or duplicate edits.', async (t) => {
	const workspace = directory(t)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_BUSY_TIMEOUT_MS: '100' }
	const init = await command(workspace, env, 'init')
	assert.equal(init.code, 0, init.output)
	const { DatabaseSync } = await import('node:sqlite')
	const db = new DatabaseSync(join(workspace, '.checkmate', 'checkmate.db'))
	const args = [
		'target',
		'open',
		'cart',
		'--entry-point',
		'web:url:Checkout.',
		'--capabilities',
		'http',
		'--operations',
		'read',
	]
	db.exec('BEGIN IMMEDIATE')
	try {
		const blocked = await command(workspace, env, ...args)
		assert.equal(blocked.code, 1, blocked.output)
		assert.match(blocked.output, /lock|busy/i)
	} finally {
		db.exec('ROLLBACK')
		db.close()
	}
	const first = await command(workspace, env, ...args)
	assert.equal(first.code, 0, first.output)
	assert.equal(first.body.recorded, true)
	const again = await command(workspace, env, ...args)
	assert.equal(again.code, 0, again.output)
	assert.equal(again.body.recorded, false)
	const result = await command(
		workspace,
		env,
		'query',
		"SELECT (SELECT count(*) FROM target_requests) AS targets, (SELECT count(*) FROM operations WHERE command = 'target open') AS attempts"
	)
	assert.equal(result.code, 0, result.output)
	assert.deepEqual(result.body.rows, [{ targets: 1, attempts: 2 }])
})

test('Pick an active instance and refuse unsafe defaults — mutation scope or selected URL is wrong.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The checkout is reachable.\n')
	const app = await fixture()
	const staging = await fixture()
	t.after(async () => {
		await app.close()
		await staging.close()
	})
	const host = fakeClaude(t, { recorder: [{ kind: 'note', text: 'Checked the test instance.' }] }, 'pi')
	const env = { ...process.env, ...host.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const unsafe = await command(
		workspace,
		env,
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--instance',
		'production'
	)
	assert.equal(unsafe.code, 1, unsafe.output)
	assert.match(unsafe.output, /production instance/i)
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok('setup', '--url', app.baseUrl, '--target', 'shop', '--instance', 'local')
	await ok('target', 'instance', 'add', 'shop', 'staging', '--entry', `web=${staging.baseUrl}`)
	await ok('target', 'instance', 'retire', 'shop', 'local')
	const args = [
		'test',
		'cart',
		'--target',
		'shop',
		'--source',
		'ticket.md',
		'--build',
		'b1',
		'--level',
		'smoke',
		'--allow',
		'Read',
	]
	const retired = await command(workspace, env, ...args, '--instance', 'local')
	assert.equal(retired.code, 1, retired.output)
	assert.match(retired.output, /retired/i)
	const started = await ok(...args, '--instance', 'staging')
	assert.equal(started.instanceId, 'staging')
	const finished = await ok('explore', 'wait', started.explorationId, '--timeout', '60')
	assert.deepEqual([finished.state, finished.instanceId], ['completed', 'staging'])
	const study = host.called().find((item: { role: string }) => item.role === 'explorer')
	assert.ok(study.prompt.includes(staging.baseUrl))
	assert.ok(!study.prompt.includes(app.baseUrl))
})

test('Keep incomplete criteria unverified — false green.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(
		t,
		{ rules: [{ id: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md', area: 'Promotion' }] },
		'pi'
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		FAKE_CLAUDE_REPLAY: join(root, 'test/e2e/incomplete-replay.mjs'),
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const start = await ok(
		'test',
		'cart',
		'--url',
		app.baseUrl,
		'--source',
		'ticket.md',
		'--build',
		'unobserved',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	assert.equal((await ok('explore', 'wait', start.explorationId, '--timeout', '60')).state, 'completed')
	const records = await ok('query', "SELECT body FROM journal_entries WHERE kind = 'criterion'")
	assert.equal(records.rows.length, 1)
	assert.equal(JSON.parse(records.rows[0].body).verdict, undefined)
	const status = await ok('status', 'cart')
	assert.equal(status.state, 'ready_to_test')
	assert.match(status.why.join(' '), /R1.*unobserved/)
})

test('Merge duplicate findings and preserve evidence — defect inflated or unique evidence dropped.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(
		t,
		{
			rules: [{ id: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md', area: 'Promotion' }],
			merger: [
				{ kind: 'issue', title: 'Promotion total is wrong', severity: 'high', reports: ['a1/D1', 'a2/D1'] },
			],
		},
		'pi'
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		FAKE_CLAUDE_REPLAY: join(root, 'test/e2e/clean-replay.mjs'),
		QA_REPLAY_DIR: directory(t),
		QA_APP_URL: app.baseUrl,
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const start = await ok(
		'test',
		'cart',
		'--url',
		app.baseUrl,
		'--source',
		'ticket.md',
		'--build',
		'broken',
		'--level',
		'smoke',
		'--explorers',
		'2',
		'--allow',
		'Read'
	)
	assert.equal((await ok('explore', 'wait', start.explorationId, '--timeout', '60')).state, 'completed')
	const claims = (await ok('claim', 'list', 'cart')).claims
	assert.equal(claims.length, 1)
	assert.deepEqual(claims[0].reports, ['a1/D1', 'a2/D1'])
	const rows = (
		await ok('query', "SELECT entry_id, body FROM journal_entries WHERE kind = 'defect' ORDER BY entry_id")
	).rows
	assert.equal(rows.length, 2)
	assert.ok(rows.every((row: { body: string }) => /HTTP 200: 220 PLN/.test(row.body)))
	assert.notDeepEqual(JSON.parse(rows[0].body).evidence, JSON.parse(rows[1].body).evidence)
})

test('Show disputed/failed retest without closing a claim — unresolved defect reported fixed.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(
		t,
		{ rules: [{ id: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md', area: 'Promotion' }] },
		'pi'
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		FAKE_CLAUDE_REPLAY: join(root, 'test/e2e/clean-replay.mjs'),
		QA_REPLAY_DIR: directory(t),
		QA_APP_URL: app.baseUrl,
		QA_RETEST: '0',
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const first = await ok(
		'test',
		'cart',
		'--url',
		app.baseUrl,
		'--source',
		'ticket.md',
		'--build',
		'broken',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	assert.equal((await ok('explore', 'wait', first.explorationId, '--timeout', '60')).state, 'completed')
	env.QA_RETEST = '1'
	const second = await ok('test', 'cart', '--build', 'still-broken', '--level', 'smoke', '--allow', 'Read')
	assert.equal((await ok('explore', 'wait', second.explorationId, '--timeout', '60')).state, 'completed')
	const claims = (await ok('claim', 'list', 'cart')).claims
	assert.equal(claims.length, 1)
	assert.equal(claims[0].open, true)
	assert.equal(claims[0].statuses['still-broken'].status, 'not_fixed')
	assert.match(JSON.stringify(await ok('explore', 'show', second.explorationId)), /220/)
})

test('Interrupt the supervisor and retry safely — orphan workers or duplicate testing.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The checkout responds.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(t, { tester: '!sleep' }, 'pi')
	const env = { ...process.env, ...host.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const first = await ok(
		'test',
		'cart',
		'--url',
		app.baseUrl,
		'--source',
		'ticket.md',
		'--build',
		'b1',
		'--level',
		'smoke',
		'--allow',
		'Read'
	)
	const calls: Array<{ role: string; pid: number }> = []
	const deadline = Date.now() + 10000
	while (!calls.some((call) => call.role === 'tester') && Date.now() < deadline) {
		calls.push(...host.called())
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	const tester = calls.find((call) => call.role === 'tester')
	assert.ok(tester, 'The controlled tester did not start.')
	const events = await ok('query', "SELECT detail FROM exploration_events WHERE step = 'supervisor'")
	const supervisor = JSON.parse(events.rows[0].detail).pid as number
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	}
	process.kill(supervisor, 'SIGKILL')
	const stoppedBy = Date.now() + 5000
	while (alive(supervisor) && Date.now() < stoppedBy) await new Promise((resolve) => setTimeout(resolve, 50))
	assert.equal(alive(supervisor), false)
	const interrupted = await ok('explore', 'status', first.explorationId)
	assert.equal(interrupted.state, 'interrupted')
	await ok('explore', 'stop', first.explorationId, '--reason', 'Recover interrupted work.')

	assert.equal(alive(tester.pid), false)
	host.reply({ recorder: [{ kind: 'note', text: 'The retry completed.' }] })
	const retry = await ok('test', 'cart', '--build', 'b1', '--level', 'smoke', '--allow', 'Read')
	assert.notEqual(retry.explorationId, first.explorationId)
	assert.equal((await ok('explore', 'wait', retry.explorationId, '--timeout', '60')).state, 'completed')
	const counts = await ok(
		'query',
		'SELECT (SELECT count(*) FROM target_requests) AS targets, (SELECT count(*) FROM plan_requests) AS plans, (SELECT count(*) FROM explorations) AS attempts'
	)
	assert.deepEqual(counts.rows, [{ targets: 1, plans: 1, attempts: 2 }])
})

test('Answer, revise, and approve the named revision — execution against the wrong revision.', async (t) => {
	const workspace = directory(t)
	const { chmodSync, copyFileSync, mkdirSync } = await import('node:fs')
	const { delimiter } = await import('node:path')
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	copyFileSync(join(root, 'test/e2e/spec-host.mjs'), join(bin, 'pi'))
	chmodSync(join(bin, 'pi'), 0o755)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240. Does the promotion replace loyalty?\n')
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
	}
	const ok = async (args: string[], value?: object) => {
		const result = await inputCommand(workspace, env, value ? JSON.stringify(value) : '', ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const target = {
		contractVersion: 'toolkit-2',
		targetId: 'shop',
		revision: 1,
		entryPoints: [{ name: 'web', kind: 'url', purpose: 'Shop HTTP API.' }],
		capabilities: ['http'],
		tools: [],
		authentication: { kind: 'none', references: [] },
		allowedOperations: ['read_catalog'],
		startup: { owner: 'factory', command: null },
		cleanup: 'No test data.',
		readyForLiveExecution: true,
		approvals: { plan: 'required', result: 'required' },
	}
	await ok([
		'target',
		'open',
		'shop',
		'--entry-point',
		'web:url:Shop HTTP API.',
		'--capabilities',
		'http',
		'--operations',
		'read_catalog',
	])
	await ok(['target', 'save', 'shop'], target)
	await ok([
		'plan',
		'open',
		'ticket',
		'--target',
		'shop@1',
		'--objective',
		'Check the quote.',
		'--source',
		'ticket.md',
	])
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [
			{
				id: 'T1',
				title: 'Quote',
				requirementIds: ['R1'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Read the quote.',
				assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
			},
		],
		gaps: [],
	})
	const review = await ok(['delegate', 'spec', 'ticket@1'])
	assert.equal(review.status, 'needs_decision')
	const first = await ok(['spec', 'status', 'ticket@1'])
	assert.equal(first.ready, false)
	assert.equal(first.findings[0].evidence, 'Does the promotion replace loyalty?')
	const blocked = await command(
		workspace,
		env,
		'spec',
		'handoff',
		'ticket@1',
		'--expect-sha',
		first.sha256,
		'--rationale',
		'Ready.'
	)
	assert.equal(blocked.code, 1, blocked.output)
	assert.match(blocked.output, /Gap G1 is open/)
	await ok([
		'gap',
		'answer',
		'ticket',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'The promotion replaces loyalty.',
		'--source',
		'oracle',
		'--rationale',
		'Owner decision.',
	])
	await ok(['plan', 'revise', 'ticket'], { tests: {} })
	const stale = await command(workspace, env, 'delegate', 'spec', 'ticket@1')
	assert.equal(stale.code, 1, stale.output)
	assert.match(stale.output, /stale/i)
	await ok(['delegate', 'spec', 'ticket@2'])
	await ok(['plan', 'approve', 'ticket@2', '--rationale', 'The owner approves.'])
	const ready = await ok(['spec', 'status', 'ticket@2'])
	assert.equal(ready.ready, true)
	await ok(['spec', 'handoff', 'ticket@2', '--expect-sha', ready.sha256, '--rationale', 'Ready to build.'])
	const counts = await ok([
		'query',
		'SELECT (SELECT count(*) FROM instances) AS instances, (SELECT count(*) FROM runs) AS runs, (SELECT count(*) FROM explorations) AS explorations, (SELECT count(*) FROM plan_builds) AS builds',
	])
	assert.deepEqual(counts.rows, [{ instances: 0, runs: 0, explorations: 0, builds: 0 }])
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(t, { recorder: [{ kind: 'note', text: 'Explored the supplied build.' }] }, 'pi')
	const runtime = { ...env, ...host.env }
	const run = async (args: string[], input = '') => {
		const result = await inputCommand(workspace, runtime, input, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await run(['target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`])
	const oldRevision = await command(
		workspace,
		runtime,
		'run',
		'begin',
		'old-run',
		'ticket@1',
		'--build',
		'broken',
		'--instance',
		'local',
		'--tests',
		'T1'
	)
	assert.equal(oldRevision.code, 1, oldRevision.output)
	const firstBuild = await run([
		'explore',
		'start',
		'ticket',
		'--build',
		'broken',
		'--instance',
		'local',
		'--level',
		'smoke',
		'--allow',
		'Read',
	])
	assert.equal((await run(['explore', 'wait', firstBuild.explorationId, '--timeout', '60'])).state, 'completed')
	await run(['run', 'begin', 'run-1', 'ticket@2', '--build', 'broken', '--instance', 'local', '--tests', 'T1'])
	const broken = await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()
	assert.equal(broken.totalPLN, 220)
	const failure = await run(
		['run', 'check', 'run-1', 'T1', 'A1', '--result', 'failed', '--observed', '220', '--evidence', '-'],
		'HTTP 200: 220'
	)
	await run(
		['run', 'finding', 'run-1'],
		JSON.stringify({
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			title: 'Wrong quote',
			expected: '240',
			observed: '220',
			reproduction: ['Read the quote.'],
			evidenceIds: failure.evidenceIds,
		})
	)
	await run(['run', 'close', 'run-1', 'T1'])
	await run([
		'run',
		'finish',
		'run-1',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No test data.',
	])
	await run(['export', 'run', 'run-1', '--format', 'json', '--out', 'broken.json'])
	await run(['export', 'run', 'run-1', '--format', 'junit', '--out', 'broken.xml'])
	const exported = JSON.parse(readFileSync(join(workspace, 'broken.json'), 'utf8'))
	assert.deepEqual([exported.result.applicationBuild, exported.result.findings[0].id], ['broken', 'F1'])
	const junit = readFileSync(join(workspace, 'broken.xml'), 'utf8')
	assert.match(junit, /<failure/)
	assert.match(junit, /F1|Wrong quote/)
	await run(['result', 'accept', 'run-1', '--rationale', 'The finding is valid.'])
	const rejected = await command(
		workspace,
		runtime,
		'plan',
		'promote',
		'ticket@2',
		'--run',
		'run-1',
		'--build',
		'broken',
		'--rationale',
		'Save tests.'
	)
	assert.equal(rejected.code, 1, rejected.output)
	app.fix()
	assert.equal((await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()).totalPLN, 240)
	const fixedBuild = await run([
		'explore',
		'start',
		'ticket',
		'--build',
		'fixed',
		'--instance',
		'local',
		'--level',
		'smoke',
		'--allow',
		'Read',
	])
	assert.equal((await run(['explore', 'wait', fixedBuild.explorationId, '--timeout', '60'])).state, 'completed')
	await run([
		'run',
		'begin',
		'run-2',
		'ticket@2',
		'--build',
		'fixed',
		'--instance',
		'local',
		'--tests',
		'T1',
		'--retest-of',
		'run-1',
	])
	await run(
		['run', 'check', 'run-2', 'T1', 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'],
		'HTTP 200: 240'
	)
	await run(['run', 'close', 'run-2', 'T1'])
	await run([
		'run',
		'finish',
		'run-2',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No test data.',
	])
	const promotion = [
		'plan',
		'promote',
		'ticket@2',
		'--run',
		'run-2',
		'--build',
		'fixed',
		'--rationale',
		'Save tests.',
	]
	assert.equal((await command(workspace, runtime, ...promotion)).code, 1)
	await run(['result', 'accept', 'run-2', '--rationale', 'The fixed build passes.'])
	const saved = await run(promotion)
	assert.deepEqual([saved.subject, saved.recorded, saved.tests], ['ticket@3', true, ['T1']])
	assert.equal((await run(promotion)).recorded, false)
	const snapshots = await run(['plan', 'promotions', 'ticket'])
	assert.deepEqual(
		[snapshots.promotions[0].sourceRevision, snapshots.promotions[0].build, snapshots.promotions[0].runId],
		[2, 'fixed', 'run-2']
	)
	await run(
		['plan', 'edit', 'ticket@3', '--patch'],
		JSON.stringify({ tests: { T1: { title: 'Later draft title' } } })
	)
	const before = await run(['query', 'SELECT count(*) AS n FROM explorations'])
	const permanent = await run([
		'run',
		'permanent',
		'permanent-1',
		'ticket',
		'--build',
		'future',
		'--promotion',
		'ticket@3',
	])
	assert.deepEqual([permanent.plan, permanent.build, permanent.tests], ['ticket@3', 'future', ['T1']])
	copyFileSync(join(root, 'test/e2e/delegate-host.mjs'), join(bin, 'claude'))
	chmodSync(join(bin, 'claude'), 0o755)
	const permanentEnv = {
		...runtime,
		PATH: `${bin}${delimiter}${runtime.PATH}`,
		CHECKMATE_HARNESS: 'claude',
		QA_STAGE: 'permanent',
		QA_APP_URL: app.baseUrl,
	}
	const executed = await command(
		workspace,
		permanentEnv,
		'delegate',
		'execute',
		'permanent-1',
		'--allow',
		'Read',
		'--allow',
		'Bash'
	)
	assert.equal(executed.code, 0, executed.output)
	const result = await run(['run', 'show', 'permanent-1'])
	assert.deepEqual(
		[result.build, result.tests[0].title, result.tests[0].outcome, result.request.permanent.reference],
		['future', 'Quote', 'passed', 'ticket@3']
	)
	assert.equal((await run(['query', 'SELECT count(*) AS n FROM explorations'])).rows[0].n, before.rows[0].n)
})

test('Delegate setup and plan and verify the record — prose or mismatched actor stands in for a receipt.', async (t) => {
	const workspace = directory(t)
	const { chmodSync, copyFileSync, mkdirSync } = await import('node:fs')
	const { delimiter } = await import('node:path')
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	copyFileSync(join(root, 'test/e2e/delegate-host.mjs'), join(bin, 'claude'))
	chmodSync(join(bin, 'claude'), 0o755)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240.\n')
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
		QA_STAGE: 'setup',
		QA_LIE: '0',
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok(
		'target',
		'open',
		'shop',
		'--entry-point',
		'web:url:Shop HTTP API.',
		'--capabilities',
		'http',
		'--operations',
		'read_catalog'
	)
	const setup = await ok('delegate', 'setup', 'shop', '--allow', 'Read')
	assert.equal(setup.status, 'completed')
	await ok('plan', 'open', 'ticket', '--target', 'shop@1', '--objective', 'Check the quote.', '--source', 'ticket.md')
	env.QA_STAGE = 'plan'
	env.QA_LIE = '1'
	const liar = await command(workspace, env, 'delegate', 'plan', 'ticket', '--allow', 'Read')
	assert.equal(liar.code, 1, liar.output)
	assert.match(liar.output, /no plan save/i)
	assert.equal((await ok('query', 'SELECT count(*) AS n FROM plan_revisions')).rows[0].n, 0)
	const wrongWorkspace = directory(t)
	const { cpSync } = await import('node:fs')
	cpSync(join(workspace, '.checkmate'), join(wrongWorkspace, '.checkmate'), { recursive: true })
	copyFileSync(join(workspace, 'ticket.md'), join(wrongWorkspace, 'ticket.md'))
	const wrongActor = await command(
		wrongWorkspace,
		{ ...env, QA_LIE: 'actor' },
		'delegate',
		'plan',
		'ticket',
		'--allow',
		'Read'
	)
	assert.equal(wrongActor.code, 1, wrongActor.output)
	assert.match(wrongActor.output, /actor|no plan save/i)
	env.QA_LIE = '0'
	const plan = await ok('delegate', 'plan', 'ticket', '--allow', 'Read')
	assert.equal(plan.status, 'completed')
	assert.equal(plan.subject, 'ticket@1')
	const records = await ok(
		'query',
		"SELECT command, actor, status FROM operations WHERE command IN ('target save', 'plan save') ORDER BY rowid"
	)
	assert.deepEqual(records.rows, [
		{ command: 'target save', actor: 'claude:setup', status: 'completed' },
		{ command: 'plan save', actor: 'claude:plan', status: 'completed' },
	])
})
