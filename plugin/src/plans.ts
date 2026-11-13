import type { Plan, PlanCandidate, PlanDelta, PlanRequest, Profile } from './types.ts'
import type { Change, Reply, Store } from './store.ts'
import { all, canonical, completed, digest, execute, one, ulid, write } from './store.ts'
import type { PlanDraft, Test } from './contracts.ts'
import {
	approvalPolicy,
	dependencyCheck,
	derivePlan,
	expectDigest,
	gapsAffecting,
	index,
	planCheck,
	planTargetCheck,
	references,
	requireChoice,
	requireCondition,
	requireIdentifier,
	requireText,
	revisionReference,
	same,
	testReference,
	validate,
} from './contracts.ts'
import { targetRevision, toolCheck } from './targets.ts'

export type PlanRevision = { plan: Plan; sha256: string }
export type PlanTool = Omit<Profile['tools'][number], 'reachable'> & { reachable?: boolean }
export type GapAnswer = {
	planId: string
	gapId: string
	kind: string
	value: string
	source?: string | null
	rationale: string
	expectSha256?: string
}
export type Verdict = { reference: string; rationale: string; expectSha256?: string }
export type GateInput = {
	reference: string
	tests?: string[]
	build: string
	partial?: string
	retestOf?: string | null
}
export type PatchOperation = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }
type RequestRow = { plan_id: string; target_id: string; target_revision: number; body: string }
type DecisionRow = {
	id: string
	gap_id: string
	kind: 'clarify' | 'accept_assumption' | 'defer'
	value: string
	source: string | null
	rationale: string
	actor: string
}

const decisionKinds = ['clarify', 'accept_assumption', 'defer'] as const
const partialModes = ['wait_for_resolution', 'ready_only'] as const

export function openPlan(
	store: Store,
	actor: string | undefined,
	input: { planId: string; target: string; request: unknown }
) {
	return write(store, { actor, command: 'plan open', subject: input.planId, input }, (operationId) => {
		const planId = requireIdentifier(input.planId, 'plan ID')
		const target = revisionReference(requireText(input.target, 'target (--target)'), 'target reference')
		requireCondition(target.revision !== null, `Name the target revision: --target ${target.id}@<revision>`)
		const profile = targetRevision(store, target.id, target.revision).profile
		const request = validate('plan-request', input.request)
		requireCondition(
			request.requirements?.length || request.context?.sources.length,
			'A plan request needs requirements or context sources'
		)
		index(request.requirements ?? [], 'id', 'requirement')
		for (const tool of request.tools ?? [])
			if (typeof tool === 'string')
				requireCondition(
					profile.tools.some((known) => known.name === tool),
					`Unknown tool ${tool}. The target profile has: ${profile.tools.map((known) => known.name).join(', ') || 'no tools'}.`
				)
			else {
				toolCheck(tool)
				requireCondition(
					!profile.tools.some((known) => known.name === tool.name),
					`Tool ${tool.name} is in the target profile. Name it as a string.`
				)
			}
		const names = planTools(request, profile).map((tool) => tool.name)
		requireCondition(new Set(names).size === names.length, 'Duplicate tool name in the plan request')
		const body = canonical(request)
		const data = { planId, target: `${target.id}@${target.revision}` }
		const existing = one<RequestRow>(store, 'SELECT * FROM plan_requests WHERE plan_id = ?', planId)
		if (existing) {
			requireCondition(
				existing.target_id === target.id &&
					existing.target_revision === target.revision &&
					existing.body === body,
				`Plan ${planId} is open with another request. Use a new plan ID.`
			)
			return { reply: completed(planId, { ...data, recorded: false }), subjects: [] }
		}
		execute(
			store,
			'INSERT INTO plan_requests (plan_id, target_id, target_revision, body, operation_id) VALUES (?, ?, ?, ?, ?)',
			planId,
			target.id,
			target.revision,
			body,
			operationId
		)
		return { reply: completed(planId, { ...data, recorded: true }), subjects: [`plan:${planId}`, 'inbox'] }
	})
}

export function planRequest(store: Store, planId: string) {
	const row = one<RequestRow>(store, 'SELECT * FROM plan_requests WHERE plan_id = ?', planId)
	requireCondition(row, `Unknown plan: ${planId}. Run plan open first.`)
	const request: PlanRequest = JSON.parse(row.body)
	return { request, target: targetRevision(store, row.target_id, row.target_revision) }
}

