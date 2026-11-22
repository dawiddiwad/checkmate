import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { canonical, closeStore, digest, openStore } from '../plugin/src/store.ts'
import { openPlan, savePlan, approvePlan, patchPlan } from '../plugin/src/plans.ts'
import { beginRun, closeTest, finishRun, acceptResult } from '../plugin/src/runs.ts'
import { promotePlan } from '../plugin/src/promotion.ts'
import { actor, check, directory, store, target } from './support.ts'

const firstTest = {
	id: 'T1',
	title: 'Promoted quote',
	requirementIds: ['R1'],
	capability: 'http',
	operations: ['read_catalog'],
	dependsOn: [],
	preconditions: [],
	action: 'Read the quote.',
	assertions: [{ id: 'A1', check: 'The quote is 240.', checkKind: 'deterministic' }],
}

export function permanentPackage(t: TestContext, project: string) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened, { capabilities: ['http'], tools: [] })
	openPlan(opened, actor, {
		planId: 'ticket',
		target: 'checkout-local@1',
		request: {
			objective: 'Check the quote.',
			context: { sources: ['ticket.md'], instructions: 'Explore everything.' },
		},
	})
	savePlan(opened, actor, {
		planId: 'ticket',
		candidate: {
			requirements: [{ id: 'R1', text: 'The quote is 240.', source: 'ticket.md' }],
			tests: [firstTest],
			gaps: [],
		},
	})
	approvePlan(opened, actor, { reference: 'ticket@1', rationale: 'Ticket rules.' })
	beginRun(opened, actor, { runId: 'source', reference: 'ticket@1', build: 'accepted', tests: ['T1'] })
	check(opened, 'source', 'T1.A1', 'passed')
	closeTest(opened, actor, { runId: 'source', testId: 'T1' })
	finishRun(opened, actor, { runId: 'source', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	acceptResult(opened, actor, { runId: 'source', rationale: 'Accepted.' })
	promotePlan(opened, actor, { reference: 'ticket@1', runId: 'source', build: 'accepted', rationale: 'Save.' })
	patchPlan(opened, actor, {
		reference: 'ticket@2',
		patch: {
			tests: {
				T1: { title: 'Later draft title', action: 'Do not execute this draft action.' },
				T2: {
					title: 'Later draft test',
					requirementIds: ['R1'],
					capability: 'http',
					operations: ['read_catalog'],
					dependsOn: [],
					preconditions: [],
					action: 'Do not execute this draft test.',
					assertions: { A1: { check: 'The draft passes.', checkKind: 'deterministic' } },
				},
			},
		},
	})
	closeStore(opened)

	const bin = join(workspace, 'bin')
	mkdirSync(bin)
	const host = join(bin, 'claude')
	writeFileSync(
		host,
		`#!/usr/bin/env node
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const prompt = fs.readFileSync(0, 'utf8')
fs.appendFileSync('host-called', 'called\\n')
if (!prompt.includes('Permanent-only run from ticket@2') || !prompt.includes('Do not explore')) throw Error('Missing permanent instructions')
if (prompt.includes('Explore everything.')) throw Error('Unexpected exploratory request instructions')
const plugin = process.argv[process.argv.indexOf('--plugin-dir') + 1]
const run = (args, input = '') => JSON.parse(execFileSync(process.execPath, [plugin + '/dist/checkmate.js', ...args, '--json'], { input, encoding: 'utf8' }))
const detail = run(['run', 'show', 'permanent-1'])
if (detail.revision !== 2 || detail.request.permanent.reference !== 'ticket@2' || detail.tests.length !== 1 || detail.tests[0].title !== 'Promoted quote' || detail.tests[0].assertions[0].check !== 'The quote is 240.') throw Error('Wrong snapshot')
const plan = run(['plan', 'show', 'ticket@2', '--tests', 'T1', '--fields', 'action,assertions'])
if (plan.tests.length !== 1 || plan.tests[0].action !== 'Read the quote.') throw Error('Wrong test action')
run(['run', 'check', 'permanent-1', 'T1', 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'], 'HTTP 200: 240')
run(['run', 'close', 'permanent-1', 'T1'])
const result = run(['run', 'finish', 'permanent-1', '--completion', 'completed', '--cleanup', 'completed', '--cleanup-reason', 'Done.'])
console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: { status: result.status, subject: result.subject, reasons: result.reasons } }))
`
	)
	chmodSync(host, 0o755)
	const cli = join(project, 'node_modules/.bin/checkmate')
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		CHECKMATE_ACTOR: 'oracle',
		CHECKMATE_HARNESS: 'claude',
	}
	const command = (args: string[], cwd = workspace, input = '') => {
		const child = spawnSync(process.execPath, [cli, ...args, '--json'], {
			cwd,
			env,
			input,
			encoding: 'utf8',
			timeout: 70000,
		})
		assert.ok(child.stdout, child.stderr)
		return { code: child.status, body: JSON.parse(child.stdout), output: child.stdout + child.stderr }
	}
	const refused = (args: string[], reason: RegExp, cwd = workspace) => {
		const result = command(args, cwd)
		assert.equal(result.code, 1, result.output)
		assert.match(result.output, reason)
	}
	refused(['run', 'permanent', 'missing', 'unknown', '--build', 'b2'], /no permanent test promotion/i)
	refused(['run', 'permanent', 'no-build', 'ticket'], /build/i)
	refused(['run', 'permanent', 'wrong', 'ticket', '--build', 'b2', '--promotion', 'other@2'], /does not belong/)
	refused(['run', 'permanent', 'empty-selector', 'ticket', '--build', 'b2', '--promotion', ''], /promotion/i)
	refused(
		['run', 'permanent', 'manual-selection', 'ticket', '--build', 'b2', '--tests', 'T2'],
		/Unknown (option|argument)/i
	)
	refused(
		['run', 'permanent', 'stale', 'ticket', '--build', 'b2', '--promotion', 'ticket@1'],
		/not the current promotion/
	)
	const empty = directory(t)
	cpSync(join(workspace, '.checkmate'), join(empty, '.checkmate'), { recursive: true })
	const corrupted = new DatabaseSync(join(empty, '.checkmate/checkmate.db'))
	corrupted.exec("DROP TRIGGER plan_promotions_update; UPDATE plan_promotions SET tests = '[]'")
	corrupted.close()
	refused(['run', 'permanent', 'empty', 'ticket', '--build', 'b2'], /no valid permanent test selection/, empty)
	assert.equal(
		command([
			'query',
			"SELECT count(*) AS n FROM runs WHERE run_id IN ('missing','wrong','stale','manual-selection','no-build','empty-selector')",
		]).body.rows[0].n,
		0
	)
	assert.equal(command(['query', "SELECT count(*) AS n FROM runs WHERE run_id = 'empty'"], empty).body.rows[0].n, 0)
	const altered = directory(t)
	cpSync(join(workspace, '.checkmate'), join(altered, '.checkmate'), { recursive: true })
	const alteredDb = new DatabaseSync(join(altered, '.checkmate/checkmate.db'))
	alteredDb.exec('DROP TRIGGER plan_revisions_update; DROP TRIGGER promoted_plan_update')
	const alteredPlan = JSON.parse(
		String(
			alteredDb.prepare("SELECT body FROM plan_revisions WHERE plan_id = 'ticket' AND revision = 2").get()!.body
		)
	)
	alteredPlan.tests[0].title = 'Changed after acceptance'
	const alteredBody = canonical(alteredPlan)
	alteredDb
		.prepare("UPDATE plan_revisions SET body = ?, sha256 = ? WHERE plan_id = 'ticket' AND revision = 2")
		.run(alteredBody, digest(alteredBody))
	alteredDb.close()
	refused(
		['run', 'permanent', 'altered', 'ticket', '--build', 'b2'],
		/does not match its accepted test definitions/,
		altered
	)
	assert.equal(
		command(['query', "SELECT count(*) AS n FROM runs WHERE run_id = 'altered'"], altered).body.rows[0].n,
		0
	)
	assert.equal(existsSync(join(workspace, 'host-called')), false)
	const started = command(['run', 'permanent', 'permanent-1', 'ticket', '--build', 'b2', '--promotion', 'ticket@2'])
	assert.equal(started.code, 0, started.output)
	assert.deepEqual([started.body.plan, started.body.build, started.body.tests], ['ticket@2', 'b2', ['T1']])
	const shown = command(['run', 'show', 'permanent-1']).body
	assert.deepEqual(
		[shown.revision, shown.build, shown.request.permanent.reference, shown.tests[0].title],
		[2, 'b2', 'ticket@2', 'Promoted quote']
	)
	const promotion = command(['plan', 'promotions', 'ticket']).body.promotions[0]
	assert.deepEqual(
		[shown.planId, shown.request.permanent.sourceRevision, shown.request.permanent.resultSha256],
		['ticket', 1, promotion.resultSha256]
	)
	const compact = spawnSync(process.execPath, [cli, 'run', 'show', 'permanent-1'], {
		cwd: workspace,
		env,
		encoding: 'utf8',
	})
	assert.match(compact.stdout, /mode=permanent/)
	refused(
		['run', 'check', 'permanent-1', 'T2', 'A1', '--result', 'passed', '--observed', 'wrong', '--evidence', '-'],
		/not selected/
	)
	const gap = JSON.stringify({
		id: 'G1',
		severity: 'blocking',
		status: 'open',
		requirementIds: [],
		testIds: ['T1'],
		question: 'Why?',
		consequence: 'Blocked.',
		decisionId: null,
	})
	const gapResult = command(['run', 'gap', 'permanent-1'], workspace, gap)
	assert.equal(gapResult.code, 1)
	assert.match(gapResult.output, /does not discover gaps/)
	const probe = JSON.stringify({
		id: 'F1',
		type: 'potential_issue',
		severity: 'low',
		assertionIds: [],
		requirementIds: [],
		title: 'Probe',
		expected: 'Expected.',
		observed: 'Observed.',
		reproduction: ['Probe.'],
		evidenceIds: [],
	})
	const finding = command(['run', 'finding', 'permanent-1'], workspace, probe)
	assert.equal(finding.code, 1)
	assert.match(finding.output, /only defects of its selected tests/)
	const done = command(['delegate', 'execute', 'permanent-1', '--allow', 'Read', '--allow', 'Bash'])
	assert.equal(done.code, 0, done.output)
	assert.equal(done.body.status, 'completed')
	assert.equal(readFileSync(join(workspace, 'host-called'), 'utf8').trim(), 'called')
	const result = command(['run', 'show', 'permanent-1']).body
	assert.deepEqual(
		[
			result.planId,
			result.revision,
			result.build,
			result.tests.map((item: { testId: string }) => item.testId),
			result.tests[0].outcome,
		],
		['ticket', 2, 'b2', ['T1'], 'passed']
	)
	const savedResult = JSON.parse(
		command(['query', "SELECT body FROM results WHERE run_id = 'permanent-1'"]).body.rows[0].body
	)
	assert.deepEqual(
		[
			savedResult.plan.planId,
			savedResult.plan.revision,
			savedResult.applicationBuild,
			savedResult.selectedTestIds,
			savedResult.tests[0].outcome,
		],
		['ticket', 2, 'b2', ['T1'], 'passed']
	)
	const record = command([
		'query',
		"SELECT (SELECT count(*) FROM explorations) AS explorations, (SELECT count(*) FROM plan_revisions WHERE plan_id = 'ticket') AS revisions",
	]).body.rows[0]
	assert.deepEqual([record.explorations, record.revisions], [0, 3])
	t.diagnostic('Permanent run executed only ticket@2/T1 on b2; later draft tests and exploration were not run')
	const newer = directory(t)
	cpSync(join(workspace, '.checkmate'), join(newer, '.checkmate'), { recursive: true })
	const next = openStore(newer)
	approvePlan(next, actor, { reference: 'ticket@3', rationale: 'Approve the new draft.' })
	beginRun(next, actor, { runId: 'source-2', reference: 'ticket@3', build: 'b3', tests: ['T1', 'T2'] })
	for (const testId of ['T1', 'T2']) {
		check(next, 'source-2', `${testId}.A1`, 'passed')
		closeTest(next, actor, { runId: 'source-2', testId })
	}
	finishRun(next, actor, { runId: 'source-2', completion: 'completed', cleanup: 'completed', cleanupReason: 'Done.' })
	acceptResult(next, actor, { runId: 'source-2', rationale: 'Accepted.' })
	promotePlan(next, actor, {
		reference: 'ticket@3',
		runId: 'source-2',
		build: 'b3',
		rationale: 'Save the new tests.',
	})
	closeStore(next)
	refused(
		['run', 'permanent', 'old-selection', 'ticket', '--build', 'b4', '--promotion', 'ticket@2'],
		/not the current promotion/,
		newer
	)
	const newest = command(['run', 'permanent', 'newest', 'ticket', '--build', 'b4'], newer)
	assert.equal(newest.code, 0, newest.output)
	assert.deepEqual([newest.body.plan, newest.body.tests], ['ticket@4', ['T1', 'T2']])
	assert.equal(command(['plan', 'reject', 'ticket@4', '--rationale', 'Reject this snapshot.'], newer).code, 0)
	refused(
		['run', 'permanent', 'rejected-snapshot', 'ticket', '--build', 'b4'],
		/Promotion ticket@4 is rejected/,
		newer
	)
	assert.equal(command(['plan', 'approve', 'ticket@4', '--rationale', 'Accept this snapshot.'], newer).code, 0)
	assert.equal(
		command(['result', 'reject', 'source-2', '--rationale', 'Withdraw the latest promotion.'], newer).code,
		0
	)
	refused(
		['run', 'permanent', 'no-fallback', 'ticket', '--build', 'b4'],
		/withdrawn or its result is not accepted/,
		newer
	)
	const pending = command(['run', 'permanent', 'pending', 'ticket', '--build', 'b3'])
	assert.equal(pending.code, 0, pending.output)
	const resumed = command(['run', 'resume', 'pending'])
	assert.equal(resumed.code, 0, resumed.output)
	const checked = command(['run', 'permanent', 'checked', 'ticket', '--build', 'b3'])
	assert.equal(checked.code, 0, checked.output)
	assert.equal(
		command(
			['run', 'check', 'checked', 'T1', 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'],
			workspace,
			'HTTP 200: 240'
		).code,
		0
	)
	assert.equal(command(['run', 'close', 'checked', 'T1']).code, 0)
	assert.equal(command(['result', 'reject', 'source', '--rationale', 'Withdrawn.']).code, 0)
	refused(['run', 'permanent', 'withdrawn', 'ticket', '--build', 'b3'], /withdrawn or its result is not accepted/)
	refused(
		['delegate', 'execute', 'pending', '--allow', 'Read', '--allow', 'Bash'],
		/withdrawn or its result is not accepted/
	)
	refused(['run', 'resume', 'pending'], /withdrawn or its result is not accepted/)
	refused(
		['run', 'check', 'pending', 'T1', 'A1', '--result', 'passed', '--observed', '240', '--evidence', '-'],
		/withdrawn or its result is not accepted/
	)
	refused(
		[
			'run',
			'finish',
			'checked',
			'--completion',
			'completed',
			'--cleanup',
			'not_applicable',
			'--cleanup-reason',
			'No action.',
		],
		/withdrawn or its result is not accepted/
	)
	const stopped = command([
		'run',
		'finish',
		'checked',
		'--completion',
		'operational_error',
		'--cleanup',
		'not_applicable',
		'--cleanup-reason',
		'No action.',
	])
	assert.equal(stopped.body.status, 'operational_error')
	assert.equal(command(['run', 'show', 'checked']).body.state, 'finalized')
	assert.equal(readFileSync(join(workspace, 'host-called'), 'utf8').trim(), 'called')
	assert.equal(command(['query', "SELECT count(*) AS n FROM runs WHERE run_id = 'withdrawn'"]).body.rows[0].n, 0)
	assert.equal(
		command(['run', 'close', 'pending', 'T1', '--outcome', 'blocked', '--reason', 'Promotion withdrawn.']).code,
		0
	)
	const finished = command([
		'run',
		'finish',
		'pending',
		'--completion',
		'completed',
		'--cleanup',
		'not_applicable',
		'--cleanup-reason',
		'No action.',
	])
	assert.equal(finished.code, 0, finished.output)
	t.diagnostic('Missing, wrong, empty, stale, and withdrawn promotions did not start a host or create a run')
}
