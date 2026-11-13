import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlanCandidate } from '../plugin/src/types.ts'
import type { PlanTool } from '../plugin/src/plans.ts'
import {
	answerGap,
	approvePlan,
	diffPlan,
	editPlan,
	gate,
	openPlan,
	patchPlan,
	planCandidate,
	planRevision,
	rejectPlan,
	revisePlan,
	savePlan,
	showPending,
	showPlanRequest,
} from '../plugin/src/plans.ts'
import { beginRun, runState } from '../plugin/src/runs.ts'
import { resultCoverage } from '../plugin/src/contracts.ts'
import { inbox, planDetail, planHistory } from '../plugin/src/views.ts'
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
		/A plan request needs requirements or context sources/
	)
	assert.throws(
		() =>
			openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request: { requirements: [] } }),
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
						A2: { check: 'totalPLN equals 240.', checkKind: 'deterministic' },
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
		{ id: 'A1', check: 'The response status is HTTP 200 OK.', checkKind: 'deterministic' },
		{ id: 'A2', check: 'totalPLN equals 240.', checkKind: 'deterministic' },
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
		/New assertion T2.A2 needs check and checkKind/
	)
	assert.throws(() => delta({ T2: { assertions: { A1: null } } }), /Ready test T2 needs one or more assertions/)
	assert.throws(
		() => revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} }, expectSha256: '00000000' }),
		/has digest/
	)
	assert.equal(
		delta({ T2: { assertions: { A1: null, A2: { check: 'totalPLN equals 240.', checkKind: 'deterministic' } } } })
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
		() => delta({ T2: { assertions: { A1: { check: 'Again.', checkKind: 'deterministic' } } } }),
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
	])
	approved(opened, 'checkout', 3)
	assert.equal(gate(opened, { ...gateInput, reference: 'checkout@3' }).reply.status, 'completed')
})

test('only a deferred blocking gap defers its tests and their requirements', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened, 'checkout', withG3())
	revised(opened)
	answerGap(opened, actor, { planId: 'checkout', gapId: 'G3', kind: 'defer', value: 'Later.', rationale: 'Scope.' })
	revisePlan(opened, actor, { planId: 'checkout', delta: { tests: {} } })
	const third = planRevision(opened, 'checkout', 3).plan
	assert.deepEqual(
		third.gaps.map((gap) => [gap.id, gap.severity, gap.status]),
		[
			['G1', 'blocking', 'resolved'],
			['G2', 'blocking', 'deferred'],
			['G3', 'non_blocking', 'deferred'],
		]
	)
	assert.deepEqual(
		third.tests.map((test) => [test.id, test.readiness]),
		[
			['T1', 'ready'],
			['T2', 'ready'],
			['T3', 'deferred'],
		]
	)
	assert.deepEqual(
		third.coverage.map((row) => [row.requirementId, row.status]),
		[
			['R1', 'planned'],
			['R2', 'planned'],
			['R3', 'deferred'],
		]
	)
	const passed = (testId: string) => ({ testId, outcome: 'passed' as const, reason: null, assertions: [] })
	const coverage = resultCoverage(third, [passed('T1'), passed('T2')], [])
	assert.deepEqual(
		coverage.requirements.map((row) => [row.requirementId, row.status]),
		[
			['R1', 'tested'],
			['R2', 'tested'],
			['R3', 'deferred'],
		]
	)
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

test('ready_only without tests selects the ready tests and lists the tests it leaves out', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	approved(opened, 'checkout', 1)
	const checked = gate(opened, { reference: 'checkout@1', build: 'b', partial: 'ready_only' })
	assert.equal(checked.reply.status, 'completed')
	assert.deepEqual(checked.reply.data.tests, ['T1'])
	assert.deepEqual(checked.reply.data.leftOut, [
		{ testId: 'T2', reason: 'blocked by G1' },
		{ testId: 'T3', reason: 'blocked by G2' },
	])
	const begun = beginRun(opened, actor, {
		runId: 'run-1',
		reference: 'checkout@1',
		build: 'b',
		partial: 'ready_only',
	})
	assert.equal(begun.status, 'completed')
	assert.deepEqual(runState(opened, 'run-1').request.selectedTestIds, ['T1'])
	assert.throws(
		() => gate(opened, { reference: 'checkout@1', build: 'b' }),
		/Select one or more tests with --tests, or add --partial ready_only/
	)
	const chain = candidate()
	chain.gaps[0].requirementIds = []
	chain.gaps[0].testIds = ['T1']
	plan(opened, 'chain', chain)
	const none = gate(opened, { reference: 'chain@1', build: 'b', partial: 'ready_only' })
	assert.deepEqual(none.reply.data.leftOut, [
		{ testId: 'T1', reason: 'blocked by G1' },
		{ testId: 'T2', reason: 'needs T1, which is left out' },
		{ testId: 'T3', reason: 'blocked by G2' },
	])
	assert.deepEqual(none.reply.reasons, ['No test is ready in chain@1', 'Plan chain@1 is not approved'])
	revised(opened)
	approved(opened)
	const deferred = gate(opened, { reference: 'checkout@2', build: 'b', partial: 'ready_only' })
	assert.deepEqual(deferred.reply.data.tests, ['T1', 'T2'])
	assert.deepEqual(deferred.reply.data.leftOut, [{ testId: 'T3', reason: 'deferred by G2' }])
})

