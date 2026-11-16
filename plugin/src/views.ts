import type { Plan, Result } from './types.ts'
import type { Store } from './store.ts'
import { explorationStatus } from './explorers.ts'
import { factoryStates, oracleStates, planClaims, planQuestions } from './journal.ts'
import { all, canonical, digest, one } from './store.ts'
import { requireChoice, requireCondition } from './contracts.ts'
import {
	approvalState,
	dependencyBlock,
	latestApproval,
	planApproval,
	planChanges,
	planRequest,
	planRevision,
	planRunGaps,
	deferredPrerequisites,
	finalizedResults,
	openDefects,
	readySelection,
	rejectedRuns,
	selectedOutcome,
	supersedes,
} from './plans.ts'
import {
	outcomeCounts,
	resultAcceptance,
	runAssertions,
	runClock,
	runEvidence,
	runFindings,
	runGaps,
	runOutcomes,
	retestVerdicts,
	runResult,
	runState,
} from './runs.ts'
import type { RunRow } from './runs.ts'
import { findInstance, instanceList } from './targets.ts'

type RevisionRow = { plan_id: string; revision: number; sha256: string; body: string; at: string; actor: string }
type ApprovalState = ReturnType<typeof approvalState>
export type ApprovalLabel = 'approved' | 'rejected' | 'pending' | 'not_required'
export type PlanListRow = {
	planId: string
	status: 'requested' | 'drafted'
	revision: number | null
	sha256: string | null
	since: string
	openGaps: string[]
	openBlockingGaps: string[]
	tests: { total: number; ready: number; blocked: number; deferred: number }
	approval: ApprovalLabel | null
	blocked: Array<{ testId: string; dependency: string; cause: string }>
	loop: { state: LoopState; waitsOn: Role }
}

export function approvalLabel(state: ApprovalState): ApprovalLabel {
	if (state.approved) return 'approved'
	if (state.rejected) return 'rejected'
	return state.policy === 'required' ? 'pending' : 'not_required'
}

function latestRevisions(store: Store) {
	return all<RevisionRow>(
		store,
		`SELECT p.plan_id, p.revision, p.sha256, p.body, o.at, o.actor FROM latest_plans p
		JOIN operations o ON o.id = p.operation_id ORDER BY p.plan_id`
	).map((row) => ({ ...row, plan: JSON.parse(row.body) as Plan }))
}

function requestedPlans(store: Store) {
	return all<{ plan_id: string; target_id: string; target_revision: number; body: string; at: string }>(
		store,
		`SELECT r.plan_id, r.target_id, r.target_revision, r.body, o.at FROM plan_requests r
		JOIN operations o ON o.id = r.operation_id
		WHERE NOT EXISTS (SELECT 1 FROM plan_revisions p WHERE p.plan_id = r.plan_id) ORDER BY r.plan_id`
	).map((row) => ({
		planId: row.plan_id,
		target: `${row.target_id}@${row.target_revision}`,
		objective: (JSON.parse(row.body) as { objective: string }).objective,
		since: row.at,
	}))
}

function planSummary(plan: Plan) {
	const count = (readiness: string) => plan.tests.filter((test) => test.readiness === readiness).length
	const open = plan.gaps.filter((gap) => gap.status === 'open').length
	return `${plan.tests.length} tests: ${count('ready')} ready, ${count('blocked')} blocked, ${count('deferred')} deferred; ${open} open gaps`
}

export function inbox(store: Store) {
	const pending = new Set(
		all<{ plan_id: string; gap_id: string }>(
			store,
			'SELECT plan_id, gap_id FROM decisions WHERE applied_revision IS NULL'
		).map((row) => `${row.plan_id}:${row.gap_id}`)
	)
	const revisions = latestRevisions(store)
	const gaps = revisions.flatMap((row) => [
		...row.plan.gaps
			.filter((gap) => gap.status === 'open' && !pending.has(`${row.plan_id}:${gap.id}`))
			.map((gap) => ({
				planId: row.plan_id,
				revision: row.revision,
				gapId: gap.id,
				question: gap.question,
				severity: gap.severity,
				since: row.at,
				runId: null as string | null,
				explorationId: null as string | null,
			})),
		...planRunGaps(store, row.plan_id)
			.filter((item) => !item.adopted)
			.map((item) => ({
				planId: row.plan_id,
				revision: row.revision,
				gapId: item.gap.id,
				question: item.gap.question,
				severity: item.gap.severity,
				since: item.at,
				runId: item.runId as string | null,
				explorationId: null as string | null,
			})),
	])
	const explored = exploredPlans(store)
	const questions = explored.flatMap((planId) =>
		planQuestions(store, planId)
			.filter((question) => question.answer === null)
			.map((question) => ({
				planId,
				revision: null as number | null,
				gapId: question.id,
				question: question.question,
				severity: (question.blocking ? 'blocking' : 'non_blocking') as 'blocking' | 'non_blocking',
				since: question.at,
				runId: null as string | null,
				explorationId: question.explorationId as string | null,
			}))
	)
	const allGaps = [...gaps.map((gap) => ({ ...gap, revision: gap.revision as number | null })), ...questions].sort(
		bySince
	)
	const claims = explored.flatMap((planId) =>
		planClaims(store, planId)
			.filter((claim) => claim.open && oracleStates.includes(claim.state))
			.map((claim) => ({
				planId,
				claimId: claim.id,
				explorationId: claim.explorationId,
				state: claim.state,
				severity: claim.severity,
				title: claim.title,
				reason: claim.reason,
			}))
	)
	const plans = revisions
		.map((row) => ({ row, approval: approvalLabel(planApproval(store, row.plan, row.sha256)) }))
		.filter(({ approval }) => approval === 'pending' || approval === 'rejected')
		.map(({ row, approval }) => ({
			planId: row.plan_id,
			revision: row.revision,
			sha256: row.sha256,
			approval,
			since: row.at,
			summary: `${approval === 'rejected' ? 'Rejected. Change the plan. ' : ''}${planSummary(row.plan)}`,
		}))
		.sort(bySince)
	const results = revisions.flatMap((row) => {
		const runs = runList(store, { planId: row.plan_id })
		const record = planRecord(store, row.plan)
		const waited = new Set([...record.supplied, ...record.defects.map((item) => item.runId)])
		return runs
			.filter((run) => waited.has(run.runId) && run.acceptance === 'pending')
			.map((run) => {
				const result = record.results.find((item) => item.runId === run.runId)!
				return {
					runId: run.runId,
					planId: run.planId,
					revision: run.revision,
					build: run.build,
					counts: selectedCounts(result),
					coverage: run.coverage!,
					sha256: run.sha256!,
					since: result.finishedAt,
				}
			})
	})
	const requests = requestedPlans(store).filter((request) => !explored.includes(request.planId))
	return { gaps: allGaps, plans, results, claims, requests: requests.sort(bySince) }
}