export function planTools(request: PlanRequest, profile: Profile): PlanTool[] {
	const named = (request.tools ?? []).filter((tool) => typeof tool === 'string')
	const added = (request.tools ?? []).filter((tool) => typeof tool !== 'string')
	const kept = named.length ? profile.tools.filter((tool) => named.includes(tool.name)) : profile.tools
	return [...kept, ...added]
}

export function showPlanRequest(store: Store, planId: string) {
	const { request, target } = planRequest(store, planId)
	return completed(planId, {
		planId,
		target: `${target.profile.targetId}@${target.revision}`,
		objective: request.objective,
		requirements: request.requirements ?? [],
		sourceContext: request.sourceContext ?? [],
		context: request.context ?? { sources: [] },
		tools: planTools(request, target.profile),
		capabilities: target.profile.capabilities,
		allowedOperations: target.profile.allowedOperations,
	})
}

export function planRevision(store: Store, planId: string, revision: number | null = null): PlanRevision {
	const row = one<{ body: string; sha256: string }>(
		store,
		revision === null
			? 'SELECT body, sha256 FROM latest_plans WHERE plan_id = ?'
			: 'SELECT body, sha256 FROM plan_revisions WHERE plan_id = ? AND revision = ?',
		planId,
		...(revision === null ? [] : [revision])
	)
	if (!row) {
		planRequest(store, planId)
		throw new Error(
			revision === null
				? `Plan ${planId} has no revision. Run plan save first.`
				: `Plan ${planId} has no revision ${revision}`
		)
	}
	return { plan: JSON.parse(row.body), sha256: row.sha256 }
}

export function latestPlans(store: Store) {
	const rows = all<{ plan_id: string; body: string }>(
		store,
		'SELECT plan_id, body FROM latest_plans ORDER BY plan_id'
	)
	return new Map(rows.map((row) => [row.plan_id, JSON.parse(row.body) as Plan]))
}

function checkedRevision(store: Store, draft: PlanDraft) {
	const plan = planCheck(derivePlan(draft))
	planTargetCheck(plan, targetRevision(store, plan.target.targetId, plan.target.revision).profile)
	const others = latestPlans(store)
	others.delete(plan.planId)
	dependencyCheck(plan, others)
	const body = canonical(plan)
	return { plan, body, sha256: digest(body) }
}

function revisionChange(plan: Plan, sha256: string): Change {
	const blockers = plan.gaps.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
	return {
		reply: {
			status: blockers.length ? 'needs_decision' : 'completed',
			subject: `${plan.planId}@${plan.revision}`,
			reasons: blockers.map((gap) => `${gap.id}: ${gap.question}`),
			data: { planId: plan.planId, revision: plan.revision, sha256 },
		},
		subjects: [`plan:${plan.planId}`, 'inbox'],
	}
}

function storeRevision(store: Store, draft: PlanDraft, operationId: string): Change {
	const { plan, body, sha256 } = checkedRevision(store, draft)
	execute(
		store,
		'INSERT INTO plan_revisions (plan_id, revision, previous_revision, sha256, body, operation_id) VALUES (?, ?, ?, ?, ?, ?)',
		plan.planId,
		plan.revision,
		plan.previousRevision,
		sha256,
		body,
		operationId
	)
	return revisionChange(plan, sha256)
}

export function planCandidate(plan: Plan): Required<PlanCandidate> {
	return {
		requirements: plan.requirements,
		tests: plan.tests.map(({ readiness, gapIds, ...test }) => test),
		gaps: plan.gaps,
	}
}

export function frozenRevision(store: Store, planId: string, revision: number) {
	if (one(store, 'SELECT 1 FROM runs WHERE plan_id = ? AND plan_revision = ?', planId, revision)) return 'run'
	const approved = one(
		store,
		"SELECT 1 FROM approvals WHERE subject_kind = 'plan' AND subject_id = ? AND verdict = 'approved'",
		`${planId}@${revision}`
	)
	return approved ? 'approved' : null
}

