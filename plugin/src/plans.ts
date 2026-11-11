import type { Plan, PlanDelta, PlanRequest } from './types.ts'
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
import { targetRevision } from './targets.ts'

export type PlanRevision = { plan: Plan; sha256: string }
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
	tests: string[]
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
		targetRevision(store, target.id, target.revision)
		const request = validate('plan-request', input.request)
		index(request.requirements, 'id', 'requirement')
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
		return { reply: completed(planId, { ...data, recorded: true }), subjects: [`plan:${planId}`] }
	})
}

export function planRequest(store: Store, planId: string) {
	const row = one<RequestRow>(store, 'SELECT * FROM plan_requests WHERE plan_id = ?', planId)
	requireCondition(row, `Unknown plan: ${planId}. Run plan open first.`)
	const request: PlanRequest = JSON.parse(row.body)
	return { request, target: targetRevision(store, row.target_id, row.target_revision) }
}

export function showPlanRequest(store: Store, planId: string) {
	const { request, target } = planRequest(store, planId)
	return completed(planId, {
		planId,
		target: `${target.profile.targetId}@${target.revision}`,
		...request,
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

function storeRevision(store: Store, draft: PlanDraft, operationId: string): Change {
	const plan = planCheck(derivePlan(draft))
	planTargetCheck(plan, targetRevision(store, plan.target.targetId, plan.target.revision).profile)
	const others = latestPlans(store)
	others.delete(plan.planId)
	dependencyCheck(plan, others)
	const body = canonical(plan)
	const sha256 = digest(body)
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

export function savePlan(store: Store, actor: string | undefined, input: { planId: string; candidate: unknown }) {
	return write(store, { actor, command: 'plan save', subject: input.planId, input }, (operationId) => {
		const { request, target } = planRequest(store, input.planId)
		requireCondition(
			!one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', input.planId),
			`Plan ${input.planId} has revision 1. Use gap answer and plan revise to change it.`
		)
		const candidate = validate('plan-candidate', input.candidate)
		return storeRevision(
			store,
			{
				contractVersion: 'toolkit-2',
				planId: input.planId,
				revision: 1,
				previousRevision: null,
				target: { targetId: target.profile.targetId, revision: target.revision, sha256: target.sha256 },
				objective: request.objective,
				requirements: request.requirements,
				tests: candidate.tests,
				gaps: candidate.gaps,
				assumptions: [],
				decisions: [],
			},
			operationId
		)
	})
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
				assertion.check !== undefined && assertion.oracleKind !== undefined,
				`New assertion ${test.id}.${id} needs check and oracleKind`
			)
			test.assertions.push({ id, check: assertion.check, oracleKind: assertion.oracleKind })
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
	return { policy, latest, approved: latest?.verdict === 'approved' && latest.sha256 === sha256 }
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
	requireCondition(Array.isArray(input.tests) && input.tests.length > 0, 'Select one or more tests with --tests')
	requireCondition(new Set(input.tests).size === input.tests.length, 'Duplicate test in --tests')
	const tests = index(plan.tests, 'id', 'test')
	references(input.tests, tests, `test in ${subject}`)
	const build = requireText(input.build, 'application build (--build)')
	const partial = requireChoice(input.partial ?? 'wait_for_resolution', partialModes, 'partial execution (--partial)')
	if (input.retestOf) retestCheck(store, input.retestOf, plan, build)
	const reasons: string[] = []
	if (!target.profile.readyForLiveExecution)
		reasons.push(`Target prerequisites are not ready: ${plan.target.targetId}@${plan.target.revision}`)
	const approval = planApproval(store, plan, revision.sha256)
	if (approval.policy === 'required' && !approval.approved) reasons.push(`Plan ${subject} is not approved`)
	if (partial === 'wait_for_resolution')
		for (const gap of plan.gaps)
			if (gap.status === 'open' && gap.severity === 'blocking') reasons.push(`Open blocking gap: ${gap.id}`)
	for (const id of input.tests) {
		const test = tests.get(id)!
		if (test.readiness !== 'ready') reasons.push(`Test is not ready: ${id}`)
		if (!target.profile.capabilities.includes(test.capability))
			reasons.push(`Missing capability: ${test.capability}`)
		if (!test.operations.every((operation) => target.profile.allowedOperations.includes(operation)))
			reasons.push(`Operation is not permitted: ${id}`)
		if (!test.assertions.length) reasons.push(`Test has no assertions: ${id}`)
		for (const dependency of test.dependsOn)
			if (!dependency.includes(':') && !input.tests.includes(dependency))
				reasons.push(`Missing prerequisite: ${dependency}`)
	}
	for (const id of input.tests)
		for (const dependency of tests.get(id)!.dependsOn.filter((dependency) => dependency.includes(':'))) {
			const cause = dependencyBlock(store, dependency, build)
			if (cause) reasons.push(`Blocked by ${dependency}: ${cause}`)
		}
	return {
		reply: {
			status: reasons.length ? ('needs_decision' as const) : ('completed' as const),
			subject,
			reasons,
			data: { planId: plan.planId, revision: plan.revision, sha256: revision.sha256 },
		},
		revision,
		target,
		build,
		partial,
	}
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