function selectedCounts(result: Result) {
	return outcomeCounts(result.tests.filter((test) => result.selectedTestIds.includes(test.testId)))
}

function bySince(a: { since: string }, b: { since: string }) {
	return a.since.localeCompare(b.since)
}

function testCounts(plan: Plan) {
	const count = (readiness: string) => plan.tests.filter((test) => test.readiness === readiness).length
	return { total: plan.tests.length, ready: count('ready'), blocked: count('blocked'), deferred: count('deferred') }
}

export function planList(store: Store): PlanListRow[] {
	const drafted = latestRevisions(store).map((row): PlanListRow => {
		const open = [
			...row.plan.gaps.filter((gap) => gap.status === 'open'),
			...planRunGaps(store, row.plan_id)
				.filter((item) => !item.adopted)
				.map((item) => item.gap),
		]
		return {
			planId: row.plan_id,
			status: 'drafted',
			revision: row.revision,
			sha256: row.sha256,
			since: row.at,
			openGaps: open.map((gap) => gap.id),
			openBlockingGaps: open.filter((gap) => gap.severity === 'blocking').map((gap) => gap.id),
			tests: testCounts(row.plan),
			approval: approvalLabel(planApproval(store, row.plan, row.sha256)),
			blocked: row.plan.tests.flatMap((test) =>
				test.dependsOn
					.filter((dependency) => dependency.includes(':'))
					.flatMap((dependency) => {
						const cause = dependencyBlock(store, dependency, null)
						return cause ? [{ testId: test.id, dependency, cause }] : []
					})
			),
			loop: loopOf(store, row.plan_id),
		}
	})
	const requested = requestedPlans(store).map((request): PlanListRow => ({
		planId: request.planId,
		status: 'requested',
		revision: null,
		sha256: null,
		since: request.since,
		openGaps: [],
		openBlockingGaps: [],
		tests: { total: 0, ready: 0, blocked: 0, deferred: 0 },
		approval: null,
		blocked: [],
		loop: loopOf(store, request.planId),
	}))
	return [...drafted, ...requested].sort((a, b) => a.planId.localeCompare(b.planId))
}

export function planDetail(store: Store, planId: string, revision: number | null = null) {
	const selected = planRevision(store, planId, revision)
	const latest = planRevision(store, planId)
	const approval = planApproval(store, selected.plan, selected.sha256)
	const pending =
		latest.plan.revision === selected.plan.revision
			? all<{ id: string; gap_id: string; kind: string; value: string; actor: string; rationale: string }>(
					store,
					'SELECT id, gap_id, kind, value, actor, rationale FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid',
					planId
				).map((row) => ({
					id: row.id,
					gapId: row.gap_id,
					kind: row.kind,
					value: row.value,
					actor: row.actor,
					rationale: row.rationale,
				}))
			: []
	return {
		planId,
		revision: selected.plan.revision,
		latestRevision: latest.plan.revision,
		sha256: selected.sha256,
		approval: { state: approvalLabel(approval), policy: approval.policy, latest: approval.latest },
		pendingDecisions: pending,
		plan: selected.plan,
		runs: runList(store, { planId }).map((run) => ({
			runId: run.runId,
			revision: run.revision,
			build: run.build,
			instanceId: run.instanceId,
			startedAt: run.startedAt,
			state: run.state,
			completion: run.completion,
			coverage: run.coverage,
			counts: run.counts,
			acceptance: run.acceptance,
		})),
	}
}

export function planHistory(store: Store, planId: string) {
	planRevision(store, planId)
	const rows = all<RevisionRow & { operation_id: string }>(
		store,
		`SELECT p.plan_id, p.revision, p.sha256, p.body, p.operation_id, o.at, o.actor FROM plan_revisions p
		JOIN operations o ON o.id = p.operation_id WHERE p.plan_id = ? ORDER BY p.revision`,
		planId
	)
	const plans = rows.map((row) => JSON.parse(row.body) as Plan)
	return rows.map((row, i) => ({
		revision: row.revision,
		sha256: row.sha256,
		operationId: row.operation_id,
		actor: row.actor,
		at: row.at,
		changes: i === 0 ? [] : planChanges(plans[i - 1], plans[i]),
	}))
}

export type LoopState =
	| 'needs_plan'
	| 'run_in_progress'
	| 'needs_revision'
	| 'plan_rejected'
	| 'needs_answers'
	| 'needs_approval'
	| 'ready_to_run'
	| 'nothing_to_run'
	| 'defects_open'
	| 'needs_retest'
	| 'awaits_acceptance'
	| 'accepted'
	| 'passed'
	| 'exploring'
	| 'needs_triage'
	| 'ready_to_test'
export type Role = 'planner' | 'oracle' | 'qa' | 'factory' | 'none'
export const roles = ['planner', 'oracle', 'qa', 'factory', 'none'] as const

