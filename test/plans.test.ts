import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlanCandidate } from '../plugin/src/types.ts'
import {
	answerGap,
	approvePlan,
	diffPlan,
	gate,
	openPlan,
	planRevision,
	rejectPlan,
	revisePlan,
	savePlan,
	showPending,
	showPlanRequest,
} from '../plugin/src/plans.ts'
import { planDetail, planHistory } from '../plugin/src/views.ts'
import { actor, approved, candidate, plan, planRequest, promotionDelta, revised, store, target } from './support.ts'

function withG3(): PlanCandidate {
	const value = candidate()
	value.gaps.push({
		id: 'G3',
		severity: 'non_blocking',
		status: 'open',
		requirementIds: [],
		testIds: ['T2'],
		question: 'Should the quote show the promotion name?',
		consequence: 'The label is not checked.',
		decisionId: null,
	})
	return value
}

const gateInput = { reference: 'checkout@2', tests: ['T1', 'T2'], build: 'build-1' }

test('plan save builds revision 1 with readiness, gap IDs, and coverage', (t) => {
	const opened = store(t)
	target(opened)
	const saved = plan(opened)
	assert.equal(saved.status, 'needs_decision')
	assert.equal(saved.subject, 'checkout@1')
	assert.deepEqual(saved.reasons, [
		'G1: Does the promotion stack with loyalty?',
		'G2: Which orders qualify for refunds?',
	])
	const { plan: snapshot, sha256 } = planRevision(opened, 'checkout', 1)
	assert.equal(saved.data.sha256, sha256)
	assert.deepEqual(
		snapshot.tests.map((test) => [test.id, test.readiness, test.gapIds]),
		[
			['T1', 'ready', []],
			['T2', 'blocked', ['G1']],
			['T3', 'blocked', ['G2']],
		]
	)
	assert.deepEqual(
		snapshot.coverage.map((row) => row.status),
		['planned', 'blocked', 'blocked']
	)
	assert.deepEqual(snapshot.target.revision, 1)
	assert.equal(snapshot.objective, planRequest().objective)
	assert.throws(() => savePlan(opened, actor, { planId: 'checkout', candidate: candidate() }), /has revision 1/)
	assert.equal(showPlanRequest(opened, 'checkout').data.target, 'checkout-local@1')
})

test('plan open needs an existing target revision and refuses a different second request', (t) => {
	const opened = store(t)
	target(opened)
	const request = planRequest()
	assert.throws(
		() => openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@2', request }),
		/Unknown target profile: checkout-local@2/
	)
	assert.throws(
		() => openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local', request }),
		/Name the target revision/
	)
	assert.throws(
		() => openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: { objective: 'x' } }),
		/Invalid plan-request/
	)
	assert.equal(
		openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request }).data.recorded,
		true
	)
	assert.equal(
		openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request }).data.recorded,
		false
	)
	assert.throws(
		() =>
			openPlan(opened, actor, {
				planId: 'checkout',
				target: 'checkout-local@1',
				request: { ...request, objective: 'Another objective.' },
			}),
		/open with another request/
	)
	assert.throws(() => savePlan(opened, actor, { planId: 'other', candidate: candidate() }), /Unknown plan: other/)
})

