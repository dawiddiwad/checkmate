import type { Plan } from './types.ts'
import type { Store } from './store.ts'
import { all, one } from './store.ts'
import { requireCondition } from './contracts.ts'
import { approvalState, dependencyBlock, latestApproval, planApproval, planChanges, planRevision } from './plans.ts'
import {
	evidenceDirectory,
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

export function approvalLabel(state: ApprovalState): ApprovalLabel {
	if (state.approved) return 'approved'
	if (state.latest?.verdict === 'rejected') return 'rejected'
	return state.policy === 'required' ? 'pending' : 'not_required'
}

function latestRevisions(store: Store) {
	return all<RevisionRow>(
		store,
		`SELECT p.plan_id, p.revision, p.sha256, p.body, o.at, o.actor FROM latest_plans p
		JOIN operations o ON o.id = p.operation_id ORDER BY p.plan_id`
	).map((row) => ({ ...row, plan: JSON.parse(row.body) as Plan }))
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
		.flatMap((row) =>
			row.plan.gaps
				.filter((gap) => gap.status === 'open' && !pending.has(`${row.plan_id}:${gap.id}`))
				.map((gap) => ({
					planId: row.plan_id,
					revision: row.revision,
					gapId: gap.id,
					question: gap.question,
					severity: gap.severity,
					since: row.at,
				}))
		)
		.sort(bySince)
	const plans = revisions
		.filter((row) => {
			const state = planApproval(store, row.plan, row.sha256)
			return state.policy === 'required' && !state.latest
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
	return { gaps, plans, results }
}

function bySince(a: { since: string }, b: { since: string }) {
	return a.since.localeCompare(b.since)
}

export function planList(store: Store) {
	return latestRevisions(store).map((row) => {
		const open = row.plan.gaps.filter((gap) => gap.status === 'open')
		return {
			planId: row.plan_id,
			revision: row.revision,
			sha256: row.sha256,
			since: row.at,
			openGaps: open.map((gap) => gap.id),
			openBlockingGaps: open.filter((gap) => gap.severity === 'blocking').map((gap) => gap.id),
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
}

export function planDetail(store: Store, planId: string, revision: number | null = null) {
	const selected = planRevision(store, planId, revision)
	const latest = planRevision(store, planId)
	const approval = planApproval(store, selected.plan, selected.sha256)
	const pending =
		latest.plan.revision === selected.plan.revision
			? all<{
					id: string
					gap_id: string
					kind: string
					value: string
					rationale: string
					source: string | null
					actor: string
				}>(
					store,
					'SELECT id, gap_id, kind, value, rationale, source, actor FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid',
					planId
				).map((row) => ({
					id: row.id,
					gapId: row.gap_id,
					kind: row.kind,
					value: row.value,
					rationale: row.rationale,
					source: row.source,
					actor: row.actor,
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
	}
}

export function planHistory(store: Store, planId: string, limit?: number) {
	if (limit !== undefined) requireCondition(Number.isInteger(limit) && limit > 0, 'Invalid history limit')
	planRevision(store, planId)
	const rows = all<RevisionRow & { operation_id: string }>(
		store,
		`SELECT p.plan_id, p.revision, p.sha256, p.body, p.operation_id, o.at, o.actor FROM plan_revisions p
		JOIN operations o ON o.id = p.operation_id WHERE p.plan_id = ? ORDER BY p.revision DESC LIMIT ?`,
		planId,
		limit === undefined ? -1 : limit + 1
	).reverse()
	const plans = rows.map((row) => JSON.parse(row.body) as Plan)
	const history = rows.map((row, i) => ({
		revision: row.revision,
		sha256: row.sha256,
		operationId: row.operation_id,
		actor: row.actor,
		at: row.at,
		changes: i === 0 ? [] : planChanges(plans[i - 1], plans[i]),
	}))
	return limit === undefined ? history : history.slice(-limit)
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
						oracleKind: assertion.oracleKind,
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
		evidenceDirectory: evidenceDirectory(runId, store.workspace),
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
	).map((row) => ({
		rowid: row.rowid,
		id: row.id,
		at: row.at,
		actor: row.actor,
		command: row.command,
		status: row.status,
		subjects: JSON.parse(row.subjects) as string[],
		arguments: JSON.parse(row.arguments) as unknown,
		response: JSON.parse(row.response) as unknown,
	}))
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

export type ListOptions = { q?: string; page?: number; size?: number; order?: string }

export function listTimestamp(iso: string) {
	return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function listOptions(options: ListOptions = {}) {
	return {
		q: options.q?.trim() ?? '',
		page: Number.isSafeInteger(options.page) && options.page! > 0 ? options.page! : 1,
		size: [25, 50, 100].includes(options.size ?? 0) ? options.size! : 25,
		order: options.order === 'asc' ? 'asc' : 'desc',
	}
}

function pageRows<T>(rows: T[], options: ListOptions) {
	const selected = listOptions(options)
	const total = rows.length
	const pages = Math.max(1, Math.ceil(total / selected.size))
	const page = Math.min(selected.page, pages)
	return { ...selected, total, pages, page, rows: rows.slice((page - 1) * selected.size, page * selected.size) }
}

function matchesQuery(query: string | undefined, values: unknown[]) {
	const text = values.flat(Infinity).join(' ').replace(/_/g, ' ').toLowerCase()
	return !query || text.includes(query.trim().replace(/_/g, ' ').toLowerCase())
}

export function planListPage(store: Store, options: ListOptions & { show?: string } = {}) {
	const rows = planList(store).map((row) => ({ ...row, plan: planRevision(store, row.planId).plan }))
	const filtered = rows.filter((row) => {
		if (options.show === 'needs_decision' && !row.openGaps.length) return false
		if (options.show === 'awaiting_approval' && row.approval !== 'pending') return false
		if (options.show === 'blocked' && !row.blocked.length && !row.openBlockingGaps.length) return false
		const count = (readiness: string) => row.plan.tests.filter((test) => test.readiness === readiness).length
		return matchesQuery(options.q, [
			`${row.planId}@${row.revision}`,
			`${row.plan.tests.length} ${row.plan.tests.length === 1 ? 'test' : 'tests'}`,
			`${count('ready')} ready`,
			count('blocked') ? `${count('blocked')} blocked` : '',
			count('deferred') ? `${count('deferred')} deferred` : '',
			row.openGaps.length ? row.openGaps : 'none',
			row.approval,
			row.blocked.length
				? row.blocked.map((block) => `${block.testId} by ${block.dependency}: ${block.cause}`)
				: 'none',
			row.since,
			listTimestamp(row.since),
		])
	})
	filtered.sort((a, b) => a.since.localeCompare(b.since) || a.planId.localeCompare(b.planId))
	if (options.order !== 'asc') filtered.reverse()
	return pageRows(filtered, options)
}

export function runListPage(
	store: Store,
	options: ListOptions & { plan?: string; build?: string; status?: string } = {}
) {
	const rows = runList(store, { planId: options.plan || undefined, build: options.build || undefined }).map((row) => {
		const counts: Record<string, number> = {}
		for (const test of runOutcomes(store, row.runId).values())
			counts[test.outcome] = (counts[test.outcome] ?? 0) + 1
		return { ...row, counts }
	})
	const filtered = rows.filter((row) => {
		if (options.status === 'started' && row.state !== 'started') return false
		if (['pending', 'approved', 'rejected'].includes(options.status ?? '') && row.acceptance !== options.status)
			return false
		const status =
			row.state === 'started'
				? 'in progress'
				: row.acceptance === 'approved'
					? 'accepted'
					: row.acceptance === 'pending'
						? 'awaiting acceptance'
						: row.acceptance
		return matchesQuery(options.q, [
			row.runId,
			`${row.planId}@${row.revision}`,
			row.build,
			Object.entries(row.counts).map(([outcome, count]) => `${count} ${outcome}`),
			Object.keys(row.counts).length ? '' : 'no outcomes yet',
			row.completion ?? 'running',
			row.coverage,
			status,
			row.startedAt,
			listTimestamp(row.startedAt),
		])
	})
	filtered.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId))
	if (options.order !== 'asc') filtered.reverse()
	return pageRows(filtered, options)
}

export function operationLogPage(store: Store, options: ListOptions & { subject?: string; actor?: string } = {}) {
	const selected = listOptions(options)
	const where = `WHERE (? = '' OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = ?))
		AND (? = '' OR actor = ?)
		AND (? = '' OR instr(lower(at || ' ' || strftime('%Y-%m-%d %H:%M UTC', at) || ' ' || actor || ' ' || command || ' ' || status || ' ' || replace(status, '_', ' ') || ' ' || CASE WHEN subjects = '[]' THEN 'none' ELSE subjects END || ' ' || id || ' ' || coalesce(json_extract(response, '$.reasons'), '')), lower(?)) > 0)`
	const args = [
		options.subject ?? '',
		options.subject ?? '',
		options.actor ?? '',
		options.actor ?? '',
		selected.q,
		selected.q,
	]
	const total = Number(
		one<{ total: number }>(store, `SELECT count(*) AS total FROM operations ${where}`, ...args)!.total
	)
	const pages = Math.max(1, Math.ceil(total / selected.size))
	const page = Math.min(selected.page, pages)
	const rows = all<OperationRow>(
		store,
		`SELECT rowid, * FROM operations ${where} ORDER BY at ${selected.order}, rowid ${selected.order} LIMIT ? OFFSET ?`,
		...args,
		selected.size,
		(page - 1) * selected.size
	).map((row) => ({
		...row,
		subjects: JSON.parse(row.subjects) as string[],
		arguments: JSON.parse(row.arguments) as unknown,
		response: JSON.parse(row.response) as unknown,
	}))
	return { ...selected, total, pages, page, rows }
}

export function operationActors(store: Store) {
	return all<{ actor: string }>(store, 'SELECT DISTINCT actor FROM operations ORDER BY actor').map((row) => row.actor)
}