export function exploredPlans(store: Store) {
	return all<{ plan_id: string }>(store, 'SELECT DISTINCT plan_id FROM explorations ORDER BY plan_id').map(
		(row) => row.plan_id
	)
}

const runningExploration = ['starting', 'testing', 'recording', 'verifying']
const overlaid: LoopState[] = ['needs_plan', 'ready_to_run', 'nothing_to_run', 'needs_retest', 'passed', 'accepted']

export function planStatus(store: Store, planId: string) {
	const base = checkStatus(store, planId)
	const explorations = all<{ exploration_id: string }>(
		store,
		'SELECT exploration_id FROM explorations WHERE plan_id = ? ORDER BY rowid',
		planId
	).map((row) => {
		const status = explorationStatus(store, row.exploration_id)
		return { explorationId: status.explorationId, build: status.build, state: status.state, reason: status.reason }
	})
	const claims = planClaims(store, planId)
		.filter((claim) => claim.open)
		.map((claim) => ({
			claimId: claim.id,
			explorationId: claim.explorationId,
			build: claim.build,
			state: claim.state,
			severity: claim.severity,
			title: claim.title,
			reason: claim.reason,
		}))
	const questions = planQuestions(store, planId).filter((question) => question.answer === null)
	const extra = { explorations, claims, questions }
	if (!overlaid.includes(base.state)) return { ...base, ...extra }
	const running = explorations.filter((item) => runningExploration.includes(item.state))
	if (running.length)
		return {
			...base,
			...extra,
			...loop(
				'exploring',
				'qa',
				running.map((item) => `${item.explorationId} is ${item.state} on build ${item.build}`),
				running.map((item) => `checkmate explore wait ${item.explorationId}`)
			),
		}
	const triage = claims.filter((claim) => oracleStates.includes(claim.state))
	const blocking = questions.filter((question) => question.blocking)
	if (triage.length || blocking.length)
		return {
			...base,
			...extra,
			...loop(
				'needs_triage',
				'oracle',
				[
					...blocking.map((question) => `${question.id} blocks testing: ${question.question}`),
					...triage.map((claim) => `${claim.claimId} is ${claim.state}: ${claim.title}`),
				],
				[
					...(blocking.length
						? [
								`checkmate gap answer ${planId} <questionId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>"`,
							]
						: []),
					...(triage.length ? [`checkmate claim accept|reject ${planId} <claimId> --rationale "<why>"`] : []),
				]
			),
		}
	const fixes = claims.filter((claim) => factoryStates.includes(claim.state))
	const last = explorations.at(-1)
	const failed = last !== undefined && ['failed', 'stopped'].includes(last.state)
	const finished = explorations.filter((item) => item.state === 'completed').at(-1)
	const after = [
		...(fixes.length
			? [
					`${amount(fixes.length, 'confirmed or observed claim')} ready for the factory: checkmate claim list ${planId}`,
				]
			: []),
		...(questions.length
			? [
					`${amount(questions.length, 'open question')} can be answered at any time and do not block: checkmate gap answer ${planId} <questionId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>"`,
				]
			: []),
		...(finished && fixes.length ? [`Store the claims as tests: checkmate harvest ${finished.explorationId}`] : []),
		`Retest on the next build: checkmate test ${planId} --build <new build> --allow Read --allow Bash`,
	]
	if (fixes.length)
		return { ...base, ...extra, ...loop('defects_open', 'factory', [amount(fixes.length, 'open claim')], after) }
	if (base.state === 'needs_plan') {
		const why = !last
			? ['No exploration yet']
			: failed
				? [`${last.explorationId} ${last.state} on build ${last.build}${last.reason ? `: ${last.reason}` : ''}`]
				: [`${last.explorationId} is ${last.state} on build ${last.build}`]
		return {
			...base,
			...extra,
			...loop(
				'ready_to_test',
				'qa',
				why,
				!last || failed ? [`checkmate test ${planId} --allow Read --allow Bash`] : after
			),
		}
	}
	return { ...base, ...extra }
}

