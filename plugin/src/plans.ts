import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Gap, Plan, PlanCandidate, PlanDelta, PlanPatch, PlanRequest, Profile, Result } from './types.ts'
import type { Change, Reply, Store } from './store.ts'
import { answerQuestion } from './journal.ts'
import { patchRules, requireHeldRules } from './rules.ts'
import { operationAllowed, readinessHint, targetWebUrl } from './targets.ts'
import { dataSummary, requireDataFor } from './resets.ts'
import { all, canonical, completed, digest, execute, one, ulid, write } from './store.ts'
import { softProblems, uncoveredRequirements, unverifiedAssertions } from './contracts.ts'
import type { PlanDraft, Test } from './contracts.ts'
import {
	approvalPolicy,
	dependencyCheck,
	dependencyWarnings,
	derivePlan,
	expectDigest,
	gapsAffecting,
	index,
	planCheck,
	planTargetCheck,
	references,
	compoundCheck,
	unverifiedCheck,
	requireChoice,
	requireCondition,
	requireIdentifier,
	requireText,
	requireWellFormed,
	revisionReference,
	same,
	testReadiness,
	testReference,
	unusedId,
	validate,
} from './contracts.ts'
import { findInstance, targetRevision, toolCheck } from './targets.ts'
import { permanentSelection } from './permanent.ts'

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
export type Verdict = { reference: string; rationale: string; expectSha256?: string; expectDecision?: string }
export type GateInput = {
	reference: string
	tests?: string[]
	build: string
	instance?: string
	partial?: string
	retestOf?: string | null
	permanent?: string
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

export const decisionKinds = ['clarify', 'accept_assumption', 'defer'] as const
export const partialModes = ['wait_for_resolution', 'ready_only'] as const

// A ticket key such as BS-42 names the plan. Without a key, the first source's file name does.
function suggestedPlanId(workspace: string, sources: string[]) {
	const [source] = sources
	requireWellFormed(
		source !== undefined,
		'Name the plan: plan open <planId> --target <target>@<revision>.',
		'Or give a --source file and leave out <planId>, and the ID comes from the ticket key or the file name.'
	)
	let text: string
	try {
		text = readFileSync(join(workspace, source), 'utf8')
	} catch {
		text = ''
	}
	const key = text.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/)?.[0] ?? basename(source, extname(source))
	return key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
}

