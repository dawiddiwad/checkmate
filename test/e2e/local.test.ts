import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { delimiter, join } from 'node:path'
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

test('Point run accept and run reject to the result command — a wrong command name leaves the record unchanged.', async (t) => {
	const workspace = directory(t)
	const result = spawnSync(
		process.execPath,
		[binary, 'run', 'reject', 'run-1', '--rationale', 'The evidence is wrong.'],
		{
			cwd: workspace,
			encoding: 'utf8',
		}
	)
	assert.equal(result.status, 1)
	assert.match(result.stdout + result.stderr, /Unknown command: run reject/)
	assert.match(result.stdout + result.stderr, /Use result reject <runId> --rationale/)
})

test('Recover after missing host or missing ticket source — unexplained partial records or duplicates.', async (t) => {
	const workspace = directory(t)
	const env = { ...process.env, PATH: '', CHECKMATE_HARNESS: 'pi', CHECKMATE_ACTOR: 'oracle' }
	const base = [
		'test',
		'cart',
		'--url',
		'http://127.0.0.1:9',
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
		'--build',
		'b1',
		'--allow',
		'Read',
	]
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

test('Keep a defect stored while a question about its rule waits — the finding is lost or the run is refused.', async (t) => {
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
		QA_QUESTION_RULE: 'R1',
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
	assert.deepEqual([status.state, status.waitsOn], ['needs_answers', 'oracle'])
	const shown = await ok('plan', 'show', 'cart')
	const observed = shown.plan.tests.find(
		(test: { metadata?: { harvestedFrom?: string } }) => test.metadata?.harvestedFrom
	)
	assert.equal(observed.readiness, 'ready', 'An observed defect is ready to record')
	assert.deepEqual(
		observed.gapIds,
		['UR1', 'Q1'],
		'Status must still name the waiting question and the unchecked rule'
	)
	await ok('export', 'run', `findings-${start.explorationId}`, '--format', 'junit', '--out', 'findings.xml')
	assert.match(readFileSync(join(workspace, 'findings.xml'), 'utf8'), /<failure/)
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
	assert.deepEqual([status.state, status.waitsOn], ['needs_answers', 'oracle'])
	const revision = await ok('plan', 'show', 'cart')
	assert.equal(revision.revision, 1, 'The test flow must save revision 1')
	await ok('export', 'run', `findings-${start.explorationId}`, '--format', 'junit', '--out', 'findings.xml')
	const findingsXml = readFileSync(join(workspace, 'findings.xml'), 'utf8')
	assert.match(findingsXml, /<failure/)
	assert.match(findingsXml, /Wrong quote|defect/i)
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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

test('Open a database that another process reads while it switches to WAL — parallel first command fails.', async (t) => {
	const workspace = directory(t)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_BUSY_TIMEOUT_MS: '100' }
	mkdirSync(join(workspace, '.checkmate'), { recursive: true })
	const path = join(workspace, '.checkmate', 'checkmate.db')
	new DatabaseSync(path).close()
	// A rollback-mode database that another process reads cannot switch to WAL at once. The holder keeps its read lock for 600 ms.
	const holder = spawn(
		process.execPath,
		[
			'-e',
			`const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]);
db.exec('BEGIN; SELECT count(*) FROM sqlite_master'); console.log('locked');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600); db.exec('COMMIT'); db.close()`,
			path,
		],
		{ stdio: ['ignore', 'pipe', 'inherit'] }
	)
	t.after(() => holder.kill())
	const [line] = (await once(holder.stdout, 'data')) as [Buffer]
	assert.match(line.toString(), /locked/)
	const result = await command(workspace, env, 'target', 'list')
	assert.equal(result.code, 0, result.output)
	assert.equal(result.body.status, 'completed')
})

test('Remove only what the answer drops — a revise that also removed R5 and T4 was refused as an over-drop.', async () => {
	const path = '../../plugin/src/plans.ts'
	const { unrequestedRemovals } = (await import(path)) as {
		unrequestedRemovals: (
			dropped: Set<string>,
			droppedTests: Set<string>,
			requirements: string[],
			tests: string[]
		) => string[]
	}
	assert.deepEqual(unrequestedRemovals(new Set(['R6']), new Set(['T6']), ['R6'], ['T6']), [])
	assert.deepEqual(unrequestedRemovals(new Set(['R6']), new Set(['T6']), ['R5', 'R6'], ['T4', 'T6']), ['R5', 'T4'])
})

test('Find the criterion a drop answer names from its wording — the planner did not link the gap to it.', async () => {
	const path = '../../plugin/src/plans.ts'
	const { droppedRequirement } = (await import(path)) as {
		droppedRequirement: (requirements: Array<{ id: string; text: string }>, value: string) => string | null
	}
	const requirements = [
		{ id: 'R6', text: 'List sorted by title ascending.' },
		{ id: 'R7', text: 'List shows newest books first.' },
	]
	assert.equal(droppedRequirement(requirements, 'Drop the newest-first criterion. The list is out of scope.'), 'R7')
	assert.equal(
		droppedRequirement(
			requirements,
			'The list is sorted by title ascending, and the newest-first criterion is out of scope, so drop it.'
		),
		'R7'
	)
	assert.equal(droppedRequirement(requirements, 'Drop the list.'), null)
})

test('Drop a criterion by revise — a dropped criterion stayed ready and needed a manual plan edit.', async (t) => {
	const workspace = directory(t)
	const { chmodSync, copyFileSync, mkdirSync } = await import('node:fs')
	const { delimiter } = await import('node:path')
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	copyFileSync(join(root, 'test/e2e/delegate-host.mjs'), join(bin, 'claude'))
	chmodSync(join(bin, 'claude'), 0o755)
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
		QA_STAGE: 'setup',
		QA_LIE: '0',
	}
	const ok = async (args: string[], input?: unknown) => {
		const result = await inputCommand(workspace, env, input === undefined ? '' : JSON.stringify(input), ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
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
	await ok(['delegate', 'setup', 'shop', '--allow', 'Read'])
	writeFileSync(join(workspace, 'ticket.md'), '# Ticket\n\n1. The quote is 240.\n2. The list is newest first.\n')
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
	const partial = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
			tests: [],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(partial.code, 1, partial.output)
	assert.match(partial.output, /sources list 2 numbered criteria/)
	await ok(['plan', 'save', 'ticket'], {
		requirements: [
			{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' },
			{ id: 'R2', text: 'The list is newest first.', source: 'ticket.md' },
		],
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
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
			},
			{
				id: 'T2',
				title: 'Order',
				requirementIds: ['R2'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Read the list.',
				assertions: [
					{
						id: 'A1',
						check: 'The newest item is first.',
						checkKind: 'deterministic',
						observe: 'the first item in the list',
						expected: 'newest',
					},
				],
			},
		],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R2'],
				testIds: ['T2'],
				question: 'Is the list newest first or sorted by title?',
				consequence: 'The order test is unknown.',
				decisionId: null,
			},
		],
	})
	await ok([
		'gap',
		'answer',
		'ticket',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'Drop the newest-first criterion. The list is out of scope.',
		'--source',
		'oracle',
		'--rationale',
		'Owner dropped the criterion.',
	])
	const refused = await inputCommand(
		workspace,
		env,
		JSON.stringify({ requirements: { R2: { remove: true } }, tests: {} }),
		'plan',
		'revise',
		'ticket'
	)
	assert.equal(refused.code, 1, refused.output)
	assert.match(refused.output, /still has tests: T2/)
	const keeps = await inputCommand(
		workspace,
		env,
		JSON.stringify({ tests: { T2: { remove: true } } }),
		'plan',
		'revise',
		'ticket'
	)
	assert.equal(keeps.code, 1, keeps.output)
	assert.match(keeps.output, /drops R2, but the revision still has it/)
	const revised = await ok(['plan', 'revise', 'ticket'], {
		requirements: { R2: { remove: true } },
		tests: { T2: { remove: true } },
	})
	assert.deepEqual(revised.removed, { tests: ['T2'], requirements: ['R2'] })
	const [{ body }] = (
		await ok(['query', "SELECT body FROM plan_revisions WHERE plan_id = 'ticket' AND revision = 2"])
	).rows
	const plan = JSON.parse(body)
	assert.deepEqual(
		plan.tests.map((test: { id: string }) => test.id),
		['T1']
	)
	assert.deepEqual(
		plan.requirements.map((requirement: { id: string }) => requirement.id),
		['R1']
	)
	assert.deepEqual(plan.gaps[0].testIds, [])
	assert.deepEqual(plan.gaps[0].requirementIds, [])
})

test('Pre-allow only the Checkmate commands that a chat may run — a shell chain or a run start passed without a person.', async () => {
	const permission = '../../plugin/pi/permission.mjs'
	const { chatCommandAllowed } = (await import(permission)) as {
		chatCommandAllowed: (command: string, clis: string[]) => boolean
	}
	const cli = '/workspace/cli/src/main.ts'
	const allowed = [
		`CHECKMATE_HARNESS=pi node "${cli}" status BS-42`,
		`node "${cli}" target list && node "${cli}" plan list`,
		`CHECKMATE_HARNESS=pi node "${cli}" gap answer BS-42 G1 --kind clarify --value 'drop it' --source ticket.md --rationale 'owner'`,
		`node "${cli}" plan revise BS-42 --actor pi:revise <<'EOF'\n{"tests":{}}\nEOF`,
		`node "${cli}" plan edit BS-42@1 --patch --rationale 'drop it' <<'EOF'\n{"tests":{}}\nEOF\nnode "${cli}" plan show BS-42`,
	]
	const refused = [
		`node "${cli}" run begin run-1 BS-42@1 --build b1`,
		`node "${cli}" delegate execute run-1`,
		`node "${cli}" status BS-42; rm -rf .checkmate`,
		`node "${cli}" status $(id)`,
		`node "/other/cli/src/main.ts" status`,
		`node "${cli}" plan revise BS-42 <<'EOF'\n{}\nEOF\nrm -rf x`,
		`node "${cli}" plan edit BS-42@1 --patch <<'EOF'\n{}\nEOF\nnode "${cli}" run begin run-2 BS-42@1 --build b1`,
	]
	for (const command of allowed) assert.equal(chatCommandAllowed(command, [cli]), true, command)
	for (const command of refused) assert.equal(chatCommandAllowed(command, [cli]), false, command)
})

test('Revise a test whole — the code keeps an assertion ID whose check is unchanged and refuses a compound check.', async (t) => {
	const workspace = directory(t)
	const { chmodSync, copyFileSync, mkdirSync } = await import('node:fs')
	const { delimiter } = await import('node:path')
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	copyFileSync(join(root, 'test/e2e/delegate-host.mjs'), join(bin, 'claude'))
	chmodSync(join(bin, 'claude'), 0o755)
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
		QA_STAGE: 'setup',
		QA_LIE: '0',
	}
	const ok = async (args: string[], input?: unknown) => {
		const result = await inputCommand(workspace, env, input === undefined ? '' : JSON.stringify(input), ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
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
	await ok(['delegate', 'setup', 'shop', '--allow', 'Read'])
	writeFileSync(join(workspace, 'ticket.md'), '# Ticket\n\n1. The quote is 240.\n2. The list is newest first.\n')
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
		requirements: [
			{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' },
			{ id: 'R2', text: 'The list is newest first.', source: 'ticket.md' },
		],
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
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
			},
			{
				id: 'T2',
				title: 'Order',
				requirementIds: ['R2'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'Read the list.',
				assertions: [
					{
						id: 'A1',
						check: 'The newest item is first.',
						checkKind: 'deterministic',
						observe: 'the first item in the list',
						expected: 'newest',
					},
				],
			},
		],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R2'],
				testIds: ['T2'],
				question: 'Is the list newest first?',
				consequence: 'The order test is unknown.',
				decisionId: null,
			},
		],
	})
	await ok([
		'gap',
		'answer',
		'ticket',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'Keep newest first.',
		'--source',
		'oracle',
		'--rationale',
		'Owner decision.',
	])
	const compound = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			tests: {
				T2: {
					assertions: [{ check: 'The quote is 240 and the total is 260.', checkKind: 'deterministic' }],
				},
			},
		}),
		'plan',
		'revise',
		'ticket'
	)
	assert.equal(compound.code, 1, compound.output)
	assert.match(compound.output, /checks more than one value/)
	const revised = await ok(['plan', 'revise', 'ticket'], {
		tests: {
			T2: {
				assertions: [
					{
						check: 'The newest item is first.',
						checkKind: 'deterministic',
						observe: 'the first item in the list',
						expected: 'newest',
					},
					{
						check: 'The list has at most 10 items.',
						checkKind: 'deterministic',
						observe: 'the number of items in the list',
						expected: '10',
					},
				],
			},
		},
	})
	assert.equal(revised.status, 'completed', JSON.stringify(revised))
	const [{ body: stored }] = (
		await ok(['query', "SELECT body FROM plan_revisions WHERE plan_id = 'ticket' AND revision = 2"])
	).rows
	const t2 = JSON.parse(stored).tests.find((test: { id: string }) => test.id === 'T2')
	assert.deepEqual(
		t2.assertions.map((assertion: { id: string; check: string }) => [assertion.id, assertion.check]),
		[
			['A1', 'The newest item is first.'],
			['A2', 'The list has at most 10 items.'],
		]
	)
})
test('Read a worker reply with one JSON object among its words — a low-tier worker added a sentence around the JSON.', async () => {
	const launcher = '../../cli/src/launcher.ts'
	const { readPiResponse } = (await import(launcher)) as {
		readPiResponse: (result: { result: unknown; failure?: [string, string] }) => { status: string; subject: string }
	}
	const wrapped = readPiResponse({
		result: 'Recorded the revision.\n{"status":"completed","subject":"BS-42","reasons":[]}\nDone.',
	})
	assert.deepEqual(wrapped, { status: 'completed', subject: 'BS-42', reasons: [] })
	assert.throws(() => readPiResponse({ result: 'I revised the plan.' }), /did not return a JSON response/)
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
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--instance',
		'local',
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.'
	)
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
	assert.equal(status.state, 'nothing_to_run')
	const revision = await ok('plan', 'show', 'cart')
	assert.ok(
		revision.plan.gaps.some(
			(gap: { requirementIds: string[]; question: string }) =>
				gap.requirementIds.includes('R1') && /R1 was not checked/.test(gap.question)
		),
		'The unobserved rule must stay open as a gap'
	)
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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

test('Wait on a paused exploration — the driver burns the timeout instead of answering the pause.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The promotion quote is 240 PLN.\n')
	const app = await fixture()
	t.after(() => app.close())
	const host = fakeClaude(t, {}, 'claude')
	const env = {
		...process.env,
		...host.env,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
		QA_APP_URL: app.baseUrl,
		QA_WORKSPACE: workspace,
		QA_CLI: binary,
	}
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
		'--source',
		'ticket.md',
		'--build',
		'broken',
		'--session'
	)
	await ok('explore', 'pause', started.explorationId, '--reason', 'Shipping rule needs a decision.')
	const began = Date.now()
	const waited = await ok('explore', 'wait', started.explorationId, '--timeout', '60')
	assert.ok(Date.now() - began < 30000, 'a paused exploration must return at once')
	assert.equal(waited.outcome, 'paused')
	assert.match(waited.hint, new RegExp(`checkmate explore next ${started.explorationId}`))
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
		reset: { owner: 'environment', command: null, policy: { text: 'The test fixture keeps no records.' } },
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
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
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
		['run', 'check', 'run-1', 'T1', 'A1', '--observed', '220', '--evidence', '-'],
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
	await run(['run', 'check', 'run-2', 'T1', 'A1', '--observed', '240', '--evidence', '-'], 'HTTP 200: 240')
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
	const noTarget = await command(
		workspace,
		env,
		'plan',
		'open',
		'ticket',
		'--target',
		'shop@1',
		'--objective',
		'Check the quote.',
		'--source',
		'ticket.md'
	)
	assert.equal(noTarget.code, 1, noTarget.output)
	assert.match(noTarget.output, /Unknown target profile: shop@1/)
	assert.match(noTarget.output, /checkmate setup --url <url>/)
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
	const unplanned = await ok('status', 'ticket')
	assert.equal(unplanned.revision, null)
	assert.match(unplanned.why.join('\n'), /no saved revision/)
	assert.ok(
		unplanned.next.some((line: string) => /delegate plan ticket/.test(line)),
		unplanned.next.join('\n')
	)
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
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
	await ok([
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
	])
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
	const compound = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
			tests: [
				{
					...common,
					id: 'T1',
					title: 'Quote',
					requirementIds: ['R1'],
					action: 'Read the quote.',
					assertions: [
						{ id: 'A1', check: 'The quote is 240 and the refund is 30 days.', checkKind: 'deterministic' },
					],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(compound.code, 1, compound.output)
	assert.match(compound.output, /checks more than one value/)
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
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
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
	const bareError = await inputCommand(
		workspace,
		env,
		'',
		'run',
		'close',
		'run-1',
		'T1',
		'--outcome',
		'error',
		'--reason',
		'Browser did not open the page'
	)
	assert.equal(bareError.code, 1, bareError.output)
	assert.match(bareError.output, /needs the output of the failed tool/)
	const giveUp = await inputCommand(
		workspace,
		env,
		'',
		'run',
		'finish',
		'run-1',
		'--completion',
		'operational_error',
		'--cleanup',
		'not_applicable',
		'--cleanup-reason',
		'No test ran.'
	)
	assert.equal(giveUp.code, 1, giveUp.output)
	assert.match(giveUp.output, /Selected tests are not closed: T1/)
	const checked = await inputCommand(
		workspace,
		env,
		JSON.stringify(quote),
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
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
	assert.match(
		execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }),
		new RegExp(`^${manifest.version} build [0-9a-f]{12}\n`)
	)
	const packageManifest = JSON.parse(
		readFileSync(join(project, 'node_modules/@xoxoai/checkmate/package.json'), 'utf8')
	)
	assert.match(
		execFileSync(process.execPath, [binary, '--version'], { encoding: 'utf8' }),
		new RegExp(`^${packageManifest.version} build [0-9a-f]{12}\n`)
	)
	assert.equal(manifest.version, packageManifest.version)
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

test('Execute a plan chat through the packaged UI — a begun run must reach its worker.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	writeFileSync(
		join(bin, 'claude'),
		`#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const args = process.argv.slice(2)
const plugin = args[args.indexOf('--plugin-dir') + 1]
const cli = plugin + '/dist/checkmate.js'
const run = (args, input) => execFileSync(process.execPath, [cli, ...args], {input, encoding:'utf8'})
const input = readFileSync(0, 'utf8')
if (args.includes('stream-json')) {
  require('node:fs').appendFileSync('chat-args.jsonl', JSON.stringify(args) + '\\n')
  const instructions = args[args.indexOf('--append-system-prompt') + 1]
  if (!input.includes('execute the fixture run') || !instructions.includes('When the person asks you to run or retest stored tests')) throw Error('Wrong request or workflow')
  run(['run','begin','ui-run','ticket@1','--build','fixed','--instance','local','--tests','T1'])
  run(['delegate','execute','ui-run','--allow','Read','--allow','Bash'])
  console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Run finished.',session_id:'fixture',duration_ms:1}))
} else {
  fetch(process.env.QA_APP_URL + '/quote?promotion=true&loyalty=true').then(r => r.json()).then(quote => {
    if (quote.totalPLN !== 240 || !input.includes('ui-run')) throw Error('Wrong build or run')
    run(['run','check','ui-run','T1','A1','--observed','240','--evidence','-'], JSON.stringify(quote))
    run(['run','close','ui-run','T1'])
    run(['run','finish','ui-run','--completion','completed','--cleanup','completed','--cleanup-reason','No test data.'])
    console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{status:'completed',subject:'ui-run',reasons:[]}}))
  }).catch(e => { console.error(e); process.exitCode = 1 })
}
`,
		{ mode: 0o755 }
	)
	const { delimiter } = await import('node:path')
	const env = {
		...process.env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
		QA_APP_URL: app.baseUrl,
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok('target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`)
	await ok('plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.')
	const ui = spawn(process.execPath, [binary, 'ui', '--port', '0', '--json'], { cwd: workspace, env })
	t.after(() => ui.kill('SIGTERM'))
	const [data] = (await once(ui.stdout, 'data')) as [Buffer]
	const url = JSON.parse(data.toString()).url as string
	const page = await (await fetch(new URL('/plans/ticket', url))).text()
	const csrf = /name="csrf" value="([^"]+)"/.exec(page)?.[1]
	assert(csrf, 'Plan page did not expose a CSRF token')
	const response = await fetch(new URL('/plans/ticket/chats', url), {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(url).origin },
		body: new URLSearchParams({
			actor: 'oracle',
			text: 'Please execute the fixture run.',
			harness: 'claude',
			csrf,
		}),
		redirect: 'manual',
	})
	assert.equal(response.status, 303)
	let result
	for (let attempt = 0; attempt < 100; attempt++) {
		const rows = await ok('query', "SELECT body FROM results WHERE run_id='ui-run'")
		if (rows.rows.length) {
			result = JSON.parse(rows.rows[0].body)
			break
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	assert(result, 'UI chat did not produce a result')
	assert.equal(result.tests[0].outcome, 'passed')
	assert.equal((await ok('run', 'show', 'ui-run')).build, 'fixed')
	const calls: string[][] = readFileSync(join(workspace, 'chat-args.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line))
	const chatArgs = calls.find((args) => args.includes('--allowedTools')) ?? []
	const allowed: string[] = chatArgs.flatMap((arg, index) => (chatArgs[index - 1] === '--allowedTools' ? [arg] : []))
	assert(
		allowed.some((rule) => /^Bash\(node ".*checkmate\.js" plan show:\*\)$/.test(rule)),
		'Chat must allow exact read commands'
	)
	assert(
		allowed.some((rule) => /^Bash\(node ".*checkmate\.js" gap answer:\*\)$/.test(rule)),
		'Chat must allow the gap answer write'
	)
	assert(
		allowed.some((rule) => /^Bash\(node '.*checkmate\.js' plan show:\*\)$/.test(rule)),
		'Chat must allow the single-quoted form the model uses'
	)
	assert(!allowed.some((rule) => /run begin/.test(rule)), 'Chat must not pre-allow commands that touch the target')
	assert.deepEqual(
		(await ok('query', "SELECT actor FROM operations WHERE command='run check' AND status='completed'")).rows,
		[{ actor: 'claude:execute' }]
	)
	assert.equal((await ok('query', 'SELECT count(*) AS n FROM runs')).rows[0].n, 1)
	writeFileSync(
		join(bin, 'pi'),
		`#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line)
  if (message.type === 'prompt') appendFileSync('unexpected-prompt', 'prompted')
  console.log(JSON.stringify({type:'response',id:message.id,command:message.type,success:true,data:{commands:[]}}))
})
`,
		{ mode: 0o755 }
	)
	const refused = await fetch(new URL('/plans/ticket/chats', url), {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(url).origin },
		body: new URLSearchParams({ actor: 'oracle', text: 'Do not run without a gate.', harness: 'pi', csrf }),
		redirect: 'manual',
	})
	assert.equal(refused.status, 303)
	let gate = ''
	for (let attempt = 0; attempt < 100; attempt++) {
		const events = await ok('query', 'SELECT detail FROM request_events ORDER BY rowid')
		gate = JSON.stringify(events.rows)
		if (gate.includes('Pi did not load the permission gate')) break
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	assert.match(gate, /Pi did not load the permission gate/)
	assert.equal(existsSync(join(workspace, 'unexpected-prompt')), false)
	assert.equal((await ok('query', 'SELECT count(*) AS n FROM runs')).rows[0].n, 1)
	ui.kill('SIGTERM')
	await once(ui, 'close')

	const piWorkspace = directory(t)
	mkdirSync(join(piWorkspace, '.checkmate'))
	writeFileSync(
		join(piWorkspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const installed = join(project, 'node_modules/@xoxoai/checkmate')
	const fullCli = join(installed, 'dist/checkmate.js')
	assert.match(execFileSync(process.execPath, [fullCli, '--help'], { encoding: 'utf8' }), /checkmate delegate/)
	const realPi = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()
	const piHome = directory(t)
	const agent = join(piHome, 'agent')
	mkdirSync(agent)
	const providerRequests: Array<{ body: Record<string, unknown>; ui: boolean; kind: string }> = []
	const providerErrors: string[] = []
	let uiSetupToolCalls = 0
	let uiExecutionStep = 0
	let workerStep = 0
	let uiCliPath = ''
	const shell = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
	const workerScript = `
import { execFileSync } from 'node:child_process'
const cli = ${JSON.stringify(fullCli)}
const response = await fetch(${JSON.stringify(`${app.baseUrl}/quote?promotion=true&loyalty=true`)})
const quote = await response.json()
if (response.status !== 200 || quote.totalPLN !== 240) throw Error('The fixed loopback build did not return 240 PLN.')
const invoke = (args, input = '') => execFileSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] })
invoke(['run', 'check', 'pi-ui-run', 'T1', 'A1', '--observed', String(quote.totalPLN), '--evidence', '-'], JSON.stringify({ status: response.status, quote }))
invoke(['run', 'close', 'pi-ui-run', 'T1'])
invoke(['run', 'finish', 'pi-ui-run', '--completion', 'completed', '--cleanup', 'completed', '--cleanup-reason', 'No test data.'])
`
	const workerCommand = `node --input-type=module -e ${shell(workerScript)}`
	const provider = createServer(async (req, res) => {
		let data = ''
		for await (const part of req) data += part
		try {
			const body = JSON.parse(data) as Record<string, unknown>
			const messages = Array.isArray(body.messages) ? body.messages : []
			const requestText = JSON.stringify(messages)
			const ui = requestText.includes('This conversation comes from the Checkmate web UI.')
			const worker = !ui && requestText.includes('Run: pi-ui-run.')
			const lastUserText = JSON.stringify(
				messages.filter((message: Record<string, unknown>) => message.role === 'user').at(-1)?.content ?? ''
			)
			providerRequests.push({ body, ui, kind: worker ? 'worker' : ui ? 'ui' : 'other' })
			let delta: Record<string, unknown>
			let finishReason: string
			if (ui && lastUserText.includes('Check setup only. Do not run QA or start a test.')) {
				if (
					!requestText.includes(
						'When the person asks only for setup or a reachability check, stop after setup.'
					)
				)
					throw Error('The UI Pi prompt omitted the setup-only instruction.')
				delta = { content: 'Setup is ready. I did not start QA.' }
				finishReason = 'stop'
			} else if (ui && lastUserText.includes('Please execute the fixture run.')) {
				if (
					!requestText.includes(
						'When the person asks you to run or retest stored tests, continue until you execute the run that Checkmate began.'
					)
				)
					throw Error('The UI Pi prompt omitted the run handoff instruction.')
				const cliPath = /node '([^']+)' <command>/.exec(requestText)?.[1]
				if (!cliPath || !existsSync(cliPath))
					throw Error('The UI Pi prompt did not name its installed CLI path.')
				assert.match(
					execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' }),
					/checkmate delegate/
				)
				uiCliPath = cliPath
				if (uiExecutionStep === 0) {
					uiExecutionStep++
					delta = {
						tool_calls: [
							{
								index: 0,
								id: 'ui-begin',
								type: 'function',
								function: {
									name: 'bash',
									arguments: JSON.stringify({
										command: `node ${shell(uiCliPath)} run begin pi-ui-run ticket@1 --build fixed --instance local --tests T1`,
									}),
								},
							},
						],
					}
					finishReason = 'tool_calls'
				} else if (uiExecutionStep === 1) {
					uiExecutionStep++
					delta = {
						tool_calls: [
							{
								index: 0,
								id: 'ui-execute',
								type: 'function',
								function: {
									name: 'bash',
									arguments: JSON.stringify({
										command: `node ${shell(uiCliPath)} delegate execute pi-ui-run`,
									}),
								},
							},
						],
					}
					finishReason = 'tool_calls'
				} else {
					uiExecutionStep++
					delta = { content: 'The fixture run finished. Its recorded evidence is ready for review.' }
					finishReason = 'stop'
				}
			} else if (worker) {
				if (workerStep === 0) {
					workerStep++
					delta = {
						tool_calls: [
							{
								index: 0,
								id: 'worker-run',
								type: 'function',
								function: { name: 'bash', arguments: JSON.stringify({ command: workerCommand }) },
							},
						],
					}
					finishReason = 'tool_calls'
				} else {
					workerStep++
					delta = { content: JSON.stringify({ status: 'completed', subject: 'pi-ui-run', reasons: [] }) }
					finishReason = 'stop'
				}
			} else {
				throw Error(`Unexpected local provider request: ${requestText.slice(-500)}`)
			}
			if (
				ui &&
				lastUserText.includes('Check setup only. Do not run QA or start a test.') &&
				Array.isArray(delta.tool_calls)
			)
				uiSetupToolCalls += delta.tool_calls.length
			res.writeHead(200, { 'content-type': 'text/event-stream' })
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
			)
			res.write(
				`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`
			)
			res.end('data: [DONE]\n\n')
		} catch (error) {
			providerErrors.push((error as Error).message)
			res.writeHead(500)
			res.end((error as Error).message)
		}
	})
	provider.listen(0, '127.0.0.1')
	await once(provider, 'listening')
	t.after(() => provider.close())
	const providerAddress = provider.address()
	assert(providerAddress && typeof providerAddress !== 'string')
	writeFileSync(
		join(agent, 'models.json'),
		JSON.stringify({
			providers: {
				localfixture: {
					baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
					api: 'openai-completions',
					apiKey: 'fixture',
					models: [{ id: 'fixture' }],
				},
			},
		})
	)
	const piEnv = {
		...process.env,
		HOME: piHome,
		PI_CODING_AGENT_DIR: agent,
		PI_OFFLINE: '1',
		PI_TELEMETRY: '0',
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		CHECKMATE_PI_MODEL: 'localfixture/fixture',
		QA_APP_URL: app.baseUrl,
	}
	execFileSync(realPi, ['install', installed, '--local', '--approve'], {
		cwd: piWorkspace,
		env: piEnv,
		timeout: 30000,
	})
	const okPi = async (...args: string[]) => {
		const result = await command(piWorkspace, piEnv, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await okPi('target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`)
	await okPi('plan', 'approve', 'ticket@1', '--rationale', 'Run the fixture rule.')
	const piUi = spawn(process.execPath, [binary, 'ui', '--port', '0', '--json'], { cwd: piWorkspace, env: piEnv })
	t.after(() => piUi.kill('SIGTERM'))
	const [piData] = (await once(piUi.stdout, 'data')) as [Buffer]
	const piUrl = JSON.parse(piData.toString()).url as string
	const piPage = await (await fetch(new URL('/plans/ticket', piUrl))).text()
	const piCsrf = /name="csrf" value="([^"]+)"/.exec(piPage)?.[1]
	assert(piCsrf, 'Pi UI plan page did not expose a CSRF token')
	const postChat = async (path: URL, text: string) => {
		const response = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(piUrl).origin },
			body: new URLSearchParams({
				actor: 'oracle',
				text,
				harness: 'pi',
				model: 'localfixture/fixture',
				csrf: piCsrf,
			}),
			redirect: 'manual',
		})
		assert.equal(response.status, 303, await response.text())
		return new URL(response.headers.get('location')!, piUrl)
	}
	const setupChat = await postChat(
		new URL('/plans/ticket/chats', piUrl),
		'Check setup only. Do not run QA or start a test.'
	)
	const piQuery = async (sql: string) => okPi('query', sql)
	const waitForRequestState = async (state: string) => {
		for (let attempt = 0; attempt < 100; attempt++) {
			const latest = await piQuery(
				"SELECT request_id, status FROM request_events WHERE step='state' ORDER BY rowid DESC LIMIT 1"
			)
			if (latest.rows[0]?.status === state) return latest.rows[0].request_id as string
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		const events = await piQuery('SELECT request_id, step, status, detail FROM request_events ORDER BY rowid')
		const runs = await piQuery('SELECT run_id, application_build FROM runs')
		const operations = await piQuery(
			"SELECT command, actor, arguments, status FROM operations WHERE command IN ('run begin', 'run check', 'run finish', 'delegate execute', 'request permit') ORDER BY rowid"
		)
		throw Error(
			`Pi UI chat did not reach state ${state}. Provider errors: ${providerErrors.join('; ')}; execution=${JSON.stringify({ uiExecutionStep, workerStep, requests: providerRequests.map((item) => ({ kind: item.kind, tail: JSON.stringify(item.body.messages).slice(-500) })), events: events.rows, runs: runs.rows, operations: operations.rows })}`
		)
	}
	const setupRequestId = await waitForRequestState('answered')
	assert.equal(uiSetupToolCalls, 0)
	assert.equal((await piQuery('SELECT count(*) AS n FROM runs')).rows[0].n, 0)
	assert.equal(workerStep, 0)
	assert.equal(providerRequests.filter((item) => item.kind === 'worker').length, 0)
	assert.equal((await piQuery("SELECT count(*) AS n FROM operations WHERE command='delegate execute'")).rows[0].n, 0)
	const chatId = setupChat.searchParams.get('chat')
	assert(chatId, setupChat.href)
	const executionChat = await postChat(
		new URL(`/plans/ticket/chats/${chatId}/turns`, piUrl),
		'Please execute the fixture run.'
	)
	assert.equal(executionChat.searchParams.get('chat'), chatId)
	let permission: { request_id: string; detail: string } | undefined
	for (let attempt = 0; attempt < 100; attempt++) {
		const open = await piQuery(
			"SELECT request_id, detail FROM request_events WHERE step='permission' AND status='open' ORDER BY rowid DESC LIMIT 1"
		)
		permission = open.rows[0]
		if (permission) break
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	assert(
		permission,
		`Pi did not request the UI permission. Provider errors: ${providerErrors.join('; ')}; steps=${JSON.stringify({ uiExecutionStep, workerStep, requests: providerRequests.map((item) => ({ kind: item.kind, model: item.body.model, tail: JSON.stringify(item.body.messages).slice(-800) })) })}`
	)
	const allowedPermissions = new Set<string>()
	const allowPermission = async (item: { request_id: string; detail: string }) => {
		const id = (JSON.parse(item.detail) as { id: string }).id
		const path = `/permissions/${item.request_id}/${id}`
		const page = await (await fetch(new URL(path, piUrl))).text()
		assert.match(page, /Allow once/)
		const csrf = /name="csrf" value="([^"]+)"/.exec(page)?.[1]
		assert(csrf, 'Permission page did not expose a CSRF token')
		const response = await fetch(new URL(path, piUrl), {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(piUrl).origin },
			body: new URLSearchParams({ actor: 'oracle', decision: 'allow', csrf }),
			redirect: 'manual',
		})
		assert.equal(response.status, 303, await response.text())
		allowedPermissions.add(`${item.request_id}/${id}`)
	}
	await allowPermission(permission)
	let piResult
	for (let attempt = 0; attempt < 200; attempt++) {
		const results = await piQuery("SELECT body FROM results WHERE run_id='pi-ui-run'")
		if (results.rows.length) {
			piResult = JSON.parse(results.rows[0].body)
			break
		}
		const open = await piQuery(
			"SELECT request_id, detail FROM request_events WHERE step='permission' AND status='open' ORDER BY rowid"
		)
		for (const item of open.rows as Array<{ request_id: string; detail: string }>) {
			const id = (JSON.parse(item.detail) as { id: string }).id
			if (!allowedPermissions.has(`${item.request_id}/${id}`)) await allowPermission(item)
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	const piRequestId = await waitForRequestState('answered')
	assert.notEqual(piRequestId, setupRequestId)
	assert(piResult, `Pi UI did not finish the run. Provider errors: ${providerErrors.join('; ')}`)
	assert.equal(piResult.tests[0].outcome, 'passed')
	assert.equal(piResult.tests[0].assertions[0].result, 'passed')
	assert.equal((await okPi('run', 'show', 'pi-ui-run')).build, 'fixed')
	const proof = await piQuery(
		"SELECT test_id, assertion_id, CAST(blobs.bytes AS TEXT) AS contents FROM evidence JOIN blobs USING (sha256) WHERE run_id='pi-ui-run'"
	)
	assert.equal(proof.rows.length, 1)
	assert.deepEqual([proof.rows[0].test_id, proof.rows[0].assertion_id], ['T1', 'A1'])
	assert.match(proof.rows[0].contents, /240/)
	assert.equal(workerStep, 3)
	assert.equal(uiExecutionStep, 3)
	assert.equal((await piQuery('SELECT count(*) AS n FROM runs')).rows[0].n, 1)
	const runOps = (
		await piQuery(
			"SELECT command, actor FROM operations WHERE json_extract(arguments, '$.runId')='pi-ui-run' AND command IN ('run begin', 'run check', 'run close', 'run finish') ORDER BY rowid"
		)
	).rows
	assert.deepEqual(runOps, [
		{ command: 'run begin', actor: `oracle via request ${piRequestId}` },
		{ command: 'run check', actor: 'pi:execute' },
		{ command: 'run close', actor: 'pi:execute' },
		{ command: 'run finish', actor: 'pi:execute' },
	])
	assert.equal((await piQuery("SELECT count(*) AS n FROM operations WHERE command='request permit'")).rows[0].n, 2)
	assert.deepEqual((await piQuery("SELECT DISTINCT actor FROM operations WHERE command='request permit'")).rows, [
		{ actor: 'oracle' },
	])
	assert.deepEqual(
		(await piQuery("SELECT arguments FROM operations WHERE command='request permit' ORDER BY rowid")).rows.map(
			(row: { arguments: string }) => JSON.parse(row.arguments).decision
		),
		['allow', 'allow']
	)
	assert.equal(
		(
			await piQuery(
				"SELECT actor FROM operations WHERE command='run finish' AND json_extract(arguments, '$.runId')='pi-ui-run'"
			)
		).rows[0].actor,
		'pi:execute'
	)
	assert.match(JSON.stringify(piResult), /240/)
	assert.ok(providerRequests.every((item) => item.body.model === 'fixture'))
	assert.equal(providerRequests.filter((item) => item.ui).length, 4)
	assert.equal(providerRequests.filter((item) => item.kind === 'worker').length, 3)
	assert.deepEqual(providerErrors, [])
	piUi.kill('SIGTERM')
	await once(piUi, 'close')
})