function checkStatus(store: Store, planId: string) {
	if (!one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', planId)) {
		planRequest(store, planId)
		return {
			planId,
			revision: null,
			...loop('needs_plan', 'planner', [], [delegateHint('plan', planId)]),
			approval: null,
			gaps: [],
			pendingDecisions: [],
			latestRun: null,
			openRuns: [],
			defects: [],
			retest: null,
		}
	}
	const { plan, sha256 } = planRevision(store, planId)
	const subject = `${planId}@${plan.revision}`
	const pendingDecisions = all<{ id: string; gap_id: string; kind: string }>(
		store,
		'SELECT id, gap_id, kind FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid',
		planId
	).map((row) => ({ id: row.id, gapId: row.gap_id, kind: row.kind }))
	const gaps = [
		...plan.gaps
			.filter((gap) => gap.status === 'open' && !pendingDecisions.some((item) => item.gapId === gap.id))
			.map((gap) => ({
				gapId: gap.id,
				severity: gap.severity,
				question: gap.question,
				runId: null as string | null,
			})),
		...planRunGaps(store, planId)
			.filter((item) => !item.adopted)
			.map((item) => ({
				gapId: item.gap.id,
				severity: item.gap.severity,
				question: item.gap.question,
				runId: item.runId as string | null,
			})),
	]
	const approval = approvalLabel(planApproval(store, plan, sha256))
	const runs = runList(store, { planId })
	const openRuns = runs
		.filter((run) => run.state === 'started')
		.map((run) => ({ runId: run.runId, build: run.build, instanceId: run.instanceId }))
	const record = planRecord(store, plan)
	const finished = runs.find((run) => run.runId === record.results.at(-1)?.runId)
	const latestRun = runs.at(-1) ?? null
	const retest = latestRetest(store, planId, record)
	const { ready, latest, supplied, rejected } = record
	const defects = record.defects.map(({ runId, finding }) => ({
		runId,
		findingId: finding.id,
		severity: finding.severity,
		testIds: finding.testIds,
		assertionIds: finding.assertionIds,
		title: finding.title,
	}))
	const active = instanceList(store, plan.target.targetId).filter((instance) => !instance.retired)
	const instance = (runId?: string) => {
		if (active.length < 2) return ''
		const used = runs.find((run) => run.runId === runId)?.instanceId
		return ` --instance ${active.some((item) => item.instanceId === used) ? used : '<instanceId>'}`
	}
	const rerun = (run: (typeof runs)[number]) => {
		const retired = !active.some((item) => item.instanceId === run.instanceId)
		return `checkmate run begin <runId> ${subject} --build ${run.build}${instance(run.runId)} --partial ready_only${retired ? ` --retest-of ${run.runId}` : ''}`
	}
	const dependencyBuilds = () => {
		const others = [
			...new Set(
				plan.tests.flatMap((test) =>
					test.dependsOn.filter((id) => id.includes(':')).map((id) => id.split(':')[0])
				)
			),
		]
		return all<{ build: string }>(
			store,
			`SELECT r.application_build AS build FROM runs r JOIN results s ON s.run_id = r.run_id
			WHERE r.plan_id IN (SELECT value FROM json_each(?)) GROUP BY r.application_build ORDER BY max(r.rowid) DESC`,
			JSON.stringify(others)
		).map((row) => row.build)
	}
	const bestBuild = (count: (build: string) => number) => {
		let best: string | undefined
		let most = 0
		for (const build of dependencyBuilds()) {
			const selected = count(build)
			if (selected > most) [best, most] = [build, selected]
		}
		return best
	}
	const nothingToRun = (build: string | null, leftOut: Array<{ testId: string; reason: string }>) => {
		const why = [
			...(ready.length ? [] : ['No test is ready']),
			...leftOut.map((item) => `${item.testId} ${item.reason}`),
		]
		const blocked = plan.tests
			.filter((test) => ready.includes(test.id))
			.flatMap((test) => test.dependsOn.filter((id) => id.includes(':') && dependencyBlock(store, id, build)))
		if (blocked.length)
			return loop(
				'nothing_to_run',
				'qa',
				why,
				[...new Set(blocked.map((id) => id.split(':')[0]))].map((other) => `checkmate status ${other}`)
			)
		return loop('nothing_to_run', 'oracle', why, [`checkmate plan edit ${subject} --patch`])
	}
	const state = (): ReturnType<typeof loop> => {
		if (openRuns.length)
			return loop(
				'run_in_progress',
				'qa',
				openRuns.map((run) => `${run.runId} is started on build ${run.build} on instance ${run.instanceId}`),
				openRuns.map((run) => delegateHint('execute', run.runId))
			)
		if (pendingDecisions.length)
			return loop(
				'needs_revision',
				'planner',
				pendingDecisions.map((item) => `${item.gapId} has a pending ${item.kind} decision`),
				[delegateHint('revise', planId)]
			)
		if (approval === 'rejected')
			return loop(
				'plan_rejected',
				'oracle',
				[rejection(store, 'plan', subject)],
				[`checkmate plan edit ${subject} --patch`]
			)
		const answer = [
			`checkmate gap answer ${planId} <gapId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>"`,
		]
		if (approval === 'pending')
			return gaps.length
				? loop(
						'needs_answers',
						'oracle',
						[amount(gaps.length, 'open gap'), `${subject} waits for approval`],
						answer
					)
				: loop(
						'needs_approval',
						'oracle',
						[`${subject} waits for approval`],
						[`checkmate plan approve ${subject} --rationale "<why>"`]
					)
		const blocking = gaps.filter((gap) => gap.severity === 'blocking')
		if (!finished) {
			const selection = readySelection(store, plan, null)
			if (selection.tests.length) {
				const build = bestBuild((item) => readySelection(store, plan, item).tests.length) ?? '<build>'
				return loop(
					'ready_to_run',
					'qa',
					[`${selection.tests.length} of ${plan.tests.length} tests are ready`],
					[`checkmate run begin <runId> ${subject} --build ${build}${instance()} --partial ready_only`]
				)
			}
			return blocking.length
				? loop(
						'needs_answers',
						'oracle',
						[`No test is ready. ${amount(blocking.length, 'open blocking gap')}`],
						answer
					)
				: nothingToRun(null, selection.leftOut)
		}
		if (blocking.length)
			return loop('needs_answers', 'oracle', [amount(blocking.length, 'open blocking gap')], answer)
		if (defects.length) {
			const defective = runs.filter((run) => defects.some((defect) => defect.runId === run.runId))
			return loop(
				'defects_open',
				'factory',
				defective.map(
					(run) =>
						`${run.runId} has ${amount(defects.filter((defect) => defect.runId === run.runId).length, 'defect')} on build ${run.build}`
				),
				defective.map(
					(run) =>
						`Build a fix, then checkmate run begin <runId> ${subject} --build <new build>${instance(run.runId)} --partial ready_only --retest-of ${run.runId}`
				)
			)
		}
		if (gaps.length) return loop('needs_answers', 'oracle', [amount(gaps.length, 'open gap')], answer)
		if (!ready.length) return nothingToRun(finished.build, readySelection(store, plan, finished.build).leftOut)
		const causes = new Set<string>()
		const reasons = new Map(
			ready.map((testId) => {
				const entries = latest.get(testId) ?? []
				if (!entries.length) return [testId, [`${testId} has not run on ${subject}`]]
				return [
					testId,
					entries.flatMap((result) => {
						const outcome = selectedOutcome(result, testId)
						if (outcome === 'passed' && !rejected.has(result.runId)) return []
						causes.add(result.runId)
						if (outcome !== 'passed') return [`${testId} is ${outcome} in ${result.runId}`]
						return [`${testId}'s latest pass is in rejected ${result.runId}`]
					}),
				]
			})
		)
		const incomplete = runs.filter(
			(run) => (supplied.includes(run.runId) || run.runId === finished.runId) && run.completion !== 'completed'
		)
		for (const run of incomplete) causes.add(run.runId)
		const why = [
			...openRejections(store, planId).map((item) => rejection(store, 'result', item.runId)),
			...incomplete.map((run) => `${run.runId} is ${run.completion}`),
			...ready.flatMap((testId) => reasons.get(testId)!),
		]
		if (why.length) {
			const needed = incomplete.length ? ready : ready.filter((testId) => reasons.get(testId)!.length)
			const selectable = (build: string) =>
				readySelection(store, plan, build).tests.some((testId) => needed.includes(testId))
			const caused = runs.filter((run) => causes.has(run.runId))
			let next = (caused.length ? caused : [finished]).filter((run) => selectable(run.build)).map(rerun)
			if (!next.length) {
				const build = bestBuild(
					(item) => readySelection(store, plan, item).tests.filter((testId) => needed.includes(testId)).length
				)
				if (build)
					next = [`checkmate run begin <runId> ${subject} --build ${build}${instance()} --partial ready_only`]
			}
			if (!next.length) return nothingToRun(finished.build, readySelection(store, plan, finished.build).leftOut)
			return loop('needs_retest', 'qa', why, [...new Set(next)])
		}
		const supplying = runs.filter((run) => supplied.includes(run.runId))
		const waiting = supplying.filter((run) => run.acceptance === 'pending')
		if (waiting.length)
			return loop(
				'awaits_acceptance',
				'oracle',
				waiting.map((run) => `${run.runId} on build ${run.build} waits for acceptance`),
				waiting.map((run) => `checkmate result accept ${run.runId} --rationale "<why>"`)
			)
		const names = supplying.map((run) => run.runId).join(', ')
		if (supplying.every((run) => run.acceptance === 'approved'))
			return loop('accepted', 'none', [`${names} ${supplying.length === 1 ? 'is' : 'are'} accepted`], [])
		return loop('passed', 'none', [`${names} passed. Result acceptance is not required`], [])
	}
	const loopState = state()
	loopState.why = [
		...new Set([
			...loopState.why,
			...[...record.derived].map(
				([testId, prerequisite]) => `${testId} deferred: prerequisite ${prerequisite} is deferred`
			),
		]),
	]
	return {
		planId,
		revision: plan.revision,
		...loopState,
		approval,
		gaps,
		pendingDecisions,
		latestRun,
		openRuns,
		defects,
		retest,
	}
}

