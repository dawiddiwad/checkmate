import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import type { Ui } from '../cli/src/ui/server.ts'
import { startUi } from '../cli/src/ui/server.ts'
import {
	answerGap,
	approvePlan,
	editPlan,
	gate,
	planRevision,
	rejectPlan,
	revisePlan,
	showPending,
} from '../plugin/src/plans.ts'
import { acceptResult, beginRun, closeTest, finishRun, rejectResult, runResult } from '../plugin/src/runs.ts'
import { planDetail, runDetail } from '../plugin/src/views.ts'
import {
	actor,
	candidate,
	check,
	cli,
	json,
	passRun,
	plan,
	planRequest,
	promotionDelta,
	ready,
	store,
	target,
} from './support.ts'

const reviewer = 'Reviewer-Rae'
const rejectedPlan = 'The discount assertion must check the final charged total.'
const rejectedRun = 'The screenshot does not show the submitted order confirmation.'

function includes(output: string, values: string[]) {
	for (const value of values) assert(output.includes(value), `Missing ${JSON.stringify(value)} in output`)
}

test('plan rejection rationale survives full and filtered CLI reads', (t) => {
	const opened = store(t)
	ready(opened)
	const { sha256 } = planRevision(opened, 'checkout', 2)
	rejectPlan(opened, reviewer, { reference: 'checkout@2', rationale: rejectedPlan, expectSha256: sha256 })
	for (const selection of [[], ['--tests', 'T1'], ['--fields', 'action,assertions']]) {
		const args = ['plan', 'show', 'checkout@2', ...selection]
		const structured = json(opened.workspace, args)
		assert.equal(structured.code, 0)
		assert.equal(structured.body.approval.state, 'rejected')
		assert.equal(structured.body.approval.latest.rationale, rejectedPlan)
		assert.equal(structured.body.approval.latest.actor, reviewer)
		const compact = cli(opened.workspace, args)
		assert.equal(compact.code, 0)
		includes(compact.output, ['rejected', rejectedPlan, reviewer])
	}
})

test('plan reject and reapprove affect execution gates without changing the approved snapshot', (t) => {
	const opened = store(t)
	ready(opened)
	const before = planRevision(opened, 'checkout', 2)
	const input = { reference: 'checkout@2', tests: ['T1'], build: 'build-1' }
	rejectPlan(opened, reviewer, { reference: input.reference, rationale: rejectedPlan })
	const blocked = gate(opened, input).reply
	assert.equal(blocked.status, 'needs_decision')
	includes(blocked.reasons.join('\n'), ['not approved', rejectedPlan])
	assert.throws(
		() =>
			approvePlan(opened, reviewer, {
				reference: input.reference,
				rationale: 'Checked again.',
				expectSha256: '0'.repeat(64),
			}),
		/digest/i
	)
	assert.equal(planDetail(opened, 'checkout', 2).approval.state, 'rejected')
	approvePlan(opened, reviewer, {
		reference: input.reference,
		rationale: 'The assertion is sufficient.',
		expectSha256: before.sha256,
	})
	assert.equal(gate(opened, input).reply.status, 'completed')
	assert.deepEqual(planRevision(opened, 'checkout', 2), before)
	editPlan(opened, actor, {
		planId: 'checkout',
		expectSha256: before.sha256,
		objective: `${before.plan.objective} Include review feedback.`,
		requirements: before.plan.requirements,
		tests: before.plan.tests,
	})
	assert.equal(planDetail(opened, 'checkout', 2).approval.state, 'approved')
	assert.equal(planDetail(opened, 'checkout', 3).approval.state, 'pending')
	assert.equal(gate(opened, { ...input, reference: 'checkout@3' }).reply.status, 'needs_decision')
})

