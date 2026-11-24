import type { ExplorationEvent } from './explorations.ts'
import type { ChildCall } from './sessions.ts'
import type { Store } from './store.ts'
import { planChatsForCosts } from './requests.ts'
import { usageOf } from './sessions.ts'
import { all } from './store.ts'

export type ModelCost = { costUsd: number | null; costPartial: boolean }
export const noModelCost: ModelCost = { costUsd: null, costPartial: false }
type RunUsage = ModelCost & { observedModels: string[] }
export const noRunUsage: RunUsage = { ...noModelCost, observedModels: [] }

type Usage = Pick<ChildCall, 'costUsd' | 'costPartial' | 'observedModels'>
type RunFilters = { runId?: string; planId?: string; build?: string }

function delegateReceipts(store: Store, { runId, planId, build }: RunFilters) {
	return all<{ runId: string; planId: string; data: string | null }>(
		store,
		`SELECT r.run_id AS runId, r.plan_id AS planId, o.response -> '$.data' AS data
		FROM operations o JOIN runs r ON r.run_id = json_extract(o.arguments, '$.subject')
		WHERE o.command = 'delegate execute' AND o.actor = 'checkmate:delegate'
		AND (? IS NULL OR r.run_id = ?) AND (? IS NULL OR r.plan_id = ?) AND (? IS NULL OR r.application_build = ?)
		ORDER BY o.rowid`,
		runId ?? null,
		runId ?? null,
		planId ?? null,
		planId ?? null,
		build ?? null,
		build ?? null
	).map(({ data, ...row }) => ({ ...row, usage: (JSON.parse(data ?? '{}') ?? {}) as Usage }))
}

export function runUsages(store: Store, filters: RunFilters) {
	const byRun = new Map<string, Usage[]>()
	for (const { runId, usage } of delegateReceipts(store, filters)) {
		const calls = byRun.get(runId) ?? []
		calls.push(usage)
		byRun.set(runId, calls)
	}
	return new Map(
		[...byRun].map(([id, calls]): [string, RunUsage] => {
			const { costUsd = null, costPartial = false, observedModels = [] } = usageOf(calls)
			return [id, { costUsd, costPartial, observedModels }]
		})
	)
}

const steps = ['end', 'record', 'rules', 'merge', 'verify', 'follow-turn']
type Total = { amount: number | null; missing: boolean }

function addCost(total: Total, status: string, attempted: boolean, value: unknown, partial: boolean) {
	const amount = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
	if (status === 'skipped' && !attempted && amount === null) return
	if (amount !== null) total.amount = (total.amount ?? 0) + amount
	if (amount === null || partial) total.missing = true
}

function costOf(total: Total): ModelCost {
	return { costUsd: total.amount, costPartial: total.amount !== null && total.missing }
}

export function explorationCost(events: ExplorationEvent[]): ModelCost {
	const total: Total = { amount: null, missing: false }
	for (const { step, status, detail } of events) {
		if (!steps.includes(step)) continue
		addCost(total, status, Boolean(detail.session || detail.agent), detail.costUsd, detail.costPartial === true)
	}
	return costOf(total)
}

type CostRow = { key: string; status: string; attempted: number; amount: number | null; partial: number | null }

function groupedCosts(store: Store, group: 'plan' | 'exploration', planId?: string) {
	const reported = "json_type(e.detail, '$.costUsd') IN ('integer', 'real')"
	const rows = all<CostRow>(
		store,
		`SELECT ${group === 'plan' ? 'x.plan_id' : 'e.exploration_id'} AS key, e.status,
			(json_extract(e.detail, '$.session') IS NOT NULL OR json_extract(e.detail, '$.agent') IS NOT NULL) AS attempted,
			CASE WHEN ${reported} THEN json_extract(e.detail, '$.costUsd') ELSE xc.cost_usd END AS amount,
			CASE WHEN ${reported} THEN json_type(e.detail, '$.costPartial') = 'true' ELSE xc.partial END AS partial
		FROM exploration_events e
		JOIN explorations x ON x.exploration_id = e.exploration_id
		LEFT JOIN exploration_event_costs xc ON xc.source_operation_id = e.operation_id
			AND xc.step = e.step AND xc.explorer = coalesce(e.explorer, '')
		WHERE e.step IN (${steps.map(() => '?').join(', ')})${planId === undefined ? '' : ' AND x.plan_id = ?'}
		ORDER BY e.rowid`,
		...steps,
		...(planId === undefined ? [] : [planId])
	)
	const totals = new Map<string, Total>()
	const totalFor = (key: string) => {
		const total = totals.get(key) ?? { amount: null, missing: false }
		totals.set(key, total)
		return total
	}
	for (const row of rows)
		addCost(totalFor(row.key), row.status, Boolean(row.attempted), row.amount, row.partial === 1)
	if (group === 'plan') {
		for (const chat of planChatsForCosts(store, planId)) {
			if (!chat.planId || !chat.turns.some((turn) => turn.startedAt)) continue
			addCost(totalFor(chat.planId), 'completed', true, chat.costUsd, chat.costPartial)
		}
		for (const receipt of delegateReceipts(store, { planId }))
			addCost(
				totalFor(receipt.planId),
				'completed',
				true,
				receipt.usage.costUsd,
				receipt.usage.costPartial === true
			)
	}
	return new Map([...totals].map(([key, total]) => [key, costOf(total)]))
}

export function planCosts(store: Store) {
	return groupedCosts(store, 'plan')
}

export function planCost(store: Store, planId: string) {
	return groupedCosts(store, 'plan', planId).get(planId) ?? noModelCost
}

export function planExplorationCosts(store: Store, planId: string) {
	return groupedCosts(store, 'exploration', planId)
}
