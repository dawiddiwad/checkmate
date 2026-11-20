import type { ExplorationEvent } from './explorations.ts'
import type { Store } from './store.ts'
import { all } from './store.ts'

export type ModelCost = { costUsd: number | null; costPartial: boolean }
export const noModelCost: ModelCost = { costUsd: null, costPartial: false }

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

function groupedCosts(store: Store, planId?: string) {
	const reported = "json_type(e.detail, '$.costUsd') IN ('integer', 'real')"
	const rows = all<CostRow>(
		store,
		`SELECT ${planId === undefined ? 'x.plan_id' : 'e.exploration_id'} AS key, e.status,
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
	for (const row of rows) {
		const total = totals.get(row.key) ?? { amount: null, missing: false }
		addCost(total, row.status, Boolean(row.attempted), row.amount, row.partial === 1)
		totals.set(row.key, total)
	}
	return new Map([...totals].map(([key, total]) => [key, costOf(total)]))
}

export function planCosts(store: Store) {
	return groupedCosts(store)
}

export function planExplorationCosts(store: Store, planId: string) {
	return groupedCosts(store, planId)
}