test('Execute a request through Pi RPC — a begun run must reach its worker.', { timeout: 60000 }, async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	const realPi = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()
	writeFileSync(
		join(bin, 'pi'),
		`#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const input = readFileSync(0, 'utf8')
if (!input.includes('pi-run')) throw Error('Wrong run')
const run = (args, input) => execFileSync(process.execPath, [process.env.QA_CLI, ...args], {input, encoding:'utf8'})
fetch(process.env.QA_APP_URL + '/quote?promotion=true&loyalty=true').then(r => r.json()).then(quote => {
  if (quote.totalPLN !== 240) throw Error('Wrong build')
  run(['run','check','pi-run','T1','A1','--observed','240','--evidence','-'], JSON.stringify(quote))
  run(['run','close','pi-run','T1'])
  run(['run','finish','pi-run','--completion','completed','--cleanup','completed','--cleanup-reason','No test data.'])
  const result = JSON.stringify({status:'completed',subject:'pi-run',reasons:[]})
  console.log(JSON.stringify({type:'agent_end',messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:result}]}]}))
}).catch(e => { console.error(e); process.exitCode = 1 })
`,
		{ mode: 0o755 }
	)
	const { delimiter } = await import('node:path')
	const home = directory(t)
	const agent = join(home, 'agent')
	mkdirSync(agent)
	const env = {
		...process.env,
		HOME: home,
		PI_CODING_AGENT_DIR: agent,
		PI_OFFLINE: '1',
		PI_TELEMETRY: '0',
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'pi',
		QA_APP_URL: app.baseUrl,
		QA_CLI: binary,
	}
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok('target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`)
	await ok('plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.')
	const shell = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
	const cli = `${shell(process.execPath)} ${shell(binary)}`
	const operation = `${cli} run begin pi-run ticket@1 --build fixed --instance local --tests T1 && ${cli} delegate execute pi-run`
	let calls = 0
	let sawGuidance = false
	const provider = createServer(async (req, res) => {
		let data = ''
		for await (const part of req) data += part
		const request = JSON.parse(data)
		calls++
		if (calls === 1)
			sawGuidance =
				data.includes('execute the fixture run') &&
				data.includes('When the person asks you to run or retest stored tests')
		const delta =
			calls === 1
				? {
						tool_calls: [
							{
								index: 0,
								id: 'call_fixture',
								type: 'function',
								function: { name: 'bash', arguments: JSON.stringify({ command: operation }) },
							},
						],
					}
				: { content: 'The run finished.' }
		res.writeHead(200, { 'content-type': 'text/event-stream' })
		res.write(
			`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
		)
		res.write(
			`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\n`
		)
		res.end('data: [DONE]\n\n')
		void request
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
	execFileSync(realPi, ['install', join(project, 'node_modules/@xoxoai/checkmate'), '--local', '--approve'], {
		cwd: workspace,
		env,
		timeout: 30000,
	})
	const child = spawn(
		realPi,
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
	child.stdin.write(
		JSON.stringify({ id: 'prompt', type: 'prompt', message: '/checkmate please execute the fixture run' }) + '\n'
	)
	const deadline = Date.now() + 30000
	while (!events.some((event) => event.type === 'agent_end') && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 50))
	assert(
		events.some((event) => event.type === 'agent_end'),
		'Pi did not finish'
	)
	assert(sawGuidance, 'Pi did not receive the workflow skill')
	assert(calls >= 2, 'Pi did not return the tool result to the provider')
	const results = await ok('query', "SELECT body FROM results WHERE run_id='pi-run'")
	assert.equal(JSON.parse(results.rows[0].body).tests[0].outcome, 'passed')
	assert.equal((await ok('run', 'show', 'pi-run')).build, 'fixed')
	assert.deepEqual(
		(await ok('query', "SELECT actor FROM operations WHERE command='run check' AND status='completed'")).rows,
		[{ actor: 'pi:execute' }]
	)
	assert.equal((await ok('query', 'SELECT count(*) AS n FROM runs')).rows[0].n, 1)
	child.stdin.end()
	await once(child, 'exit')
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
	await ok([
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.',
	])
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
				assertions: [
					{
						id: 'A1',
						check: 'Service responds.',
						checkKind: 'deterministic',
						observe: 'the HTTP status of the service',
						expected: '200',
					},
				],
			},
			{
				...common,
				id: 'T2',
				title: 'Quote',
				dependsOn: ['T1'],
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
			},
			{
				...common,
				id: 'T3',
				title: 'Unrelated',
				dependsOn: [],
				assertions: [{ id: 'A1', check: 'The quote is positive.', checkKind: 'agent_observation' }],
			},
		],
		gaps: [],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rules.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'broken', '--tests', 'T1,T2'])
	const quote = await (await fetch(`${app.baseUrl}/quote?promotion=true&loyalty=true`)).json()
	assert.equal(quote.totalPLN, 220)
	await ok(['run', 'check', 'run-1', 'T1', 'A1', '--observed', '200', '--evidence', '-'], quote)
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
		// T1 checks the HTTP status of the service, T2 the quote total.
		const observed = id === 'T1' ? '200' : '240'
		await ok(['run', 'check', 'run-2', id, 'A1', '--observed', observed, '--evidence', '-'], fixed)
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
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
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
			['run', 'check', run, 'T1', 'A1', '--observed', String(expected), '--evidence', '-'],
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
	assert.match(
		execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }),
		new RegExp(`^${manifest.version} build [0-9a-f]{12}\n`)
	)
	assert(existsSync(join(plugin, 'pi/permission.mjs')))
	const ui = spawn(process.execPath, [entry, 'ui', '--port', '0'], { cwd: directory(t), env: process.env })
	try {
		const [data] = (await once(ui.stdout, 'data')) as [Buffer]
		const url = /^completed ui url=(\S+)$/m.exec(data.toString())?.[1]
		assert(url, data.toString())
		assert.equal((await fetch(new URL('/assets/style.css', url))).status, 200)
	} finally {
		ui.kill('SIGTERM')
		await once(ui, 'close')
	}
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
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
  if (!process.env.QA_FINISH) execFileSync(process.execPath, [plugin + '/dist/checkmate.js', 'run', 'check', 'run-1', 'T1', 'A1', '--observed', '240', '--evidence', '-'], { input: JSON.stringify(quote), stdio: ['pipe', 'pipe', 'inherit'] })
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
	const missing = await invoke(entry, workspace, { ...env, PATH: '' }, '', [
		'delegate',
		'execute',
		'run-1',
		'--allow',
		'Read',
	])
	assert.equal(missing.code, 1, missing.output)
	assert.match(missing.output, /Cannot start worker: ENOENT/)
	assert.equal((await ok('query', 'SELECT count(*) AS n FROM runs')).rows[0].n, 1)
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

test('Export a partial run with blocked tests as skipped — green CI hides the open gap.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240. The promotion replaces loyalty.\n')
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (args: string[], value?: object) => {
		const result = await inputCommand(workspace, env, value ? JSON.stringify(value) : '', ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
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
	await ok(['target', 'save', 'shop'], {
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
		reset: { owner: 'environment', command: null, policy: { text: 'The test fixture keeps no records.' } },
		approvals: { plan: 'none', result: 'none' },
	})
	await ok(['target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`])
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
	const test = (id: string, title: string) => ({
		id,
		title,
		requirementIds: ['R1'],
		capability: 'http',
		operations: ['read_catalog'],
		dependsOn: [],
		preconditions: [],
		action: 'Read the quote.',
		assertions: [
			{
				id: 'A1',
				check: 'The quote is 240.',
				checkKind: 'deterministic',
				observe: 'the value stated by the check',
				expected: '240',
			},
		],
	})
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [test('T1', 'Quote'), { ...test('T2', 'Promotion with loyalty'), assertions: [] }],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: [],
				testIds: ['T2'],
				question: 'Does the promotion replace loyalty?',
				consequence: 'The expected total of T2 is unknown.',
				decisionId: null,
			},
		],
	})
	await ok(['plan', 'open', 'held', '--target', 'shop@1', '--objective', 'Check the quote.', '--source', 'ticket.md'])
	await ok(['plan', 'save', 'held'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [test('T1', 'Promotion with loyalty')],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: [],
				testIds: ['T1'],
				question: 'Does the promotion replace loyalty?',
				consequence: 'The expected total of T1 is unknown.',
				decisionId: null,
			},
		],
	})
	const waiting = await command(workspace, env, 'status', 'ticket')
	assert.equal(waiting.code, 0, waiting.output)
	const withGap = await command(workspace, env, 'status', 'ticket', '--fail-on-blocked')
	assert.equal(withGap.code, 3, withGap.output)
	assert.equal(withGap.body.waitsOn, 'qa')
	const blocked = await command(workspace, env, 'status', 'held', '--fail-on-blocked')
	assert.equal(blocked.code, 3, blocked.output)
	assert.equal(blocked.body.waitsOn, 'oracle')
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local', '--partial', 'ready_only'])
	const check = await inputCommand(
		workspace,
		env,
		'HTTP 200: 240',
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--observed',
		'240',
		'--evidence',
		'-'
	)
	assert.equal(check.code, 0, check.output)
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
	await ok(['export', 'run', 'run-1', '--format', 'junit', '--out', 'partial.xml'])
	const junit = readFileSync(join(workspace, 'partial.xml'), 'utf8')
	assert.match(junit, /<testsuites name="run-1" tests="2" failures="0" errors="0" skipped="1"/)
	assert.match(
		junit,
		/<testcase classname="ticket" name="T2"[^>]*>\s*<properties>[\s\S]*?<skipped message="blocked by open gap G1: Does the promotion replace loyalty\?"/
	)
	assert.match(junit, /name="coverage" value="partial"/)
})