export function editPlan(
	store: Store,
	actor: string | undefined,
	input: { reference: string; candidate: unknown; expectSha256?: string }
) {
	return write(store, { actor, command: 'plan edit', subject: input.reference, input }, (operationId) => {
		const reference = revisionReference(requireText(input.reference, 'plan reference'), 'plan reference')
		requireCondition(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`)
		const base = planRevision(store, reference.id, reference.revision)
		const subject = `${reference.id}@${reference.revision}`
		const latest = planRevision(store, reference.id).plan.revision
		requireCondition(
			latest === reference.revision,
			`${subject} is not the latest revision. Edit ${reference.id}@${latest}.`
		)
		expectDigest(base.sha256, input.expectSha256, subject)
		const candidate = validate('plan-candidate', input.candidate)
		const frozen = frozenRevision(store, reference.id, reference.revision)
		const { coverage, tests, ...kept } = structuredClone(base.plan)
		const draft: PlanDraft = {
			...kept,
			...(frozen ? { revision: base.plan.revision + 1, previousRevision: base.plan.revision } : {}),
			requirements: candidate.requirements ?? kept.requirements,
			tests: candidate.tests,
			gaps: candidate.gaps,
		}
		for (const decision of pendingDecisions(store, reference.id))
			requireCondition(
				draft.gaps.some((gap) => gap.id === decision.gap_id && gap.status === 'open'),
				`Gap ${decision.gap_id} has a pending decision ${decision.id}. Keep the gap open.`
			)
		for (const test of draft.tests) {
			const before = base.plan.tests.find((item) => item.id === test.id)?.assertions ?? []
			const used = usedAssertionIds(store, reference.id, test.id)
			for (const assertion of test.assertions)
				requireCondition(
					before.some((item) => item.id === assertion.id) || !used.includes(assertion.id),
					`Assertion ID ${test.id}.${assertion.id} was used in an earlier revision. Use a new ID.`
				)
		}
		if (frozen) {
			const change = storeRevision(store, draft, operationId)
			change.reply.data.edit = 'new_revision'
			change.reply.data.reason = frozen
			return change
		}
		const { plan, body, sha256 } = checkedRevision(store, draft)
		execute(
			store,
			'UPDATE plan_revisions SET sha256 = ?, body = ?, operation_id = ? WHERE plan_id = ? AND revision = ?',
			sha256,
			body,
			operationId,
			plan.planId,
			plan.revision
		)
		const change = revisionChange(plan, sha256)
		change.reply.data.edit = 'in_place'
		change.reply.data.previousSha256 = base.sha256
		return change
	})
}

export function savePlan(store: Store, actor: string | undefined, input: { planId: string; candidate: unknown }) {
	return write(store, { actor, command: 'plan save', subject: input.planId, input }, (operationId) => {
		const { request, target } = planRequest(store, input.planId)
		requireCondition(
			!one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', input.planId),
			`Plan ${input.planId} has revision 1. Use plan edit, or gap answer and plan revise, to change it.`
		)
		const candidate = validate('plan-candidate', input.candidate)
		const requirements = candidateRequirements(request, candidate.requirements)
		return storeRevision(
			store,
			{
				contractVersion: 'toolkit-2',
				planId: input.planId,
				revision: 1,
				previousRevision: null,
				target: { targetId: target.profile.targetId, revision: target.revision, sha256: target.sha256 },
				objective: request.objective,
				requirements,
				tests: candidate.tests,
				gaps: candidate.gaps,
				assumptions: [],
				decisions: [],
			},
			operationId
		)
	})
}

function candidateRequirements(request: PlanRequest, drafted: Plan['requirements'] | undefined) {
	if (request.requirements?.length) {
		requireCondition(!drafted, 'The plan request names the requirements. Do not add requirements to the candidate.')
		return request.requirements
	}
	const sources = request.context?.sources ?? []
	requireCondition(
		drafted?.length,
		`The plan request has no requirements. Draft them from the context sources: ${sources.join(', ')}`
	)
	index(drafted, 'id', 'requirement')
	for (const requirement of drafted)
		requireCondition(
			sources.some((source) => requirement.source.startsWith(source)),
			`Requirement ${requirement.id} cites ${requirement.source}, which is not a context source. Use one of: ${sources.join(', ')}`
		)
	return drafted
}

function pendingDecisions(store: Store, planId: string) {
	return all<DecisionRow>(
		store,
		'SELECT * FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid',
		planId
	)
}

export function answerGap(store: Store, actor: string | undefined, input: GapAnswer) {
	return write(store, { actor, command: 'gap answer', subject: input.planId, input }, (operationId, at, actor) => {
		const latest = planRevision(store, input.planId)
		const subject = `${input.planId}@${latest.plan.revision}`
		expectDigest(latest.sha256, input.expectSha256, subject)
		const gap = latest.plan.gaps.find((gap) => gap.id === input.gapId)
		requireCondition(gap, `Unknown gap ${input.gapId} in ${subject}`)
		requireCondition(
			gap.status === 'open',
			`Gap ${gap.id} is ${gap.status} in ${subject}. Only an open gap takes a decision.`
		)
		const kind = requireChoice(input.kind, decisionKinds, 'decision kind (--kind)')
		const value = requireText(input.value, 'decision value (--value)')
		const rationale = requireText(input.rationale, 'rationale (--rationale)')
		const source = input.source ?? null
		if (source !== null) requireText(source, 'source (--source)')
		requireCondition(kind !== 'clarify' || source, 'A clarification needs a source (--source)')
		const pending = pendingDecisions(store, input.planId).find((decision) => decision.gap_id === gap.id)
		requireCondition(
			!pending,
			`Gap ${gap.id} has a pending decision ${pending?.id}. Run plan revise to apply it first.`
		)
		const id = ulid()
		execute(
			store,
			'INSERT INTO decisions (id, plan_id, base_revision, gap_id, kind, value, source, rationale, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			id,
			input.planId,
			latest.plan.revision,
			gap.id,
			kind,
			value,
			source,
			rationale,
			actor,
			operationId
		)
		return {
			reply: completed(input.planId, {
				decisionId: id,
				planId: input.planId,
				baseRevision: latest.plan.revision,
				gapId: gap.id,
				kind,
			}),
			subjects: [`plan:${input.planId}`, 'inbox'],
		}
	})
}

function affectedTests(plan: Plan, gapIds: string[]) {
	const gaps = plan.gaps.filter((gap) => gapIds.includes(gap.id))
	return plan.tests.filter((test) => gapsAffecting(gaps, test).length > 0)
}

export function showPending(store: Store, planId: string) {
	const latest = planRevision(store, planId)
	const decisions = pendingDecisions(store, planId)
	const gapIds = decisions.map((decision) => decision.gap_id)
	return completed(`${planId}@${latest.plan.revision}`, {
		planId,
		revision: latest.plan.revision,
		sha256: latest.sha256,
		decisions: decisions.map(decisionSnapshot),
		gaps: latest.plan.gaps.filter((gap) => gapIds.includes(gap.id)),
		tests: affectedTests(latest.plan, gapIds),
	})
}

function decisionSnapshot(row: DecisionRow): Plan['decisions'][number] {
	return {
		id: row.id,
		gapId: row.gap_id,
		kind: row.kind,
		actor: row.actor,
		rationale: row.rationale,
		value: row.value,
		source: row.source,
	}
}

export function revisePlan(
	store: Store,
	actor: string | undefined,
	input: { planId: string; delta: unknown; expectSha256?: string }
) {
	return write(store, { actor, command: 'plan revise', subject: input.planId, input }, (operationId) => {
		const base = planRevision(store, input.planId)
		expectDigest(base.sha256, input.expectSha256, `${input.planId}@${base.plan.revision}`)
		const decisions = pendingDecisions(store, input.planId)
		requireCondition(
			decisions.length > 0,
			`Plan ${input.planId} has no pending decision. Record one with gap answer first.`
		)
		const delta = validate('plan-delta', input.delta)
		const { coverage, ...draft } = structuredClone(base.plan)
		draft.revision = base.plan.revision + 1
		draft.previousRevision = base.plan.revision
		for (const decision of decisions) {
			const gap = draft.gaps.find((gap) => gap.id === decision.gap_id)!
			gap.status = decision.kind === 'defer' ? 'deferred' : 'resolved'
			gap.decisionId = decision.id
			draft.decisions.push(decisionSnapshot(decision))
			if (decision.kind === 'accept_assumption')
				draft.assumptions.push({ decisionId: decision.id, text: decision.value })
		}
		const affected = affectedTests(
			base.plan,
			decisions.map((decision) => decision.gap_id)
		).map((test) => test.id)
		for (const [testId, change] of Object.entries(delta.tests)) {
			const test = draft.tests.find((test) => test.id === testId)
			requireCondition(test, `Unknown test in delta: ${testId}`)
			requireCondition(
				affected.includes(testId),
				`Test ${testId} is not affected by a pending decision. A revision changes only affected tests.`
			)
			applyTestChange(test, change, usedAssertionIds(store, input.planId, testId))
		}
		const change = storeRevision(store, draft, operationId)
		for (const decision of decisions)
			execute(store, 'UPDATE decisions SET applied_revision = ? WHERE id = ?', draft.revision, decision.id)
		change.reply.data.applied = decisions.map((decision) => decision.id)
		return change
	})
}

function usedAssertionIds(store: Store, planId: string, testId: string) {
	return all<{ id: string }>(
		store,
		"SELECT DISTINCT a.value ->> '$.id' AS id FROM plan_tests t, json_each(t.test, '$.assertions') a WHERE t.plan_id = ? AND t.test_id = ?",
		planId,
		testId
	).map((row) => row.id)
}

function applyTestChange(test: Test, change: PlanDelta['tests'][string], used: string[]) {
	if (change.action !== undefined) test.action = change.action
	if (change.preconditions !== undefined) test.preconditions = change.preconditions
	for (const [id, assertion] of Object.entries(change.assertions ?? {})) {
		const position = test.assertions.findIndex((existing) => existing.id === id)
		if (assertion === null) {
			requireCondition(position >= 0, `Cannot remove unknown assertion ${test.id}.${id}`)
			test.assertions.splice(position, 1)
		} else if (position >= 0) test.assertions[position] = { ...test.assertions[position], ...assertion }
		else {
			requireCondition(
				!used.includes(id),
				`Assertion ID ${test.id}.${id} was used in an earlier revision. Use a new ID.`
			)
			requireCondition(
				assertion.check !== undefined && assertion.checkKind !== undefined,
				`New assertion ${test.id}.${id} needs check and checkKind`
			)
			test.assertions.push({ id, check: assertion.check, checkKind: assertion.checkKind })
		}
	}
}

export function approvePlan(store: Store, actor: string | undefined, input: Verdict) {
	return decidePlan(store, actor, input, 'approved')
}

export function rejectPlan(store: Store, actor: string | undefined, input: Verdict) {
	return decidePlan(store, actor, input, 'rejected')
}

function decidePlan(store: Store, actor: string | undefined, input: Verdict, verdict: 'approved' | 'rejected') {
	const command = verdict === 'approved' ? 'plan approve' : 'plan reject'
	return write(store, { actor, command, subject: input.reference, input }, (operationId, at, actor) => {
		const reference = revisionReference(requireText(input.reference, 'plan reference'), 'plan reference')
		requireCondition(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`)
		const revision = planRevision(store, reference.id, reference.revision)
		const subject = `${reference.id}@${reference.revision}`
		expectDigest(revision.sha256, input.expectSha256, subject)
		return {
			reply: recordApproval(store, actor, operationId, {
				kind: 'plan',
				subject,
				sha256: revision.sha256,
				verdict,
				rationale: input.rationale,
			}),
			subjects: [`plan:${reference.id}`, 'inbox'],
		}
	})
}