test('a request with context sources and no requirements takes drafted requirements that cite a source', (t) => {
	const opened = store(t)
	target(opened)
	const request = {
		objective: 'Verify checkout from the ticket.',
		context: { sources: ['jira:SHOP-12', 'docs/checkout.md'], instructions: 'Read the acceptance criteria.' },
		tools: ['node', { name: 'jira', kind: 'mcp' as const, purpose: 'Read the ticket.' }],
	}
	openPlan(opened, actor, { planId: 'checkout', target: 'checkout-local@1', request })
	const shown = showPlanRequest(opened, 'checkout').data
	assert.deepEqual(shown.requirements, [])
	assert.deepEqual(shown.context, request.context)
	assert.deepEqual(
		(shown.tools as PlanTool[]).map((tool) => [tool.name, tool.kind]),
		[
			['node', 'cli'],
			['jira', 'mcp'],
		]
	)
	const drafted = [
		{ id: 'R1', text: 'A standard order totals 400 PLN.', source: 'jira:SHOP-12#ac-1' },
		{ id: 'R2', text: 'The promotion applies.', source: 'docs/checkout.md#promotion' },
		{ id: 'R3', text: 'Refunds are allowed.', source: 'docs/checkout.md#refunds' },
	]
	const save = (requirements?: typeof drafted) =>
		savePlan(opened, actor, { planId: 'checkout', candidate: { ...candidate(), requirements } })
	assert.throws(
		() => save(),
		/has no requirements. Draft them from the context sources: jira:SHOP-12, docs\/checkout.md/
	)
	assert.throws(
		() => save([...drafted.slice(1), { ...drafted[0], source: 'memory' }]),
		/Requirement R1 cites memory, which is not a context source/
	)
	assert.equal(save(drafted).status, 'needs_decision')
	assert.deepEqual(planRevision(opened, 'checkout').plan.requirements, drafted)
})

test('a request needs known tool names and refuses drafted requirements when it names requirements', (t) => {
	const opened = store(t)
	target(opened)
	const open = (planId: string, tools: unknown[]) =>
		openPlan(opened, actor, { planId, target: 'checkout-local@1', request: { ...planRequest(), tools } })
	assert.throws(() => open('a', ['jira']), /Unknown tool jira. The target profile has: playwright-cli, node/)
	assert.throws(
		() => open('a', [{ name: 'node', kind: 'cli', purpose: 'x' }]),
		/Tool node is in the target profile. Name it as a string/
	)
	assert.throws(() => open('a', ['node', 'node']), /Invalid plan-request|Duplicate tool name/)
	open('b', ['playwright-cli'])
	assert.deepEqual(
		(showPlanRequest(opened, 'b').data.tools as PlanTool[]).map((tool) => tool.name),
		['playwright-cli']
	)
	open('c', [])
	assert.deepEqual(
		(showPlanRequest(opened, 'c').data.tools as PlanTool[]).map((tool) => tool.name),
		['playwright-cli', 'node']
	)
	assert.throws(
		() =>
			savePlan(opened, actor, {
				planId: 'c',
				candidate: { ...candidate(), requirements: planRequest().requirements },
			}),
		/The plan request names the requirements/
	)
})