test('Report a different checkmate build on PATH — the session runs a stale plugin without a warning.', async (t) => {
	const workspace = directory(t)
	const { chmodSync, copyFileSync, mkdirSync, appendFileSync } = await import('node:fs')
	const { delimiter } = await import('node:path')
	const other = join(workspace, 'other')
	mkdirSync(other)
	const copy = join(other, 'checkmate.js')
	copyFileSync(join(root, 'plugin/dist/checkmate.js'), copy)
	appendFileSync(copy, '\n// a different build\n')
	chmodSync(copy, 0o755)
	const { symlinkSync } = await import('node:fs')
	symlinkSync(copy, join(other, 'checkmate'))
	const result = spawnSync(process.execPath, [join(root, 'plugin/dist/checkmate.js'), '--version'], {
		cwd: workspace,
		env: { ...process.env, PATH: `${other}${delimiter}${process.env.PATH}` },
		encoding: 'utf8',
	})
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /^0\.7\.2 build [0-9a-f]{12}$/m)
	assert.match(result.stdout, /^warning: the checkmate on PATH is build [0-9a-f]{12} at .*checkmate\.js/m)
})

test('Refuse a run that can change data without a reset, then run the recorded reset before it begins — testers start from clean data.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'An order can be created.\n')
	writeFileSync(
		join(workspace, 'reset.mjs'),
		"import { writeFileSync } from 'node:fs'\nwriteFileSync('reset-ran.txt', 'yes')\n"
	)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
	await ok('setup', '--url', app.baseUrl, '--target', 'shop', '--instance', 'local')
	await ok('plan', 'open', 'ticket', '--target', 'shop@1', '--objective', 'Create an order.', '--source', 'ticket.md')
	const saved = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'An order can be created.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Create an order',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['create_fixture_order'],
					dependsOn: [],
					preconditions: [],
					action: 'Create an order.',
					assertions: [
						{
							id: 'A1',
							check: 'The order is created.',
							checkKind: 'deterministic',
							observe: 'the order status in the create response',
							expected: 'created',
						},
					],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(saved.code, 0, saved.output)
	const refused = await command(
		workspace,
		env,
		'run',
		'begin',
		'run-1',
		'ticket@1',
		'--build',
		'b1',
		'--instance',
		'local'
	)
	assert.equal(refused.code, 1, refused.output)
	assert.match(refused.output, /can change data \(create_fixture_order\), and target shop has no data policy/)
	assert.match(refused.output, /--reset \\?"<command>/)
	await ok('setup', '--url', app.baseUrl, '--target', 'shop', '--instance', 'local', '--reset', 'node reset.mjs')
	await ok('run', 'gate', 'ticket@1', '--build', 'b1')
	assert.equal(existsSync(join(workspace, 'reset-ran.txt')), false)
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local')
	assert.equal(readFileSync(join(workspace, 'reset-ran.txt'), 'utf8'), 'yes')
})

