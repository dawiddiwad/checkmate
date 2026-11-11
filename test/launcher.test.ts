import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { delegate, minimumRules, resumeReason, worker } from '../cli/src/launcher.ts'
import { closeStore, openStore, resolveActor } from '../plugin/src/store.ts'
import { answerGap, approvePlan, openPlan, rejectPlan } from '../plugin/src/plans.ts'
import { planDetail } from '../plugin/src/views.ts'
import { actor, begin, candidate, check, directory, plan, planRequest, ready, root, store, target } from './support.ts'
import type { TestContext } from 'node:test'

const rules = ['Read', 'Write', 'Bash(node *)']
const pluginRoot = join(root, 'plugin')

function executable(workspace: string, name: string, code: string) {
	const path = join(workspace, name)
	writeFileSync(path, `#!/usr/bin/env node\n${code}\n`)
	chmodSync(path, 0o700)
	return path
}

function claude(workspace: string, body: string) {
	return executable(
		workspace,
		'fake-claude',
		`const { execFileSync } = require('node:child_process')
const plugin = process.argv[process.argv.indexOf('--plugin-dir') + 1]
const checkmate = (args, input = '') => execFileSync(process.execPath, [plugin + '/dist/checkmate.js', ...args], { input, encoding: 'utf8' })
const reply = (output) => console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: output }))
${body}`
	)
}

function playwright(workspace: string) {
	return executable(
		workspace,
		'fake-playwright',
		`require('node:fs').appendFileSync('closed.log', process.argv.slice(2).join(' ') + '\\n')`
	)
}

function planned(t: TestContext) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	plan(opened)
	closeStore(opened)
	return workspace
}

function started(t: TestContext) {
	const workspace = directory(t)
	const opened = store(t, workspace)
	ready(opened)
	begin(opened, 'run-1', ['T1'], 'build-1')
	check(opened, 'run-1', 'T1.A1', 'passed')
	const session = opened.db.prepare('SELECT browser_session FROM runs').get()!.browser_session as string
	closeStore(opened)
	return { workspace, session }
}

function query<T>(workspace: string, sql: string) {
	const opened = openStore(workspace)
	try {
		return opened.db
			.prepare(sql)
			.all()
			.map((row) => ({ ...row })) as T[]
	} finally {
		closeStore(opened)
	}
}

test('the worker refuses prose, a failed envelope, and missing structured output', async (t) => {
	const workspace = directory(t)
	for (const [output, reason] of [
		['"not json"', /JSON envelope/],
		[JSON.stringify(JSON.stringify({ type: 'result', subtype: 'success' })), /structured output/],
		[
			JSON.stringify(
				JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key' })
			),
			/did not complete the stage: Invalid API key/,
		],
	] as const) {
		const path = executable(workspace, 'prose', `console.log(${output})`)
		await assert.rejects(worker(path, [], { cwd: workspace, prompt: 'x', timeoutSeconds: 5 }), reason)
	}
	const exits = executable(workspace, 'exits', `console.error('Not logged in.'); process.exit(1)`)
	await assert.rejects(
		worker(exits, [], { cwd: workspace, prompt: 'x', timeoutSeconds: 5 }),
		/Worker exited with code 1: Not logged in\./
	)
})

test('delegate refuses an empty allow list and an unknown subject before it starts Claude', async (t) => {
	const workspace = planned(t)
	const missing = '/does-not-exist'
	await assert.rejects(
		delegate(workspace, 'execute', 'run-1', { allowedTools: [], claude: missing }),
		new RegExp(`Minimum for execute: ${minimumRules.execute.join(', ').replace(/[()*]/g, '\\$&')}`)
	)
	await assert.rejects(
		delegate(workspace, 'setup', 'other', { allowedTools: rules, pluginRoot, claude: missing }),
		/Unknown target request/
	)
	await assert.rejects(
		delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: missing }),
		/revision 1/
	)
	await assert.rejects(
		delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: missing }),
		/no pending decision/
	)
	await assert.rejects(
		delegate(workspace, 'execute', 'run-1', { allowedTools: rules, pluginRoot, claude: missing }),
		/run begin/
	)
})