export function recordApproval(
	store: Store,
	actor: string,
	operationId: string,
	input: {
		kind: 'plan' | 'result'
		subject: string
		sha256: string
		verdict: 'approved' | 'rejected'
		rationale: string
	}
): Reply {
	const rationale = requireText(input.rationale, 'rationale (--rationale)')
	const id = ulid()
	execute(
		store,
		'INSERT INTO approvals (id, subject_kind, subject_id, subject_sha256, verdict, rationale, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		id,
		input.kind,
		input.subject,
		input.sha256,
		input.verdict,
		rationale,
		actor,
		operationId
	)
	return completed(input.subject, { approvalId: id, verdict: input.verdict, sha256: input.sha256 })
}

export type Approval = {
	verdict: 'approved' | 'rejected'
	sha256: string
	actor: string
	rationale: string
	at: string
}

export function latestApproval(store: Store, kind: 'plan' | 'result', subject: string) {
	return one<Approval>(
		store,
		`SELECT a.verdict, a.subject_sha256 AS sha256, a.actor, a.rationale, o.at FROM approvals a
		JOIN operations o ON o.id = a.operation_id
		WHERE a.subject_kind = ? AND a.subject_id = ? ORDER BY a.rowid DESC LIMIT 1`,
		kind,
		subject
	)
}