test('Record each test with its own worker — a silent worker is retried once, then its test is closed as error and dependent tests are blocked.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240.\n')
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
	const test = (id: string, dependsOn: string[] = []) => ({
		capability: 'http',
		operations: ['read_catalog'],
		dependsOn,
		preconditions: [],
		id,
		title: `Quote ${id}`,
		requirementIds: ['R1'],
		action: 'Read the quote.',
		assertions: [
			{
				id: 'A1',
				check: 'The quote is 240.',
				checkKind: 'deterministic',
				observe: 'the value stated by the check',
				expected: '240',
			},
		],
	})
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [test('T1'), test('T2'), test('T3'), test('T4', ['T3'])],
		gaps: [],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--partial', 'ready_only'])
	const bin = directory(t)
	copyFileSync(join(root, 'test/e2e/per-test-host.mjs'), join(bin, 'pi'))
	chmodSync(join(bin, 'pi'), 0o755)
	const log = join(directory(t), 'prompts.log')
	const piEnv = {
		...env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_HARNESS: 'pi',
		FAKE_PI_LOG: log,
		FAKE_CHECKMATE_CLI: binary,
		FAKE_RUN: 'run-1',
	}
	const delegated = await inputCommand(workspace, piEnv, '', 'delegate', 'execute', 'run-1')
	assert.equal(delegated.body.status, 'operational_error', delegated.output)
	const gated = await inputCommand(workspace, env, '', 'run', 'show', 'run-1', '--gate')
	assert.equal(gated.code, 2, gated.output)
	assert.equal(gated.body.gate.state, 'could_not_test')
	assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['T1', 'T2', 'T2', 'T3', 'T3', 'PROBE'])
	const probed = await ok([
		'query',
		"SELECT count(*) AS n FROM findings WHERE run_id = 'run-1' AND body LIKE '%\"potential_issue\"%'",
	])
	assert.equal(probed.rows[0].n, 1)
	const outcomes = await ok([
		'query',
		"SELECT test_id, outcome FROM outcomes WHERE run_id = 'run-1' ORDER BY test_id",
	])
	assert.deepEqual(outcomes.rows, [
		{ test_id: 'T1', outcome: 'passed' },
		{ test_id: 'T2', outcome: 'passed' },
		{ test_id: 'T3', outcome: 'error' },
		{ test_id: 'T4', outcome: 'blocked' },
	])
})