test('the parent checks the database, not the worker claim', async (t) => {
	const workspace = directory(t)
	const opened = store(t, workspace)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	closeStore(opened)
	const liar = claude(workspace, `reply({ status: 'completed', subject: 'checkout', reasons: [] })`)
	const lied = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: liar })
	assert.equal(lied.status, 'operational_error')
	assert.match(lied.reasons[0], /Worker returned completed, but no plan save for checkout was recorded/)
	const wrong = claude(workspace, `reply({ status: 'completed', subject: 'other', reasons: [] })`)
	const misnamed = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: wrong })
	assert.equal(misnamed.status, 'operational_error')
	assert.match(misnamed.reasons[0], /names other, not checkout/)
	const denied = claude(
		workspace,
		`reply({ status: 'needs_decision', subject: 'checkout', reasons: ['No Bash permission.'] })`
	)
	assert.deepEqual(
		await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: denied }),
		{
			status: 'needs_decision',
			subject: 'checkout',
			reasons: ['No Bash permission.'],
			operation: null,
		}
	)
	const honest = claude(
		workspace,
		`const out = checkmate(['plan', 'save', 'checkout', '--json'], ${JSON.stringify(JSON.stringify(candidate()))})
const { status, subject, reasons } = JSON.parse(out)
reply({ status, subject, reasons })`
	)
	const saved = await delegate(workspace, 'plan', 'checkout', { allowedTools: rules, pluginRoot, claude: honest })
	assert.equal(saved.status, 'needs_decision')
	assert.equal(saved.subject, 'checkout@1')
	assert.deepEqual(saved.reasons, [
		'G1: Does the promotion stack with loyalty?',
		'G2: Which orders qualify for refunds?',
	])
	const [operation] = query<{ id: string; actor: string }>(
		workspace,
		"SELECT id, actor FROM operations WHERE command = 'plan save' AND status != 'rejected'"
	)
	assert.deepEqual(operation, { id: saved.operation, actor: resolveActor(workspace) })
})

test('delegate revise needs every pending decision applied', async (t) => {
	const workspace = planned(t)
	const opened = store(t, workspace)
	rejectPlan(opened, actor, { reference: 'checkout@1', rationale: 'Apply the recorded refund decision.' })
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G2',
		kind: 'defer',
		value: 'Out of scope.',
		source: null,
		rationale: 'Later.',
	})
	closeStore(opened)
	const revises = claude(
		workspace,
		`const { status, subject, reasons } = JSON.parse(checkmate(['plan', 'revise', 'checkout', '--json'], '{"tests":{}}'))
reply({ status, subject, reasons })`
	)
	const revised = await delegate(workspace, 'revise', 'checkout', {
		allowedTools: rules,
		pluginRoot,
		claude: revises,
	})
	assert.equal(revised.status, 'needs_decision', revised.reasons.join('; '))
	assert.equal(revised.subject, 'checkout@2')
})

test('delegate revise corrects a rejected plan without pending gaps and verifies the saved edit', async (t) => {
	const workspace = planned(t)
	const opened = store(t, workspace)
	const before = planDetail(opened, 'checkout')
	rejectPlan(opened, actor, { reference: 'checkout@1', rationale: 'Include the audit requirement in the objective.' })
	closeStore(opened)
	const liar = claude(workspace, `reply({ status: 'completed', subject: 'checkout', reasons: [] })`)
	const lied = await delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: liar })
	assert.equal(lied.status, 'operational_error')
	assert.match(lied.reasons[0], /no plan edit for checkout was recorded/)
	const edits = claude(
		workspace,
		`const assert = require('node:assert/strict')
const prompt = require('node:fs').readFileSync(0, 'utf8')
assert.match(prompt, /approval.latest.rationale/)
assert.match(prompt, /plan edit checkout --expect-sha/)
assert.match(prompt, /Do not answer gaps, approve the new revision, or run test actions/)
const current = JSON.parse(checkmate(['plan', 'show', 'checkout', '--json']))
assert.equal(current.approval.latest.rationale, 'Include the audit requirement in the objective.')
const { objective, requirements, tests } = current.plan
const payload = JSON.stringify({ objective: objective + ' Include the audit requirement.', requirements, tests })
const { status, subject, reasons } = JSON.parse(checkmate(['plan', 'edit', 'checkout', '--expect-sha', current.sha256, '--json'], payload))
reply({ status, subject, reasons })`
	)
	const revised = await delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: edits })
	assert.equal(revised.status, 'needs_decision', revised.reasons.join('; '))
	assert.equal(revised.subject, 'checkout@2')
	const after = store(t, workspace)
	const detail = planDetail(after, 'checkout')
	assert.equal(detail.revision, 2)
	assert.equal(detail.approval.state, 'pending')
	assert.equal(detail.approval.latest, null)
	assert.equal(detail.plan.objective, `${before.plan.objective} Include the audit requirement.`)
	assert.deepEqual(planDetail(after, 'checkout', 1).plan, before.plan)
	assert.deepEqual(detail.pendingDecisions, [])
	assert.equal(after.db.prepare('SELECT count(*) AS count FROM approvals').get()!.count, 1)
	assert.equal(after.db.prepare('SELECT count(*) AS count FROM runs').get()!.count, 0)
	assert.equal(
		after.db.prepare('SELECT operation_id FROM plan_revisions WHERE revision = 2').get()!.operation_id,
		revised.operation
	)
	closeStore(after)
	await assert.rejects(
		delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: '/does-not-exist' }),
		/no pending decision or rejected approval/
	)
})