test('plan save refuses candidates that break the plan rules', (t) => {
	const opened = store(t)
	target(opened)
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: planRequest() })
	const refuse = (change: (value: PlanCandidate) => void, pattern: RegExp) => {
		const value = candidate()
		change(value)
		assert.throws(() => savePlan(opened, actor, { planId: 'checkout', candidate: value }), pattern)
	}
	refuse((value) => (value.tests[0].assertions = []), /Ready test T1 needs one or more assertions/)
	refuse((value) => (value.tests[0].capability = 'mobile'), /needs capability mobile, which the target lacks/)
	refuse((value) => (value.tests[0].operations = ['delete_orders']), /operation delete_orders/)
	refuse((value) => {
		value.tests.pop()
		value.gaps[1].requirementIds = ['R2']
		value.gaps[1].testIds = []
	}, /Requirement R3 has no test or gap/)
	refuse((value) => (value.gaps[0].status = 'resolved'), /Gap G1 needs a matching decision/)
	refuse(
		(value) => value.tests[0].assertions.push({ ...value.tests[0].assertions[0], check: 'Other check.' }),
		/Duplicate assertion in test T1: A1/
	)
	refuse((value) => (value.tests[1].dependsOn = ['T9']), /Unknown dependency of test T2: T9/)
	refuse((value) => (value.tests[1].dependsOn = ['checkout:T1']), /Use the local test ID, not checkout:T1/)
	refuse(
		(value) => (value.tests[0].dependsOn = ['T2']),
		/Test dependency cycle: checkout:T1 -> checkout:T2 -> checkout:T1/
	)
	refuse((value) => Object.assign(value.tests[0], { readiness: 'ready' }), /Invalid plan-candidate/)
	refuse((value) => (value.tests[0].title = ''), /Invalid plan-candidate/)
	assert.throws(() => planRevision(opened, 'checkout'), /has no revision/)
})

test('gap answer records one pending decision for an open gap of the latest revision', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	const answer = (input: Partial<Parameters<typeof answerGap>[2]>) =>
		answerGap(opened, actor, {
			planId: 'checkout',
			gapId: 'G1',
			kind: 'clarify',
			value: 'Promotion replaces loyalty.',
			source: 'decisions#1',
			rationale: 'Product decision.',
			...input,
		})
	assert.throws(() => answer({ gapId: 'G9' }), /Unknown gap G9 in checkout@1/)
	assert.throws(() => answer({ source: null }), /A clarification needs a source/)
	assert.throws(() => answer({ kind: 'guess' }), /Invalid decision kind \(--kind\): guess/)
	assert.throws(() => answer({ rationale: ' ' }), /Missing rationale/)
	assert.throws(() => answer({ expectSha256: 'deadbeef' }), /checkout@1 has digest .* not deadbeef/)
	const sha256 = planRevision(opened, 'checkout').sha256
	assert.equal(answer({ expectSha256: sha256.slice(0, 8) }).status, 'completed')
	assert.throws(() => answer({}), /Gap G1 has a pending decision/)
	assert.equal(planDetail(opened, 'checkout').pendingDecisions.length, 1)
	const pending = showPending(opened, 'checkout').data
	assert.deepEqual(
		(pending.tests as Array<{ id: string }>).map((test) => test.id),
		['T2']
	)
	assert.deepEqual(
		(pending.gaps as Array<{ id: string }>).map((gap) => gap.id),
		['G1']
	)
})