test('Refuse a run on a plan that holds a compound assertion — a stored check with two values passed against one page.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240.\n')
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
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [
			{
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				id: 'T1',
				title: 'Quote',
				requirementIds: ['R1'],
				action: 'Read the quote.',
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
			},
		],
		gaps: [],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	const database = new DatabaseSync(join(workspace, '.checkmate', 'checkmate.db'))
	for (const trigger of database
		.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'plan_revisions'")
		.all() as Array<{ name: string }>)
		database.exec(`DROP TRIGGER ${trigger.name}`)
	const body = (
		database.prepare("SELECT body FROM plan_revisions WHERE plan_id = 'ticket' AND revision = 1").get() as {
			body: string
		}
	).body
	database
		.prepare("UPDATE plan_revisions SET body = ? WHERE plan_id = 'ticket' AND revision = 1")
		.run(body.replaceAll('"check":"The quote is 240."', '"check":"The quote is 240 and the refund is 30 days."'))
	database.close()
	const gated = await inputCommand(workspace, env, '', 'run', 'gate', 'ticket@1', '--build', 'b1')
	assert.equal(gated.body.status, 'needs_decision', gated.output)
	assert.match(gated.output, /checks more than one value/)
	assert.match(gated.output, /delegate revise ticket/)
})

test('Report a second Checkmate package that Pi declares — a stale copy loads beside this build without a warning.', async (t) => {
	const workspace = directory(t)
	const agent = directory(t)
	mkdirSync(join(workspace, '.pi'))
	writeFileSync(
		join(workspace, '.pi', 'settings.json'),
		JSON.stringify({ packages: ['git:github.com/dawiddiwad/checkmate@wip/refactor-team-blue'] })
	)
	const env = { ...process.env, PI_CODING_AGENT_DIR: agent }
	const version = spawnSync(process.execPath, [binary, '--version'], { cwd: workspace, env, encoding: 'utf8' })
	assert.equal(version.status, 0, version.stderr)
	assert.match(
		version.stdout + version.stderr,
		/warning: Pi declares another Checkmate package at project scope: git:github\.com\/dawiddiwad\/checkmate@wip\/refactor-team-blue\. .*pi remove git:github\.com\/dawiddiwad\/checkmate@wip\/refactor-team-blue -l/
	)
})