// A source or the objective that mentions another local file is a truncated plan when that file is not named. Refuse, and name the file.
export function requireUnnamedSources(workspace: string, sources: string[], objective: string) {
	const named = new Set(sources.map((source) => source.replace(/^\.\//, '')))
	const mentions: Array<[string, string]> = [['The objective', objective]]
	for (const source of sources) {
		try {
			mentions.push([source, readFileSync(join(workspace, source), 'utf8')])
		} catch {
			// An unreadable source is reported when the planner reads it.
		}
	}
	for (const [origin, text] of mentions) {
		for (const match of text.matchAll(/[A-Za-z0-9_./-]+\.(?:md|txt|json|csv|ya?ml|feature|html)\b/g)) {
			const file = match[0].replace(/^\.\//, '')
			if (named.has(file) || !existsSync(join(workspace, file)) || file === origin) continue
			const all = [...sources, file]
			requireWellFormed(
				false,
				`${origin} refers to ${file}, which exists and was not named as a source. The plan would be built from ${sources.join(', ') || 'no source'} only.`,
				`Open the plan again with every source: checkmate plan open <planId> --target <target>@<revision> ${all.map((item) => `--source ${item}`).join(' ')}.`
			)
		}
	}
}

export function openPlan(
	store: Store,
	actor: string | undefined,
	input: { planId?: string; target: string; request: unknown }
) {
	return write(store, { actor, command: 'plan open', subject: input.planId ?? '', input }, (operationId) => {
		const target = revisionReference(requireText(input.target, 'target (--target)'), 'target reference')
		requireWellFormed(target.revision !== null, `Name the target revision: --target ${target.id}@<revision>`)
		const profile = targetRevision(store, target.id, target.revision).profile
		const request = validate('plan-request', input.request)
		requireWellFormed(
			request.requirements?.length || request.context?.sources.length,
			'A plan request needs requirements or context sources'
		)
		index(request.requirements ?? [], 'id', 'requirement')
		requireUnnamedSources(store.workspace, request.context?.sources ?? [], request.objective)
		for (const tool of request.tools ?? [])
			if (typeof tool === 'string')
				requireWellFormed(
					profile.tools.some((known) => known.name === tool),
					`Unknown tool ${tool}. The target profile has: ${profile.tools.map((known) => known.name).join(', ') || 'no tools'}.`
				)
			else {
				toolCheck(tool)
				requireWellFormed(
					!profile.tools.some((known) => known.name === tool.name),
					`Tool ${tool.name} is in the target profile. Name it as a string.`
				)
			}
		const names = planTools(request, profile).map((tool) => tool.name)
		requireWellFormed(new Set(names).size === names.length, 'Duplicate tool name in the plan request')
		const body = canonical(request)
		const sources = request.context?.sources ?? []
		const planId = requireIdentifier(input.planId ?? suggestedPlanId(store.workspace, sources), 'plan ID')
		const data = {
			planId,
			// The reply says where the ID came from, so the person can see it and pass it next time.
			...(input.planId ? {} : { planIdFrom: sources[0] }),
			target: `${target.id}@${target.revision}`,
			sources,
		}
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

// A typed ID such as BS42 for BS-42 names the one plan whose ID is the same after case and punctuation are removed.
function similarPlanHint(store: Store, planId: string) {
	const key = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, '')
	const matches = all<{ plan_id: string }>(store, 'SELECT plan_id FROM plan_requests').filter(
		(row) => key(row.plan_id) === key(planId)
	)
	return matches.length === 1 ? `Did you mean ${matches[0].plan_id}? Use that exact ID.` : undefined
}

// The lines a driver needs to act on a saved plan: each check or requirement that is not ready, and the command to fix it.
export function notReadyReasons(store: Store, planId: string) {
	const row = one<{ body: string }>(store, 'SELECT body FROM latest_plans WHERE plan_id = ?', planId)
	if (!row) return []
	const plan = JSON.parse(row.body) as Plan
	const lines = [
		...plan.tests.flatMap((test) =>
			unverifiedAssertions(test, plan.requirements).map((id) => `Not ready: ${test.id}.${id}`)
		),
		...uncoveredRequirements(plan).map((id) => `Not ready: ${id} has no test`),
	]
	return lines.length ? [...lines, `Next: checkmate plan revise ${planId} with the fix for each line above.`] : []
}

export function planRequest(store: Store, planId: string) {
	const row = one<RequestRow>(store, 'SELECT * FROM plan_requests WHERE plan_id = ?', planId)
	requireCondition(row, `Unknown plan: ${planId}. Run plan open first.`, similarPlanHint(store, planId))
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
		data: dataSummary(store.workspace, target.profile.reset),
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

// A soft rule refuses the first save, with a corrected example. The next save of the same plan saves, and the test is not
// ready: status and plan show name its reason and the fix. Only the tests that a save adds or changes are checked.
const softRefusalTexts = [
	'positive control',
	'reads it from the source',
	'names no input value',
	'covers a required field',
	'has no test or gap',
	'serves',
]

function priorSoftRefusal(store: Store, planId: string) {
	const last = one<{ id: number | null }>(
		store,
		"SELECT max(rowid) AS id FROM operations WHERE subjects LIKE ? AND command = 'plan save' AND status = 'completed'",
		`%"plan:${planId}"%`
	)
	const refused = all<{ response: string }>(
		store,
		"SELECT response FROM operations WHERE response LIKE ? AND command = 'plan save' AND status = 'rejected' AND rowid > ?",
		`%"subject":"${planId}"%`,
		last?.id ?? 0
	)
	return refused.some((row) => softRefusalTexts.some((text) => row.response.includes(text)))
}

function softReason(test: Plan['tests'][number], problem: ReturnType<typeof softProblems>[number]) {
	if (problem.reason === 'needs_control')
		return `Test ${test.id} expects a refusal (${problem.check}) but has no positive control: nothing shows that the same request succeeds.`
	if (problem.reason === 'needs_source_check')
		return `Test ${test.id} changes state ("${test.action}") but no check reads it from the source.`
	if (problem.reason === 'needs_split')
		return `Test ${test.id} serves ${problem.check.split(', ').length} requirements (${problem.check}): a test serves one requirement or a group of at most three.`
	if (problem.reason === 'needs_required')
		return `Test ${test.id} covers a required field but has no check that leaves each required field empty and names the refusal.`
	return `Check ${test.id}.${problem.id} states a range but names no input value: "${problem.check}"`
}

// The complete corrected test: the control first, then the refusal, so the next save has both.
function correctedTest(test: Plan['tests'][number]) {
	const next = Math.max(0, ...test.assertions.map((assertion) => Number(assertion.id.replace(/\D/g, '')) || 0)) + 1
	const control = {
		id: `A${next}`,
		check: 'The same request with a valid value returns 200.',
		checkKind: 'deterministic',
		observe: 'HTTP status of the same request with a valid value',
		expected: '200',
	}
	return {
		id: test.id,
		title: test.title,
		requirementIds: test.requirementIds,
		capability: test.capability,
		operations: test.operations,
		dependsOn: test.dependsOn,
		preconditions: test.preconditions,
		action: test.action,
		assertions: [
			control,
			...test.assertions.map(({ id, check, checkKind, observe, expected, observeFrom }) => ({
				id,
				check,
				checkKind,
				observe,
				expected,
				observeFrom,
			})),
		],
	}
}

function requireChangedChecks(store: Store, plan: Plan, previous: Plan | undefined) {
	const before = new Map((previous?.tests ?? []).map((test) => [test.id, test]))
	const changed = plan.tests.filter((test) => {
		const old = before.get(test.id)
		return (
			!old ||
			old.action !== test.action ||
			canonical(old.assertions) !== canonical(test.assertions) ||
			canonical(old.requirementIds) !== canonical(test.requirementIds)
		)
	})
	const problems = changed.flatMap((test) =>
		softProblems(test, plan.requirements).map((problem) => ({ test, problem }))
	)
	const uncovered = uncoveredRequirements(plan)
	const covered = plan.requirements.length - uncovered.length
	const hasRevision = one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', plan.planId)
	if (!hasRevision && covered * 2 < plan.requirements.length && priorSoftRefusal(store, plan.planId))
		requireWellFormed(
			false,
			`Planning did not produce tests after two attempts: ${covered} of ${plan.requirements.length} criteria have tests. Nothing was saved as the plan.`,
			`Plan again: checkmate delegate plan ${plan.planId} --detach. Each criterion needs at least one test.`
		)
	if ((!problems.length && !uncovered.length) || priorSoftRefusal(store, plan.planId)) return
	const controls = changed.filter((test) =>
		problems.some((item) => item.test === test && item.problem.reason === 'needs_control')
	)
	const reasons = [
		...problems.map((item) => softReason(item.test, item.problem)),
		...(uncovered.length ? [`Requirement ${uncovered.join(', ')} has no test or gap.`] : []),
	]
	const corrections = [
		...(controls.length
			? [
					`Corrected test${controls.length > 1 ? 's' : ''}, with the control first: ${controls.map((test) => JSON.stringify(correctedTest(test))).join(' ')}`,
				]
			: []),
		...uncovered.map(
			(id) =>
				`Skeleton for ${id}: {"id": "T${id.replace(/\D/g, '')}", "title": "<what the test checks>", "requirementIds": ["${id}"], "capability": "<a target capability>", "operations": ["<an allowed operation>"], "dependsOn": [], "preconditions": [], "action": "<the step>", "assertions": [{"id": "A1", "check": "<${id} as one checkable value>", "checkKind": "deterministic", "observe": "<what is observed>", "expected": "<value>"}]}`
		),
		'Save again. A check or requirement that still breaks the rule is saved as not ready: plan show names it.',
	]
	requireWellFormed(false, reasons.join(' '), corrections.join(' '))
}

function checkedRevision(store: Store, draft: PlanDraft) {
	const plan = planCheck(derivePlan(draft))
	planTargetCheck(plan, targetRevision(store, plan.target.targetId, plan.target.revision).profile)
	const others = latestPlans(store)
	requireChangedChecks(store, plan, others.get(plan.planId))
	others.delete(plan.planId)
	dependencyCheck(plan, others)
	const body = canonical(plan)
	return { plan, body, sha256: digest(body) }
}

function revisionChange(plan: Plan, sha256: string): Change {
	const blockers = plan.gaps.filter((gap) => gap.status === 'open' && gap.severity === 'blocking')
	const missing = uncoveredRequirements(plan)
	const coverage = missing.length
		? [
				`${plan.requirements.length - missing.length} of ${plan.requirements.length} criteria have tests; ${missing.length} still need tests: run checkmate delegate revise ${plan.planId}`,
			]
		: []
	const warnings = [...dependencyWarnings(plan), ...coverage]
	return {
		reply: {
			status: blockers.length ? 'needs_decision' : 'completed',
			subject: `${plan.planId}@${plan.revision}`,
			reasons: blockers.map((gap) => `${gap.id}: ${gap.question}`),
			data: { planId: plan.planId, revision: plan.revision, sha256, ...(warnings.length ? { warnings } : {}) },
		},
		subjects: [`plan:${plan.planId}`, 'inbox'],
	}
}

export function storeRevision(store: Store, draft: PlanDraft, operationId: string): Change {
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
	if (one(store, 'SELECT 1 FROM plan_promotions WHERE plan_id = ? AND promoted_revision = ?', planId, revision))
		return 'promotion'
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
	input: { reference: string; candidate: unknown; expectSha256?: string; rationale?: string }
) {
	return write(
		store,
		{ actor, command: 'plan edit', subject: input.reference, input },
		(operationId, _at, writer) => {
			const base = editableRevision(store, input.reference, input.expectSha256)
			const candidate = validate('plan-candidate', input.candidate)
			return storeEditedPlan(store, operationId, base, candidate, writer, input.rationale)
		}
	)
}

export function patchPlan(
	store: Store,
	actor: string | undefined,
	input: { reference: string; patch: unknown; expectSha256?: string; rationale?: string }
) {
	return write(
		store,
		{ actor, command: 'plan edit', subject: input.reference, input },
		(operationId, _at, writer) => {
			if (!input.reference.includes('@'))
				return patchRules(store, operationId, input.reference, validate('plan-patch', input.patch))
			const base = editableRevision(store, input.reference, input.expectSha256)
			const patch = validate('plan-patch', input.patch)
			requireHeldRules(store, base.plan, patch)
			const candidate = patchedCandidate(base.plan, patch)
			return storeEditedPlan(store, operationId, base, candidate, writer, input.rationale)
		}
	)
}

function withoutRemovedTests(
	plan: Plan,
	candidate: PlanCandidate & { tests: Array<{ id: string; requirementIds: string[] }>; gaps: Gap[] }
) {
	const kept = new Set(candidate.tests.map((test) => test.id))
	const removed = plan.tests.map((test) => test.id).filter((id) => !kept.has(id))
	const stripped = candidate.gaps.map((gap) => ({
		...gap,
		testIds: gap.testIds.filter((id) => id.includes(':') || !removed.includes(id)),
	}))
	const closedGaps: Array<{ gapId: string; reason: string }> = []
	const gaps = stripped.map((gap) => {
		const lost = (candidate.gaps.find((item) => item.id === gap.id)?.testIds ?? []).filter((id) =>
			removed.includes(id)
		)
		const used =
			gap.testIds.length ||
			candidate.tests.some((test) => test.requirementIds.some((id) => gap.requirementIds.includes(id)))
		if (!lost.length || used || gap.status === 'not_needed') return gap
		closedGaps.push({
			gapId: gap.id,
			reason: `Not needed: only the removed tests ${lost.join(', ')} used this gap.`,
		})
		return { ...gap, status: 'not_needed' as const }
	})
	return { removed, stripped: { ...candidate, gaps: stripped }, closed: { ...candidate, gaps }, closedGaps }
}

function storeEditedPlan(
	store: Store,
	operationId: string,
	base: PlanRevision,
	candidate: PlanCandidate & { tests: Array<{ id: string; requirementIds: string[] }>; gaps: Gap[] },
	actor: string,
	rationale: string | undefined
) {
	const removal = withoutRemovedTests(base.plan, candidate)
	gapEditCheck(store, base.plan, removal.stripped)
	if (!removal.removed.length) return storeEdit(store, operationId, base, candidate)
	requireWellFormed(
		rationale?.trim(),
		`The edit removes ${removal.removed.join(', ')}. Give the reason with --rationale.`,
		'The new revision records who removed which tests and why.'
	)
	return storeEdit(store, operationId, base, removal.closed, {
		actor,
		rationale: rationale!.trim(),
		testIds: removal.removed,
		closedGaps: removal.closedGaps,
	})
}

function gapEditCheck(store: Store, plan: Plan, candidate: { tests: Array<{ id: string }>; gaps: Gap[] }) {
	const { gaps, tests } = candidate
	const pending = pendingDecisions(store, plan.planId).map((decision) => decision.gap_id)
	const kept = (id: string) => id.includes(':') || tests.some((test) => test.id === id)
	for (const old of plan.gaps) {
		if (old.status === 'open' && !pending.includes(old.id)) continue
		const now = gaps.find((gap) => gap.id === old.id)
		requireCondition(
			now && same(now, { ...old, testIds: old.testIds.filter(kept) }),
			`Gap ${old.id} has a decision. Only an open gap without a decision can change.`
		)
	}
	const open = planRunGaps(store, plan.planId).filter((item) => !item.adopted)
	for (const gap of gaps.filter((gap) => !plan.gaps.some((old) => old.id === gap.id)))
		requireCondition(
			!one(store, 'SELECT 1 FROM plan_gaps WHERE plan_id = ? AND gap_id = ?', plan.planId, gap.id) &&
				!open.some((item) => item.gap.id === gap.id),
			`Gap ID ${gap.id} is in use. Use a new ID.`
		)
}

export function adoptGaps(
	store: Store,
	actor: string | undefined,
	input: { reference: string; runId: string; gapIds?: string[]; expectSha256?: string }
) {
	return write(store, { actor, command: 'plan adopt-gaps', subject: input.reference, input }, (operationId) => {
		const base = editableRevision(store, input.reference, input.expectSha256)
		const planId = base.plan.planId
		const run = one<{ plan_id: string }>(store, 'SELECT plan_id FROM runs WHERE run_id = ?', input.runId)
		requireCondition(run, `Unknown run: ${input.runId}`)
		requireCondition(run.plan_id === planId, `Run ${input.runId} tests plan ${run.plan_id}, not ${planId}`)
		const recorded = planRunGaps(store, planId).filter((item) => item.runId === input.runId)
		const gaps =
			input.gapIds === undefined
				? recorded.filter((item) => !item.adopted).map((item) => item.gap)
				: input.gapIds.map((id) => {
						const item = recorded.find((item) => item.gap.id === id)
						requireCondition(item, `Run ${input.runId} has no gap ${id}`)
						requireCondition(!item.adopted, `Gap ${id} of run ${input.runId} is in plan ${planId}`)
						return item.gap
					})
		requireCondition(gaps.length, `Run ${input.runId} has no gap to adopt`)
		return adoption(store, operationId, base, input.runId, gaps)
	})
}

function adoption(store: Store, operationId: string, base: PlanRevision, runId: string, gaps: Gap[]): Change {
	const candidate = planCandidate(base.plan)
	const tested = runPlan(store, runId)
	const kept = gaps.map((gap) => currentScope(base.plan, tested, gap))
	const change = storeEdit(store, operationId, base, { ...candidate, gaps: [...candidate.gaps, ...kept] })
	change.reply.data.runId = runId
	change.reply.data.adopted = gaps.map((gap) => gap.id)
	change.subjects.push(`run:${runId}`)
	return change
}

function runPlan(store: Store, runId: string) {
	const run = one<{ plan_id: string; plan_revision: number }>(
		store,
		'SELECT plan_id, plan_revision FROM runs WHERE run_id = ?',
		runId
	)!
	return planRevision(store, run.plan_id, run.plan_revision).plan
}

function currentScope(plan: Plan, tested: Plan, gap: Gap): Gap {
	const exists = (id: string) => id.includes(':') || plan.tests.some((test) => test.id === id)
	const known = (id: string) => plan.requirements.some((requirement) => requirement.id === id)
	const testIds = gap.testIds.filter(exists)
	const removed = gap.testIds.filter((id) => !exists(id))
	const requirementIds =
		testIds.length || gap.requirementIds.length
			? gap.requirementIds.filter(known)
			: tested.tests
					.filter((test) => removed.includes(test.id))
					.flatMap((test) => test.requirementIds.filter(known))
	requireCondition(
		testIds.length || requirementIds.length || (!gap.testIds.length && !gap.requirementIds.length),
		`Gap ${gap.id} names only tests and requirements that ${plan.planId}@${plan.revision} does not have. Record a new gap.`
	)
	return { ...gap, testIds, requirementIds: [...new Set(requirementIds)] }
}

export type RunGap = { runId: string; gap: Gap; adopted: boolean; at: string }

export function planRunGaps(store: Store, planId: string): RunGap[] {
	return all<{ run_id: string; body: string; adopted: number; at: string }>(
		store,
		`SELECT g.run_id, g.body, o.at, EXISTS (SELECT 1 FROM plan_gaps p
			WHERE p.plan_id = r.plan_id AND p.revision > r.plan_revision AND p.gap_id = g.id) AS adopted
		FROM run_gaps g JOIN runs r ON r.run_id = g.run_id JOIN operations o ON o.id = g.operation_id
		WHERE r.plan_id = ? ORDER BY g.rowid`,
		planId
	).map((row) => ({ runId: row.run_id, gap: JSON.parse(row.body), adopted: row.adopted === 1, at: row.at }))
}

function editableRevision(store: Store, text: string, expectSha256: string | undefined) {
	const reference = revisionReference(requireText(text, 'plan reference'), 'plan reference')
	requireWellFormed(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`)
	const base = planRevision(store, reference.id, reference.revision)
	const subject = `${reference.id}@${reference.revision}`
	const latest = planRevision(store, reference.id).plan.revision
	requireCondition(
		latest === reference.revision,
		`${subject} is not the latest revision. Edit ${reference.id}@${latest}.`
	)
	expectDigest(base.sha256, expectSha256, subject)
	return base
}

type Removal = {
	actor: string
	rationale: string
	testIds: string[]
	closedGaps: Array<{ gapId: string; reason: string }>
}

export function storeEdit(
	store: Store,
	operationId: string,
	base: PlanRevision,
	value: unknown,
	removal?: Removal
): Change {
	const candidate = validate('plan-candidate', value)
	const planId = base.plan.planId
	const frozen = removal ? 'removal' : frozenRevision(store, planId, base.plan.revision)
	const { coverage, tests, ...kept } = structuredClone(base.plan)
	const draft: PlanDraft = {
		...kept,
		...(frozen ? { revision: base.plan.revision + 1, previousRevision: base.plan.revision } : {}),
		requirements: candidate.requirements ?? kept.requirements,
		tests: candidate.tests,
		gaps: candidate.gaps,
		...(removal ? { removals: [...(kept.removals ?? []), { revision: base.plan.revision + 1, ...removal }] } : {}),
	}
	for (const decision of pendingDecisions(store, planId))
		requireCondition(
			draft.gaps.some(
				(gap) => gap.id === decision.gap_id && (gap.status === 'open' || gap.status === 'not_needed')
			),
			`Gap ${decision.gap_id} has a pending decision ${decision.id}. Keep the gap open.`
		)
	for (const test of draft.tests) {
		const before = base.plan.tests.find((item) => item.id === test.id)?.assertions ?? []
		const used = usedAssertionIds(store, planId, test.id)
		for (const assertion of test.assertions)
			requireWellFormed(
				before.some((item) => item.id === assertion.id) || !used.includes(assertion.id),
				`Assertion ID ${test.id}.${assertion.id} was used in an earlier revision. Use a new ID.`
			)
	}
	if (frozen) {
		const change = storeRevision(store, draft, operationId)
		applyEditResult(change)
		change.reply.data.edit = 'new_revision'
		change.reply.data.reason = frozen
		if (removal) {
			change.reply.data.removed = removal.testIds
			change.reply.data.closedGaps = removal.closedGaps
		}
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
	applyEditResult(change)
	change.reply.data.edit = 'in_place'
	change.reply.data.previousSha256 = base.sha256
	return change
}

// A plan edit that was applied reports completed. Its open gaps are warnings, and the plan state is a separate field.
function applyEditResult(change: Change) {
	const open = change.reply.status === 'needs_decision' ? change.reply.reasons : []
	change.reply.status = 'completed'
	change.reply.reasons = open.map((reason) => `warning: ${reason}`)
	change.reply.data.planState = open.length ? 'needs_decision' : 'ready'
}

function patchedCandidate(plan: Plan, patch: PlanPatch): Required<PlanCandidate> {
	const candidate = planCandidate(structuredClone(plan))
	return {
		requirements: patchList(candidate.requirements, patch.requirements, 'requirement', (item, id, change) =>
			item ? { ...item, ...change } : { id, ...newFields(`requirement ${id}`, change, ['text', 'source']) }
		),
		tests: patchList(candidate.tests, patch.tests, 'test', (item, id, change) => {
			const { assertions, ...fields } = change
			const test = item
				? { ...item, ...fields }
				: {
						id,
						assertions: [],
						...newFields(
							`test ${id}`,
							fields,
							['title', 'requirementIds', 'capability', 'operations', 'action'],
							{ dependsOn: [], preconditions: [] }
						),
					}
			test.assertions = patchList(test.assertions, assertions, `assertion in test ${id}`, (old, key, value) =>
				old
					? { ...old, ...value }
					: { id: key, ...newFields(`assertion ${id}.${key}`, value, ['check', 'checkKind']) }
			)
			return test
		}),
		gaps: patchList(candidate.gaps, patch.gaps, 'gap', (item, id, change) =>
			item
				? { ...item, ...change }
				: {
						id,
						status: 'open',
						decisionId: null,
						...newFields(`gap ${id}`, change, [
							'severity',
							'requirementIds',
							'testIds',
							'question',
							'consequence',
						]),
					}
		),
	}
}

export function patchList<T extends { id: string }, C extends object>(
	items: T[],
	changes: Record<string, C | null> | undefined,
	name: string,
	apply: (item: T | undefined, id: string, change: C) => T
) {
	const result = [...items]
	for (const [id, change] of Object.entries(changes ?? {})) {
		const position = result.findIndex((item) => item.id === id)
		if (change === null) {
			requireWellFormed(position >= 0, `Cannot remove unknown ${name} ${id}`)
			result.splice(position, 1)
		} else if (position >= 0) result[position] = apply(result[position], id, change)
		else result.push(apply(undefined, id, change))
	}
	return result
}

export function newFields<C extends object>(name: string, change: C, required: string[], defaults: Partial<C> = {}) {
	const missing = required.filter((field) => !(field in change))
	requireWellFormed(!missing.length, `New ${name} needs ${missing.join(', ')}`)
	return { ...defaults, ...change } as Required<C>
}

export function savePlan(store: Store, actor: string | undefined, input: { planId: string; candidate: unknown }) {
	return write(store, { actor, command: 'plan save', subject: input.planId, input }, (operationId) => {
		const { request, target } = planRequest(store, input.planId)
		requireCondition(
			!one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', input.planId),
			`Plan ${input.planId} has revision 1. Use plan edit, or gap answer and plan revise, to change it.`
		)
		const candidate = validate('plan-candidate', input.candidate)
		const requirements = candidateRequirements(
			request,
			candidate.requirements,
			sourceCriteria(store.workspace, request)
		)
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

// Numbered lines in the context sources are the criteria. The plan must cover each one with a requirement.
function sourceCriteria(workspace: string, request: PlanRequest) {
	return (request.context?.sources ?? []).flatMap((source) => {
		try {
			return readFileSync(join(workspace, source), 'utf8')
				.split('\n')
				.flatMap((line) => {
					const match = /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/.exec(line)
					return match ? [match[1]] : []
				})
		} catch {
			return []
		}
	})
}

function candidateRequirements(request: PlanRequest, drafted: Plan['requirements'] | undefined, criteria: string[]) {
	if (request.requirements?.length) {
		requireWellFormed(
			!drafted,
			'The plan request names the requirements. Do not add requirements to the candidate.'
		)
		return request.requirements
	}
	const sources = request.context?.sources ?? []
	requireWellFormed(
		drafted?.length,
		`The plan request has no requirements. Draft them from the context sources: ${sources.join(', ')}`,
		`Send the requirements as the numbered criteria of the source, for example: ${JSON.stringify(criteria.slice(0, 3).map((text, i) => ({ id: `R${i + 1}`, text, source: sources[0] })))}`
	)
	index(drafted, 'id', 'requirement')
	requireWellFormed(
		criteria.length < 2 || drafted.length >= criteria.length,
		`The sources list ${criteria.length} numbered criteria, but the plan has ${drafted.length} requirements. The plan was opened with: ${sources.join(', ')}. If a source file is missing from the plan, open a new plan ID with every source: checkmate plan open <new-plan-id> --target <target>@<revision> ${sources.map((source) => `--source ${source}`).join(' ')} --source <missing-file>.`,
		`Write one requirement for each criterion, with its test or gap. Criteria: ${criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join(' ')}`
	)
	for (const requirement of drafted)
		requireWellFormed(
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

// A person can drop a requirement with no open question. The drop is recorded as a gap answer against a new gap for that
// requirement, so revise applies it with the same two-way check. Two writes: the gap, then the answer.
export function scopeDrop(
	store: Store,
	actor: string | undefined,
	input: { planId: string; requirementId: string; source: string; rationale: string }
) {
	const plan = planRevision(store, input.planId).plan
	const requirement = plan.requirements.find((item) => item.id === input.requirementId)
	requireWellFormed(requirement, `Unknown requirement ${input.requirementId} in plan ${input.planId}.`)
	// An open gap on the dropped requirement is closed by this decision, so no gap is left on a removed requirement.
	const covering = plan.gaps.filter((gap) => gap.status === 'open' && gap.requirementIds.includes(requirement!.id))
	requireWellFormed(
		covering.every((gap) => gap.requirementIds.length === 1),
		`A gap covers ${requirement!.id} and other requirements. Answer it with gap answer first, then drop ${requirement!.id}.`,
		`checkmate gap answer ${input.planId} <gapId> --kind clarify --value "<answer>" --source <file>`
	)
	const value = `Drop ${requirement!.id} "${requirement!.text}". ${input.rationale}`
	if (covering.length) {
		let reply: Reply | undefined
		for (const gap of covering) {
			reply = answerGap(store, actor, {
				planId: input.planId,
				gapId: gap.id,
				kind: 'clarify',
				value,
				source: input.source,
				rationale: input.rationale,
			})
			if (reply.status !== 'completed') return reply
		}
		return reply!
	}
	const gapId = unusedId(
		'G',
		plan.gaps.map((gap) => gap.id)
	)
	const tests = plan.tests.filter((test) => test.requirementIds.includes(requirement!.id)).map((test) => test.id)
	const added = patchPlan(store, actor, {
		reference: `${input.planId}@${plan.revision}`,
		patch: {
			gaps: {
				[gapId]: {
					severity: 'blocking',
					requirementIds: [requirement!.id],
					testIds: tests,
					question: `Drop ${requirement!.id} "${requirement!.text}" from the plan?`,
					consequence: 'The requirement and its tests leave the plan on the next revision.',
				},
			},
		},
		rationale: input.rationale,
	})
	if (added.status !== 'completed') return added
	return answerGap(store, actor, {
		planId: input.planId,
		gapId,
		kind: 'clarify',
		value,
		source: input.source,
		rationale: input.rationale,
	})
}

export function answerGap(store: Store, actor: string | undefined, input: GapAnswer) {
	return write(store, { actor, command: 'gap answer', subject: input.planId, input }, (operationId, at, actor) => {
		const kind = requireChoice(input.kind, decisionKinds, 'decision kind (--kind)')
		const value = requireText(input.value, 'decision value (--value)')
		const rationale = requireText(input.rationale, 'rationale (--rationale)')
		const source = input.source ?? null
		if (source !== null) requireText(source, 'source (--source)')
		requireWellFormed(kind !== 'clarify' || source, 'A clarification needs a source (--source)')
		if (input.gapId.includes('/')) {
			planRequest(store, input.planId)
			const entry = answerQuestion(store, actor, operationId, {
				...input,
				kind,
				value,
				source,
				rationale,
				questionId: input.gapId,
			})
			return {
				reply: completed(input.planId, { planId: input.planId, gapId: input.gapId, answerId: entry.id, kind }),
				subjects: [`plan:${input.planId}`, 'inbox'],
			}
		}
		const answered = planRevision(store, input.planId)
		expectDigest(answered.sha256, input.expectSha256, `${input.planId}@${answered.plan.revision}`)
		const adopted = answered.plan.gaps.some((gap) => gap.id === input.gapId)
			? null
			: adoptRunGap(store, operationId, answered, input.gapId)
		const latest = adopted ? planRevision(store, input.planId) : answered
		const subject = `${input.planId}@${latest.plan.revision}`
		const gap = latest.plan.gaps.find((gap) => gap.id === input.gapId)!
		requireCondition(
			gap.status === 'open',
			`Gap ${gap.id} is ${gap.status} in ${subject}. Only an open gap takes a decision.`
		)
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
				...(adopted
					? {
							adopted: {
								runId: adopted.reply.data.runId,
								revision: latest.plan.revision,
								edit: adopted.reply.data.edit,
							},
						}
					: {}),
			}),
			subjects: adopted ? adopted.subjects : [`plan:${input.planId}`, 'inbox'],
		}
	})
}

function adoptRunGap(store: Store, operationId: string, base: PlanRevision, gapId: string) {
	const subject = `${base.plan.planId}@${base.plan.revision}`
	const found = planRunGaps(store, base.plan.planId).find((item) => item.gap.id === gapId && !item.adopted)
	requireCondition(found, `Unknown gap ${gapId} in ${subject}`)
	return adoption(store, operationId, base, found.runId, [found.gap])
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

// Tests with a check that code cannot verify or that states more than one value. A revise migrates them.
export function migrationTests(plan: Plan) {
	return plan.tests
		.filter((test) =>
			test.assertions.some((assertion) => unverifiedCheck(assertion) || compoundCheck(assertion.check))
		)
		.map((test) => test.id)
}

export const migrationReason = 'migrate checks to the current shape'

// A drop answer names a criterion in the clauses that contain its drop word. The requirement whose text shares the most of
// those words is the one it drops. A tie or no shared word means the requirement is not identified.
const dropWording = /\b(drop|dropped|drops|remove|removed)\b/i
const dropStopWords = new Set([
	'drop',
	'dropped',
	'drops',
	'remove',
	'removed',
	'criterion',
	'criteria',
	'scope',
	'that',
	'this',
	'with',
	'from',
	'then',
	'should',
	'there',
	'their',
	'have',
	'been',
	'will',
])
function wordsOf(text: string) {
	return new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !dropStopWords.has(word)))
}
export function droppedRequirement(requirements: Plan['requirements'], value: string): string | null {
	const clauses = value
		.split(/[.;,]|\band\b|\bso\b/i)
		.filter((clause) => dropWording.test(clause) || /\bout of scope\b/i.test(clause))
	const words = wordsOf(clauses.join(' '))
	const scored = requirements
		.map((requirement) => ({
			id: requirement.id,
			score: [...wordsOf(requirement.text)].filter((word) => words.has(word)).length,
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
	if (!scored.length || (scored.length > 1 && scored[0].score === scored[1].score)) return null
	return scored[0].id
}

// The removed requirements and tests that no drop answer named. An empty list means the removals match the answers.
export function unrequestedRemovals(
	dropped: Set<string>,
	droppedTests: Set<string>,
	removedRequirements: string[],
	removedTests: string[]
) {
	return [
		...removedRequirements.filter((id) => !dropped.has(id)),
		...removedTests.filter((id) => !droppedTests.has(id)),
	]
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
		const migrating = decisions.length === 0 && migrationTests(base.plan).length > 0
		requireCondition(
			decisions.length > 0 || migrating,
			`Plan ${input.planId} has no pending decision and no check to migrate. Record one with gap answer first.`
		)
		const delta = validate('plan-delta', input.delta)
		const { coverage, ...draft } = structuredClone(base.plan)
		draft.revision = base.plan.revision + 1
		draft.previousRevision = base.plan.revision
		for (const decision of decisions) {
			const gap = draft.gaps.find((gap) => gap.id === decision.gap_id)!
			if (gap.status !== 'not_needed') gap.status = decision.kind === 'defer' ? 'deferred' : 'resolved'
			gap.decisionId = decision.id
			draft.decisions.push(decisionSnapshot(decision))
			if (decision.kind === 'accept_assumption')
				draft.assumptions.push({ decisionId: decision.id, text: decision.value })
		}
		const affected = migrating
			? migrationTests(base.plan)
			: affectedTests(
					base.plan,
					decisions.map((decision) => decision.gap_id)
				).map((test) => test.id)
		const onlyAffected = migrating
			? `Change only the tests with checks to migrate: ${affected.join(', ')}.`
			: `Change only the tests that the pending decisions affect: ${affected.join(', ') || 'none'}.`
		for (const [id, change] of Object.entries(delta.requirements ?? {})) {
			if (change.remove) continue
			const existing = draft.requirements.find((requirement) => requirement.id === id)
			if (existing) {
				if (change.text !== undefined) existing.text = change.text
				if (change.source !== undefined) existing.source = change.source
				if (change.area !== undefined) existing.area = change.area
				continue
			}
			requireWellFormed(
				change.text !== undefined && change.source !== undefined,
				`New requirement ${id} needs text and source`,
				`Send {"requirements": {"${id}": {"text": "<the requirement>", "source": "<file or conversation>"}}}.`
			)
			draft.requirements.push({
				id,
				text: change.text!,
				source: change.source!,
				...(change.area ? { area: change.area } : {}),
			})
		}
		const removedTests: string[] = []
		for (const [testId, change] of Object.entries(delta.tests)) {
			const test = draft.tests.find((test) => test.id === testId)
			if (change.remove) {
				requireWellFormed(test, `Unknown test in delta: ${testId}`, onlyAffected)
				requireCondition(
					affected.includes(testId),
					`Test ${testId} is not affected by a pending decision. A revision changes only affected tests.`,
					onlyAffected
				)
				removedTests.push(testId)
				continue
			}
			if (!test) {
				draft.tests.push(newTest(draft, testId, change, usedAssertionIds(store, input.planId, testId)))
				continue
			}
			requireCondition(
				affected.includes(testId),
				`Test ${testId} is not affected by a pending decision. A revision changes only affected tests.`,
				onlyAffected
			)
			replaceTest(test, change, usedAssertionIds(store, input.planId, testId))
		}
		for (const test of draft.tests)
			for (const assertion of test.assertions)
				requireWellFormed(
					!compoundCheck(assertion.check),
					`Assertion ${test.id}.${assertion.id} checks more than one value: "${assertion.check}"`,
					'Send one assertion for each value. Each assertion checks one expected value, so split the check into two assertions.'
				)
		for (const [gapId, change] of Object.entries(delta.gaps ?? {})) {
			requireWellFormed(!draft.gaps.some((gap) => gap.id === gapId), `Gap ${gapId} already exists`)
			for (const testId of change.testIds)
				requireCondition(
					affected.includes(testId),
					`Test ${testId} is not affected by a pending decision. A revision changes only affected tests.`,
					onlyAffected
				)
			draft.gaps.push({
				id: gapId,
				severity: 'blocking',
				status: 'open',
				requirementIds: [],
				testIds: change.testIds,
				question: change.question,
				consequence: change.consequence,
				decisionId: null,
			})
		}
		const removedRequirements = removeRequirements(draft, delta.requirements ?? {}, removedTests)
		if (removedTests.length) removeTests(draft, removedTests)
		// Only what a drop answer names may be removed. A removal that no answer asked for is refused, not saved.
		const dropped = new Set(
			decisions
				.filter((decision) => decision.kind === 'clarify' && dropWording.test(decision.value))
				.map((decision) => droppedRequirement(base.plan.requirements, decision.value))
				.filter((id): id is string => id !== null)
		)
		const droppedTests = new Set(
			base.plan.tests.filter((test) => test.requirementIds.some((id) => dropped.has(id))).map((test) => test.id)
		)
		for (const id of unrequestedRemovals(dropped, droppedTests, removedRequirements, removedTests))
			requireWellFormed(
				false,
				`The revision removes ${id}, which no answer drops.`,
				`Keep ${id}. Send only the requirements and tests that the answers drop, with {"remove": true}.`
			)
		for (const test of draft.tests)
			requireWellFormed(
				test.assertions.length > 0 || testReadiness(draft.gaps, test) !== 'ready',
				`Ready test ${test.id} needs one or more assertions`,
				`Add an assertion to ${test.id} in the delta: {"tests": {"${test.id}": {"assertions": {"${unusedId('A', usedAssertionIds(store, input.planId, test.id))}": {"check": "<expected result>", "checkKind": "deterministic"}}}}}. When no decision or source gives an expected value, use "checkKind": "agent_observation" with a check that records the behavior and checks only what the sources state.`
			)
		// An answer that drops a criterion must leave that requirement and its tests out of the revision. The requirement
		// is found from the answer's own wording, not from the planner's gap links.
		for (const decision of decisions) {
			if (decision.kind !== 'clarify' || !dropWording.test(decision.value)) continue
			const gap = draft.gaps.find((gap) => gap.id === decision.gap_id)!
			const target = droppedRequirement(base.plan.requirements, decision.value)
			const listed = base.plan.requirements
				.map((requirement) => `${requirement.id} "${requirement.text}"`)
				.join('; ')
			requireWellFormed(
				target !== null,
				`The answer to ${gap.id} drops a criterion, but no requirement matches its wording. Requirements: ${listed}.`,
				`Name the requirement the answer removes, and remove it with {"requirements": {"<id>": {"remove": true}}} and its tests with {"tests": {"<testId>": {"remove": true}}}.`
			)
			const kept =
				draft.requirements.some((requirement) => requirement.id === target) ||
				draft.tests.some((test) => test.requirementIds.includes(target!))
			requireWellFormed(
				!kept,
				`The answer to ${gap.id} drops ${target}, but the revision still has it.`,
				`Remove ${target} with {"requirements": {"${target}": {"remove": true}}} and remove its tests with {"tests": {"<testId>": {"remove": true}}}.`
			)
		}
		const change = storeRevision(store, draft, operationId)
		for (const decision of decisions)
			execute(store, 'UPDATE decisions SET applied_revision = ? WHERE id = ?', draft.revision, decision.id)
		change.reply.data.applied = decisions.map((decision) => decision.id)
		if (migrating) change.reply.data.reason = migrationReason
		change.reply.data.removed = { tests: removedTests, requirements: removedRequirements }
		return change
	})
}

// A requirement goes only when its tests go in the same delta. Gaps and dependencies drop the removed IDs.
function removeRequirements(
	draft: Pick<Plan, 'requirements' | 'tests' | 'gaps'>,
	requested: Record<string, { remove?: boolean }>,
	removedTests: string[]
) {
	const removed: string[] = []
	for (const [id, change] of Object.entries(requested)) {
		requireWellFormed(
			draft.requirements.some((requirement) => requirement.id === id),
			`Unknown requirement in delta: ${id}`
		)
		if (!change.remove) continue
		const kept = draft.tests
			.filter((test) => test.requirementIds.includes(id) && !removedTests.includes(test.id))
			.map((test) => test.id)
		requireCondition(
			kept.length === 0,
			`Requirement ${id} still has tests: ${kept.join(', ')}. Remove those tests in the same delta.`
		)
		removed.push(id)
	}
	draft.requirements = draft.requirements.filter((requirement) => !removed.includes(requirement.id))
	for (const gap of draft.gaps) gap.requirementIds = gap.requirementIds.filter((id) => !removed.includes(id))
	return removed
}

function removeTests(draft: Pick<Plan, 'tests' | 'gaps'>, removedTests: string[]) {
	draft.tests = draft.tests.filter((test) => !removedTests.includes(test.id))
	for (const test of draft.tests) test.dependsOn = test.dependsOn.filter((id) => !removedTests.includes(id))
	for (const gap of draft.gaps) gap.testIds = gap.testIds.filter((id) => !removedTests.includes(id))
}

function usedAssertionIds(store: Store, planId: string, testId: string) {
	return all<{ id: string }>(
		store,
		"SELECT DISTINCT a.value ->> '$.id' AS id FROM plan_tests t, json_each(t.test, '$.assertions') a WHERE t.plan_id = ? AND t.test_id = ?",
		planId,
		testId
	).map((row) => row.id)
}

// The delta sends each affected test whole. The code keeps an assertion's ID when its check text is unchanged.
type TestChange = NonNullable<PlanDelta['tests'][string]>
function replaceTest(test: Test, change: TestChange, used: string[]) {
	if (change.title !== undefined) test.title = change.title
	if (change.requirementIds !== undefined) test.requirementIds = change.requirementIds
	if (change.capability !== undefined) test.capability = change.capability
	if (change.operations !== undefined) test.operations = change.operations
	if (change.dependsOn !== undefined) test.dependsOn = change.dependsOn
	if (change.preconditions !== undefined) test.preconditions = change.preconditions
	if (change.action !== undefined) test.action = change.action
	if (change.assertions === undefined) return
	const previous = test.assertions
	const issued: string[] = []
	test.assertions = change.assertions.map((item) => {
		const kept = previous.find((existing) => existing.check === item.check)
		const id = kept?.id ?? unusedId('A', [...used, ...issued])
		issued.push(id)
		return {
			id,
			check: item.check,
			checkKind: item.checkKind,
			...(item.observe !== undefined ? { observe: item.observe } : {}),
			...(item.expected !== undefined ? { expected: item.expected } : {}),
		}
	})
}

function newTest(
	draft: Pick<Plan, 'requirements' | 'tests' | 'gaps'>,
	id: string,
	change: TestChange,
	used: string[]
): Test {
	const missing = ['title', 'requirementIds', 'capability', 'operations', 'action', 'assertions'].filter(
		(field) => change[field as keyof TestChange] === undefined
	)
	requireWellFormed(
		missing.length === 0,
		`New test ${id} needs ${missing.join(', ')}`,
		`Send the whole test: {"tests": {"${id}": {"title": "...", "requirementIds": ["R1"], "capability": "http", "operations": ["read"], "action": "...", "assertions": [{"check": "<one expected value>", "checkKind": "deterministic"}]}}}.`
	)
	const test = {
		id,
		title: '',
		requirementIds: [],
		capability: '',
		operations: [],
		readiness: 'ready',
		gapIds: [],
		dependsOn: [],
		preconditions: [],
		action: '',
		assertions: [],
	} as unknown as Test
	replaceTest(test, change, used)
	test.gapIds = draft.gaps.filter((gap) => gap.testIds.includes(id)).map((gap) => gap.id)
	test.readiness = testReadiness(draft.gaps, test)
	return test
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
		requireWellFormed(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`)
		const revision = planRevision(store, reference.id, reference.revision)
		const subject = `${reference.id}@${reference.revision}`
		latestCheck(store, reference.id, reference.revision)
		expectDigest(revision.sha256, input.expectSha256, subject)
		expectDecision(store, 'plan', subject, input.expectDecision)
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

function latestCheck(store: Store, planId: string, revision: number) {
	const latest = planRevision(store, planId).plan.revision
	requireCondition(latest === revision, `${planId}@${revision} is not the latest revision. Use ${planId}@${latest}.`)
}

export function recordApproval(
	store: Store,
	actor: string,
	operationId: string,
	input: {
		kind: 'plan' | 'result' | 'claim'
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

export function decisionToken(store: Store, kind: 'plan' | 'result', subject: string) {
	return (
		one<{ id: string }>(
			store,
			'SELECT id FROM approvals WHERE subject_kind = ? AND subject_id = ? ORDER BY rowid DESC LIMIT 1',
			kind,
			subject
		)?.id ?? 'none'
	)
}

export function expectDecision(store: Store, kind: 'plan' | 'result', subject: string, expected: string | undefined) {
	if (expected === undefined) return
	requireCondition(
		decisionToken(store, kind, subject) === expected,
		`${subject} has a newer decision. Read it again before you decide.`
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
	requireWellFormed(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`)
	const revision = planRevision(store, reference.id, reference.revision)
	const { plan } = revision
	const subject = `${plan.planId}@${plan.revision}`
	const permanent = input.permanent ? permanentSelection(store, plan.planId, input.permanent) : null
	if (permanent) {
		requireCondition(permanent.revision === plan.revision, `Run must use ${permanent.reference}.`)
		requireCondition(
			JSON.stringify(input.tests) === JSON.stringify(permanent.tests),
			`Permanent run must select exactly the tests of ${permanent.reference}.`
		)
	} else latestCheck(store, plan.planId, plan.revision)
	const target = targetRevision(store, plan.target.targetId, plan.target.revision)
	const build = requireText(input.build, 'application build (--build)')
	const partial = requireChoice(input.partial ?? 'ready_only', partialModes, 'partial execution (--partial)')
	const tests = index(plan.tests, 'id', 'test')
	const ready =
		(input.tests === undefined && partial === 'ready_only') || input.retestOf
			? readySelection(store, plan, build)
			: null
	const selection =
		input.tests === undefined && partial === 'ready_only' ? ready! : givenSelection(input.tests, tests, subject)
	const selected = selection.tests
	requireDataFor(
		targetRevision(store, target.profile.targetId).profile,
		selected.flatMap((id) => tests.get(id)?.operations ?? []),
		`Run ${subject}`,
		targetWebUrl(store, target.profile.targetId)
	)
	if (input.retestOf) retestCheck(store, input.retestOf, plan, build, input.instance)
	const earlier = input.retestOf ? retestDefects(store, input.retestOf) : []
	const reasons: string[] = []
	const hints: string[] = []
	const status = `Run checkmate status ${plan.planId} to see who acts next.`
	const partialHint = `To run only the tests that no open blocking gap affects, add --partial ready_only.`
	if (!selected.length) {
		reasons.push(`No test is ready in ${subject}`)
		hints.push(status)
	}
	if (input.retestOf)
		for (const [id, why] of retestSelection(plan, ready!.tests, earlier))
			if (!selected.includes(id)) {
				reasons.push(`Retest of ${input.retestOf} must select ${id}: ${why}`)
				hints.push(`Add ${id} to --tests.`)
			}
	// Readiness belongs to the latest profile: setup saves a new revision when the application answers.
	const live = targetRevision(store, plan.target.targetId)
	if (!live.profile.readyForLiveExecution) {
		reasons.push(`Target prerequisites are not ready: ${plan.target.targetId}@${live.revision}`)
		hints.push(readinessHint(store, plan.target.targetId))
	}
	const approval = planApproval(store, plan, revision.sha256)
	if (permanent ? approval.rejected : approval.policy === 'required' && !approval.approved) {
		reasons.push(`Plan ${subject} is not approved`)
		hints.push(`The oracle must approve ${subject}. ${status}`)
	}
	if (partial === 'wait_for_resolution')
		for (const gap of plan.gaps)
			if (gap.status === 'open' && gap.severity === 'blocking') {
				reasons.push(`Open blocking gap: ${gap.id}`)
				hints.push(partialHint)
			}
	const runGaps = partial === 'wait_for_resolution' ? blockingRunGaps(store, plan.planId) : []
	for (const id of selected) {
		const test = tests.get(id)!
		for (const assertion of test.assertions) {
			if (compoundCheck(assertion.check)) {
				reasons.push(`Assertion ${id}.${assertion.id} checks more than one value: ${assertion.check}`)
				hints.push(
					`Revise the plan so that each assertion checks one value: checkmate delegate revise ${plan.planId}.`
				)
			}
			if (unverifiedCheck(assertion)) {
				reasons.push(
					`Assertion ${id}.${assertion.id} is a deterministic check without an expected value: ${assertion.check}`
				)
				hints.push(`Migrate the checks to the current shape: checkmate delegate revise ${plan.planId}.`)
			}
		}
		if (test.readiness !== 'ready') {
			reasons.push(`Test is not ready: ${id}`)
			hints.push(`Remove ${id} from --tests, or leave out --tests and add --partial ready_only.`)
		}
		const runGap = runGapAffecting(runGaps, test)
		if (runGap) {
			reasons.push(runGapReason(runGap, id))
			hints.push(partialHint)
		}
		if (!target.profile.capabilities.includes(test.capability))
			reasons.push(`Missing capability: ${test.capability}`)
		if (!test.operations.every((operation) => operationAllowed(target.profile, operation)))
			reasons.push(`Operation is not permitted: ${id}`)
		if (!test.assertions.length) reasons.push(`Test has no assertions: ${id}`)
		for (const dependency of test.dependsOn)
			if (!dependency.includes(':') && !selected.includes(dependency)) {
				reasons.push(`Missing prerequisite: ${dependency}`)
				hints.push(`Add ${dependency} to --tests.`)
			}
	}
	for (const id of selected)
		for (const dependency of tests.get(id)!.dependsOn.filter((dependency) => dependency.includes(':'))) {
			const cause = dependencyBlock(store, dependency, build)
			if (cause) {
				reasons.push(`Blocked by ${dependency}: ${cause}`)
				hints.push(`Run checkmate status ${testReference(dependency).planId} to see who acts next.`)
			}
		}
	return {
		reply: {
			status: reasons.length ? ('needs_decision' as const) : ('completed' as const),
			subject,
			reasons: [...new Set(reasons)],
			...(hints.length ? { hint: [...new Set(hints)].join(' ') } : {}),
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
		retestDefects: earlier,
	}
}

function retestSelection(plan: Plan, selectable: string[], earlier: RetestDefect[]) {
	const required = new Map<string, string>()
	for (const defect of earlier)
		for (const id of defect.testIds)
			if (selectable.includes(id) && !required.has(id))
				required.set(id, `it has open defect ${defect.findingId} of ${defect.runId}`)
	for (const test of plan.tests)
		if (test.metadata?.type === 'regression' && selectable.includes(test.id) && !required.has(test.id))
			required.set(test.id, 'it is a regression test')
	return required
}

type LeftOut = { testId: string; reason: string }

function givenSelection(selected: string[] | undefined, tests: Map<string, Test>, subject: string) {
	requireWellFormed(
		Array.isArray(selected) && selected.length > 0,
		'Select one or more tests with --tests, or use --partial ready_only'
	)
	requireWellFormed(new Set(selected).size === selected.length, 'Duplicate test in --tests')
	references(selected, tests, `test in ${subject}`)
	return { tests: selected, leftOut: [] as LeftOut[] }
}

function blockingRunGaps(store: Store, planId: string) {
	return planRunGaps(store, planId).filter((item) => !item.adopted && item.gap.severity === 'blocking')
}

function runGapAffecting(runGaps: RunGap[], test: Test) {
	return runGaps.find((item) => gapsAffecting([item.gap], test).length > 0)
}

function runGapReason(runGap: RunGap, testId: string) {
	return `Open blocking gap ${runGap.gap.id} of ${runGap.runId} affects ${testId}`
}

export function openRunGapReasons(store: Store, planId: string, tests: Test[]) {
	const runGaps = blockingRunGaps(store, planId)
	return tests.flatMap((test) => {
		const runGap = runGapAffecting(runGaps, test)
		return runGap ? [runGapReason(runGap, test.id)] : []
	})
}

export function deferredPrerequisites(plan: Plan) {
	const deferred = new Map<string, string>()
	const root = (id: string) => {
		const test = plan.tests.find((item) => item.id === id)
		if (test?.readiness === 'deferred') return id
		return deferred.get(id)
	}
	for (let changed = true; changed;) {
		changed = false
		for (const test of plan.tests.filter((item) => item.readiness === 'ready' && !deferred.has(item.id))) {
			const prerequisite = test.dependsOn.filter((id) => !id.includes(':')).find(root)
			if (!prerequisite) continue
			deferred.set(test.id, root(prerequisite)!)
			changed = true
		}
	}
	return deferred
}

export function readySelection(store: Store, plan: Plan, build: string | null) {
	const leftOut: LeftOut[] = []
	const runGaps = blockingRunGaps(store, plan.planId)
	const deferred = deferredPrerequisites(plan)
	for (const test of plan.tests) {
		const prerequisite = deferred.get(test.id)
		const reason = prerequisite
			? `deferred: prerequisite ${prerequisite} is deferred`
			: notReadyReason(store, plan, test, build, runGaps)
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

function notReadyReason(store: Store, plan: Plan, test: Test, build: string | null, runGaps: RunGap[]) {
	if (test.readiness !== 'ready') {
		const gaps = plan.gaps.filter(
			(gap) =>
				test.gapIds.includes(gap.id) &&
				(test.readiness === 'deferred'
					? gap.status === 'deferred' && gap.severity === 'blocking'
					: gap.status === 'open' && gap.severity === 'blocking')
		)
		return `${test.readiness} by ${gaps.map((gap) => gap.id).join(', ')}`
	}
	const runGap = runGapAffecting(runGaps, test)
	if (runGap) return `blocked by ${runGap.gap.id} of ${runGap.runId}`
	for (const dependency of test.dependsOn.filter((id) => id.includes(':'))) {
		const cause = dependencyBlock(store, dependency, build)
		if (cause) return `blocked by ${dependency}: ${cause}`
	}
	return null
}

function retestCheck(store: Store, runId: string, plan: Plan, build: string, instanceId: string | undefined) {
	const previous = one<{
		plan_id: string
		target_id: string
		target_revision: number
		instance_id: string
		application_build: string
		finished: number
	}>(
		store,
		'SELECT r.plan_id, r.target_id, r.target_revision, r.instance_id, r.application_build, s.run_id IS NOT NULL AS finished FROM runs r LEFT JOIN results s ON s.run_id = r.run_id WHERE r.run_id = ?',
		runId
	)
	requireCondition(
		previous,
		`Unknown run to retest: ${runId}`,
		`Run checkmate run list --plan ${plan.planId} to see the runs.`
	)
	requireCondition(
		previous.finished,
		`Run ${runId} is not finished. Retest a finished run.`,
		`Finish ${runId} first: checkmate run finish ${runId} --completion <completed|interrupted|operational_error> --cleanup <completed|failed|not_applicable> --cleanup-reason "<text>". Then run this command again. To start a run that is not a retest, leave out --retest-of.`
	)
	requireCondition(
		previous.plan_id === plan.planId &&
			previous.target_id === plan.target.targetId &&
			previous.target_revision === plan.target.revision,
		`Retest scope changed: ${runId} ran plan ${previous.plan_id} on ${previous.target_id}@${previous.target_revision}`
	)
	const refreshed =
		instanceId !== undefined &&
		instanceId !== previous.instance_id &&
		findInstance(store, previous.target_id, previous.instance_id).retired
	requireCondition(
		previous.application_build !== build || refreshed,
		`Retest needs a new build. Run ${runId} used build ${build}. Keep the build only on a new instance after ${previous.instance_id} is retired.`
	)
}

export function finalizedResults(store: Store, planId: string) {
	return all<{ body: string }>(
		store,
		'SELECT s.body FROM results s JOIN runs r ON r.run_id = s.run_id WHERE r.plan_id = ? ORDER BY r.rowid',
		planId
	).map((row) => JSON.parse(row.body) as Result)
}

export function rejectedRuns(store: Store, planId: string) {
	const rows = all<{ run_id: string; target_id: string; target_revision: number; sha256: string }>(
		store,
		'SELECT r.run_id, r.target_id, r.target_revision, s.sha256 FROM runs r JOIN results s ON s.run_id = r.run_id WHERE r.plan_id = ?',
		planId
	)
	const policies = new Map<string, 'required' | 'none'>()
	const policy = (row: (typeof rows)[number]) => {
		const key = `${row.target_id}@${row.target_revision}`
		if (!policies.has(key))
			policies.set(key, approvalPolicy(targetRevision(store, row.target_id, row.target_revision).profile).result)
		return policies.get(key)!
	}
	const rejected = rows.filter((row) => approvalState(store, 'result', row.run_id, row.sha256, policy(row)).rejected)
	return new Set(rejected.map((row) => row.run_id))
}

export function selectedOutcome(result: Result, testId: string) {
	if (!result.selectedTestIds.includes(testId)) return null
	return result.tests.find((test) => test.testId === testId)?.outcome ?? null
}

export function retests(later: Result, earlier: Result, byRun: Map<string, Result>) {
	for (let runId = later.retestOf; runId; runId = byRun.get(runId)?.retestOf ?? null)
		if (runId === earlier.runId) return true
	return false
}

export function supersedes(later: Result, earlier: Result, byRun: Map<string, Result>) {
	return (
		later.instanceId === earlier.instanceId ||
		later.applicationBuild !== earlier.applicationBuild ||
		retests(later, earlier, byRun)
	)
}

export function openDefects(results: Result[], rejected: Set<string>) {
	const byRun = new Map(results.map((result) => [result.runId, result]))
	const counted = results.filter((result) => !rejected.has(result.runId))
	return counted.flatMap((result, i) => {
		const later = counted.slice(i + 1).filter((run) => supersedes(run, result, byRun))
		const fixed = (testIds: string[]) =>
			later.some((run) => testIds.every((testId) => selectedOutcome(run, testId) === 'passed'))
		const found = (testIds: string[]) =>
			later.some(
				(run) =>
					retests(run, result, byRun) &&
					run.findings.some(
						(other) =>
							other.type === 'defect' &&
							other.testIds.some(
								(testId) => testIds.includes(testId) && selectedOutcome(run, testId) === 'failed'
							)
					)
			)
		return result.findings
			.filter((finding) => finding.type === 'defect' && !fixed(finding.testIds) && !found(finding.testIds))
			.map((finding) => ({ runId: result.runId, finding }))
	})
}

export type RetestDefect = {
	runId?: string
	findingId: string
	title: string
	testIds: string[]
	assertionIds?: string[]
}

export function retestDefects(store: Store, runId: string): RetestDefect[] {
	const { plan_id } = one<{ plan_id: string }>(store, 'SELECT plan_id FROM runs WHERE run_id = ?', runId)!
	const results = finalizedResults(store, plan_id)
	const byRun = new Map(results.map((result) => [result.runId, result]))
	const chain: string[] = []
	for (let id: string | null = runId; id && !chain.includes(id); id = byRun.get(id)?.retestOf ?? null) chain.push(id)
	// A defect is judged by the runs of its own retest chain. A later run on another build that passed the test does not
	// retire the defect for a retest of the run that recorded it.
	return openDefects(
		results.filter((result) => chain.includes(result.runId)),
		rejectedRuns(store, plan_id)
	)
		.filter((defect) => chain.includes(defect.runId))
		.map(({ runId, finding }) => ({
			runId,
			findingId: finding.id,
			title: finding.title,
			testIds: finding.testIds,
			assertionIds: finding.assertionIds,
		}))
}

export function dependencyBlock(store: Store, reference: string, build: string | null): string | null {
	const { planId, testId } = testReference(reference)
	const results = all<{
		run_id: string
		target_id: string
		target_revision: number
		sha256: string
		outcome: string
	}>(
		store,
		`SELECT r.run_id, r.target_id, r.target_revision, s.sha256,
			(SELECT t.value ->> '$.outcome' FROM json_each(s.body, '$.tests') t WHERE t.value ->> '$.testId' = ?) AS outcome
		FROM runs r JOIN results s ON s.run_id = r.run_id
		WHERE r.plan_id = ? AND (? IS NULL OR r.application_build = ?)
			AND EXISTS (SELECT 1 FROM json_each(s.body, '$.selectedTestIds') WHERE value = ?)
		ORDER BY r.rowid DESC`,
		testId,
		planId,
		build,
		build,
		testId
	)
	if (!results.length) return build === null ? 'no finalized result' : `no finalized result for build ${build}`
	const passed = results.filter((result) => result.outcome === 'passed')
	if (!passed.length) return `latest result ${results[0].run_id} shows ${results[0].outcome}`
	const accepted = (result: (typeof results)[number]) => {
		const policy = approvalPolicy(targetRevision(store, result.target_id, result.target_revision).profile).result
		return policy === 'none' || approvalState(store, 'result', result.run_id, result.sha256, policy).approved
	}
	if (!passed.some(accepted)) return `result ${passed[0].run_id} is not accepted`
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
	const show = (value: unknown) => (value === undefined ? '(none)' : JSON.stringify(value))
	const fields = (prefix: string, a: object, b: object, skip: string[] = []) => {
		const x = a as Record<string, unknown>
		const y = b as Record<string, unknown>
		for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort())
			if (!skip.includes(key) && !same(x[key], y[key]))
				lines.push(`${prefix} ${key}: ${show(x[key])} → ${show(y[key])}`)
	}
	const items = <T extends { id: string }>(
		old: T[],
		next: T[],
		label: (item: T) => string,
		skip: string[] = [],
		inner: (a: T, b: T) => void = () => {}
	) => {
		for (const item of old)
			if (!next.some((other) => other.id === item.id)) lines.push(`${item.id} removed: ${show(label(item))}`)
		for (const item of next) {
			const previous = old.find((other) => other.id === item.id)
			if (!previous) {
				lines.push(`${item.id} added: ${show(label(item))}`)
				continue
			}
			fields(item.id, previous, item, skip)
			inner(previous, item)
		}
	}
	items(before.requirements, after.requirements, (requirement) => requirement.text)
	items(
		before.tests,
		after.tests,
		(test) => test.title,
		['assertions'],
		(old, test) => {
			for (const assertion of old.assertions)
				if (!test.assertions.some((item) => item.id === assertion.id))
					lines.push(`${test.id}.${assertion.id} removed: ${show(assertion.check)}`)
			for (const assertion of test.assertions) {
				const previous = old.assertions.find((item) => item.id === assertion.id)
				if (previous) fields(`${test.id}.${assertion.id}`, previous, assertion)
				else lines.push(`${test.id}.${assertion.id} added: ${show(assertion.check)}`)
			}
		}
	)
	items(before.gaps, after.gaps, (gap) => gap.question)
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
		requireWellFormed(/^[1-9][0-9]*$/.test(text), `Invalid revision: ${text}. Use a positive integer.`)
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