test('plan edit changes an unapproved latest revision in place and records the operation', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	const before = planRevision(opened, 'checkout')
	const content = planCandidate(before.plan)
	content.tests[0].title = 'Standard order total, edited'
	content.requirements[0].text = 'A standard order totals 400 PLN.'
	assert.throws(
		() => editPlan(opened, 'reviewer', { reference: 'checkout@1', candidate: content, expectSha256: 'ffffffff' }),
		/checkout@1 has digest [a-f0-9]{64}, not ffffffff/
	)
	const edited = editPlan(opened, 'reviewer', {
		reference: 'checkout@1',
		candidate: content,
		expectSha256: before.sha256.slice(0, 8),
	})
	assert.equal(edited.status, 'needs_decision')
	assert.deepEqual(
		[edited.subject, edited.data.edit, edited.data.previousSha256],
		['checkout@1', 'in_place', before.sha256]
	)
	const after = planRevision(opened, 'checkout', 1)
	assert.notEqual(after.sha256, before.sha256)
	assert.equal(after.sha256, edited.data.sha256)
	assert.equal(after.plan.tests[0].title, 'Standard order total, edited')
	assert.equal(after.plan.requirements[0].text, 'A standard order totals 400 PLN.')
	assert.deepEqual(
		planHistory(opened, 'checkout').map((row) => [row.revision, row.actor]),
		[[1, 'reviewer']]
	)
	const log = opened.db
		.prepare("SELECT actor, status FROM operations WHERE command = 'plan edit' ORDER BY rowid")
		.all()
	assert.deepEqual(
		log.map((row) => [row.actor, row.status]),
		[
			['reviewer', 'rejected'],
			['reviewer', 'needs_decision'],
		]
	)
	assert.throws(
		() => approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'Ok.', expectSha256: before.sha256 }),
		/has digest/
	)
	assert.equal(
		approvePlan(opened, actor, { reference: 'checkout@1', rationale: 'Ok.', expectSha256: after.sha256 }).status,
		'completed'
	)
})

test('editing a rejected revision returns it to pending approval', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	rejectPlan(opened, actor, { reference: 'checkout@1', rationale: 'T1 title is vague.' })
	assert.equal(planDetail(opened, 'checkout').approval.state, 'rejected')
	assert.deepEqual(inbox(opened).plans, [])
	const content = planCandidate(planRevision(opened, 'checkout').plan)
	content.tests[0].title = 'Standard order total for one item'
	editPlan(opened, actor, { reference: 'checkout@1', candidate: content })
	assert.equal(planDetail(opened, 'checkout').approval.state, 'pending')
	assert.deepEqual(
		inbox(opened).plans.map((row) => `${row.planId}@${row.revision}`),
		['checkout@1']
	)
})

test('editing an approved revision saves the next revision and keeps the approved one', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	revised(opened)
	approved(opened)
	const approvedRevision = planRevision(opened, 'checkout', 2)
	const content = planCandidate(approvedRevision.plan)
	content.tests[0].preconditions = ['Fresh cart.']
	assert.throws(
		() => editPlan(opened, actor, { reference: 'checkout@1', candidate: content }),
		/checkout@1 is not the latest revision. Edit checkout@2/
	)
	const edited = editPlan(opened, actor, { reference: 'checkout@2', candidate: content })
	assert.deepEqual([edited.subject, edited.data.edit, edited.data.reason], ['checkout@3', 'new_revision', 'approved'])
	assert.deepEqual(planRevision(opened, 'checkout', 2), approvedRevision)
	const third = planRevision(opened, 'checkout', 3).plan
	assert.deepEqual([third.previousRevision, third.tests[0].preconditions], [2, ['Fresh cart.']])
	assert.deepEqual(third.decisions, approvedRevision.plan.decisions)
	assert.equal(planDetail(opened, 'checkout').approval.state, 'pending')
})

test('plan edit keeps gaps with pending decisions open and refuses reused assertion IDs', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	revised(opened)
	const base = planCandidate(planRevision(opened, 'checkout').plan)
	const removed = structuredClone(base)
	removed.tests[1].assertions = removed.tests[1].assertions.filter((assertion) => assertion.id !== 'A2')
	editPlan(opened, actor, { reference: 'checkout@2', candidate: removed })
	const reused = structuredClone(removed)
	reused.tests[1].assertions.push({ id: 'A2', check: 'Another meaning.', checkKind: 'deterministic' })
	editPlan(opened, actor, { reference: 'checkout@2', candidate: reused })
	const open = structuredClone(reused)
	open.gaps.push({
		id: 'G3',
		severity: 'non_blocking',
		status: 'open',
		requirementIds: [],
		testIds: ['T1'],
		question: 'Is the label right?',
		consequence: 'None.',
		decisionId: null,
	})
	editPlan(opened, actor, { reference: 'checkout@2', candidate: open })
	answerGap(opened, actor, { planId: 'checkout', gapId: 'G3', kind: 'defer', value: 'Later.', rationale: 'Scope.' })
	assert.throws(
		() => editPlan(opened, actor, { reference: 'checkout@2', candidate: reused }),
		/Gap G3 has a pending decision [0-9A-Z]{26}. Keep the gap open/
	)
	const renamed = structuredClone(open)
	renamed.tests[0].assertions[0].id = 'A1x'
	editPlan(opened, actor, { reference: 'checkout@2', candidate: renamed })
	renamed.tests[0].assertions[0].id = 'A1'
	assert.throws(
		() => editPlan(opened, actor, { reference: 'checkout@2', candidate: renamed }),
		/Assertion ID T1.A1 was used in an earlier revision. Use a new ID/
	)
})