test('Decide a structured assertion by comparing the observed value with the expected value — a child never records passed for a value it did not see.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The kettle price is 240 PLN.\n')
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
		'Check the price.',
		'--source',
		'ticket.md',
	])
	const structured = (id: string, observe: string, expected: string) => ({
		id,
		check: `The kettle price shown is ${expected}.`,
		checkKind: 'deterministic',
		observe,
		expected,
	})
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The kettle price is 240 PLN.', source: 'ticket.md' }],
		tests: [
			{
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				id: 'T1',
				title: 'Price',
				requirementIds: ['R1'],
				action: 'Read the price.',
				assertions: [
					structured('A1', 'the price value labelled Price', '240 PLN'),
					structured('A2', 'the unit price in the quote', '240 PLN'),
				],
			},
		],
		gaps: [],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--partial', 'ready_only'])
	const refused = await inputCommand(
		workspace,
		env,
		'Price: 240 PLN',
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--result',
		'passed',
		'--observed',
		'240 PLN',
		'--evidence',
		'-'
	)
	assert.equal(refused.code, 1, refused.output)
	assert.match(refused.output, /takes its result from --observed/)
	const shown = await inputCommand(
		workspace,
		env,
		'Price: 300 PLN',
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--observed',
		'300 PLN',
		'--evidence',
		'-'
	)
	assert.equal(shown.code, 0, shown.output)
	const quoted = await inputCommand(
		workspace,
		env,
		'unitPrice: 240 PLN',
		'run',
		'check',
		'run-1',
		'T1',
		'A2',
		'--observed',
		'240 PLN',
		'--evidence',
		'-'
	)
	assert.equal(quoted.code, 0, quoted.output)
	const results = await ok([
		'query',
		"SELECT assertion_id, result FROM assertion_results WHERE run_id = 'run-1' ORDER BY assertion_id",
	])
	assert.deepEqual(results.rows, [
		{ assertion_id: 'A1', result: 'failed' },
		{ assertion_id: 'A2', result: 'passed' },
	])
})

test('Resume a run with a test that may have changed data — a recorded reset runs again, an external reset asks the oracle.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'An order can be created.\n')
	writeFileSync(
		join(workspace, 'reset.mjs'),
		"import { writeFileSync } from 'node:fs'\nwriteFileSync('reset-ran.txt', 'yes')\n"
	)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
	await ok('setup', '--url', app.baseUrl, '--target', 'shop', '--instance', 'local', '--reset', 'node reset.mjs')
	await ok('plan', 'open', 'ticket', '--target', 'shop@1', '--objective', 'Create an order.', '--source', 'ticket.md')
	const saved = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'An order can be created.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Create an order',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['create_fixture_order'],
					dependsOn: [],
					preconditions: [],
					action: 'Create an order.',
					assertions: [
						{
							id: 'A1',
							check: 'The order is created.',
							checkKind: 'deterministic',
							observe: 'the order status in the create response',
							expected: 'created',
						},
					],
				},
				{
					id: 'T2',
					title: 'Read the catalog',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the catalog.',
					assertions: [
						{
							id: 'A1',
							check: 'The catalog is listed.',
							checkKind: 'deterministic',
							observe: 'the catalog list in the response',
							expected: 'listed',
						},
					],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(saved.code, 0, saved.output)
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local')
	rmSync(join(workspace, 'reset-ran.txt'), { force: true })
	const resumed = await ok('run', 'resume', 'run-1')
	assert.equal(resumed.status, 'completed')
	assert.equal(readFileSync(join(workspace, 'reset-ran.txt'), 'utf8'), 'yes')
	const byTest = Object.fromEntries(resumed.tests.map((item: { testId: string }) => [item.testId, item]))
	assert.equal(byTest.T1.reset, 'ran before this attempt')
	assert.equal(byTest.T2.reset, undefined)
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--instance',
		'local',
		'--data',
		'environment',
		'--policy',
		'The test fixture keeps no records.'
	)
	await ok('run', 'begin', 'run-2', 'ticket@1', '--build', 'b2', '--instance', 'local')
	const asked = await ok('run', 'resume', 'run-2')
	assert.equal(asked.status, 'needs_decision')
	assert.match(asked.reasons[0], /T1/)
	assert.match(asked.hint, /run resume run-2 --error T1/)
})

