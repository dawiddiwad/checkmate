import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { root } from '../support.ts'

const project = mkdtempSync(join(tmpdir(), 'checkmate-factory-package-'))
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
test.after(() => rmSync(project, { recursive: true, force: true }))

const fixture = join(root, 'test/e2e/factory-preview')
function workspace() {
	return mkdtempSync(join(tmpdir(), 'checkmate-factory-workspace-'))
}
function command(path: string, actor: string, args: string[], input = '') {
	const result = spawnSync(process.execPath, [binary, ...args, '--workspace', path, '--json'], {
		cwd: path,
		encoding: 'utf8',
		input,
		env: { ...process.env, CHECKMATE_ACTOR: actor },
		timeout: 70000,
	})
	const output = result.stdout + result.stderr
	return {
		code: result.status,
		output,
		body: JSON.parse(result.stdout || JSON.stringify({ output, error: String(result.error ?? '') })),
	}
}
function ok(path: string, actor: string, args: string[], input = '') {
	const result = command(path, actor, args, input)
	assert.equal(result.code, 0, result.output)
	return result.body
}
function start(buildDirectory: string, build: string, mode: 'broken' | 'fixed', seedPath: string) {
	const child = spawn(process.execPath, [join(buildDirectory, 'app.mjs')], {
		cwd: buildDirectory,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			FACTORY_BUILD: build,
			FACTORY_BUG: mode === 'broken' ? '1' : '0',
			FACTORY_SEED: seedPath,
		},
	})
	return new Promise<{ child: ChildProcess; url: string }>((resolveReady, reject) => {
		let output = ''
		child.stdout!.on('data', (part: Buffer) => {
			output += part.toString()
			const match = /READY (http:\/\/\S+)/.exec(output)
			if (match) resolveReady({ child, url: match[1] })
		})
		child.once('error', reject)
		child.once('exit', (code) => reject(Error(`Factory app exited ${code}: ${output}`)))
	})
}
async function stop(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return
	const exited = once(child, 'exit')
	child.kill('SIGTERM')
	await exited
}

