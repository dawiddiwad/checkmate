import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { directory, root } from '../support.ts'
import { fakeClaude } from '../claude.ts'
import { fixture } from '../fixture.ts'

const project = directory()
let binary = ''
test.before(() => {
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
	return invoke(binary, workspace, env, input, args)
}

function invoke(entry: string, workspace: string, env: NodeJS.ProcessEnv, input: string, args: string[]) {
	return new Promise<{ code: number | null; body: ReturnType<typeof JSON.parse>; output: string }>(
		(resolve, reject) => {
			const child = spawn(process.execPath, [entry, ...args, '--json'], { cwd: workspace, env, timeout: 70000 })
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
	let flaky = false
	let calls = 0
	const server = createServer((_req, response) => {
		const totalPLN = flaky && calls++ % 2 === 1 ? 240 : 220
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify({ totalPLN }))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	t.after(() => server.close())
	const address = server.address()
	assert(address && typeof address !== 'string')
	const url = `http://127.0.0.1:${address.port}`
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
		QA_APP_URL: url,
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
		url,
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
	flaky = true
	const disputed = await ok(
		'test',
		'cart',
		'--build',
		'flaky',
		'--level',
		'smoke',
		'--explorers',
		'2',
		'--allow',
		'Read'
	)
	assert.equal((await ok('explore', 'wait', disputed.explorationId, '--timeout', '60')).state, 'completed')
	const claim = (await ok('claim', 'list', 'cart')).claims[0]
	assert.equal(claim.open, true)
	assert.equal(claim.statuses.flaky.status, 'disputed')
	const verdicts = (
		await ok(
			'query',
			`SELECT body FROM journal_entries WHERE exploration_id = '${disputed.explorationId}' AND kind = 'verdict'`
		)
	).rows
		.map((row: { body: string }) => JSON.parse(row.body).result)
		.sort()
	assert.deepEqual(verdicts, ['fixed', 'not_fixed'])
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

test('Stop only one tester and keep the others running — sibling workers killed.', async (t) => {
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
	const started = await ok(
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
		'--explorers',
		'2',
		'--allow',
		'Read'
	)
	const calls: Array<{ role: string; pid: number; work: string }> = []
	const deadline = Date.now() + 10000
	while (calls.filter((call) => call.role === 'tester').length < 2 && Date.now() < deadline) {
		calls.push(...host.called())
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	const testers = calls.filter((call) => call.role === 'tester')
	assert.equal(testers.length, 2, 'Both controlled testers must start.')
	const one = testers.find((item) => item.work.endsWith('/a1'))!
	const two = testers.find((item) => item.work.endsWith('/a2'))!
	assert.ok(one && two)
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	}
	await ok('explore', 'stop', started.explorationId, '--explorer', 'a1', '--reason', 'Stop only the first tester.')
	assert.equal(alive(one.pid), false)
	assert.equal(alive(two.pid), true)
	const status = await ok('explore', 'status', started.explorationId)
	assert.equal(status.state, 'testing')
	assert.equal(status.explorers.find((item: { explorer: string }) => item.explorer === 'a1').ended, 'stopped')
	await ok('explore', 'stop', started.explorationId, '--explorer', 'a2', '--reason', 'Finish the test.')
	assert.equal(alive(two.pid), false)
	const stopped = await command(workspace, env, 'explore', 'wait', started.explorationId, '--timeout', '60')
	assert.equal(stopped.code, 1, stopped.output)
	assert.equal(stopped.body.state, 'stopped')
})

test('Show a safe provider failure and retained partial usage — secret visible or usage silently zero.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The checkout responds.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(t, { explorer: '!pi-auth' }, 'pi')
	const clock = join(workspace, 'clock.cjs')
	writeFileSync(
		clock,
		`if (process.argv.includes('drive')) { const original = global.setTimeout; global.setTimeout = (fn, delay, ...args) => original(fn, delay === 60000 ? 4000 : delay, ...args) }`
	)
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		NODE_OPTIONS: `--require=${clock}`,
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const failed = await ok(
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
	const error = await command(workspace, env, 'explore', 'wait', failed.explorationId, '--timeout', '60')
	assert.equal(error.code, 1, error.output)
	assert.equal(error.body.state, 'failed')
	assert.match(error.output, /API key|authentication|log in/i)
	assert.doesNotMatch(error.output, /fixture-secret/)
	host.reply({ tester: '!partial-sleep', recorder: [{ kind: 'note', text: 'Partial session recorded.' }] })
	const retry = await ok('test', 'cart', '--build', 'b2', '--level', 'smoke', '--timeout', '60', '--allow', 'Read')
	assert.equal((await ok('explore', 'wait', retry.explorationId, '--timeout', '60')).state, 'completed')
	const events = await ok(
		'query',
		`SELECT detail FROM exploration_events WHERE exploration_id = '${retry.explorationId}' AND step = 'end'`
	)
	const detail = JSON.parse(events.rows[0].detail)
	assert.deepEqual([detail.costUsd, detail.costPartial], [0.125, true])
	assert.ok(detail.observedModels.includes('fixture/partial'))
})

test('Run ready tests and report blocked tests — partial execution misreported complete.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240. The refund rule needs a decision.\n')
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (args: string[], value?: object) => {
		const result = await inputCommand(workspace, env, value ? JSON.stringify(value) : '', ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok(['setup', '--url', app.baseUrl, '--target', 'shop'])
	await ok([
		'plan',
		'open',
		'ticket',
		'--target',
		'shop@1',
		'--objective',
		'Check the ticket.',
		'--source',
		'ticket.md',
	])
	const common = { capability: 'http', operations: ['read_catalog'], dependsOn: [], preconditions: [] }
	await ok(['plan', 'save', 'ticket'], {
		requirements: [
			{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' },
			{ id: 'R2', text: 'Refund eligibility is specified.', source: 'ticket.md' },
		],
		tests: [
			{
				...common,
				id: 'T1',
				title: 'Quote',
				requirementIds: ['R1'],
				action: 'Read the quote.',
				assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
			},
			{
				...common,
				id: 'T2',
				title: 'Refund',
				requirementIds: ['R2'],
				action: 'Check the refund.',
				assertions: [],
			},
		],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R2'],
				testIds: ['T2'],
				question: 'Which refunds qualify?',
				consequence: 'The result is unknown.',
				decisionId: null,
			},
		],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the ready rule.'])
	const started = await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--partial', 'ready_only'])
	assert.deepEqual(started.tests, ['T1'])
	assert.deepEqual(started.leftOut, [{ testId: 'T2', reason: 'blocked by G1' }])
	const quote = await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()
	assert.equal(quote.totalPLN, 240)
	const checked = await inputCommand(
		workspace,
		env,
		JSON.stringify(quote),
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--result',
		'passed',
		'--observed',
		String(quote.totalPLN),
		'--evidence',
		'-'
	)
	assert.equal(checked.code, 0, checked.output)
	await ok(['run', 'close', 'run-1', 'T1'])
	await ok([
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
	const rows = await ok(['query', "SELECT body FROM results WHERE run_id = 'run-1'"])
	const result = JSON.parse(rows.rows[0].body)
	assert.deepEqual(
		result.tests.map((item: { testId: string; outcome: string }) => [item.testId, item.outcome]),
		[
			['T1', 'passed'],
			['T2', 'not_run'],
		]
	)
	assert.equal(result.coverage.status, 'partial')
})

test('Discover the packaged Claude plugin and invoke its entry — broken plugin distribution.', async (t) => {
	const workspace = directory(t)
	const plugin = join(project, 'node_modules/@xoxoai/checkmate/plugin')
	const manifest = JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8'))
	assert.equal(manifest.name, 'checkmate')
	const entry = join(plugin, 'dist/checkmate.js')
	assert.equal(execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim(), manifest.version)
	assert.match(execFileSync(process.execPath, [entry, '--help'], { encoding: 'utf8' }), /delegate/)
	const nested = await invoke(entry, workspace, { ...process.env, CHECKMATE_ACTOR: 'claude:execute' }, '', [
		'delegate',
		'execute',
		'run-1',
	])
	assert.equal(nested.code, 1)
	assert.match(nested.output, /cannot start another delegate/)
	const output = execFileSync(process.execPath, [entry, 'init', '--json'], { cwd: workspace, encoding: 'utf8' })
	assert.equal(JSON.parse(output).status, 'completed')
	assert(existsSync(join(workspace, '.checkmate/checkmate.db')))
	const list = execFileSync(process.execPath, [entry, 'plan', 'list', '--json'], { cwd: workspace, encoding: 'utf8' })
	assert.deepEqual(JSON.parse(list).plans, [])
})

test(
	'Install the Pi package and route a request — wrong skill, workspace, or harness.',
	{ timeout: 60000 },
	async (t) => {
		const workspace = directory(t)
		const home = directory(t)
		const agent = join(home, 'agent')
		mkdirSync(agent)
		let received: (value: unknown) => void = () => {}
		const request = new Promise<unknown>((resolve) => {
			received = resolve
		})
		const provider = createServer(async (req, res) => {
			let data = ''
			for await (const part of req) data += part
			received(JSON.parse(data))
			res.writeHead(200, { 'content-type': 'text/event-stream' })
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Done.' }, finish_reason: null }] })}\n\n`
			)
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
			)
			res.end('data: [DONE]\n\n')
		})
		provider.listen(0, '127.0.0.1')
		await once(provider, 'listening')
		t.after(() => provider.close())
		const address = provider.address()
		assert(address && typeof address !== 'string')
		writeFileSync(
			join(agent, 'models.json'),
			JSON.stringify({
				providers: {
					localfixture: {
						baseUrl: `http://127.0.0.1:${address.port}/v1`,
						api: 'openai-completions',
						apiKey: 'fixture',
						models: [{ id: 'fixture' }],
					},
				},
			})
		)
		const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_TELEMETRY: '0' }
		const installed = join(project, 'node_modules/@xoxoai/checkmate')
		execFileSync('pi', ['install', installed, '--local', '--approve'], { cwd: workspace, env, timeout: 30000 })
		const child = spawn(
			'pi',
			['--mode', 'rpc', '--no-session', '--provider', 'localfixture', '--model', 'fixture', '--approve'],
			{ cwd: workspace, env, stdio: 'pipe' }
		)
		t.after(() => child.kill('SIGTERM'))
		const lines = createInterface({ input: child.stdout })
		const events: Record<string, unknown>[] = []
		lines.on('line', (line) => {
			try {
				events.push(JSON.parse(line))
			} catch {}
		})
		const wait = async (predicate: (event: Record<string, unknown>) => boolean) => {
			const deadline = Date.now() + 15000
			while (Date.now() < deadline) {
				const found = events.find(predicate)
				if (found) return found
				await new Promise((resolve) => setTimeout(resolve, 50))
			}
			throw Error(`Pi did not respond: ${JSON.stringify(events)}`)
		}
		child.stdin.write(JSON.stringify({ id: 'commands', type: 'get_commands' }) + '\n')
		const commands = await wait((event) => event.id === 'commands')
		assert.equal(commands.success, true)
		assert.match(JSON.stringify(commands.data), /skill:checkmate/)
		child.stdin.write(
			JSON.stringify({ id: 'prompt', type: 'prompt', message: '/checkmate inspect the checkout fixture' }) + '\n'
		)
		assert.equal((await wait((event) => event.id === 'prompt')).success, true)
		const input = JSON.stringify(
			await Promise.race([
				request,
				new Promise((_, reject) => setTimeout(() => reject(Error('No local provider request')), 15000).unref()),
			])
		)
		assert.match(input, /inspect the checkout fixture/)
		assert.match(input, /Run `target list` and `plan list`/)
		assert.match(input, /checkmate/i)
		assert.ok(input.includes(workspace), 'Pi must route the request with the disposable workspace')
		child.stdin.end()
		await once(child, 'exit')
	}
)

test('Run a narrow retest with prerequisites and regressions — uncovered tests silently accepted.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240.\n')
	const app = await fixture()
	t.after(() => app.close())
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (args: string[], value?: unknown) => {
		const result = await inputCommand(workspace, env, value === undefined ? '' : JSON.stringify(value), ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok(['setup', '--url', app.baseUrl, '--target', 'shop'])
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
	const common = {
		requirementIds: ['R1'],
		capability: 'http',
		operations: ['read_catalog'],
		preconditions: [],
		action: 'Read quote.',
	}
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [
			{
				...common,
				id: 'T1',
				title: 'Prerequisite',
				dependsOn: [],
				metadata: { type: 'regression' },
				assertions: [{ id: 'A1', check: 'Service responds.', checkKind: 'deterministic' }],
			},
			{
				...common,
				id: 'T2',
				title: 'Quote',
				dependsOn: ['T1'],
				assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
			},
			{
				...common,
				id: 'T3',
				title: 'Unrelated',
				dependsOn: [],
				assertions: [{ id: 'A1', check: 'The quote is positive.', checkKind: 'deterministic' }],
			},
		],
		gaps: [],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rules.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'broken', '--tests', 'T1,T2'])
	const quote = await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()
	assert.equal(quote.totalPLN, 220)
	await ok(
		['run', 'check', 'run-1', 'T1', 'A1', '--result', 'passed', '--observed', 'HTTP 200', '--evidence', '-'],
		quote
	)
	await ok(['run', 'close', 'run-1', 'T1'])
	const checked = await inputCommand(
		workspace,
		env,
		JSON.stringify(quote),
		'run',
		'check',
		'run-1',
		'T2',
		'A1',
		'--result',
		'failed',
		'--observed',
		'220',
		'--evidence',
		'-'
	)
	assert.equal(checked.code, 0, checked.output)
	await ok(['run', 'finding', 'run-1'], {
		id: 'F1',
		type: 'defect',
		severity: 'high',
		assertionIds: ['T2.A1'],
		requirementIds: ['R1'],
		title: 'Wrong quote',
		expected: '240',
		observed: '220',
		reproduction: ['Read quote.'],
		evidenceIds: checked.body.evidenceIds,
	})
	await ok(['run', 'close', 'run-1', 'T2'])
	await ok([
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
	const missing = await command(
		workspace,
		env,
		'run',
		'begin',
		'bad',
		'ticket@1',
		'--build',
		'fixed',
		'--retest-of',
		'run-1',
		'--tests',
		'T2'
	)
	assert.equal(missing.body.status, 'needs_decision', missing.output)
	assert.match(missing.output, /regression test/)
	assert.match(missing.output, /Missing prerequisite: T1/)
	app.fix()
	const fixed = await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()
	assert.equal(fixed.totalPLN, 240)
	const begun = await ok([
		'run',
		'begin',
		'run-2',
		'ticket@1',
		'--build',
		'fixed',
		'--retest-of',
		'run-1',
		'--tests',
		'T1,T2',
	])
	assert.deepEqual(begun.tests, ['T1', 'T2'])
	for (const id of ['T1', 'T2']) {
		await ok(
			['run', 'check', 'run-2', id, 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'],
			fixed
		)
		await ok(['run', 'close', 'run-2', id])
	}
	await ok([
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
	const result = await ok(['query', "SELECT body FROM results WHERE run_id = 'run-2'"])
	const recorded = JSON.parse(result.rows[0].body)
	assert.deepEqual(
		recorded.tests.map((item: { testId: string; outcome: string }) => [item.testId, item.outcome]),
		[
			['T1', 'passed'],
			['T2', 'passed'],
			['T3', 'not_run'],
		]
	)
})

test('Open a previous version’s workspace read/write — existing work becomes inaccessible.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	const path = join(workspace, '.checkmate/checkmate.db')
	// Created by the public CLI at 39d33f74138202987a627e119b49ef4ea50a9a57.
	writeFileSync(path, gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-39d33f7.db.gz'))))
	const previous = new DatabaseSync(path)
	assert.equal(previous.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'plan_promotions'").get()!.n, 0)
	previous.close()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const before = await command(workspace, env, 'plan', 'show', 'ticket@1')
	assert.equal(before.code, 0, before.output)
	assert.match(before.output, /The quote is 240/)
	const approval = await command(
		workspace,
		env,
		'plan',
		'approve',
		'ticket@1',
		'--rationale',
		'Review the preserved plan.'
	)
	assert.equal(approval.code, 0, approval.output)
	const after = await command(workspace, env, 'plan', 'show', 'ticket@1')
	assert.equal(after.code, 0, after.output)
	assert.match(after.output, /The quote is 240/)
	const records = await command(
		workspace,
		env,
		'query',
		'SELECT (SELECT count(*) FROM plan_promotions) AS promotions, (SELECT count(*) FROM approvals) AS approvals'
	)
	assert.equal(records.code, 0, records.output)
	assert.deepEqual(records.body.rows, [{ promotions: 0, approvals: 1 }])
})

test('Run a two-instance matrix and accept each latest result — one pass masks another instance’s failure.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-39d33f7.db.gz')))
	)
	const a = await fixture()
	const b = await fixture()
	t.after(() => a.close())
	t.after(() => b.close())
	b.fix()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (args: string[], input = '') => {
		const result = await inputCommand(workspace, env, input, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok(['target', 'instance', 'add', 'shop', 'a', '--entry', `web=${a.baseUrl}`])
	await ok(['target', 'instance', 'add', 'shop', 'b', '--entry', `web=${b.baseUrl}`])
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Check both instances.'])
	for (const [instance, app, expected] of [
		['a', a, 220],
		['b', b, 240],
	] as const) {
		const run = `run-${instance}`
		await ok(['run', 'begin', run, 'ticket@1', '--build', 'b1', '--instance', instance, '--tests', 'T1'])
		const observed = await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()
		assert.equal(observed.totalPLN, expected)
		const checked = await ok(
			[
				'run',
				'check',
				run,
				'T1',
				'A1',
				'--result',
				expected === 240 ? 'passed' : 'failed',
				'--observed',
				String(expected),
				'--evidence',
				'-',
			],
			JSON.stringify(observed)
		)
		if (expected === 220)
			await ok(
				['run', 'finding', run],
				JSON.stringify({
					id: 'F1',
					type: 'defect',
					severity: 'high',
					assertionIds: ['T1.A1'],
					requirementIds: ['R1'],
					title: 'Wrong quote',
					expected: '240',
					observed: '220',
					reproduction: ['Read quote.'],
					evidenceIds: checked.evidenceIds,
				})
			)
		await ok(['run', 'close', run, 'T1'])
		await ok([
			'run',
			'finish',
			run,
			'--completion',
			'completed',
			'--cleanup',
			'completed',
			'--cleanup-reason',
			'No test data.',
		])
		await ok(['result', 'accept', run, '--rationale', 'Reviewed this instance.'])
	}
	const status = await ok(['status', 'ticket'])
	assert.equal(status.state, 'defects_open', JSON.stringify(status))
	assert.match(JSON.stringify(status), /run-a/)
	const records = await ok(['query', 'SELECT run_id, body FROM results ORDER BY run_id'])
	assert.deepEqual(
		records.rows.map((row: { run_id: string; body: string }) => [
			row.run_id,
			JSON.parse(row.body).tests[0].outcome,
		]),
		[
			['run-a', 'failed'],
			['run-b', 'passed'],
		]
	)
})

test('Resume a structured run after a worker deadline — outcomes lost or gate bypassed.', async (t) => {
	const workspace = directory(t)
	const { cpSync } = await import('node:fs')
	const plugin = join(workspace, 'standalone')
	const installed = join(project, 'node_modules/@xoxoai/checkmate/plugin')
	for (const path of ['.claude-plugin', 'dist', 'contracts', 'skills', 'references', 'pi', 'src/ui/assets']) {
		const destination = join(plugin, path)
		mkdirSync(join(destination, '..'), { recursive: true })
		cpSync(join(installed, path), destination, { recursive: true })
	}
	const entry = join(plugin, 'dist/checkmate.js')
	const manifest = JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8'))
	assert.equal(execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim(), manifest.version)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-39d33f7.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	const { chmodSync } = await import('node:fs')
	const { delimiter } = await import('node:path')
	writeFileSync(
		join(bin, 'claude'),
		`#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const plugin = process.argv[process.argv.indexOf('--plugin-dir') + 1]
writeFileSync('worker.pid', String(process.pid))
fetch(process.env.QA_APP_URL + '/quote?promotion=true&loyalty=true').then(r => r.json()).then(quote => {
  if (quote.totalPLN !== 240) throw Error('Bad build')
  if (!process.env.QA_FINISH) execFileSync(process.execPath, [plugin + '/dist/checkmate.js', 'run', 'check', 'run-1', 'T1', 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'], { input: JSON.stringify(quote), stdio: ['pipe', 'pipe', 'inherit'] })
  if (process.env.QA_FINISH) {
    execFileSync(process.execPath, [plugin + '/dist/checkmate.js', 'run', 'close', 'run-1', 'T1'])
    execFileSync(process.execPath, [plugin + '/dist/checkmate.js', 'run', 'finish', 'run-1', '--completion', 'completed', '--cleanup', 'completed', '--cleanup-reason', 'No test data.'])
    console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{status:'completed',subject:'run-1',reasons:[]}}))
    return
  }
  setInterval(() => {}, 1000)
})
`,
		{ mode: 0o755 }
	)
	chmodSync(join(bin, 'claude'), 0o755)
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
		QA_APP_URL: app.baseUrl,
	}
	const ok = async (...args: string[]) => {
		const result = await invoke(entry, workspace, env, '', args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok('target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`)
	await ok('plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.')
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'fixed', '--instance', 'local', '--tests', 'T1')
	const stopped = await invoke(entry, workspace, env, '', [
		'delegate',
		'execute',
		'run-1',
		'--timeout',
		'2',
		'--allow',
		'Read',
		'--allow',
		'Bash',
	])
	assert.equal(stopped.code, 1, stopped.output)
	assert.equal(stopped.body.status, 'interrupted')
	assert.match(stopped.output, /Worker deadline exceeded/)
	const records = await ok(
		'query',
		"SELECT test_id, assertion_id, result FROM assertion_results WHERE run_id='run-1'"
	)
	assert.deepEqual(records.rows, [{ test_id: 'T1', assertion_id: 'A1', result: 'passed' }])
	const resumed = await ok('run', 'resume', 'run-1')
	assert.equal(resumed.attempt, 2)
	assert.equal(resumed.tests[0].recorded, 1)
	const completed = await invoke(entry, workspace, { ...env, QA_FINISH: '1' }, '', [
		'delegate',
		'execute',
		'run-1',
		'--allow',
		'Read',
		'--allow',
		'Bash',
	])
	assert.equal(completed.code, 0, completed.output)
	assert.equal(completed.body.status, 'completed')
	const results = await ok('query', "SELECT body FROM results WHERE run_id='run-1'")
	const result = JSON.parse(results.rows[0].body)
	assert.equal(result.tests[0].outcome, 'passed')
	const pid = Number(readFileSync(join(workspace, 'worker.pid'), 'utf8'))
	assert.throws(() => process.kill(pid, 0), /ESRCH/)
})

test(
	'Resume a chat turn and change its model — wrong native session, context, or charge.',
	{ timeout: 45000 },
	async (t) => {
		const workspace = directory(t)
		const host = fakeClaude(t, {
			request: 'The quote was checked.',
			models: [
				{ value: 'sonnet', displayName: 'Sonnet' },
				{ value: 'opus', displayName: 'Opus' },
			],
		})
		const env = { ...process.env, ...host.env, CHECKMATE_HARNESS: 'claude' }
		const server = spawn(process.execPath, [binary, 'ui', '--port', '0', '--json'], { cwd: workspace, env })
		t.after(() => {
			if (server.exitCode === null) server.kill('SIGTERM')
		})
		const [first] = (await once(server.stdout, 'data')) as [Buffer]
		const url = JSON.parse(first.toString().split('\n')[0]).url as string
		assert(url)
		const html = await (await fetch(new URL('/chats', url))).text()
		const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(html)?.[1]
		assert(csrf)
		const send = async (path: string, text: string, model: string) => {
			const response = await fetch(new URL(path, url), {
				method: 'POST',
				redirect: 'manual',
				headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'checkmate_actor=oracle' },
				body: new URLSearchParams({ csrf, text, model, harness: 'claude' }),
			})
			assert.equal(response.status, 303, await response.text())
			return response.headers.get('location')!
		}
		const done = async (count: number) => {
			const until = Date.now() + 10000
			while (Date.now() < until) {
				const result = await command(
					workspace,
					env,
					'query',
					"SELECT count(*) AS n FROM request_events WHERE status='answered'"
				)
				if (result.body.rows[0].n >= count) return
				await new Promise((resolve) => setTimeout(resolve, 50))
			}
			throw Error('Chat did not answer')
		}
		const chat = await send('/chats', 'First prompt.', 'sonnet')
		assert.match(chat, /^\/chats\//)
		await done(1)
		await send(`${chat}/turns`, 'Same model.', 'sonnet')
		await done(2)
		await send(`${chat}/turns`, 'Different model.', 'opus')
		await done(3)
		const calls = host.called().filter((item: { role: string }) => item.role === 'request')
		assert.equal(calls.length, 3)
		const flag = (call: { args: string[] }, key: string) => call.args[call.args.indexOf(key) + 1]
		assert.equal(flag(calls[0], '--model'), 'sonnet')
		assert.equal(flag(calls[1], '--resume'), flag(calls[0], '--session-id'))
		assert.equal(flag(calls[2], '--model'), 'opus')
		assert.notEqual(flag(calls[2], '--session-id'), flag(calls[0], '--session-id'))
		assert.match(calls[2].prompt, /First prompt.*The quote was checked.*Same model/s)
		const stored = await command(workspace, env, 'query', 'SELECT conversation, text FROM requests ORDER BY rowid')
		assert.deepEqual(
			stored.body.rows.map((row: { text: string }) => row.text),
			['First prompt.', 'Same model.', 'Different model.']
		)
		assert.equal(new Set(stored.body.rows.map((row: { conversation: string }) => row.conversation)).size, 1)
		const events = await command(workspace, env, 'query', 'SELECT detail FROM request_events ORDER BY rowid')
		const history = JSON.stringify(events.body.rows)
		assert.match(history, /sonnet/)
		assert.match(history, /opus/)
		assert.ok(history.includes(flag(calls[0], '--session-id')))
		assert.ok(history.includes(flag(calls[2], '--session-id')))
		const costs = await command(
			workspace,
			env,
			'query',
			"SELECT detail FROM request_events WHERE step='state' AND status='answered' ORDER BY rowid"
		)
		assert.deepEqual(
			costs.body.rows.map((row: { detail: string }) => JSON.parse(row.detail).costUsd),
			[0.06, undefined, 0.06]
		)
	}
)
