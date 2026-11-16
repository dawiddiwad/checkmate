import type { Store } from './store.ts'
import type { Plan } from './types.ts'
import { all, canonical, completed, execute, one, write } from './store.ts'
import { requireChoice, requireIdentifier, requireText, unusedId } from './contracts.ts'
import { planRequest, planTools } from './plans.ts'
import { runInstance } from './targets.ts'
import { explorationRow } from './journal.ts'

export const explorationModes = ['exploratory', 'regression'] as const
export type Charter = {
	goal: string
	requirements: Array<{ id: string; text: string }>
	sources: string[]
	instructions: string | null
	capabilities: string[]
	operations: string[]
	tools: Array<{ name: string; purpose: string }>
	scope: string[]
}
export type ExplorationEvent = {
	at: string
	step: string
	explorer: string | null
	status: string
	detail: Record<string, unknown>
}

function latestRevision(store: Store, planId: string) {
	const row = one<{ revision: number; body: string }>(
		store,
		'SELECT revision, body FROM latest_plans WHERE plan_id = ?',
		planId
	)
	return row ? { revision: row.revision, plan: JSON.parse(row.body) as Plan } : null
}

export function charterOf(store: Store, planId: string, scope: string[]): Charter {
	const { request, target } = planRequest(store, planId)
	const latest = latestRevision(store, planId)
	const requirements = latest?.plan.requirements ?? request.requirements ?? []
	return {
		goal: request.objective,
		requirements: requirements.map(({ id, text }) => ({ id, text })),
		sources: request.context?.sources ?? [],
		instructions: request.context?.instructions ?? null,
		capabilities: target.profile.capabilities,
		operations: target.profile.allowedOperations,
		tools: planTools(request, target.profile).map(({ name, purpose }) => ({ name, purpose })),
		scope,
	}
}

export function nextExplorationId(store: Store) {
	const ids = all<{ exploration_id: string }>(store, 'SELECT exploration_id FROM explorations').map(
		(row) => row.exploration_id
	)
	return unusedId('x-', ids)
}

export type OpenInput = {
	planId: string
	build: string
	instance?: string
	mode?: string
	scope?: string[]
	explorationId?: string
}

export function insertExploration(store: Store, input: OpenInput, operationId: string, at: string) {
	const planId = requireIdentifier(input.planId, 'plan ID')
	const { target } = planRequest(store, planId)
	const build = requireText(input.build, 'application build (--build)')
	const mode = requireChoice(input.mode ?? 'exploratory', explorationModes, 'mode (--mode)')
	const instance = runInstance(store, target.profile.targetId, input.instance)
	const explorationId = input.explorationId ?? nextExplorationId(store)
	const charter = charterOf(store, planId, input.scope ?? [])
	execute(
		store,
		'INSERT INTO explorations (exploration_id, plan_id, plan_revision, target_id, target_revision, instance_id, build, mode, charter, started_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		explorationId,
		planId,
		latestRevision(store, planId)?.revision ?? null,
		target.profile.targetId,
		target.revision,
		instance.instanceId,
		build,
		mode,
		canonical(charter),
		at,
		operationId
	)
	return { explorationId, planId, build, mode, instanceId: instance.instanceId, charter }
}

export function openExploration(store: Store, actor: string | undefined, input: OpenInput) {
	return write(store, { actor, command: 'explore open', subject: input.planId, input }, (operationId, at) => {
		const opened = insertExploration(store, input, operationId, at)
		return {
			reply: completed(opened.explorationId, {
				...opened,
				next: [
					`Record each test session: checkmate record ${opened.explorationId} --explorer <name> --session <sessionId>`,
					`Then merge and verify: checkmate explore finish ${opened.explorationId}`,
				],
			}),
			subjects: [`exploration:${opened.explorationId}`, `plan:${opened.planId}`],
		}
	})
}

export function addEvent(
	store: Store,
	explorationId: string,
	event: Omit<ExplorationEvent, 'at'>,
	operationId: string,
	at: string
) {
	execute(
		store,
		'INSERT INTO exploration_events (exploration_id, at, step, explorer, status, detail, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
		explorationId,
		at,
		event.step,
		event.explorer,
		event.status,
		canonical(event.detail),
		operationId
	)
}

export function explorationEvents(store: Store, explorationId: string): ExplorationEvent[] {
	return all<{ at: string; step: string; explorer: string | null; status: string; detail: string }>(
		store,
		'SELECT at, step, explorer, status, detail FROM exploration_events WHERE exploration_id = ? ORDER BY rowid',
		explorationId
	).map((row) => ({ ...row, detail: JSON.parse(row.detail) }))
}

export function exploration(store: Store, explorationId: string) {
	const row = explorationRow(store, explorationId)
	return { ...row, charter: JSON.parse(row.charter) as Charter }
}
