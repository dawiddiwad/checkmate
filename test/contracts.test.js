import test from 'node:test'
import assert from 'node:assert/strict'
import { symlink, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sandbox, prepare, revised, executeRequest, observation } from './support.js'
import { savePlan, setup, gate, beginRun, finalize, reports } from '../src/stages.ts'
import { planCheck, planCoverage } from '../src/contracts.ts'
import { publish, readDocument, readReference } from '../src/files.ts'

test('setup is repeatable and preserves local choices', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	assert.deepEqual((await setup(workspace, p.setupRequest, p.profile)).artifact, p.target)
	await assert.rejects(setup(workspace, p.setupRequest, { ...p.profile, cleanup: 'changed' }), /Profile exists/)
})
test('planning blocks by default and ready-only requires eligible tests', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const request = executeRequest(p, { reference: p.base }, { selectedTestIds: ['T1'] })
	assert.equal((await gate(workspace, request)).status, 'needs_decision')
	assert.equal((await beginRun(workspace, request)).status, 'needs_decision')
	await assert.rejects(readDocument(workspace, 'runs/run-1/invocation.json'), { code: 'ENOENT' })
	assert.equal((await gate(workspace, { ...request, partialExecution: 'ready_only' })).status, 'completed')
	assert.equal(
		(await gate(workspace, { ...request, partialExecution: 'ready_only', selectedTestIds: ['T2'] })).status,
		'needs_decision'
	)
	await assert.rejects(gate(workspace, { ...request, selectedTestIds: ['unknown'] }), /Unknown/)
	await assert.rejects(gate(workspace, { ...request, plan: { ...p.base, sha256: '0'.repeat(64) } }), /digest/)
})
test('revision preserves decisions and rejects stale or conflicting writes', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const r = await revised(workspace, p)
	assert.equal(r.plan.coverage[2].status, 'deferred')
	await assert.rejects(savePlan(workspace, r.request, r.plan), /newer revision/)
	assert.equal((await readReference(workspace, p.base)).revision, 1)
	const p2 = await prepare(await sandbox(t))
	const changed = structuredClone(p2.plan)
	changed.tests[0].expected = null
	assert.throws(() => planCheck(changed), /expected result/)
})
test('dependencies and explicit oracles are validated', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const cycle = structuredClone(p.plan)
	cycle.tests[0].dependsOn = ['T2']
	cycle.tests[1].dependsOn = ['T1']
	assert.throws(() => planCheck(cycle), /cycle/)
	const missing = structuredClone(p.plan)
	missing.tests[0].dependsOn = ['missing']
	assert.throws(() => planCheck(missing), /Unknown/)
	const invalid = structuredClone(p.plan)
	invalid.gaps[0].severity = 'non_blocking'
	invalid.tests[1].readiness = 'ready'
	invalid.coverage = planCoverage(invalid)
	assert.throws(() => planCheck(invalid), /expected result/)
})
test('result preserves omitted coverage and immutable retest history', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r)
	const saved = await finalize(workspace, request, await observation(workspace, request, r.plan))
	const failed = await readReference(workspace, saved.artifact)
	assert.equal(failed.tests[1].outcome, 'failed')
	assert.equal(failed.coverage.status, 'partial')
	const retest = executeRequest(p, r, {
		runId: 'run-2',
		requestId: 'execute-2',
		outputDirectory: 'runs/run-2',
		applicationBuild: 'fixture-build-2',
		selectedTestIds: ['T2'],
		retestOf: saved.artifact,
	})
	const passed = await finalize(workspace, retest, await observation(workspace, retest, r.plan, 90))
	const result = await readReference(workspace, passed.artifact)
	assert.equal(result.tests[0].outcome, 'not_run')
	assert.equal(result.tests[1].outcome, 'passed')
	assert.equal(result.coverage.status, 'partial')
	assert.equal((await readReference(workspace, saved.artifact)).tests[1].outcome, 'failed')
	await assert.rejects(beginRun(workspace, request), { code: 'EEXIST' })
	await reports(workspace, saved.artifact)
})
test('finalizer rejects fabricated scope, assertions, evidence, and operational success', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p),
		request = executeRequest(p, r)
	const candidate = await observation(workspace, request, r.plan)
	const mutations = [
		(c) => c.tests.pop(),
		(c) => (c.tests[0].evidenceIds = []),
		(c) => (c.tests[0].expected = 'invented'),
		(c) => (c.evidence[0].path = '../profile.json'),
		(c) => (c.evidence[0].path = 'evidence/../invocation.json'),
		(c) => (c.evidence[0].sha256 = '0'.repeat(64)),
		(c) => (c.cleanup.status = 'failed'),
		(c) => (c.tests[0].outcome = 'error'),
		(c) => (c.findings = []),
		(c) => (c.selectedTestIds = ['T2']),
		(c) => (c.tests[2].outcome = 'passed'),
	]
	for (const mutate of mutations) {
		const changed = structuredClone(candidate)
		mutate(changed)
		await assert.rejects(finalize(workspace, request, changed))
	}
	await symlink(join(workspace, 'profile.json'), join(workspace, 'runs/run-1/evidence/outside.json'))
	const changed = structuredClone(candidate)
	changed.evidence[0].path = 'evidence/outside.json'
	await assert.rejects(finalize(workspace, request, changed), /Symlink/)
})
test('renderer escapes content and detects changed generated views', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p),
		request = executeRequest(p, r)
	const candidate = await observation(workspace, request, r.plan)
	candidate.tests[0].observed = '<script>alert(1)</script> ```'
	const saved = await finalize(workspace, request, candidate)
	const html = await readFile(join(workspace, 'runs/run-1/report.html'), 'utf8')
	assert(!html.includes('<script>'))
	assert(html.includes('&lt;script&gt;'))
	await writeFile(join(workspace, 'runs/run-1/report.md'), 'changed')
	await assert.rejects(reports(workspace, saved.artifact), /differs/)
})
test('concurrent immutable writes have one winner', async (t) => {
	const workspace = await sandbox(t)
	const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => publish(workspace, 'one.json', { i })))
	assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
})