test('plan revise applies decisions and an assertion delta to affected tests', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened, 'checkout', withG3())
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G1',
		kind: 'accept_assumption',
		value: 'Promotion replaces loyalty.',
		rationale: 'Assumed for this build.',
	})
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G2',
		kind: 'defer',
		value: 'Later.',
		rationale: 'Out of scope.',
	})
	const reply = revisePlan(opened, actor, {
		planId: 'checkout',
		delta: {
			tests: {
				T2: {
					preconditions: ['Cart with 20 PLN loyalty.'],
					assertions: {
						A1: { check: 'The response status is HTTP 200 OK.' },
						A2: { check: 'totalPLN equals 240.', oracleKind: 'deterministic' },
					},
				},
			},
		},
	})
	assert.equal(reply.status, 'completed')
	assert.equal(reply.subject, 'checkout@2')
	const next = planRevision(opened, 'checkout').plan
	assert.equal(next.previousRevision, 1)
	assert.deepEqual(
		next.tests.map((test) => test.readiness),
		['ready', 'ready', 'deferred']
	)
	assert.deepEqual(next.tests[1].assertions, [
		{ id: 'A1', check: 'The response status is HTTP 200 OK.', oracleKind: 'deterministic' },
		{ id: 'A2', check: 'totalPLN equals 240.', oracleKind: 'deterministic' },
	])
	assert.deepEqual(next.tests[1].preconditions, ['Cart with 20 PLN loyalty.'])
	assert.deepEqual(
		next.gaps.map((gap) => gap.status),
		['resolved', 'deferred', 'open']
	)
	assert.deepEqual(next.assumptions, [{ decisionId: next.decisions[0].id, text: 'Promotion replaces loyalty.' }])
	assert.deepEqual(reply.data.applied, [next.decisions[0].id, next.decisions[1].id])
	assert.deepEqual(
		opened.db
			.prepare('SELECT applied_revision FROM decisions ORDER BY rowid')
			.all()
			.map((row) => row.applied_revision),
		[2, 2]
	)
	assert.deepEqual(diffPlan(opened, { planId: 'checkout', from: '1', to: '2' }).data.changes, [
		'T2 preconditions: ["Cart with 400 PLN and 20 PLN loyalty."] → ["Cart with 20 PLN loyalty."]',
		'T2 readiness: "blocked" → "ready"',
		'T2.A1 check: "The response status is HTTP 200." → "The response status is HTTP 200 OK."',
		'T2.A2 added: "totalPLN equals 240."',
		'T3 readiness: "blocked" → "deferred"',
		`G1 decisionId: null → "${next.decisions[0].id}"`,
		'G1 status: "open" → "resolved"',
		`G2 decisionId: null → "${next.decisions[1].id}"`,
		'G2 status: "open" → "deferred"',
		`decision ${next.decisions[0].id} accept_assumption G1: "Promotion replaces loyalty."`,
		`decision ${next.decisions[1].id} defer G2: "Later."`,
		`assumption ${next.decisions[0].id}: "Promotion replaces loyalty."`,
		'R2 coverage: "blocked" → "planned"',
		'R3 coverage: "blocked" → "deferred"',
	])
	const patch = diffPlan(opened, { planId: 'checkout', from: '1', to: '2' }).data.patch as Array<{ path: string }>
	assert(patch.some((operation) => operation.path === '/tests/1/assertions/1'))
	assert.deepEqual(
		planHistory(opened, 'checkout').map((row) => [row.revision, row.actor, row.changes.length > 0]),
		[
			[1, actor, false],
			[2, actor, true],
		]
	)
})

test('plan revise refuses deltas outside the decided scope', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened, 'checkout', withG3())
	const delta = (tests: Record<string, unknown>) =>
		revisePlan(opened, actor, { planId: 'checkout', delta: { tests } })
	assert.throws(() => delta({}), /Plan checkout has no pending decision/)
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G1',
		kind: 'clarify',
		value: 'Promotion replaces loyalty.',
		source: 'decisions#1',
		rationale: 'Product.',
	})
	assert.throws(() => delta({ T1: { action: 'Other action.' } }), /Test T1 is not affected by a pending decision/)
	assert.throws(() => delta({ T9: { action: 'x' } }), /Unknown test in delta: T9/)
	assert.throws(() => delta({ T2: { title: 'New title' } }), /Invalid plan-delta/)
	assert.throws(() => delta({ T2: {} }), /Invalid plan-delta/)
	assert.throws(() => delta({ T2: { assertions: { A7: null } } }), /Cannot remove unknown assertion T2.A7/)
	assert.throws(
		() => delta({ T2: { assertions: { A2: { check: 'x' } } } }),
		/New assertion T2.A2 needs check and oracleKind/
	)
	assert.throws(() => delta({ T2: { assertions: { A1: null } } }), /Ready test T2 needs one or more assertions/)
	assert.throws(
		() => revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} }, expectSha256: '00000000' }),
		/has digest/
	)
	assert.equal(
		delta({ T2: { assertions: { A1: null, A2: { check: 'totalPLN equals 240.', oracleKind: 'deterministic' } } } })
			.status,
		'needs_decision'
	)
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G3',
		kind: 'clarify',
		value: 'Show the name.',
		source: 'decisions#2',
		rationale: 'Product.',
	})
	assert.throws(
		() => delta({ T2: { assertions: { A1: { check: 'Again.', oracleKind: 'deterministic' } } } }),
		/Assertion ID T2.A1 was used in an earlier revision/
	)
	assert.equal(planRevision(opened, 'checkout').plan.revision, 2)
})