test('Finish a run whose deadline is used up as interrupted with cause deadline — tests closed on the deadline are not refused as completed.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240.\n')
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
	await ok(['plan', 'save', 'ticket'], {
		requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
		tests: [
			{
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				id: 'T1',
				title: 'Quote',
				requirementIds: ['R1'],
				action: 'Read the quote.',
				assertions: [
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
			},
		],
		gaps: [],
	})
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--partial', 'ready_only', '--timeout', '1'])
	await new Promise((resolve) => setTimeout(resolve, 2500))
	const delegated = await inputCommand(
		workspace,
		{ ...env, CHECKMATE_HARNESS: 'pi' },
		'',
		'delegate',
		'execute',
		'run-1'
	)
	assert.equal(delegated.body.status, 'interrupted', delegated.output)
	const outcomes = await ok(['query', "SELECT test_id, outcome FROM outcomes WHERE run_id = 'run-1'"])
	assert.deepEqual(outcomes.rows, [{ test_id: 'T1', outcome: 'not_run' }])
})

test('Show a legacy plan — status and plan show name checks saved without an expected value and the revise command.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-39d33f7.db.gz')))
	)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const shown = await command(workspace, env, 'plan', 'show', 'ticket')
	assert.equal(shown.code, 0, shown.output)
	assert.deepEqual(shown.body.legacyChecks, ['T1.A1'])
	const status = await command(workspace, env, 'status', 'ticket')
	assert.equal(status.code, 0, status.output)
	assert.deepEqual(status.body.legacyChecks, ['T1.A1'])
})

test('Refuse a run on a legacy check, then migrate it by revise without a decision — the check gets its expected value, no worker decides it.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-39d33f7.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok('target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`)
	await ok('plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.')
	const refused = await command(
		workspace,
		env,
		'run',
		'begin',
		'run-1',
		'ticket@1',
		'--build',
		'fixed',
		'--instance',
		'local',
		'--tests',
		'T1'
	)
	assert.equal(refused.body.status, 'needs_decision', refused.output)
	assert.match(refused.body.reasons.join(' '), /T1\.A1 is a deterministic check without an expected value/)
	assert.match(refused.body.hint, /checkmate delegate revise ticket/)
	const migrated = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			tests: {
				T1: {
					assertions: [
						{
							check: 'The quote is 240.',
							checkKind: 'deterministic',
							observe: 'the value stated by the check',
							expected: '240',
						},
					],
				},
			},
		}),
		'plan',
		'revise',
		'ticket'
	)
	assert.equal(migrated.code, 0, migrated.output)
	assert.equal(migrated.body.reason, 'migrate checks to the current shape')
	await ok('plan', 'approve', 'ticket@2', '--rationale', 'Run the migrated rule.')
	await ok('run', 'begin', 'run-1', 'ticket@2', '--build', 'fixed', '--instance', 'local', '--tests', 'T1')
})

test('Save a deterministic check only with an expected value — the kind decides, not a digit; an agent observation names no value and the gate counts its verdict.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'The quote is 240 and the order has one item.\n')
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
		'Check the quote.',
		'--source',
		'ticket.md',
	])
	const plan = (assertions: object[][]) => ({
		requirements: [{ id: 'R1', text: 'The quote is 240 and the order has one item.', source: 'ticket.md' }],
		tests: [
			{
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				id: 'T1',
				title: 'Quote',
				requirementIds: ['R1'],
				action: 'Read the quote.',
				assertions: assertions[0],
			},
			{
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				id: 'T2',
				title: 'Order',
				requirementIds: ['R1'],
				action: 'Read the order.',
				assertions: assertions[1],
			},
		],
		gaps: [],
	})
	const refused = await inputCommand(
		workspace,
		env,
		JSON.stringify(
			plan([
				[
					{
						id: 'A1',
						check: 'The quote is 240.',
						checkKind: 'deterministic',
						observe: 'the quote total',
						expected: '240',
					},
				],
				[{ id: 'A1', check: 'The order has one item.', checkKind: 'deterministic' }],
			])
		),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(refused.code, 1, refused.output)
	assert.match(
		refused.body.reasons.join(' '),
		/T2\.A1 is a deterministic check without an observed item and an expected value/
	)
	assert.match(refused.body.hint, /agent_observation/)
	await ok(
		['plan', 'save', 'ticket'],
		plan([
			[
				{
					id: 'A1',
					check: 'The quote is 240.',
					checkKind: 'deterministic',
					observe: 'the quote total',
					expected: '240',
				},
			],
			[{ id: 'A1', check: 'The order has one item.', checkKind: 'agent_observation' }],
		])
	)
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'fixed', '--partial', 'ready_only'])
	await ok(['run', 'check', 'run-1', 'T1', 'A1', '--observed', '240', '--evidence', '-'], { totalPLN: 240 })
	await ok(['run', 'close', 'run-1', 'T1'])
	await ok(['run', 'check', 'run-1', 'T2', 'A1', '--result', 'passed', '--observed', 'one item', '--evidence', '-'], {
		lines: 1,
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
	const gated = await command(workspace, env, 'run', 'show', 'run-1', '--gate')
	assert.equal(gated.code, 0, gated.output)
	assert.equal(gated.body.gate.state, 'passed')
	assert.equal(gated.body.gate.judgedByAgent, 1)
})

test('Gate a run with a deterministic check that code did not verify — the run is not green and names the checks and the revise command.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok('target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`)
	await ok('plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.')
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'fixed', '--instance', 'local', '--tests', 'T1')
	await inputCommand(
		workspace,
		env,
		'{"totalPLN":240}',
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--observed',
		'240',
		'--evidence',
		'-'
	)
	await ok('run', 'close', 'run-1', 'T1')
	await ok(
		'run',
		'finish',
		'run-1',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'No test data.'
	)
	const database = new DatabaseSync(join(workspace, '.checkmate', 'checkmate.db'))
	for (const trigger of database
		.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'plan_revisions'")
		.all() as Array<{ name: string }>)
		database.exec(`DROP TRIGGER ${trigger.name}`)
	const body = (
		database.prepare("SELECT body FROM plan_revisions WHERE plan_id = 'ticket' AND revision = 1").get() as {
			body: string
		}
	).body
	database
		.prepare("UPDATE plan_revisions SET body = ? WHERE plan_id = 'ticket' AND revision = 1")
		.run(body.replaceAll(',"expected":"240"', '').replaceAll(',"observe":"the value stated by the check"', ''))
	database.close()
	const gated = await command(workspace, env, 'run', 'show', 'run-1', '--gate')
	assert.equal(gated.code, 2, gated.output)
	assert.equal(gated.body.gate.state, 'unverified_checks')
	assert.deepEqual(gated.body.gate.unverified, ['T1.A1'])
})

test('Revise a check that needs a decision to split — the test is blocked by a gap and keeps no check; no oracle decision is needed for the rest.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-39d33f7.db.gz')))
	)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const revised = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			tests: { T1: { assertions: [] } },
			gaps: {
				'G-T1': {
					question: 'Which price does the quote show for the promotion?',
					consequence: 'T1 stays untested until the oracle answers.',
					testIds: ['T1'],
				},
			},
		}),
		'plan',
		'revise',
		'ticket'
	)
	assert.equal(revised.code, 0, revised.output)
	assert.equal(revised.body.reason, 'migrate checks to the current shape')
	const shown = await command(workspace, env, 'plan', 'show', 'ticket@2')
	assert.equal(shown.code, 0, shown.output)
	assert.deepEqual(shown.body.legacyChecks, [])
	const gaps = shown.body.plan.gaps
	assert.deepEqual(
		gaps.map((gap: { id: string; status: string }) => [gap.id, gap.status]),
		[['G-T1', 'open']]
	)
})

test('Set a data kind with a policy — setup refuses a kind without one, and run show prints the kind and the policy.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'An order can be created.\n')
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
	const missing = await command(
		workspace,
		env,
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation'
	)
	assert.equal(missing.code, 1, missing.output)
	assert.match(missing.output, /needs a data policy/)
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation',
		'--policy',
		'Use the test users only.'
	)
	const profile = await ok('target', 'show', 'shop')
	assert.equal(profile.profile.reset.owner, 'isolation')
	assert.deepEqual(profile.profile.reset.policy, { text: 'Use the test users only.' })
	await ok('plan', 'open', 'ticket', '--target', 'shop@1', '--objective', 'Create an order.', '--source', 'ticket.md')
	const saved = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'An order can be created.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Read the catalog',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the catalog.',
					assertions: [{ id: 'A1', check: 'The catalog is listed.', checkKind: 'agent_observation' }],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(saved.code, 0, saved.output)
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local')
	const shown = await command(workspace, env, 'run', 'show', 'run-1')
	assert.equal(shown.body.data.policy, 'Use the test users only.')
	assert.match(shown.body.data.kind, /^isolation/)
})

test('Run a prepare command before a run — its facts reach the run, and a failed prepare stops the run with its reason.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'An order can be created.\n')
	writeFileSync(
		join(workspace, 'prepare.mjs'),
		"import { writeFileSync } from 'node:fs'\nwriteFileSync('prepared-marker.txt', process.env.CHECKMATE_MARKER)\nconsole.log(`test user qa-user-${process.env.CHECKMATE_MARKER}`)\n"
	)
	writeFileSync(join(workspace, 'fail.mjs'), 'process.exit(3)\n')
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation',
		'--policy',
		'Use the test users only.',
		'--reset',
		'node prepare.mjs'
	)
	await ok('plan', 'open', 'ticket', '--target', 'shop@1', '--objective', 'Create an order.', '--source', 'ticket.md')
	const saved = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'An order can be created.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Read the catalog',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the catalog.',
					assertions: [{ id: 'A1', check: 'The catalog is listed.', checkKind: 'agent_observation' }],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(saved.code, 0, saved.output)
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local')
	assert.match(readFileSync(join(workspace, 'prepared-marker.txt'), 'utf8'), /^qa-[a-z0-9]+-run-1$/)
	const detail = await ok('run', 'show', 'run-1')
	assert.match(detail.request.facts, /test user qa-user-qa-[a-z0-9]+-run-1/)
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation',
		'--policy',
		'Use the test users only.',
		'--reset',
		'node fail.mjs'
	)
	const failed = await command(
		workspace,
		env,
		'run',
		'begin',
		'run-2',
		'ticket@1',
		'--build',
		'b2',
		'--instance',
		'local'
	)
	assert.equal(failed.code, 1, failed.output)
	assert.match(failed.output, /prepare command node fail\.mjs exited with code 3/)
	assert.match(failed.output, /Checkmate started no test/)
	const absent = await command(workspace, env, 'run', 'show', 'run-2')
	assert.equal(absent.code, 1, absent.output)
})