function latestRetest(store: Store, planId: string, record: ReturnType<typeof planRecord>) {
	const row = one<{ run_id: string }>(
		store,
		"SELECT run_id FROM runs WHERE plan_id = ? AND request ->> '$.retestOf' IS NOT NULL ORDER BY rowid DESC LIMIT 1",
		planId
	)
	if (!row) return null
	const run = runState(store, row.run_id)
	const verdicts = retestVerdicts(run, runOutcomes(store, row.run_id))
	const open = verdicts.some((item) =>
		record.defects.some((defect) => defect.runId === item.runId && defect.finding.id === item.findingId)
	)
	return open || record.results.at(-1)?.runId === row.run_id ? { runId: row.run_id, verdicts } : null
}

function rejection(store: Store, kind: 'plan' | 'result', subject: string) {
	const decision = latestApproval(store, kind, subject)!
	return `${subject} was rejected by ${decision.actor}: ${decision.rationale}`
}

export function openRejections(store: Store, planId: string) {
	const { plan } = planRevision(store, planId)
	const runs = runList(store, { planId })
	const { ready, latest, rejected } = planRecord(store, plan)
	return runs
		.filter((run) => rejected.has(run.runId))
		.map((run) => ({
			runId: run.runId,
			testIds: ready.filter((testId) => latest.get(testId)?.some((result) => result.runId === run.runId)),
			rationale: latestApproval(store, 'result', run.runId)!.rationale,
		}))
		.filter((item) => item.testIds.length)
}

function delegateHint(stage: 'plan' | 'revise' | 'execute', subject: string) {
	return `checkmate delegate ${stage} ${subject} --allow Read --allow Bash`
}

function loopOf(store: Store, planId: string) {
	const { state, waitsOn } = planStatus(store, planId)
	return { state, waitsOn }
}

function planRecord(store: Store, plan: Plan) {
	const results = finalizedResults(store, plan.planId)
	const rejected = rejectedRuns(store, plan.planId)
	const derived = deferredPrerequisites(plan)
	const ready = plan.tests
		.filter((test) => test.readiness === 'ready' && !derived.has(test.id))
		.map((test) => test.id)
	const latest = latestOutcomes(store, plan, results)
	const supplied = results
		.filter((result) => ready.some((testId) => latest.get(testId)?.includes(result)))
		.map((result) => result.runId)
	const defects = openDefects(results, rejected).filter(({ finding }) =>
		finding.testIds.some((testId) => ready.includes(testId))
	)
	return { results, rejected, ready, derived, latest, supplied, defects }
}

function testDefinition(plan: Plan, test: Plan['tests'][number]) {
	const { action, preconditions, assertions, dependsOn, capability, operations, requirementIds } = test
	const requirements = requirementIds.map((id) => plan.requirements.find((item) => item.id === id)?.text ?? null)
	return digest(
		canonical({
			action,
			preconditions,
			assertions,
			dependsOn,
			capability,
			operations,
			requirementIds,
			requirements,
		})
	)
}

