import type { Gap, LiteChecklist, LiteRecord, Profile } from './types.ts'
import type { Store } from './store.ts'
import type { PlanDraft } from './contracts.ts'
import type { RetestDefect } from './plans.ts'
import { all, canonical, completed, execute, one, write } from './store.ts'
import {
	approvalPolicy,
	index,
	requireCondition,
	requireIdentifier,
	requireText,
	requireWellFormed,
	revisionReference,
	unusedId,
	validate,
} from './contracts.ts'
import {
	applyDecisions,
	finalizedResults,
	openDefects,
	pendingDecisions,
	planRevision,
	rejectedRuns,
	retestCheck,
	retestDefects,
	storeRevision,
} from './plans.ts'
import {
	readEvidence,
	retestVerdicts,
	runFindings,
	runOutcomes,
	runState,
	storeEvidence,
	storeResult,
	textEvidence,
} from './runs.ts'
import { runInstance, targetRevision } from './targets.ts'
import { runList } from './views.ts'

type Question = NonNullable<LiteChecklist['questions']>[number]
type Check = LiteRecord['checks'][number]
type Evidence = NonNullable<Check['evidence']>

const recordedBy = 'lite'
const consequence = 'Until the oracle answers, the check of the item uses the ticket and the docs.'
const cleanup = {
	status: 'not_applicable' as const,
	reason: 'Lite record. The agent tested before the record and owns the cleanup.',
}
const evidenceHint =
	'Add "evidence": ["<file path in the workspace>"] or "evidence": [{"text": "<what you saw>"}]. Give one or more items.'

function liteTest(id: string, item: string, check: string, profile: Profile) {
	return {
		id,
		title: check.slice(0, 200),
		requirementIds: [item],
		capability: profile.capabilities[0],
		operations: [profile.allowedOperations[0]],
		dependsOn: [],
		preconditions: [],
		action: 'Free testing. The agent records the result after the test.',
		assertions: [{ id: 'A1', check, checkKind: 'agent_observation' as const }],
		metadata: { recordedBy },
	}
}

function questionGaps(store: Store, planId: string, questions: Question[] = []): Gap[] {
	const used = all<{ gap_id: string }>(store, 'SELECT DISTINCT gap_id FROM plan_gaps WHERE plan_id = ?', planId).map(
		(row) => row.gap_id
	)
	index(questions, 'id', 'question')
	for (const question of questions)
		requireCondition(
			!used.includes(question.id),
			`Question ID ${question.id} is in use. Use a new ID, for example ${unusedId('Q', used)}.`
		)
	return questions.map((question) => ({
		id: question.id,
		severity: 'non_blocking',
		status: 'open',
		requirementIds: question.items ?? [],
		testIds: [],
		question: question.question,
		consequence,
		decisionId: null,
	}))
}

export function recordChecklist(
	store: Store,
	actor: string | undefined,
	input: { planId: string; target: string; checklist: unknown }
) {
	return write(store, { actor, command: 'lite checklist', subject: input.planId, input }, (operationId) => {
		const planId = requireIdentifier(input.planId, 'plan ID')
		const reference = revisionReference(requireText(input.target, 'target (--target)'), 'target reference')
		requireWellFormed(reference.revision !== null, `Name the target revision: --target ${reference.id}@<revision>`)
		const target = targetRevision(store, reference.id, reference.revision)
		requireCondition(
			approvalPolicy(target.profile).plan === 'none',
			`Target ${reference.id}@${target.revision} requires plan approval. Lite mode has no plan approval.`,
			'Save a target profile revision with "approvals": {"plan": "none", "result": "required"}.'
		)
		requireCondition(
			!one(store, 'SELECT 1 FROM plan_requests WHERE plan_id = ?', planId),
			`Plan ${planId} exists. Add new items with lite record.`
		)
		const checklist = validate('lite-checklist', input.checklist)
		index(checklist.items, 'id', 'checklist item')
		const request = validate('plan-request', { objective: checklist.objective, requirements: checklist.items })
		execute(
			store,
			'INSERT INTO plan_requests (plan_id, target_id, target_revision, body, operation_id) VALUES (?, ?, ?, ?, ?)',
			planId,
			reference.id,
			target.revision,
			canonical(request),
			operationId
		)
		const gaps = questionGaps(store, planId, checklist.questions)
		const change = storeRevision(
			store,
			{
				contractVersion: 'toolkit-2',
				planId,
				revision: 1,
				previousRevision: null,
				target: { targetId: reference.id, revision: target.revision, sha256: target.sha256 },
				objective: checklist.objective,
				requirements: checklist.items,
				tests: checklist.items.map((item) => liteTest(item.id, item.id, item.text, target.profile)),
				gaps,
				assumptions: [],
				decisions: [],
			},
			operationId
		)
		change.reply.data.questions = gaps.map((gap) => gap.id)
		return change
	})
}