test('plan edit --patch changes items by ID and keeps the edit rules', (t) => {
	const opened = store(t)
	target(opened)
	plan(opened)
	const patch = (value: unknown, reference = 'checkout@1') => patchPlan(opened, actor, { reference, patch: value })
	const edited = patch({
		requirements: { R1: { text: 'A standard order totals 400 PLN.' } },
		tests: {
			T1: {
				title: 'Standard total',
				assertions: { A2: null, A3: { check: 'One line.', checkKind: 'deterministic' } },
			},
			T4: {
				title: 'Catalog',
				requirementIds: ['R1'],
				capability: 'http',
				operations: ['read_catalog'],
				action: 'Read the catalog.',
				assertions: { A1: { check: 'HTTP 200.', checkKind: 'deterministic' } },
			},
		},
		gaps: {
			G1: { question: 'Does the 40 percent promotion stack with loyalty?' },
			G3: {
				severity: 'non_blocking',
				requirementIds: [],
				testIds: ['T4'],
				question: 'Is the catalog paged?',
				consequence: 'Paging is not checked.',
			},
		},
	})
	assert.deepEqual([edited.subject, edited.data.edit], ['checkout@1', 'in_place'])
	const after = planRevision(opened, 'checkout').plan
	assert.equal(after.requirements[0].text, 'A standard order totals 400 PLN.')
	assert.equal(after.requirements[0].source, 'brief#standard')
	assert.deepEqual(
		after.tests.map((test) => [test.id, test.title, test.assertions.map((assertion) => assertion.id)]),
		[
			['T1', 'Standard total', ['A1', 'A3']],
			['T2', 'Promotion quote', ['A1']],
			['T3', 'Refund eligibility', []],
			['T4', 'Catalog', ['A1']],
		]
	)
	assert.deepEqual([after.tests[3].dependsOn, after.tests[3].preconditions, after.tests[3].gapIds], [[], [], ['G3']])
	assert.deepEqual(
		after.gaps.map((gap) => [gap.id, gap.status, gap.decisionId, gap.question]),
		[
			['G1', 'open', null, 'Does the 40 percent promotion stack with loyalty?'],
			['G2', 'open', null, 'Which orders qualify for refunds?'],
			['G3', 'open', null, 'Is the catalog paged?'],
		]
	)
	assert.throws(() => patch({ tests: { T9: { title: 'New' } } }), /New test T9 needs requirementIds, capability/)
	assert.throws(
		() => patch({ tests: { T1: { assertions: { A9: { check: 'x' } } } } }),
		/New assertion T1.A9 needs checkKind/
	)
	assert.throws(() => patch({ gaps: { G9: null } }), /Cannot remove unknown gap G9/)
	assert.throws(() => patch({ tests: { T1: { readiness: 'ready' } } }), /Invalid plan-patch/)
	assert.throws(() => patch({ gaps: { G1: { status: 'resolved' } } }), /Invalid plan-patch/)
	assert.throws(() => patch({}), /Invalid plan-patch/)
	assert.throws(
		() => patch({ tests: { T1: { assertions: { A2: { check: 'Back.' } } } } }),
		/New assertion T1.A2 needs/
	)
	assert.throws(() => patch({ requirements: { R1: null } }), /Unknown requirement in test T1: R1/)
	approved(opened, 'checkout', 1)
	const next = patch({ tests: { T1: { preconditions: ['Fresh cart.'] } } })
	assert.deepEqual([next.subject, next.data.edit, next.data.reason], ['checkout@2', 'new_revision', 'approved'])
	assert.deepEqual(planRevision(opened, 'checkout', 1).plan.tests[0].preconditions, [
		'Fresh cart with one 400 PLN item.',
	])
	assert.throws(() => patch({ tests: { T1: { title: 'Old' } } }), /checkout@1 is not the latest revision/)
	patch({ tests: { T1: { assertions: { A3: null } } } }, 'checkout@2')
	assert.throws(
		() =>
			patch(
				{ tests: { T1: { assertions: { A3: { check: 'Back.', checkKind: 'deterministic' } } } } },
				'checkout@2'
			),
		/Assertion ID T1.A3 was used in an earlier revision/
	)
})