test('delegate revise does not act on a rejection superseded by approval', async (t) => {
	const workspace = planned(t)
	const opened = store(t, workspace)
	rejectPlan(opened, actor, { reference: 'checkout@1', rationale: 'Check the requirement.' })
	approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'The requirement is correct.' })
	closeStore(opened)
	await assert.rejects(
		delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: '/does-not-exist' }),
		/no pending decision or rejected approval/
	)
})

test('delegate revise applies gaps then corrects an unrelated rejection and returns the last revision', async (t) => {
	const workspace = planned(t)
	const opened = store(t, workspace)
	rejectPlan(opened, actor, {
		reference: 'checkout@1',
		rationale: 'T1 must verify that the order identifier is visible.',
	})
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G2',
		kind: 'defer',
		value: 'Later.',
		source: null,
		rationale: 'Refunds are out of scope.',
	})
	closeStore(opened)
	const edits = claude(
		workspace,
		`const assert = require('node:assert/strict')
const prompt = require('node:fs').readFileSync(0, 'utf8')
assert.match(prompt, /plan show checkout@1 --json/)
assert.match(prompt, /After applying gaps, check the new revision against that original rejection/)
const original = JSON.parse(checkmate(['plan', 'show', 'checkout@1', '--json']))
checkmate(['plan', 'revise', 'checkout', '--expect-sha', original.sha256, '--json'], JSON.stringify({ tests: {} }))
const current = JSON.parse(checkmate(['plan', 'show', 'checkout', '--json']))
assert.equal(current.revision, 2)
assert.equal(current.approval.latest, null)
const { objective, requirements, tests } = current.plan
tests.find(test => test.id === 'T1').assertions.push({ id: 'A3', check: 'The order identifier is visible.', oracleKind: 'agent_observation' })
const { status, subject, reasons } = JSON.parse(checkmate(['plan', 'edit', 'checkout', '--expect-sha', current.sha256, '--json'], JSON.stringify({ objective, requirements, tests })))
reply({ status, subject, reasons })`
	)
	const revised = await delegate(workspace, 'revise', 'checkout', { allowedTools: rules, pluginRoot, claude: edits })
	assert.equal(revised.subject, 'checkout@3')
	const after = store(t, workspace)
	const detail = planDetail(after, 'checkout')
	assert.equal(detail.approval.state, 'pending')
	assert.deepEqual(detail.pendingDecisions, [])
	assert.equal(detail.plan.gaps.find((gap) => gap.id === 'G2')!.status, 'deferred')
	assert.equal(
		detail.plan.tests.find((test) => test.id === 'T1')!.assertions.at(-1)!.check,
		'The order identifier is visible.'
	)
	assert.equal(planDetail(after, 'checkout', 2).plan.tests.find((test) => test.id === 'T1')!.assertions.length, 2)
	assert.equal(
		after.db.prepare('SELECT operation_id FROM plan_revisions WHERE revision = 3').get()!.operation_id,
		revised.operation
	)
	assert.equal(after.db.prepare('SELECT count(*) AS count FROM approvals').get()!.count, 1)
	assert.equal(after.db.prepare('SELECT count(*) AS count FROM runs').get()!.count, 0)
})