test('Run a cleanup command when a run finishes — a failed cleanup is reported and the verdict stays.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'An order can be created.\n')
	writeFileSync(
		join(workspace, 'cleanup.mjs'),
		"import { writeFileSync } from 'node:fs'\nwriteFileSync('cleaned.txt', process.env.CHECKMATE_MARKER)\n"
	)
	writeFileSync(join(workspace, 'cleanup-fail.mjs'), 'process.exit(4)\n')
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation',
		'--policy',
		'Use the test users only.',
		'--cleanup',
		'node cleanup.mjs'
	)
	await ok(
		'plan',
		'open',
		'ticket',
		'--target',
		'shop@1',
		'--objective',
		'Read the catalog.',
		'--source',
		'ticket.md'
	)
	const saved = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'The catalog is listed.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Read the catalog',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the catalog.',
					assertions: [{ id: 'A1', check: 'The catalog is listed.', checkKind: 'agent_observation' }],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(saved.code, 0, saved.output)
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local')
	const check = await inputCommand(
		workspace,
		env,
		'HTTP 200',
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--result',
		'passed',
		'--observed',
		'listed',
		'--evidence',
		'-'
	)
	assert.equal(check.code, 0, check.output)
	await ok('run', 'close', 'run-1', 'T1')
	const finished = await ok(
		'run',
		'finish',
		'run-1',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'The run kept no work folder.'
	)
	assert.equal(finished.status, 'completed')
	assert.match(readFileSync(join(workspace, 'cleaned.txt'), 'utf8'), /^qa-[a-z0-9]+-run-1$/)
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation',
		'--policy',
		'Use the test users only.',
		'--cleanup',
		'node cleanup-fail.mjs'
	)
	await ok(
		'plan',
		'open',
		'ticket2',
		'--target',
		'shop@2',
		'--objective',
		'Read the catalog.',
		'--source',
		'ticket.md'
	)
	const saved2 = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'The catalog is listed.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Read the catalog',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the catalog.',
					assertions: [{ id: 'A1', check: 'The catalog is listed.', checkKind: 'agent_observation' }],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket2'
	)
	assert.equal(saved2.code, 0, saved2.output)
	await ok('run', 'begin', 'run-2', 'ticket2@1', '--build', 'b2', '--instance', 'local')
	const check2 = await inputCommand(
		workspace,
		env,
		'HTTP 200',
		'run',
		'check',
		'run-2',
		'T1',
		'A1',
		'--result',
		'passed',
		'--observed',
		'listed',
		'--evidence',
		'-'
	)
	assert.equal(check2.code, 0, check2.output)
	await ok('run', 'close', 'run-2', 'T1')
	const finished2 = await ok(
		'run',
		'finish',
		'run-2',
		'--completion',
		'completed',
		'--cleanup',
		'completed',
		'--cleanup-reason',
		'The run kept no work folder.'
	)
	assert.equal(finished2.status, 'completed')
	assert.match(JSON.stringify(finished2), /cleanupFailures/)
	const verdict = await ok('run', 'show', 'run-2')
	assert.equal(verdict.tests.find((item: { testId: string }) => item.testId === 'T1').outcome, 'passed')
})

test('Close a test as error after a check on a value it did not observe — the check reads not_checked and its defect is no verdict.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (args: string[], value?: object) => {
		const result = await inputCommand(workspace, env, value ? JSON.stringify(value) : '', ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok(['target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`])
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	await ok(['run', 'begin', 'run-1', 'ticket@1', '--build', 'fixed', '--instance', 'local', '--tests', 'T1'])
	const checked = await inputCommand(
		workspace,
		env,
		'HTTP 404 Not Found: page text not found.',
		'run',
		'check',
		'run-1',
		'T1',
		'A1',
		'--observed',
		'not found',
		'--evidence',
		'-'
	)
	assert.equal(checked.code, 0, checked.output)
	await ok(['run', 'finding', 'run-1'], {
		id: 'F-T1-1',
		type: 'defect',
		severity: 'medium',
		assertionIds: ['T1.A1'],
		requirementIds: ['R1'],
		title: 'Quote not shown',
		expected: '240',
		observed: 'not found',
		reproduction: ['Open the product page.'],
		evidenceIds: checked.body.evidenceIds,
	})
	const closed = await inputCommand(
		workspace,
		env,
		'HTTP 404 Not Found: page text not found.',
		'run',
		'close',
		'run-1',
		'T1',
		'--outcome',
		'error',
		'--reason',
		'Product page returned HTTP 404.',
		'--evidence',
		'-'
	)
	assert.equal(closed.code, 0, closed.output)
	const shown = await command(workspace, env, 'run', 'show', 'run-1')
	assert.equal(shown.code, 0, shown.output)
	assert.equal(shown.body.tests[0].outcome, 'error')
	assert.equal(shown.body.tests[0].assertions[0].result, 'not_checked')
	assert.deepEqual(shown.body.findings, [])
	const gated = await command(workspace, env, 'run', 'show', 'run-1', '--gate')
	assert.equal(gated.code, 2, gated.output)
	assert.equal(gated.body.gate.state, 'could_not_test')
})

test('Begin a run on an instance that is not added — the refusal names the add command and says the person gives the data kind.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	await command(workspace, env, 'plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.')
	const refused = await command(
		workspace,
		env,
		'run',
		'begin',
		'run-1',
		'ticket@1',
		'--build',
		'b1',
		'--instance',
		'local'
	)
	assert.equal(refused.code, 1, refused.output)
	assert.match(refused.body.reasons.join(' '), /Unknown instance: shop\/local/)
	assert.match(refused.body.hint, /checkmate target instance add shop local --entry web=/)
	assert.match(refused.body.hint, /ask the person for it/)
})

test('Execute a run with a short deadline — the worker runs its test; no test is closed as deadline before the deadline is used.', async (t) => {
	const workspace = directory(t)
	mkdirSync(join(workspace, '.checkmate'))
	writeFileSync(
		join(workspace, '.checkmate/checkmate.db'),
		gunzipSync(readFileSync(join(root, 'test/e2e/fixtures/workspace-migrated.db.gz')))
	)
	const app = await fixture()
	t.after(() => app.close())
	app.fix()
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle' }
	const ok = async (args: string[]) => {
		const result = await inputCommand(workspace, env, '', ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	await ok(['target', 'instance', 'add', 'shop', 'local', '--entry', `web=${app.baseUrl}`])
	await ok(['plan', 'approve', 'ticket@1', '--rationale', 'Run the rule.'])
	await ok([
		'run',
		'begin',
		'run-1',
		'ticket@1',
		'--build',
		'fixed',
		'--instance',
		'local',
		'--tests',
		'T1',
		'--timeout',
		'30',
	])
	const bin = directory(t)
	copyFileSync(join(root, 'test/e2e/per-test-host.mjs'), join(bin, 'pi'))
	chmodSync(join(bin, 'pi'), 0o755)
	const piEnv = {
		...env,
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CHECKMATE_HARNESS: 'pi',
		FAKE_PI_LOG: join(directory(t), 'log.txt'),
		FAKE_CHECKMATE_CLI: binary,
		FAKE_RUN: 'run-1',
	}
	const delegated = await inputCommand(workspace, piEnv, '', 'delegate', 'execute', 'run-1')
	assert.equal(delegated.body.status, 'completed', delegated.output)
	const gated = await command(workspace, env, 'run', 'show', 'run-1', '--gate')
	assert.equal(gated.code, 0, gated.output)
	assert.equal(gated.body.gate.state, 'passed')
})

test('Name the owed cleanup of a run that never finished — status gives the exact command, and it removes the marked data.', async (t) => {
	const workspace = directory(t)
	writeFileSync(join(workspace, 'ticket.md'), 'An order can be created.\n')
	writeFileSync(
		join(workspace, 'cleanup.mjs'),
		"import { writeFileSync } from 'node:fs'\nwriteFileSync('cleaned.txt', process.env.CHECKMATE_MARKER)\n"
	)
	const env = { ...process.env, CHECKMATE_ACTOR: 'oracle', CHECKMATE_HARNESS: 'pi' }
	const ok = async (...args: string[]) => {
		const result = await command(workspace, env, ...args)
		assert.equal(result.code, 0, result.output)
		return result.body
	}
	const app = await fixture()
	t.after(() => app.close())
	await ok(
		'setup',
		'--url',
		app.baseUrl,
		'--target',
		'shop',
		'--data',
		'isolation',
		'--policy',
		'Use the test users only.',
		'--cleanup',
		'node cleanup.mjs'
	)
	await ok(
		'plan',
		'open',
		'ticket',
		'--target',
		'shop@1',
		'--objective',
		'Read the catalog.',
		'--source',
		'ticket.md'
	)
	const saved = await inputCommand(
		workspace,
		env,
		JSON.stringify({
			requirements: [{ id: 'R1', text: 'The catalog is listed.', source: 'ticket.md' }],
			tests: [
				{
					id: 'T1',
					title: 'Read the catalog',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Read the catalog.',
					assertions: [{ id: 'A1', check: 'The catalog is listed.', checkKind: 'agent_observation' }],
				},
			],
			gaps: [],
		}),
		'plan',
		'save',
		'ticket'
	)
	assert.equal(saved.code, 0, saved.output)
	await ok('run', 'begin', 'run-1', 'ticket@1', '--build', 'b1', '--instance', 'local')
	assert.equal(existsSync(join(workspace, 'cleaned.txt')), false)
	const status = await ok('status', 'ticket')
	assert.ok(status.next.includes('Cleanup owed by run-1: checkmate cleanup run-1'), JSON.stringify(status.next))
	const cleaned = await ok('cleanup', 'run-1')
	assert.equal(cleaned.status, 'completed')
	assert.match(readFileSync(join(workspace, 'cleaned.txt'), 'utf8'), /^qa-[a-z0-9]+-run-1$/)
	const after = await ok('status', 'ticket')
	assert.equal(
		after.next.some((line: string) => line.startsWith('Cleanup owed by')),
		false
	)
})