function latestOutcomes(store: Store, plan: Plan, results: Result[]) {
	const byRun = new Map(results.map((result) => [result.runId, result]))
	const current = new Map(plan.tests.map((test) => [test.id, testDefinition(plan, test)]))
	const tested = new Map<number, Plan>()
	const latest = new Map<string, Result[]>()
	for (const result of results) {
		const revision = result.plan.revision
		if (!tested.has(revision)) tested.set(revision, planRevision(store, plan.planId, revision).plan)
		for (const test of tested.get(revision)!.tests) {
			if (
				!result.selectedTestIds.includes(test.id) ||
				current.get(test.id) !== testDefinition(tested.get(revision)!, test)
			)
				continue
			const kept = (latest.get(test.id) ?? []).filter((earlier) => !supersedes(result, earlier, byRun))
			latest.set(test.id, [...kept, result])
		}
	}
	return latest
}

function amount(count: number, noun: string) {
	return `${count} ${noun}${count === 1 ? '' : 's'}`
}

const loopStages: Partial<Record<LoopState, 'plan' | 'revise' | 'execute'>> = {
	needs_plan: 'plan',
	needs_revision: 'revise',
	run_in_progress: 'execute',
}

function loop(state: LoopState, waitsOn: Role, why: string[], next: string[]) {
	return { state, waitsOn, why, next, stage: loopStages[state] ?? 'none' }
}

export function runList(store: Store, filters: { planId?: string; build?: string } = {}) {
	const rows = all<RunRow & { completion: string | null; coverage: string | null; sha256: string | null }>(
		store,
		`SELECT r.*, s.completion, s.coverage, s.sha256 FROM runs r LEFT JOIN results s ON s.run_id = r.run_id
		WHERE (? IS NULL OR r.plan_id = ?) AND (? IS NULL OR r.application_build = ?) ORDER BY r.rowid`,
		filters.planId ?? null,
		filters.planId ?? null,
		filters.build ?? null,
		filters.build ?? null
	)
	return rows.map((row) => ({
		runId: row.run_id,
		planId: row.plan_id,
		revision: row.plan_revision,
		build: row.application_build,
		instanceId: row.instance_id,
		startedAt: row.started_at,
		state: row.sha256 ? ('finalized' as const) : ('started' as const),
		completion: row.completion,
		coverage: row.coverage,
		sha256: row.sha256,
		acceptance: row.sha256 ? approvalLabel(resultAcceptance(store, row, row.sha256)) : null,
		counts: Object.fromEntries(
			all<{ outcome: string; count: number }>(
				store,
				'SELECT outcome, count(*) AS count FROM outcomes WHERE run_id = ? GROUP BY outcome ORDER BY outcome',
				row.run_id
			).map((count) => [count.outcome, count.count])
		) as Record<string, number>,
	}))
}

export function runDetail(store: Store, runId: string) {
	const run = runState(store, runId)
	const outcomes = runOutcomes(store, runId)
	const results = runAssertions(store, runId)
	const evidence = runEvidence(store, runId).map((row) => ({
		id: row.id,
		testId: row.test_id,
		assertionId: row.assertion_id,
		kind: row.kind,
		name: row.name,
		mediaType: row.media_type,
		sha256: row.sha256,
		size: row.size,
	}))
	const finished = runResult(store, runId)
	const attempts = all<{ attempt: number; started_at: string; actor: string }>(
		store,
		'SELECT attempt, started_at, actor FROM run_attempts WHERE run_id = ? ORDER BY attempt',
		runId
	).map((row) => ({ attempt: row.attempt, startedAt: row.started_at, actor: row.actor }))
	const tests = run.plan.tests
		.filter((test) => run.request.selectedTestIds.includes(test.id))
		.map((test) => {
			const closed = outcomes.get(test.id)
			return {
				testId: test.id,
				title: test.title,
				metadata: test.metadata ?? {},
				outcome: closed?.outcome ?? null,
				cause: closed?.cause ?? null,
				reason: closed?.reason ?? null,
				evidence: evidence.filter((item) => item.testId === test.id && item.assertionId === null),
				assertions: test.assertions.map((assertion) => {
					const row = results.get(`${test.id}.${assertion.id}`)
					return {
						assertionId: assertion.id,
						check: assertion.check,
						checkKind: assertion.checkKind,
						result: row?.result ?? null,
						observed: row?.observed ?? null,
						reason: row?.reason ?? null,
						evidence: evidence.filter(
							(item) => item.testId === test.id && item.assertionId === assertion.id
						),
					}
				}),
			}
		})
	return {
		runId,
		planId: run.row.plan_id,
		revision: run.row.plan_revision,
		planSha256: run.row.plan_sha256,
		target: `${run.row.target_id}@${run.row.target_revision}`,
		instance: findInstance(store, run.row.target_id, run.row.instance_id),
		build: run.row.application_build,
		startedAt: run.row.started_at,
		browserSession: run.row.browser_session,
		deadlineSeconds: run.row.deadline_seconds,
		clock: runClock(store, run.row, finished?.result.finishedAt),
		request: run.request,
		state: finished ? ('finalized' as const) : ('started' as const),
		attempts,
		tests,
		findings: runFindings(store, runId),
		retest: retestVerdicts(run, outcomes),
		newGaps: runGaps(store, runId),
		result: finished
			? {
					sha256: finished.sha256,
					completion: finished.result.completion,
					completionCause: finished.result.completionCause ?? null,
					completionReason: finished.result.completionReason ?? null,
					coverage: finished.result.coverage,
					cleanup: finished.result.cleanup,
					finishedAt: finished.result.finishedAt,
					acceptance: approvalLabel(resultAcceptance(store, run.row, finished.sha256)),
					latestDecision: latestApproval(store, 'result', runId) ?? null,
				}
			: null,
	}
}