test('global blockers and deferred gaps retain uncovered scope', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace)
	const plan = structuredClone(p.plan)
	plan.gaps.push({
		id: 'global',
		severity: 'blocking',
		status: 'open',
		requirementIds: [],
		testIds: [],
		question: 'Access?',
		consequence: 'Cannot reach target.',
		decisionId: null,
	})
	plan.tests[0].readiness = 'blocked'
	plan.coverage = planCoverage(plan)
	assert.equal(planCheck(plan).coverage[0].status, 'blocked')
})

test('prerequisites cannot be omitted or reported as passed after failure', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	r.plan.tests[1].dependsOn = ['T1']
	const reference = await publish(workspace, 'dependent-plan.json', r.plan)
	const request = executeRequest(p, { reference })
	assert.equal((await gate(workspace, { ...request, selectedTestIds: ['T2'] })).status, 'needs_decision')
	const candidate = await observation(workspace, request, r.plan)
	candidate.tests[0].outcome = 'error'
	candidate.tests[0].reason = 'Browser failed.'
	candidate.completion = 'operational_error'
	await assert.rejects(finalize(workspace, request, candidate), /Prerequisite/)
})

test('changed inputs and missing evidence prevent finalization', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r)
	const candidate = await observation(workspace, request, r.plan)
	candidate.evidence[0].path = 'evidence/missing.txt'
	await assert.rejects(finalize(workspace, request, candidate), { code: 'ENOENT' })
	await writeFile(join(workspace, p.target.path), '{}')
	await assert.rejects(gate(workspace, request), /digest/)
})

test('run IDs remain unique across output directories', async (t) => {
	const workspace = await sandbox(t),
		p = await prepare(workspace),
		r = await revised(workspace, p)
	const request = executeRequest(p, r)
	await beginRun(workspace, request)
	await assert.rejects(beginRun(workspace, { ...request, outputDirectory: 'another/run-1' }), { code: 'EEXIST' })
})