test('a concurrent revise from a second connection is refused', (t) => {
	const first = store(t)
	const second = store(t, first.workspace)
	target(first)
	plan(first)
	answerGap(first, actor, {
		planId: 'checkout',
		gapId: 'G1',
		kind: 'clarify',
		value: 'Promotion replaces loyalty.',
		source: 'decisions#1',
		rationale: 'Product.',
	})
	const base = planRevision(second, 'checkout').sha256
	assert.equal(revisePlan(first, actor, { planId: 'checkout', delta: promotionDelta }).subject, 'checkout@2')
	assert.throws(
		() => revisePlan(second, actor, { planId: 'checkout', delta: promotionDelta, expectSha256: base }),
		/checkout@2 has digest/
	)
	assert.throws(() => revisePlan(second, actor, { planId: 'checkout', delta: promotionDelta }), /no pending decision/)
	assert.throws(
		() =>
			second.db.exec(
				`INSERT INTO plan_revisions (plan_id, revision, previous_revision, sha256, body, operation_id) SELECT plan_id, revision, previous_revision, sha256, body, operation_id FROM plan_revisions WHERE revision = 2`
			),
		/UNIQUE constraint failed: plan_revisions.plan_id, plan_revisions.revision/
	)
})

test('the gate needs an approval of the exact revision, and a new revision needs a new approval', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened, 'checkout', withG3())
	revised(opened)
	assert.deepEqual(gate(opened, gateInput).reply.reasons, ['Plan checkout@2 is not approved'])
	rejectPlan(opened, actor, { reference: 'checkout@2', rationale: 'Not yet.' })
	assert.equal(planDetail(opened, 'checkout').approval.state, 'rejected')
	assert.deepEqual(gate(opened, gateInput).reply.reasons, ['Plan checkout@2 is not approved'])
	assert.throws(
		() => approvePlan(opened, actor, { reference: 'checkout@2', rationale: 'Ok.', expectSha256: 'abcdef12' }),
		/checkout@2 has digest/
	)
	assert.throws(
		() => approvePlan(opened, actor, { reference: 'checkout', rationale: 'Ok.' }),
		/Name the plan revision/
	)
	assert.throws(() => approvePlan(opened, actor, { reference: 'checkout@2', rationale: '' }), /Missing rationale/)
	approved(opened)
	assert.equal(planDetail(opened, 'checkout').approval.state, 'approved')
	assert.equal(gate(opened, gateInput).reply.status, 'completed')
	answerGap(opened, actor, {
		planId: 'checkout',
		gapId: 'G3',
		kind: 'defer',
		value: 'Later.',
		rationale: 'Not needed now.',
	})
	revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	assert.deepEqual(gate(opened, { ...gateInput, reference: 'checkout@3' }).reply.reasons, [
		'Plan checkout@3 is not approved',
		'Test is not ready: T2',
	])
	approved(opened, 'checkout', 3)
	assert.deepEqual(gate(opened, { ...gateInput, reference: 'checkout@3' }).reply.reasons, ['Test is not ready: T2'])
})