test('result accept, reject, and reaccept retain the latest rationale and immutable evidence', (t) => {
	const opened = store(t)
	ready(opened)
	passRun(opened, 'reviewed-run', 'build-1')
	const before = runResult(opened, 'reviewed-run')!
	const verdicts = [
		{ decide: acceptResult, state: 'approved', rationale: 'Initial review accepted the evidence.' },
		{ decide: rejectResult, state: 'rejected', rationale: rejectedRun },
		{
			decide: acceptResult,
			state: 'approved',
			rationale: 'Review confirmed the attached confirmation was correct.',
		},
	]
	for (const { decide, state, rationale } of verdicts) {
		decide(opened, reviewer, { runId: 'reviewed-run', rationale, expectSha256: before.sha256 })
		const detail = runDetail(opened, 'reviewed-run')
		assert.equal(detail.result!.acceptance, state)
		assert.equal(detail.result!.latestDecision!.rationale, rationale)
		assert.equal(detail.result!.latestDecision!.actor, reviewer)
		assert.equal(detail.result!.latestDecision!.sha256, before.sha256)
		const structured = json(opened.workspace, ['run', 'show', 'reviewed-run'])
		assert.equal(structured.body.result.latestDecision.rationale, rationale)
		includes(cli(opened.workspace, ['run', 'show', 'reviewed-run']).output, [state, rationale, reviewer])
		assert.deepEqual(runResult(opened, 'reviewed-run'), before)
	}
	assert.equal(
		opened.db
			.prepare(
				"SELECT COUNT(*) AS count FROM approvals WHERE subject_kind = 'result' AND subject_id = 'reviewed-run'"
			)
			.get()!.count,
		3
	)
	assert.throws(
		() =>
			rejectResult(opened, reviewer, {
				runId: 'reviewed-run',
				rationale: rejectedRun,
				expectSha256: '0'.repeat(64),
			}),
		/digest/i
	)
	assert.equal(runDetail(opened, 'reviewed-run').result!.acceptance, 'approved')
})

test('retest reads retain the original run link and rejected run reason', (t) => {
	const opened = store(t)
	ready(opened)
	passRun(opened, 'original-run', 'build-1')
	rejectResult(opened, reviewer, { runId: 'original-run', rationale: rejectedRun })
	const reply = beginRun(opened, actor, {
		runId: 'followup-run',
		reference: 'checkout@2',
		tests: ['T1'],
		build: 'build-2',
		retestOf: 'original-run',
	})
	assert.equal(reply.status, 'completed')
	assert.equal(json(opened.workspace, ['run', 'show', 'followup-run']).body.request.retestOf, 'original-run')
	includes(cli(opened.workspace, ['run', 'show', 'followup-run']).output, ['retestOf=original-run'])
	includes(cli(opened.workspace, ['run', 'show', 'original-run']).output, [rejectedRun, reviewer])
})

for (const kind of ['clarify', 'accept_assumption', 'defer'] as const) {
	test(`${kind} gap decisions preserve rationale, actor, and source before and after revision`, (t) => {
		const opened = store(t)
		target(opened)
		plan(opened)
		const base = planRevision(opened, 'checkout', 1)
		const rationale = `Review rationale for ${kind}.`
		const source = kind === 'clarify' ? 'review://promotion-policy' : null
		const value = kind === 'defer' ? 'Skip promotion checks in this scope.' : 'The promotion replaces loyalty.'
		answerGap(opened, reviewer, {
			planId: 'checkout',
			gapId: 'G1',
			kind,
			value,
			source,
			rationale,
			expectSha256: base.sha256,
		})
		const pending = showPending(opened, 'checkout').data.decisions as Array<{
			rationale: string
			actor: string
			source: string | null
		}>
		assert.equal(pending.length, 1)
		assert.equal(pending[0].rationale, rationale)
		assert.equal(pending[0].actor, reviewer)
		assert.equal(pending[0].source, source)
		assert.equal(planRevision(opened, 'checkout', 1).plan.gaps[0].status, 'open')
		for (const args of [
			['plan', 'pending', 'checkout'],
			['plan', 'show', 'checkout@1'],
		]) {
			const data = json(opened.workspace, args).body
			const decisions = data.pendingDecisions ?? data.decisions
			assert.equal(decisions[0].rationale, rationale)
			assert.equal(decisions[0].source, source)
			includes(cli(opened.workspace, args).output, [value, rationale, reviewer, ...(source ? [source] : [])])
		}
		assert.throws(
			() => answerGap(opened, reviewer, { planId: 'checkout', gapId: 'G1', kind, value, source, rationale }),
			/pending/i
		)
		revisePlan(opened, actor, {
			planId: 'checkout',
			delta: kind === 'defer' ? { tests: {} } : promotionDelta,
			expectSha256: base.sha256,
		})
		const revised = planRevision(opened, 'checkout', 2)
		assert.equal(revised.plan.gaps[0].status, kind === 'defer' ? 'deferred' : 'resolved')
		assert.equal(
			revised.plan.tests.find((item) => item.id === 'T2')!.readiness,
			kind === 'defer' ? 'deferred' : 'ready'
		)
		assert.equal(revised.plan.decisions[0].rationale, rationale)
		assert.equal(revised.plan.decisions[0].actor, reviewer)
		assert.equal(revised.plan.decisions[0].source, source)
		assert.equal(planDetail(opened, 'checkout', 2).pendingDecisions.length, 0)
		includes(cli(opened.workspace, ['plan', 'show', 'checkout@2']).output, [
			value,
			rationale,
			reviewer,
			...(source ? [source] : []),
		])
		assert.deepEqual(planRevision(opened, 'checkout', 1), base)
		assert.throws(
			() =>
				answerGap(opened, reviewer, {
					planId: 'checkout',
					gapId: 'G2',
					kind,
					value,
					source,
					rationale,
					expectSha256: base.sha256,
				}),
			/digest/i
		)
		assert.throws(
			() => answerGap(opened, reviewer, { planId: 'checkout', gapId: 'G1', kind, value, source, rationale }),
			/Only an open gap takes a decision/i
		)
	})
}