export function findingList(store: Store, filters: { planId?: string; open?: boolean } = {}) {
	if (filters.planId !== undefined) planRequest(store, filters.planId)
	const rows = all<RunRow & { body: string }>(
		store,
		`SELECT r.*, f.body FROM findings f JOIN runs r ON r.run_id = f.run_id
		WHERE (? IS NULL OR r.plan_id = ?) ORDER BY f.rowid`,
		filters.planId ?? null,
		filters.planId ?? null
	)
	const open = new Set(
		filters.open
			? [...new Set(rows.map((row) => row.plan_id))].flatMap((planId) =>
					openDefects(finalizedResults(store, planId), rejectedRuns(store, planId)).map(
						({ runId, finding }) => `${runId}/${finding.id}`
					)
				)
			: []
	)
	return rows
		.map((row) => {
			const finding = JSON.parse(row.body) as Result['findings'][number]
			return {
				runId: row.run_id,
				planId: row.plan_id,
				revision: row.plan_revision,
				build: row.application_build,
				instanceId: row.instance_id,
				testIds: finding.testIds,
				findingId: finding.id,
				type: finding.type,
				severity: finding.severity,
				title: finding.title,
				expected: finding.expected,
				observed: finding.observed,
				reproduction: finding.reproduction,
				requirementIds: finding.requirementIds,
				assertionIds: finding.assertionIds,
				evidenceIds: finding.evidenceIds,
				metadata: finding.metadata ?? {},
			}
		})
		.filter((row) => !filters.open || open.has(`${row.runId}/${row.findingId}`))
}

type OperationRow = {
	rowid: number
	id: string
	at: string
	actor: string
	command: string
	arguments: string
	status: string
	response: string
	subjects: string
}

export function operationLog(store: Store, filters: { subject?: string; limit?: number; after?: number } = {}) {
	const limit = filters.limit ?? 50
	requireCondition(Number.isInteger(limit) && limit > 0 && limit <= 1000, `Invalid limit: ${limit}. Use 1 to 1000.`)
	return all<OperationRow>(
		store,
		`SELECT rowid, * FROM operations
		WHERE (? IS NULL OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = ?)) AND rowid > ?
		ORDER BY rowid ${filters.after === undefined ? 'DESC' : 'ASC'} LIMIT ?`,
		filters.subject ?? null,
		filters.subject ?? null,
		filters.after ?? 0,
		limit
	).map(operationRow)
}

function operationRow(row: OperationRow) {
	return {
		rowid: row.rowid,
		id: row.id,
		at: row.at,
		actor: row.actor,
		command: row.command,
		status: row.status,
		subjects: JSON.parse(row.subjects) as string[],
		arguments: JSON.parse(row.arguments) as unknown,
		response: JSON.parse(row.response) as unknown,
	}
}

export function changesAfter(store: Store, rowid: number) {
	return all<{ rowid: number; id: string; subjects: string }>(
		store,
		'SELECT rowid, id, subjects FROM operations WHERE rowid > ? ORDER BY rowid',
		rowid
	).map((row) => ({ rowid: row.rowid, id: row.id, subjects: JSON.parse(row.subjects) as string[] }))
}

export function evidenceBytes(store: Store, id: string) {
	const row = one<{
		id: string
		run_id: string
		test_id: string
		assertion_id: string | null
		kind: string
		name: string
		media_type: string
		sha256: string
		size: number
		bytes: Uint8Array
	}>(
		store,
		'SELECT e.id, e.run_id, e.test_id, e.assertion_id, e.kind, e.name, e.media_type, e.sha256, b.size, b.bytes FROM evidence e JOIN blobs b ON b.sha256 = e.sha256 WHERE e.id = ?',
		id
	)
	requireCondition(row, `Unknown evidence: ${id}`)
	return {
		id: row.id,
		runId: row.run_id,
		testId: row.test_id,
		assertionId: row.assertion_id,
		kind: row.kind,
		name: row.name,
		mediaType: row.media_type,
		sha256: row.sha256,
		size: row.size,
		bytes: row.bytes,
	}
}

export type ListQuery = {
	limit?: number
	offset?: number
	sort?: string
	direction?: 'asc' | 'desc'
	q?: string
	filters?: Record<string, string | undefined>
}
export type ListPage<T> = {
	rows: T[]
	total: number
	limit: number
	offset: number
	sort: string
	direction: 'asc' | 'desc'
}
type Sortable = string | number | null

const pageSizes = [25, 50, 100]

function listQuery(query: ListQuery, columns: string[], defaults: { sort: string; direction: 'asc' | 'desc' }) {
	const limit = query.limit ?? 25
	const offset = query.offset ?? 0
	const sort = query.sort ?? defaults.sort
	const direction = query.direction ?? (query.sort ? 'asc' : defaults.direction)
	requireCondition(pageSizes.includes(limit), `Invalid limit: ${limit}. Use one of: ${pageSizes.join(', ')}.`)
	requireCondition(Number.isInteger(offset) && offset >= 0, `Invalid offset: ${offset}. Use 0 or more.`)
	requireChoice(sort, columns, 'sort column')
	requireChoice(direction, ['asc', 'desc'], 'sort direction')
	return { limit, offset, sort, direction, q: query.q?.trim().toLowerCase() ?? '' }
}

function filterValue(filters: ListQuery['filters'], names: Record<string, readonly string[] | null>) {
	const values: Record<string, string> = {}
	for (const [name, value] of Object.entries(filters ?? {})) {
		if (value === undefined || value === '') continue
		requireCondition(name in names, `Unknown filter: ${name}. Use: ${Object.keys(names).join(', ')}.`)
		const choices = names[name]
		if (choices) requireChoice(value, choices, `${name} filter`)
		values[name] = value
	}
	return values
}