test('the gate collects every reason in order', (t) => {
	const opened = store(t)
	target(opened, { readyForLiveExecution: false, approvals: { plan: 'none', result: 'none' } })
	plan(opened)
	const checked = gate(opened, { reference: 'checkout@1', tests: ['T2', 'T3'], build: 'b' })
	assert.deepEqual(checked.reply.reasons, [
		'Target prerequisites are not ready: checkout-local@1',
		'Open blocking gap: G1',
		'Open blocking gap: G2',
		'Test is not ready: T2',
		'Missing prerequisite: T1',
		'Test is not ready: T3',
		'Test has no assertions: T3',
	])
	const partial = gate(opened, { reference: 'checkout@1', tests: ['T1'], build: 'b', partial: 'ready_only' })
	assert.deepEqual(partial.reply.reasons, ['Target prerequisites are not ready: checkout-local@1'])
	assert.throws(
		() => gate(opened, { reference: 'checkout@1', tests: ['T9'], build: 'b' }),
		/Unknown test in checkout@1: T9/
	)
	assert.throws(() => gate(opened, { reference: 'checkout@1', tests: [], build: 'b' }), /Select one or more tests/)
	assert.throws(
		() => gate(opened, { reference: 'checkout@1', tests: ['T1'], build: 'b', partial: 'run_ready' }),
		/Invalid partial execution/
	)
})

test('editing preserves old plans, derives coverage, and requires a fresh digest', async (t) => {
	const { editPlan } = await import('../plugin/src/plans.ts')
	const opened = store(t)
	target(opened)
	plan(opened)
	const before = planRevision(opened, 'checkout')
	const tests = structuredClone(before.plan.tests)
	tests[0].title = 'Revised title'
	tests[0].requirementIds = ['R1', 'R2']
	const requirements = structuredClone(before.plan.requirements)
	requirements[0].text = 'The reviewed requirement.'
	const input = {
		planId: 'checkout',
		expectSha256: before.sha256,
		objective: 'Reviewed objective.',
		requirements,
		tests,
	}
	const reply = editPlan(opened, actor, input)
	assert.equal(reply.subject, 'checkout@2')
	const after = planRevision(opened, 'checkout')
	assert.equal(after.plan.objective, 'Reviewed objective.')
	assert.equal(after.plan.requirements[0].text, 'The reviewed requirement.')
	assert(after.plan.coverage.find((row) => row.requirementId === 'R2')!.testIds.includes('T1'))
	assert.deepEqual(planRevision(opened, 'checkout', 1), before)
	assert.equal(planDetail(opened, 'checkout').approval.state, 'pending')
	assert.throws(() => editPlan(opened, actor, input), /changed|digest/i)
	assert.throws(
		() =>
			editPlan(opened, actor, {
				...input,
				expectSha256: after.sha256,
				tests: [{ ...tests[0], requirementIds: ['missing'] }, ...tests.slice(1)],
			}),
		/Unknown requirement/i
	)
	assert.equal(planRevision(opened, 'checkout').plan.revision, 2)
	assert(planHistory(opened, 'checkout')[1].changes.some((line) => line.startsWith('objective:')))
	assert.deepEqual(planHistory(opened, 'checkout', 1), planHistory(opened, 'checkout').slice(-1))
	answerGap(opened, actor, { planId: 'checkout', gapId: 'G1', kind: 'defer', value: 'Later', rationale: 'Scope' })
	assert.throws(() => editPlan(opened, actor, { ...input, expectSha256: after.sha256 }), /pending gap decisions/)
})

test('editing cannot reuse a retired assertion ID', async (t) => {
	const { editPlan } = await import('../plugin/src/plans.ts')
	const opened = store(t)
	target(opened)
	plan(opened)
	const original = planRevision(opened, 'checkout')
	const tests = structuredClone(original.plan.tests)
	tests[0].assertions[0].id = 'A99'
	editPlan(opened, actor, {
		planId: 'checkout',
		expectSha256: original.sha256,
		objective: original.plan.objective,
		requirements: original.plan.requirements,
		tests,
	})
	const current = planRevision(opened, 'checkout')
	assert.throws(
		() =>
			editPlan(opened, actor, {
				planId: 'checkout',
				expectSha256: current.sha256,
				objective: original.plan.objective,
				requirements: original.plan.requirements,
				tests: original.plan.tests,
			}),
		/earlier revision/
	)
})