test('Factory pins a ticket to built previews, retains failed evidence, and promotes only a passing retest', async (t) => {
	const path = workspace()
	t.after(() => rmSync(path, { recursive: true, force: true }))
	const appDirectory = join(path, 'previews')
	const seed = join(path, 'seed.json')
	writeFileSync(join(path, 'ticket.md'), 'SHOP-12: combined quote must be 240 PLN.\n')
	const ticket = join(path, 'ticket.md')
	const ticketSha256 = createHash('sha256').update(readFileSync(ticket)).digest('hex')
	const brokenDirectory = execFileSync(
		process.execPath,
		[join(fixture, 'build.mjs'), appDirectory, 'build-001', 'broken', ticket],
		{ encoding: 'utf8' }
	).trim()
	const fixedDirectory = execFileSync(
		process.execPath,
		[join(fixture, 'build.mjs'), appDirectory, 'build-002', 'fixed', ticket],
		{ encoding: 'utf8' }
	).trim()
	execFileSync(process.execPath, [join(fixture, 'reset.mjs'), seed, '400', '-160'])
	assert.deepEqual(JSON.parse(readFileSync(seed, 'utf8')), { seeded: 'SHOP-12-v1', basePLN: 400, loyaltyPLN: -160 })
	const broken = await start(brokenDirectory, 'build-001', 'broken', seed)
	t.after(() => stop(broken.child))
	assert.deepEqual(await (await fetch(`${broken.url}/health`)).json(), { build: 'build-001', seeded: 'SHOP-12-v1' })
	assert.deepEqual(await (await fetch(`${broken.url}/quote`)).json(), { totalPLN: 220 })
	const oracle = (args: string[], input = '') => ok(path, 'oracle', args, input)
	oracle([
		'target',
		'open',
		'shop',
		'--entry-point',
		'web:url:Factory preview.',
		'--capabilities',
		'http',
		'--operations',
		'read_catalog',
	])
	oracle(
		['target', 'save', 'shop'],
		JSON.stringify({
			contractVersion: 'toolkit-2',
			targetId: 'shop',
			revision: 1,
			entryPoints: [{ name: 'web', kind: 'url', purpose: 'Factory preview.' }],
			capabilities: ['http'],
			tools: [],
			authentication: { kind: 'none', references: [] },
			allowedOperations: ['read_catalog'],
			startup: { owner: 'factory', command: null },
			cleanup: 'Factory stops the preview.',
			readyForLiveExecution: true,
			reset: { owner: 'external', command: null },
			approvals: { plan: 'required', result: 'required' },
		})
	)
	oracle(['target', 'instance', 'add', 'shop', 'broken', '--entry', `web=${broken.url}`])
	oracle([
		'plan',
		'open',
		'SHOP-12',
		'--target',
		'shop@1',
		'--objective',
		'Check the combined quote.',
		'--source',
		'ticket.md',
	])
	const candidate = {
		requirements: [{ id: 'R1', text: 'Combined quote is 240 PLN.', source: 'ticket.md' }],
		tests: [
			{
				id: 'T1',
				title: 'Combined quote',
				requirementIds: ['R1'],
				capability: 'http',
				operations: ['read_catalog'],
				dependsOn: [],
				preconditions: [],
				action: 'GET /quote on the pinned build.',
				assertions: [
					{
						id: 'A1',
						check: 'totalPLN is 240',
						checkKind: 'deterministic',
						observe: 'the value stated by the check',
						expected: '240',
					},
				],
			},
		],
		gaps: [
			{
				id: 'G1',
				severity: 'blocking',
				status: 'open',
				requirementIds: ['R1'],
				testIds: ['T1'],
				question: 'Does the quote include loyalty?',
				consequence: 'Expected total is unclear.',
				decisionId: null,
			},
		],
	}
	oracle(['plan', 'save', 'SHOP-12'], JSON.stringify(candidate))
	const archive = mkdtempSync(join(tmpdir(), 'checkmate-factory-archive-'))
	t.after(() => rmSync(archive, { recursive: true, force: true }))
	cpSync(path, archive, { recursive: true })
	const answer = command(archive, 'oracle', [
		'gap',
		'answer',
		'SHOP-12',
		'G1',
		'--kind',
		'clarify',
		'--value',
		'Yes, the total is 240 PLN.',
		'--source',
		'ticket.md',
		'--rationale',
		'Ticket owner decision.',
	])
	assert.equal(answer.code, 0, JSON.stringify(answer))
	const revision = ok(
		archive,
		'planner',
		['plan', 'revise', 'SHOP-12'],
		JSON.stringify({ tests: { T1: { action: 'Verify the seeded combined quote is 240 PLN.' } } })
	)
	assert.ok(revision.sha256)
	ok(archive, 'oracle', ['plan', 'approve', 'SHOP-12@2', '--rationale', 'Ticket and answer are applied.'])
	const plan = ok(archive, 'oracle', ['plan', 'show', 'SHOP-12@2'])
	assert.equal(plan.plan.requirements[0].source, 'ticket.md')
	assert.equal(plan.plan.gaps[0].status, 'resolved')
	const built = JSON.parse(readFileSync(join(brokenDirectory, 'build.json'), 'utf8'))
	assert.deepEqual(built, { build: 'build-001', mode: 'broken', ticket: 'SHOP-12', sourceSha256: ticketSha256 })
	const run1 = ok(archive, 'oracle', [
		'run',
		'begin',
		'run-1',
		'SHOP-12@2',
		'--build',
		built.build,
		'--instance',
		'broken',
	])
	assert.equal(run1.tests[0], 'T1')
	const failed = ok(
		archive,
		'tester',
		['run', 'check', 'run-1', 'T1', 'A1', '--observed', '220', '--evidence', '-'],
		'GET /quote on build-001 returned HTTP 200: {"totalPLN":220}'
	)
	ok(
		archive,
		'tester',
		['run', 'finding', 'run-1'],
		JSON.stringify({
			id: 'F1',
			type: 'defect',
			severity: 'high',
			assertionIds: ['T1.A1'],
			requirementIds: ['R1'],
			title: 'Combined quote is wrong',
			expected: '240 PLN',
			observed: '220 PLN',
			reproduction: ['GET /quote'],
			evidenceIds: failed.evidenceIds,
		})
	)
	ok(archive, 'tester', ['run', 'close', 'run-1', 'T1'])
	ok(archive, 'tester', [
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
	const report = ok(archive, 'oracle', ['run', 'show', 'run-1'])
	assert.equal(report.build, 'build-001')
	assert.match(JSON.stringify(report), /220/)
	assert.deepEqual(
		report.tests[0].assertions[0].evidence.map((item: { id: string }) => item.id),
		failed.evidenceIds
	)
	const refused = command(archive, 'oracle', [
		'plan',
		'promote',
		'SHOP-12@2',
		'--run',
		'run-1',
		'--build',
		'build-001',
		'--rationale',
		'Should not promote.',
	])
	assert.equal(refused.code, 1, refused.output)
	assert.match(refused.output, /Accept result|pass|failed/i)
	const fixed = await start(fixedDirectory, 'build-002', 'fixed', seed)
	t.after(() => stop(fixed.child))
	ok(archive, 'oracle', ['target', 'instance', 'add', 'shop', 'fixed', '--entry', `web=${fixed.url}`])
	assert.deepEqual(await (await fetch(`${fixed.url}/quote`)).json(), { totalPLN: 240 })
	const run2 = ok(archive, 'oracle', [
		'run',
		'begin',
		'run-2',
		'SHOP-12@2',
		'--build',
		'build-002',
		'--instance',
		'fixed',
		'--retest-of',
		'run-1',
	])
	assert.deepEqual(run2.tests, ['T1'])
	const passed = ok(
		archive,
		'tester',
		['run', 'check', 'run-2', 'T1', 'A1', '--observed', '240', '--evidence', '-'],
		'GET /quote on build-002 returned HTTP 200: {"totalPLN":240}'
	)
	ok(archive, 'tester', ['run', 'close', 'run-2', 'T1'])
	ok(archive, 'tester', [
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
	ok(archive, 'oracle', ['result', 'accept', 'run-2', '--rationale', 'Build-002 satisfies the ticket.'])
	const promotion = ok(archive, 'oracle', [
		'plan',
		'promote',
		'SHOP-12@2',
		'--run',
		'run-2',
		'--build',
		'build-002',
		'--rationale',
		'Promote the passing retest.',
	])
	assert.equal(promotion.build, 'build-002')
	const retest = ok(archive, 'oracle', ['run', 'show', 'run-2'])
	assert.equal(retest.request.retestOf, 'run-1')
	assert.ok(
		retest.retest.some(
			(item: { findingId: string; verdict: string }) => item.findingId === 'F1' && item.verdict === 'fixed'
		)
	)
	const stored = ok(archive, 'oracle', [
		'query',
		"SELECT application_build, json_extract(request, '$.retestOf') AS retest_of FROM runs ORDER BY rowid",
	])
	assert.deepEqual(stored.rows, [
		{ application_build: 'build-001', retest_of: null },
		{ application_build: 'build-002', retest_of: 'run-1' },
	])
	assert.ok(passed.evidenceIds.length)
	assert.ok(existsSync(join(archive, '.checkmate/checkmate.db')))
	await stop(broken.child)
	await stop(fixed.child)
	assert.ok(broken.child.exitCode !== null || broken.child.signalCode !== null)
	assert.ok(fixed.child.exitCode !== null || fixed.child.signalCode !== null)
})