export function approvalState(
	store: Store,
	kind: 'plan' | 'result',
	subject: string,
	sha256: string,
	policy: 'required' | 'none'
) {
	const latest = latestApproval(store, kind, subject) ?? null
	const current = latest?.sha256 === sha256
	return {
		policy,
		latest,
		approved: current && latest?.verdict === 'approved',
		rejected: current && latest?.verdict === 'rejected',
	}
}

export function planApproval(store: Store, plan: Plan, sha256: string) {
	const policy = approvalPolicy(targetRevision(store, plan.target.targetId, plan.target.revision).profile).plan
	return approvalState(store, 'plan', `${plan.planId}@${plan.revision}`, sha256, policy)
}

export function gate(store: Store, input: GateInput) {
	const reference = revisionReference(requireText(input.reference, 'plan reference'), 'plan reference')
	requireCondition(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`)
	const revision = planRevision(store, reference.id, reference.revision)
	const { plan } = revision
	const subject = `${plan.planId}@${plan.revision}`
	const target = targetRevision(store, plan.target.targetId, plan.target.revision)
	const build = requireText(input.build, 'application build (--build)')
	const partial = requireChoice(input.partial ?? 'wait_for_resolution', partialModes, 'partial execution (--partial)')
	const tests = index(plan.tests, 'id', 'test')
	const selection =
		input.tests === undefined && partial === 'ready_only'
			? readySelection(store, plan, build)
			: givenSelection(input.tests, tests, subject)
	const selected = selection.tests
	if (input.retestOf) retestCheck(store, input.retestOf, plan, build)
	const reasons: string[] = []
	if (!selected.length) reasons.push(`No test is ready in ${subject}`)
	if (!target.profile.readyForLiveExecution)
		reasons.push(`Target prerequisites are not ready: ${plan.target.targetId}@${plan.target.revision}`)
	const approval = planApproval(store, plan, revision.sha256)
	if (approval.policy === 'required' && !approval.approved) reasons.push(`Plan ${subject} is not approved`)
	if (partial === 'wait_for_resolution')
		for (const gap of plan.gaps)
			if (gap.status === 'open' && gap.severity === 'blocking') reasons.push(`Open blocking gap: ${gap.id}`)
	for (const id of selected) {
		const test = tests.get(id)!
		if (test.readiness !== 'ready') reasons.push(`Test is not ready: ${id}`)
		if (!target.profile.capabilities.includes(test.capability))
			reasons.push(`Missing capability: ${test.capability}`)
		if (!test.operations.every((operation) => target.profile.allowedOperations.includes(operation)))
			reasons.push(`Operation is not permitted: ${id}`)
		if (!test.assertions.length) reasons.push(`Test has no assertions: ${id}`)
		for (const dependency of test.dependsOn)
			if (!dependency.includes(':') && !selected.includes(dependency))
				reasons.push(`Missing prerequisite: ${dependency}`)
	}
	for (const id of selected)
		for (const dependency of tests.get(id)!.dependsOn.filter((dependency) => dependency.includes(':'))) {
			const cause = dependencyBlock(store, dependency, build)
			if (cause) reasons.push(`Blocked by ${dependency}: ${cause}`)
		}
	return {
		reply: {
			status: reasons.length ? ('needs_decision' as const) : ('completed' as const),
			subject,
			reasons,
			data: {
				planId: plan.planId,
				revision: plan.revision,
				sha256: revision.sha256,
				tests: selected,
				leftOut: selection.leftOut,
			},
		},
		tests: selected,
		revision,
		target,
		build,
		partial,
	}
}

type LeftOut = { testId: string; reason: string }

function givenSelection(selected: string[] | undefined, tests: Map<string, Test>, subject: string) {
	requireCondition(
		Array.isArray(selected) && selected.length > 0,
		'Select one or more tests with --tests, or add --partial ready_only'
	)
	requireCondition(new Set(selected).size === selected.length, 'Duplicate test in --tests')
	references(selected, tests, `test in ${subject}`)
	return { tests: selected, leftOut: [] as LeftOut[] }
}

function readySelection(store: Store, plan: Plan, build: string) {
	const leftOut: LeftOut[] = []
	for (const test of plan.tests) {
		const reason = notReadyReason(store, plan, test, build)
		if (reason) leftOut.push({ testId: test.id, reason })
	}
	let selected = plan.tests.map((test) => test.id).filter((id) => !leftOut.some((item) => item.testId === id))
	for (let changed = true; changed;) {
		changed = false
		for (const test of plan.tests.filter((test) => selected.includes(test.id))) {
			const missing = test.dependsOn.find((id) => !id.includes(':') && !selected.includes(id))
			if (!missing) continue
			leftOut.push({ testId: test.id, reason: `needs ${missing}, which is left out` })
			selected = selected.filter((id) => id !== test.id)
			changed = true
		}
	}
	const order = plan.tests.map((test) => test.id)
	leftOut.sort((a, b) => order.indexOf(a.testId) - order.indexOf(b.testId))
	return { tests: selected, leftOut }
}

function notReadyReason(store: Store, plan: Plan, test: Test, build: string) {
	if (test.readiness !== 'ready') {
		const gaps = plan.gaps.filter(
			(gap) =>
				test.gapIds.includes(gap.id) &&
				(test.readiness === 'deferred'
					? gap.status === 'deferred'
					: gap.status === 'open' && gap.severity === 'blocking')
		)
		return `${test.readiness} by ${gaps.map((gap) => gap.id).join(', ')}`
	}
	for (const dependency of test.dependsOn.filter((id) => id.includes(':'))) {
		const cause = dependencyBlock(store, dependency, build)
		if (cause) return `blocked by ${dependency}: ${cause}`
	}
	return null
}

function retestCheck(store: Store, runId: string, plan: Plan, build: string) {
	const previous = one<{
		plan_id: string
		target_id: string
		target_revision: number
		application_build: string
		finished: number
	}>(
		store,
		'SELECT r.plan_id, r.target_id, r.target_revision, r.application_build, s.run_id IS NOT NULL AS finished FROM runs r LEFT JOIN results s ON s.run_id = r.run_id WHERE r.run_id = ?',
		runId
	)
	requireCondition(previous, `Unknown run to retest: ${runId}`)
	requireCondition(previous.finished, `Run ${runId} is not finished. Retest a finished run.`)
	requireCondition(
		previous.plan_id === plan.planId &&
			previous.target_id === plan.target.targetId &&
			previous.target_revision === plan.target.revision,
		`Retest scope changed: ${runId} ran plan ${previous.plan_id} on ${previous.target_id}@${previous.target_revision}`
	)
	requireCondition(
		previous.application_build !== build,
		`Retest needs a new build. Run ${runId} used build ${build}.`
	)
}

// A cross-plan dependency needs the latest finalized result for the build (any build
// when build is null) that selected the test to show passed, accepted when required,
// and no open blocking gap in any plan that applies to the test.
export function dependencyBlock(store: Store, reference: string, build: string | null): string | null {
	const { planId, testId } = testReference(reference)
	const result = one<{ run_id: string; target_id: string; target_revision: number; sha256: string; outcome: string }>(
		store,
		`SELECT r.run_id, r.target_id, r.target_revision, s.sha256,
			(SELECT t.value ->> '$.outcome' FROM json_each(s.body, '$.tests') t WHERE t.value ->> '$.testId' = ?) AS outcome
		FROM runs r JOIN results s ON s.run_id = r.run_id
		WHERE r.plan_id = ? AND (? IS NULL OR r.application_build = ?)
			AND EXISTS (SELECT 1 FROM json_each(s.body, '$.selectedTestIds') WHERE value = ?)
		ORDER BY s.rowid DESC LIMIT 1`,
		testId,
		planId,
		build,
		build,
		testId
	)
	if (!result) return build === null ? 'no finalized result' : `no finalized result for build ${build}`
	if (result.outcome !== 'passed') return `latest result ${result.run_id} shows ${result.outcome}`
	const policy = approvalPolicy(targetRevision(store, result.target_id, result.target_revision).profile).result
	if (policy === 'required' && !approvalState(store, 'result', result.run_id, result.sha256, policy).approved)
		return `result ${result.run_id} is not accepted`
	for (const [owner, plan] of latestPlans(store)) {
		const open = plan.gaps.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
		const test = plan.tests.find((test) => test.id === testId)
		const gap =
			owner === planId
				? test && gapsAffecting(open, test)[0]
				: open.find((gap) => gap.testIds.includes(reference))
		if (gap) return `open blocking gap ${gap.id} in ${owner}`
	}
	return null
}

export function planChanges(before: Plan, after: Plan): string[] {
	const lines: string[] = []
	const fields = (prefix: string, a: object, b: object, skip: string[] = []) => {
		const x = a as Record<string, unknown>
		const y = b as Record<string, unknown>
		for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort())
			if (!skip.includes(key) && !same(x[key], y[key]))
				lines.push(`${prefix} ${key}: ${JSON.stringify(x[key])} → ${JSON.stringify(y[key])}`)
	}
	for (const test of after.tests) {
		const old = before.tests.find((item) => item.id === test.id)
		if (!old) {
			lines.push(`${test.id} added`)
			continue
		}
		fields(test.id, old, test, ['assertions'])
		for (const assertion of old.assertions)
			if (!test.assertions.some((item) => item.id === assertion.id))
				lines.push(`${test.id}.${assertion.id} removed`)
		for (const assertion of test.assertions) {
			const previous = old.assertions.find((item) => item.id === assertion.id)
			if (previous) fields(`${test.id}.${assertion.id}`, previous, assertion)
			else lines.push(`${test.id}.${assertion.id} added: ${JSON.stringify(assertion.check)}`)
		}
	}
	for (const gap of after.gaps) {
		const old = before.gaps.find((item) => item.id === gap.id)
		if (old) fields(gap.id, old, gap)
		else lines.push(`${gap.id} added`)
	}
	for (const decision of after.decisions.filter((item) => !before.decisions.some((old) => old.id === item.id)))
		lines.push(`decision ${decision.id} ${decision.kind} ${decision.gapId}: ${JSON.stringify(decision.value)}`)
	for (const assumption of after.assumptions.filter(
		(item) => !before.assumptions.some((old) => old.decisionId === item.decisionId)
	))
		lines.push(`assumption ${assumption.decisionId}: ${JSON.stringify(assumption.text)}`)
	for (const row of after.coverage) {
		const old = before.coverage.find((item) => item.requirementId === row.requirementId)
		if (old && old.status !== row.status)
			lines.push(`${row.requirementId} coverage: ${JSON.stringify(old.status)} → ${JSON.stringify(row.status)}`)
	}
	return lines
}

export function jsonPatch(before: unknown, after: unknown, path = ''): PatchOperation[] {
	if (same(before, after)) return []
	if (Array.isArray(before) && Array.isArray(after)) {
		const common = Math.min(before.length, after.length)
		const operations: PatchOperation[] = []
		for (let i = 0; i < common; i++) operations.push(...jsonPatch(before[i], after[i], `${path}/${i}`))
		for (let i = common; i < after.length; i++)
			operations.push({ op: 'add', path: `${path}/${i}`, value: after[i] })
		for (let i = before.length - 1; i >= after.length; i--) operations.push({ op: 'remove', path: `${path}/${i}` })
		return operations
	}
	if (isRecord(before) && isRecord(after)) {
		const operations: PatchOperation[] = []
		const pointer = (key: string) => `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
		for (const key of Object.keys(before).sort())
			if (!(key in after)) operations.push({ op: 'remove', path: pointer(key) })
		for (const key of Object.keys(after).sort())
			if (key in before) operations.push(...jsonPatch(before[key], after[key], pointer(key)))
			else operations.push({ op: 'add', path: pointer(key), value: after[key] })
		return operations
	}
	return [{ op: 'replace', path, value: after }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function diffPlan(store: Store, input: { planId: string; from: string; to: string }) {
	const revision = (text: string) => {
		requireCondition(/^[1-9][0-9]*$/.test(text), `Invalid revision: ${text}. Use a positive integer.`)
		return planRevision(store, input.planId, Number(text)).plan
	}
	const before = revision(input.from)
	const after = revision(input.to)
	return completed(`${input.planId}@${before.revision}..${after.revision}`, {
		planId: input.planId,
		from: before.revision,
		to: after.revision,
		patch: jsonPatch(before, after),
		changes: planChanges(before, after),
	})
}