test('delegate revise retains outstanding rejection feedback after saving a gap revision', async (t) => {
	const workspace = planned(t)
	const opened = store(t, workspace)
	const rationale = 'T1 must verify the audit field.'
	rejectPlan(opened, actor, { reference: 'checkout@1', rationale })
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G2',
		kind: 'defer',
		value: 'Later.',
		source: null,
		rationale: 'Refunds are out of scope.',
	})
	closeStore(opened)
	const revises = claude(
		workspace,
		`const current = JSON.parse(checkmate(['plan', 'show', 'checkout', '--json']))
const { subject } = JSON.parse(checkmate(['plan', 'revise', 'checkout', '--expect-sha', current.sha256, '--json'], JSON.stringify({ tests: {} })))
reply({ status: 'needs_decision', subject, reasons: [current.approval.latest.rationale + ' The expected audit value is missing.'] })`
	)
	const revised = await delegate(workspace, 'revise', 'checkout', {
		allowedTools: rules,
		pluginRoot,
		claude: revises,
	})
	assert.equal(revised.status, 'needs_decision')
	assert.equal(revised.subject, 'checkout@2')
	assert(revised.operation)
	assert(revised.reasons.includes(rationale + ' The expected audit value is missing.'))
	assert(revised.reasons.includes('G1: Does the promotion stack with loyalty?'))
	assert.equal(new Set(revised.reasons).size, revised.reasons.length)
})

test('a deadline kills the worker group, keeps the run started, and closes the browser once', async (t) => {
	const { workspace, session } = started(t)
	const hangs = executable(
		workspace,
		'fake-claude',
		`const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
require('node:fs').writeFileSync('child.pid', String(child.pid))
setInterval(() => {}, 1000)`
	)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		timeoutSeconds: 1,
		claude: hangs,
		playwright: playwright(workspace),
	})
	assert.equal(result.status, 'interrupted')
	assert.deepEqual(result.reasons, ['Worker deadline exceeded', resumeReason('run-1')])
	assert.match(result.reasons[1], /checkmate run resume run-1/)
	assert.deepEqual(query(workspace, 'SELECT run_id FROM results'), [])
	assert.deepEqual(
		query(workspace, "SELECT test_id, assertion_id, result FROM assertion_results WHERE run_id = 'run-1'"),
		[{ test_id: 'T1', assertion_id: 'A1', result: 'passed' }]
	)
	assert.deepEqual(readFileSync(join(workspace, 'closed.log'), 'utf8').trim().split('\n'), [`-s=${session} close`])
	const pid = Number(readFileSync(join(workspace, 'child.pid'), 'utf8'))
	try {
		process.kill(pid, 0)
		assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8'), /\) Z /)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== 'ESRCH' && code !== 'ENOENT') throw error
	}
})

test('an execute worker that exits without finishing leaves the run started', async (t) => {
	const { workspace, session } = started(t)
	const quits = claude(workspace, `reply({ status: 'completed', subject: 'run-1', reasons: [] })`)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: quits,
		playwright: '/missing-playwright',
	})
	assert.equal(result.status, 'operational_error')
	assert.deepEqual(result.reasons, [
		'Worker returned completed, but run run-1 is not finished',
		`Browser session ${session} was not closed: the command is unavailable.`,
		resumeReason('run-1'),
	])
})

test('an execute worker that finishes the run through the plugin CLI completes the stage', async (t) => {
	const { workspace, session } = started(t)
	const finishes = claude(
		workspace,
		`const fs = require('node:fs')
const evidence = JSON.parse(checkmate(['run', 'show', 'run-1', '--json'])).evidenceDirectory + '/a2.txt'
fs.writeFileSync(evidence, 'one item')
checkmate(['run', 'check', 'run-1', 'T1', 'A2', '--result', 'passed', '--observed', 'One item.', '--evidence', evidence])
checkmate(['run', 'close', 'run-1', 'T1'])
const { status, subject, reasons } = JSON.parse(checkmate(['run', 'finish', 'run-1', '--completion', 'completed', '--cleanup', 'completed', '--cleanup-reason', 'Closed the browser.', '--json']))
reply({ status, subject, reasons })`
	)
	const result = await delegate(workspace, 'execute', 'run-1', {
		allowedTools: rules,
		pluginRoot,
		claude: finishes,
		playwright: playwright(workspace),
	})
	assert.deepEqual(
		{ ...result, operation: undefined },
		{
			status: 'completed',
			subject: 'run-1',
			reasons: [],
			operation: undefined,
		}
	)
	assert.deepEqual(
		query<{ actor: string }>(workspace, "SELECT actor FROM operations WHERE command = 'run finish'").map(
			(row) => row.actor
		),
		[resolveActor(workspace)]
	)
	assert.equal(readFileSync(join(workspace, 'closed.log'), 'utf8'), `-s=${session} close\n`)
})