test('rejecting a previously accepted prerequisite blocks dependent runs with the reviewer reason', (t) => {
	const opened = store(t)
	target(opened)
	const request = planRequest()
	request.requirements = request.requirements.slice(0, 1)
	const prerequisite = candidate()
	prerequisite.tests = prerequisite.tests.slice(0, 1)
	prerequisite.gaps = []
	plan(opened, 'prerequisite', prerequisite, request)
	approvePlan(opened, actor, { reference: 'prerequisite@1', rationale: 'Ready for review.' })
	const dependent = structuredClone(prerequisite)
	dependent.tests[0].dependsOn = ['prerequisite:T1']
	plan(opened, 'dependent', dependent, request)
	approvePlan(opened, actor, { reference: 'dependent@1', rationale: 'Ready for review.' })
	assert.equal(
		beginRun(opened, actor, {
			runId: 'prerequisite-run',
			reference: 'prerequisite@1',
			tests: ['T1'],
			build: 'build-1',
		}).status,
		'completed'
	)
	for (const assertion of ['T1.A1', 'T1.A2']) check(opened, 'prerequisite-run', assertion, 'passed')
	closeTest(opened, actor, { runId: 'prerequisite-run', testId: 'T1' })
	finishRun(opened, actor, {
		runId: 'prerequisite-run',
		completion: 'completed',
		cleanup: 'not_applicable',
		cleanupReason: 'No state.',
	})
	const input = { reference: 'dependent@1', tests: ['T1'], build: 'build-1' }
	assert.equal(gate(opened, input).reply.status, 'needs_decision')
	acceptResult(opened, reviewer, { runId: 'prerequisite-run', rationale: 'Verified the prerequisite.' })
	assert.equal(gate(opened, input).reply.status, 'completed')
	rejectResult(opened, reviewer, { runId: 'prerequisite-run', rationale: rejectedRun })
	const blocked = gate(opened, input).reply
	assert.equal(blocked.status, 'needs_decision')
	includes(blocked.reasons.join('\n'), ['not accepted', rejectedRun])
	acceptResult(opened, reviewer, { runId: 'prerequisite-run', rationale: 'Verified the evidence again.' })
	assert.equal(gate(opened, input).reply.status, 'completed')
})

function call(ui: Ui, path: string, form?: Record<string, string>): Promise<{ status: number; body: string }> {
	const body = form ? new URLSearchParams(form).toString() : undefined
	return new Promise((resolve, reject) => {
		const req = request(
			new URL(path, ui.url),
			{
				method: form ? 'POST' : 'GET',
				headers: {
					Cookie: `checkmate_actor=${reviewer}`,
					...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk) => chunks.push(chunk))
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
			}
		)
		req.on('error', reject)
		req.end(body)
	})
}