function pageOf<T>(
	rows: T[],
	query: ReturnType<typeof listQuery>,
	columns: Record<string, (row: T) => Sortable>,
	text: (row: T) => unknown[]
): ListPage<T> {
	const matched = query.q
		? rows.filter((row) =>
				text(row).some((field) =>
					String(field ?? '')
						.toLowerCase()
						.includes(query.q)
				)
			)
		: rows
	const key = columns[query.sort]
	const order = query.direction === 'asc' ? 1 : -1
	const position = new Map(matched.map((row, index) => [row, index]))
	const sorted = [...matched].sort((a, b) => {
		const x = key(a)
		const y = key(b)
		if (x === y) return (position.get(a)! - position.get(b)!) * order
		if (x === null) return 1
		if (y === null) return -1
		return (x < y ? -1 : 1) * order
	})
	return {
		rows: sorted.slice(query.offset, query.offset + query.limit),
		total: matched.length,
		limit: query.limit,
		offset: query.offset,
		sort: query.sort,
		direction: query.direction,
	}
}

const planShows = ['all', 'needs_decision', 'awaiting_approval', 'blocked'] as const
const approvalLabels = ['approved', 'rejected', 'pending', 'not_required'] as const

export function pagedPlans(store: Store, query: ListQuery = {}) {
	type Row = ReturnType<typeof planList>[number]
	const columns: Record<string, (row: Row) => Sortable> = {
		plan: (row) => row.planId,
		loop: (row) => row.loop.state,
		tests: (row) => row.tests.total,
		gaps: (row) => row.openGaps.length,
		approval: (row) => row.approval ?? row.status,
		blocked: (row) => row.blocked.length,
		updated: (row) => row.since,
	}
	const options = listQuery(query, Object.keys(columns), { sort: 'plan', direction: 'asc' })
	const filters = filterValue(query.filters, { show: planShows, approval: approvalLabels, waits: roles })
	const rows = planList(store).filter(
		(row) =>
			(filters.approval === undefined || row.approval === filters.approval) &&
			(filters.waits === undefined || row.loop.waitsOn === filters.waits) &&
			(filters.show !== 'needs_decision' || row.openGaps.length > 0) &&
			(filters.show !== 'awaiting_approval' || row.approval === 'pending') &&
			(filters.show !== 'blocked' || row.blocked.length > 0 || row.openBlockingGaps.length > 0)
	)
	return pageOf(rows, options, columns, (row) => [
		row.revision === null ? row.planId : `${row.planId}@${row.revision}`,
		row.status,
		row.loop.state,
		`waits on ${row.loop.waitsOn}`,
		`${row.tests.total} tests ${row.tests.ready} ready ${row.tests.blocked} blocked ${row.tests.deferred} deferred`,
		...row.openGaps,
		row.approval,
		...row.blocked.map((block) => `${block.testId} ${block.dependency} ${block.cause}`),
		row.since,
	])
}

const runStatuses = ['started', 'pending', 'approved', 'rejected', 'not_required'] as const

function runStatus(row: ReturnType<typeof runList>[number]) {
	return row.state === 'started' ? 'started' : (row.acceptance ?? 'finalized')
}

export function pagedRuns(store: Store, query: ListQuery = {}) {
	type Row = ReturnType<typeof runList>[number]
	const columns: Record<string, (row: Row) => Sortable> = {
		run: (row) => row.runId,
		plan: (row) => `${row.planId}@${String(row.revision).padStart(9, '0')}`,
		build: (row) => row.build,
		instance: (row) => row.instanceId,
		completion: (row) => row.completion,
		coverage: (row) => row.coverage,
		status: (row) => runStatus(row),
		started: (row) => row.startedAt,
	}
	const options = listQuery(query, Object.keys(columns), { sort: 'started', direction: 'desc' })
	const filters = filterValue(query.filters, { plan: null, build: null, status: runStatuses })
	const rows = runList(store, { planId: filters.plan, build: filters.build }).filter(
		(row) => filters.status === undefined || runStatus(row) === filters.status
	)
	return pageOf(rows, options, columns, (row) => [
		row.runId,
		`${row.planId}@${row.revision}`,
		row.build,
		row.instanceId,
		...Object.entries(row.counts).map(([outcome, count]) => `${count} ${outcome}`),
		row.completion,
		row.coverage,
		runStatus(row),
		row.startedAt,
	])
}

const logColumns: Record<string, string> = {
	time: 'rowid',
	actor: 'actor',
	command: 'command',
	status: 'status',
}

export function pagedOperations(
	store: Store,
	query: ListQuery = {}
): ListPage<ReturnType<typeof operationLog>[number]> {
	const options = listQuery(query, Object.keys(logColumns), { sort: 'time', direction: 'desc' })
	const filters = filterValue(query.filters, { subject: null, actor: null, command: null, status: null })
	const where = `WHERE (:subject IS NULL OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = :subject))
		AND (:actor IS NULL OR actor = :actor) AND (:command IS NULL OR command = :command)
		AND (:status IS NULL OR status = :status)
		AND (:q = '' OR instr(lower(at || ' ' || actor || ' ' || command || ' ' || status || ' ' || subjects || ' ' || id
			|| ' ' || coalesce(response ->> '$.reasons', '')), :q) > 0)`
	const parameters = {
		subject: filters.subject ?? null,
		actor: filters.actor ?? null,
		command: filters.command ?? null,
		status: filters.status ?? null,
		q: options.q,
	}
	const total = (
		store.db.prepare(`SELECT count(*) AS total FROM operations ${where}`).get(parameters) as { total: number }
	).total
	const direction = options.direction === 'asc' ? 'ASC' : 'DESC'
	const rows = store.db
		.prepare(
			`SELECT rowid, * FROM operations ${where} ORDER BY ${logColumns[options.sort]} ${direction}, rowid ${direction} LIMIT :limit OFFSET :offset`
		)
		.all({ ...parameters, limit: options.limit, offset: options.offset }) as OperationRow[]
	return {
		rows: rows.map(operationRow),
		total,
		limit: options.limit,
		offset: options.offset,
		sort: options.sort,
		direction: options.direction,
	}
}