function completeness(store: Store, planId: string, items: string[], record: LiteRecord, earlier: RetestDefect[]) {
	const defects = record.defects ?? []
	const retests = record.retests ?? []
	for (const check of record.checks) {
		const name = `Check "${check.check}" of ${check.item}`
		requireWellFormed(
			items.includes(check.item),
			`${name} names an unknown item`,
			`Add the item to items, or use one of: ${items.join(', ')}.`
		)
		if (check.result === 'passed' || check.result === 'failed')
			requireWellFormed(
				check.observed,
				`${name} is ${check.result} without observed`,
				'Add "observed": "<what you saw>".'
			)
		else
			requireWellFormed(
				check.reason,
				`${name} is ${check.result} without a reason`,
				'Add "reason": "<why the check did not run>".'
			)
		requireWellFormed(
			check.result === 'failed' || check.defect === undefined,
			`${name} is ${check.result}. Only a failed check names a defect.`
		)
	}
	const unchecked = items.filter((id) => !record.checks.some((check) => check.item === id))
	requireCondition(
		!unchecked.length,
		`Checklist items without a check: ${unchecked.join(', ')}`,
		'Add one or more checks for each item with the result passed, failed, blocked, or not_run. Give a reason for blocked and not_run.'
	)
	const defectIds = [...index(defects, 'id', 'defect').keys()]
	const notFixed = retests.filter((retest) => retest.verdict === 'not_fixed').map((retest) => retest.defect)
	const orphans = record.checks.filter(
		(check) => check.result === 'failed' && ![...defectIds, ...notFixed].includes(check.defect ?? '')
	)
	requireCondition(
		!orphans.length,
		`Failed checks without a defect: ${orphans.map((check) => `${check.item} "${check.check}"`).join(', ')}`,
		'Add each defect to defects. Write its ID in the "defect" field of each failed check. A check can also name an earlier defect with the verdict not_fixed.'
	)
	const unlinked = defectIds.filter((id) => !record.checks.some((check) => check.defect === id))
	requireCondition(
		!unlinked.length,
		`Defects without a failed check: ${unlinked.join(', ')}`,
		'Write the defect ID in the "defect" field of a failed check. For a defect that no item covers, add an item and a failed check.'
	)
	const bare = defects.filter((defect) => !defect.evidence?.length).map((defect) => defect.id)
	requireCondition(!bare.length, `Defects without evidence: ${bare.join(', ')}`, evidenceHint)
	const used = all<{ id: string }>(
		store,
		'SELECT f.id FROM findings f JOIN runs r ON r.run_id = f.run_id WHERE r.plan_id = ?',
		planId
	).map((row) => row.id)
	for (const id of defectIds)
		requireCondition(
			!used.includes(id),
			`Defect ID ${id} is in use by an earlier build. Use a new ID, for example ${unusedId('D', [...used, ...defectIds])}.`,
			'Give an earlier defect a verdict in retests. Do not record it again.'
		)
	index(retests, 'defect', 'retest verdict')
	const open = earlier.map((defect) => defect.findingId)
	for (const retest of retests)
		requireWellFormed(
			open.includes(retest.defect),
			`Defect ${retest.defect} is not an open earlier defect`,
			open.length
				? `Give a verdict for each of: ${open.join(', ')}.`
				: 'Leave out retests. No earlier defect is open.'
		)
	const missing = open.filter((id) => !retests.some((retest) => retest.defect === id))
	requireCondition(
		!missing.length,
		`Earlier defects without a retest verdict: ${missing.join(', ')}`,
		'Add {"defect": "<id>", "verdict": "fixed" or "not_fixed", "observed": "<what you saw>", "evidence": [...]} to retests for each one.'
	)
	const unproven = retests.filter((retest) => !retest.evidence?.length).map((retest) => retest.defect)
	requireCondition(!unproven.length, `Retest verdicts without evidence: ${unproven.join(', ')}`, evidenceHint)
}

function stored(
	store: Store,
	runId: string,
	testId: string,
	assertion: string | null,
	name: string,
	evidence: Evidence,
	operationId: string
) {
	const files = evidence.map((spec, i) =>
		typeof spec === 'string' ? readEvidence(store, './', spec) : textEvidence(spec, `${name}-${i + 1}`)
	)
	return storeEvidence(store, runId, testId, assertion, files, operationId)
}

function close(
	store: Store,
	runId: string,
	testId: string,
	outcome: string,
	reason: string | null,
	at: string,
	operationId: string
) {
	execute(
		store,
		'INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, 1, ?, ?, ?, ?)',
		runId,
		testId,
		outcome,
		reason,
		at,
		operationId
	)
}

