import type { Plan } from './types.ts'
import type { Store } from './store.ts'
import { all, one } from './store.ts'
import { requireChoice, requireCondition } from './contracts.ts'
import {
	approvalState,
	dependencyBlock,
	latestApproval,
	planApproval,
	planChanges,
	planRevision,
	planRunGaps,
} from './plans.ts'
import {
	outcomeCounts,
	resultAcceptance,
	runAssertions,
	runEvidence,
	runFindings,
	runGaps,
	runOutcomes,
	runResult,
	runState,
} from './runs.ts'
import type { RunRow } from './runs.ts'

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
	const gaps = revisions
		.flatMap((row) => [
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
					runId: item.runId,
				})),
		])
		.sort(bySince)
	const plans = revisions
		.filter((row) => {
			const state = planApproval(store, row.plan, row.sha256)
			return state.policy === 'required' && !state.approved && !state.rejected
		})
		.map((row) => ({
			planId: row.plan_id,
			revision: row.revision,
			sha256: row.sha256,
			since: row.at,
			summary: planSummary(row.plan),
		}))
		.sort(bySince)
	const results = all<RunRow & { finished_at: string; sha256: string; coverage: string }>(
		store,
		'SELECT r.*, s.finished_at, s.sha256, s.coverage FROM runs r JOIN results s ON s.run_id = r.run_id ORDER BY s.rowid'
	)
		.filter((row) => {
			const state = resultAcceptance(store, row, row.sha256)
			return state.policy === 'required' && !state.latest
		})
		.map((row) => ({
			runId: row.run_id,
			planId: row.plan_id,
			revision: row.plan_revision,
			build: row.application_build,
			counts: outcomeCounts(runResult(store, row.run_id)!.result.tests),
			coverage: row.coverage,
			sha256: row.sha256,
			since: row.finished_at,
		}))
	return { gaps, plans, results, requests: requestedPlans(store).sort(bySince) }
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
		const open = row.plan.gaps.filter((gap) => gap.status === 'open')
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
	}))
	return [...drafted, ...requested].sort((a, b) => a.planId.localeCompare(b.planId))
}

export function planDetail(store: Store, planId: string, revision: number | null = null) {
	const selected = planRevision(store, planId, revision)
	const latest = planRevision(store, planId)
	const approval = planApproval(store, selected.plan, selected.sha256)
	const pending =
		latest.plan.revision === selected.plan.revision
			? all<{ id: string; gap_id: string; kind: string; value: string; actor: string }>(
					store,
					'SELECT id, gap_id, kind, value, actor FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid',
					planId
				).map((row) => ({ id: row.id, gapId: row.gap_id, kind: row.kind, value: row.value, actor: row.actor }))
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
				outcome: closed?.outcome ?? null,
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
		build: run.row.application_build,
		startedAt: run.row.started_at,
		browserSession: run.row.browser_session,
		deadlineSeconds: run.row.deadline_seconds,
		request: run.request,
		state: finished ? ('finalized' as const) : ('started' as const),
		attempts,
		tests,
		findings: runFindings(store, runId),
		newGaps: runGaps(store, runId),
		result: finished
			? {
					sha256: finished.sha256,
					completion: finished.result.completion,
					coverage: finished.result.coverage,
					cleanup: finished.result.cleanup,
					finishedAt: finished.result.finishedAt,
					acceptance: approvalLabel(resultAcceptance(store, run.row, finished.sha256)),
					latestDecision: latestApproval(store, 'result', runId) ?? null,
				}
			: null,
	}
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
		ORDER BY rowid DESC LIMIT ?`,
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
		tests: (row) => row.tests.total,
		gaps: (row) => row.openGaps.length,
		approval: (row) => row.approval ?? row.status,
		blocked: (row) => row.blocked.length,
		updated: (row) => row.since,
	}
	const options = listQuery(query, Object.keys(columns), { sort: 'plan', direction: 'asc' })
	const filters = filterValue(query.filters, { show: planShows, approval: approvalLabels })
	const rows = planList(store).filter(
		(row) =>
			(filters.approval === undefined || row.approval === filters.approval) &&
			(filters.show !== 'needs_decision' || row.openGaps.length > 0) &&
			(filters.show !== 'awaiting_approval' || row.approval === 'pending') &&
			(filters.show !== 'blocked' || row.blocked.length > 0 || row.openBlockingGaps.length > 0)
	)
	return pageOf(rows, options, columns, (row) => [
		row.revision === null ? row.planId : `${row.planId}@${row.revision}`,
		row.status,
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