function field(html: string, name: string) {
	const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)
	assert(match, `Missing form field ${name}`)
	return match[1]
}

test('UI plan and run reviews preserve reasons and actors through confirmation and later CLI reads', async (t) => {
	const opened = store(t)
	ready(opened)
	passRun(opened, 'ui-run', 'build-1')
	const ui = await startUi({ workspace: opened.workspace })
	t.after(() => ui.close())
	for (const review of [
		{
			path: '/plans/checkout@2',
			args: ['plan', 'show', 'checkout@2'],
			verdicts: ['reject', 'approve'],
			reason: rejectedPlan,
		},
		{ path: '/runs/ui-run', args: ['run', 'show', 'ui-run'], verdicts: ['reject', 'accept'], reason: rejectedRun },
	]) {
		for (const verdict of review.verdicts) {
			const page = await call(ui, review.path)
			assert.equal(page.status, 200)
			const rationale = `${verdict}: ${review.reason}`
			const before = json(opened.workspace, review.args).body
			const form = {
				csrf: field(page.body, 'csrf'),
				sha: before.sha256 ?? before.result.sha256,
				verdict,
				rationale,
			}
			const confirmation = await call(ui, review.path, form)
			assert.equal(confirmation.status, 200)
			includes(confirmation.body, [rationale, reviewer])
			assert.deepEqual(json(opened.workspace, review.args).body, before)
			const saved = await call(ui, review.path, { ...form, confirmed: '1' })
			assert.equal(saved.status, 303)
			const data = json(opened.workspace, review.args).body
			const decision = data.approval?.latest ?? data.result.latestDecision
			assert.equal(decision.rationale, rationale)
			assert.equal(decision.actor, reviewer)
			assert.equal(decision.sha256, form.sha)
			includes(cli(opened.workspace, review.args).output, [rationale, reviewer])
			includes((await call(ui, review.path)).body, [rationale, reviewer])
			for (const invalid of [{ sha: '0'.repeat(64) }, { rationale: '' }]) {
				assert.equal((await call(ui, review.path, { ...form, confirmed: '1', ...invalid })).status, 422)
				assert.deepEqual(json(opened.workspace, review.args).body, data)
			}
		}
	}
})

for (const kind of ['clarify', 'accept_assumption', 'defer'] as const) {
	test(`UI ${kind} gap answer remains visible to the caller with its rationale`, async (t) => {
		const opened = store(t)
		target(opened)
		plan(opened)
		const ui = await startUi({ workspace: opened.workspace })
		t.after(() => ui.close())
		const path = '/plans/checkout@1/gaps/G1'
		const page = await call(ui, path)
		assert.equal(page.status, 200)
		const rationale = `Human rationale for ${kind}.`
		const form = {
			csrf: field(page.body, 'csrf'),
			sha: field(page.body, 'sha'),
			kind,
			value: 'Promotion replaces loyalty.',
			source: 'review://promotion',
			rationale,
		}
		assert.equal((await call(ui, path, { ...form, sha: '0'.repeat(64) })).status, 422)
		assert.equal(planDetail(opened, 'checkout', 1).pendingDecisions.length, 0)
		assert.equal((await call(ui, path, { ...form, rationale: '' })).status, 422)
		assert.equal(planDetail(opened, 'checkout', 1).pendingDecisions.length, 0)
		assert.equal((await call(ui, path, form)).status, 303)
		const decision = json(opened.workspace, ['plan', 'pending', 'checkout']).body.decisions[0]
		assert.equal(decision.rationale, rationale)
		assert.equal(decision.actor, reviewer)
		assert.equal(decision.source, kind === 'clarify' ? form.source : null)
		includes(cli(opened.workspace, ['plan', 'pending', 'checkout']).output, [rationale, reviewer])
		includes((await call(ui, '/plans/checkout@1')).body, [rationale, reviewer])
		assert.equal((await call(ui, path, form)).status, 422)
		assert.equal(planDetail(opened, 'checkout', 1).pendingDecisions.length, 1)
	})
}