function check(
	store: Store,
	runId: string,
	testId: string,
	result: 'passed' | 'failed',
	observed: string,
	at: string,
	operationId: string
) {
	execute(
		store,
		'INSERT INTO assertion_results (run_id, test_id, assertion_id, attempt, result, observed, reason, recorded_at, operation_id) VALUES (?, ?, ?, 1, ?, ?, NULL, ?, ?)',
		runId,
		testId,
		'A1',
		result,
		observed,
		at,
		operationId
	)
	close(store, runId, testId, result, null, at, operationId)
}

function insertFinding(store: Store, runId: string, finding: unknown, testIds: string[], operationId: string) {
	const checked = validate('finding', finding)
	execute(
		store,
		'INSERT INTO findings (id, run_id, body, operation_id) VALUES (?, ?, ?, ?)',
		checked.id,
		runId,
		canonical({ ...checked, testIds }),
		operationId
	)
}

export function recordBuild(
	store: Store,
	actor: string | undefined,
	input: { planId: string; build: string; instance?: string; record: unknown }
) {
	return write(store, { actor, command: 'lite record', subject: input.planId, input }, (operationId, at, actor) => {
		const base = planRevision(store, input.planId)
		const planId = base.plan.planId
		requireCondition(
			base.plan.tests.every((test) => test.metadata?.recordedBy === recordedBy),
			`Plan ${planId} is not a lite plan. Record its runs with run begin.`
		)
		const build = requireText(input.build, 'application build (--build)')
		const record = validate('lite-record', input.record)
		const previous =
			one<{ run_id: string }>(
				store,
				'SELECT run_id FROM runs WHERE plan_id = ? ORDER BY rowid DESC LIMIT 1',
				planId
			)?.run_id ?? null
		if (previous) retestCheck(store, previous, base.plan, build, input.instance)
		const earlier = previous ? retestDefects(store, previous) : []
		const target = base.plan.target
		const { profile } = targetRevision(store, target.targetId, target.revision)
		const instance = runInstance(store, target.targetId, input.instance)
		const { coverage, tests, ...kept } = structuredClone(base.plan)
		const draft: PlanDraft = {
			...kept,
			revision: base.plan.revision + 1,
			previousRevision: base.plan.revision,
			tests: [],
		}
		const decisions = pendingDecisions(store, planId)
		applyDecisions(draft, decisions)
		draft.requirements.push(...(record.items ?? []))
		index(draft.requirements, 'id', 'checklist item')
		const questions = questionGaps(store, planId, record.questions)
		draft.gaps.push(...questions)
		completeness(
			store,
			planId,
			draft.requirements.map((item) => item.id),
			record,
			earlier
		)
		const usedTests = all<{ test_id: string }>(
			store,
			'SELECT DISTINCT test_id FROM plan_tests WHERE plan_id = ?',
			planId
		).map((row) => row.test_id)
		const retested = earlier.map((defect) => {
			const revision = one<{ plan_revision: number }>(
				store,
				'SELECT plan_revision FROM runs WHERE run_id = ?',
				defect.runId!
			)!.plan_revision
			const tested = planRevision(store, planId, revision).plan.tests
			return {
				defect,
				retest: record.retests!.find((item) => item.defect === defect.findingId)!,
				tests: defect.testIds.map((id) => {
					const { readiness, gapIds, ...test } = tested.find((item) => item.id === id)!
					return test
				}),
			}
		})
		const checks = record.checks.map((item) => {
			const id = unusedId(`${item.item}-`, usedTests)
			usedTests.push(id)
			return { check: item, test: liteTest(id, item.item, item.check, profile) }
		})
		draft.tests = [...retested.flatMap((item) => item.tests), ...checks.map((item) => item.test)]
		const revision = storeRevision(store, draft, operationId)
		for (const decision of decisions)
			execute(store, 'UPDATE decisions SET applied_revision = ? WHERE id = ?', draft.revision, decision.id)
		const runIds = all<{ run_id: string }>(store, 'SELECT run_id FROM runs').map((row) => row.run_id)
		const runId = requireIdentifier(unusedId(`${planId}-run-`, runIds), 'run ID')
		const request = {
			selectedTestIds: draft.tests.map((test) => test.id),
			partialExecution: 'ready_only',
			onNewBlocker: 'continue_independent',
			timeoutSeconds: 3600,
			retestOf: previous,
			...(previous ? { retestDefects: earlier } : {}),
			recordedBy,
		}
		execute(
			store,
			'INSERT INTO runs (run_id, plan_id, plan_revision, plan_sha256, target_id, target_revision, instance_id, application_build, request, started_at, browser_session, deadline_seconds, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			runId,
			planId,
			draft.revision,
			String(revision.reply.data.sha256),
			target.targetId,
			target.revision,
			instance.instanceId,
			build,
			canonical(request),
			at,
			recordedBy,
			request.timeoutSeconds,
			operationId
		)
		execute(
			store,
			'INSERT INTO run_attempts (run_id, attempt, started_at, actor) VALUES (?, 1, ?, ?)',
			runId,
			at,
			actor
		)
		const reopened = retested.map(({ defect, retest, tests }) => {
			const result = retest.verdict === 'fixed' ? 'passed' : 'failed'
			const evidenceIds = tests.flatMap((test) => {
				check(store, runId, test.id, result, retest.observed, at, operationId)
				return stored(store, runId, test.id, 'A1', `${defect.findingId}-retest`, retest.evidence!, operationId)
			})
			return { defect, retest, evidenceIds }
		})
		for (const { check: item, test } of checks) {
			const evidence = item.evidence ?? []
			if (item.result === 'passed' || item.result === 'failed') {
				check(store, runId, test.id, item.result, item.observed!, at, operationId)
				stored(store, runId, test.id, 'A1', test.id, evidence, operationId)
			} else {
				close(store, runId, test.id, item.result, item.reason!, at, operationId)
				stored(store, runId, test.id, null, test.id, evidence, operationId)
			}
		}
		for (const { defect, retest, evidenceIds } of reopened.filter((item) => item.retest.verdict === 'not_fixed')) {
			const { testIds, ...finding } = runFindings(store, defect.runId!).find(
				(item) => item.id === defect.findingId
			)!
			const linked = checks.filter((item) => item.check.defect === defect.findingId)
			insertFinding(
				store,
				runId,
				{
					...finding,
					assertionIds: [...finding.assertionIds, ...linked.map((item) => `${item.test.id}.A1`)],
					requirementIds: [...new Set([...finding.requirementIds, ...linked.map((item) => item.check.item)])],
					observed: retest.observed,
					evidenceIds,
				},
				[...testIds, ...linked.map((item) => item.test.id)],
				operationId
			)
		}
		for (const defect of record.defects ?? []) {
			const linked = checks.filter((item) => item.check.defect === defect.id)
			const first = linked[0].test.id
			insertFinding(
				store,
				runId,
				{
					id: defect.id,
					type: 'defect',
					severity: defect.severity,
					assertionIds: linked.map((item) => `${item.test.id}.A1`),
					requirementIds: [...new Set(linked.map((item) => item.check.item))],
					title: defect.title,
					expected: defect.expected,
					observed: defect.actual,
					reproduction: defect.steps,
					evidenceIds: stored(store, runId, first, 'A1', defect.id, defect.evidence!, operationId),
				},
				linked.map((item) => item.test.id),
				operationId
			)
		}
		const run = runState(store, runId)
		const result = storeResult(store, run, operationId, at, {
			completion: 'completed',
			cause: null,
			reason: null,
			cleanup,
		})
		const verdicts = retestVerdicts(run, runOutcomes(store, runId))
		return {
			reply: completed(runId, {
				runId,
				plan: `${planId}@${draft.revision}`,
				build,
				instanceId: instance.instanceId,
				...result,
				defects: (record.defects ?? []).map((defect) => defect.id),
				retest: verdicts.map((item) => ({
					runId: item.runId,
					findingId: item.findingId,
					verdict: item.verdict,
				})),
				questions: questions.map((gap) => gap.id),
				applied: decisions.map((decision) => decision.id),
			}),
			subjects: [`run:${runId}`, `plan:${planId}`, 'inbox'],
		}
	})
}

export function showLite(store: Store, planId: string) {
	const { plan, sha256 } = planRevision(store, planId)
	const pending = pendingDecisions(store, planId)
	const questions = plan.gaps.map((gap) => {
		const decision =
			plan.decisions.find((item) => item.id === gap.decisionId) ?? pending.find((item) => item.gap_id === gap.id)
		return {
			id: gap.id,
			status: gap.status === 'open' && decision ? 'answered' : gap.status,
			question: gap.question,
			kind: decision?.kind ?? null,
			answer: decision?.value ?? null,
		}
	})
	const defects = openDefects(finalizedResults(store, planId), rejectedRuns(store, planId)).map(
		({ runId, finding }) => ({
			runId,
			id: finding.id,
			severity: finding.severity,
			title: finding.title,
			items: finding.requirementIds,
		})
	)
	const runs = runList(store, { planId }).map((run) => ({
		runId: run.runId,
		build: run.build,
		coverage: run.coverage,
		acceptance: run.acceptance,
	}))
	return completed(`${planId}@${plan.revision}`, {
		planId,
		revision: plan.revision,
		sha256,
		items: plan.requirements,
		questions,
		runs,
		defects,
	})
}
