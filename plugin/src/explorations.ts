import type { Store } from './store.ts'
import type { Plan } from './types.ts'
import type { Change } from './change.ts'
import { all, canonical, completed, execute, one, write } from './store.ts'
import { requireChoice, requireIdentifier, requireText, unusedId } from './contracts.ts'
import { planRequest, planTools } from './plans.ts'
import { runInstance } from './targets.ts'
import { explorationRules, planRules } from './rules.ts'
import type { Claim } from './journal.ts'
import { addPlanBuild, explorationRow, journal, planClaims, planQuestions } from './journal.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
	change: Change | null
	knownState: string | null
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

export function charterOf(
	store: Store,
	planId: string,
	scope: string[],
	change: Change | null,
	knownState: string | null = null
): Charter {
	const { request, target } = planRequest(store, planId)
	return {
		goal: request.objective,
		requirements: planRules(store, planId).rules.map(({ id, text }) => ({ id, text })),
		sources: request.context?.sources ?? [],
		instructions: request.context?.instructions ?? null,
		capabilities: target.profile.capabilities,
		operations: target.profile.allowedOperations,
		tools: planTools(request, target.profile).map(({ name, purpose }) => ({ name, purpose })),
		scope,
		change,
		knownState,
	}
}

export function workFolder(explorationId: string, explorer?: string) {
	return `.checkmate/work/${explorationId}${explorer ? `/${explorer}` : ''}`
}

const maxKnownLines = 150
const isEntryId = (word: string) => /^([A-Za-z0-9_-]+\/)?[A-Z]+[0-9]+$/.test(word)

const withBlankEnd = (lines: string[]) => (lines.at(-1) === '' ? lines : [...lines, ''])

export function knownStateText(store: Store, planId: string, build: string) {
	const state = journal(store, planId)
	const claims = planClaims(store, planId).filter((claim) => claim.build !== build)
	const lastSeen = (claim: Claim) =>
		Object.entries(claim.statuses)
			.filter(([, on]) => on.status === 'not_fixed')
			.map(([seen]) => seen)
			.at(-1) ?? claim.build
	const open = claims.filter((claim) => claim.open)
	const fixed = claims.filter((claim) => !claim.open && claim.state !== 'rejected')
	const rejected = claims.filter((claim) => claim.state === 'rejected')
	const answers = planQuestions(store, planId).filter((question) => question.answer !== null)
	const observed = state.team.filter((entry) => ['observation', 'defect'].includes(entry.kind))
	const mentioned = new Set(
		observed.flatMap((entry) => [...(entry.about ?? '').split(/[\s,;]+/), ...(entry.links ?? [])])
	)
	const criteria = state.team.filter((entry) => entry.kind === 'criterion')
	const areas = [
		...new Set(
			state.team.flatMap((entry) => [
				...(entry.area ? [entry.area] : []),
				...(entry.kind === 'observation' && entry.about && !entry.about.split(/[\s,;]+/).every(isEntryId)
					? [entry.about]
					: []),
			])
		),
	]
	const fixedOn = (claim: Claim) =>
		Object.entries(claim.statuses)
			.filter(([, on]) => on.status === 'fixed')
			.map(([seen]) => seen)
			.at(-1) ?? claim.build
	const newestFirst = [...fixed].sort((a, b) => state.builds.indexOf(fixedOn(b)) - state.builds.indexOf(fixedOn(a)))
	const block = (claim: Claim, seen: string) => [
		`### ${claim.id}: ${claim.title} (${claim.severity})`,
		seen,
		`- Steps: ${[claim.steps ?? 'not given'].flat().join(' ')}`,
		`- Expected: ${claim.expected}`,
		`- Actual: ${claim.actual}`,
		'',
	]
	const render = (full: number) => {
		const shortened = newestFirst.length - full
		return [
			'# Results of earlier builds',
			'',
			'Retest every problem below, open and fixed. In your report, give one line for each problem, with its ID: still present, fixed, or not retested and the reason.',
			'',
			'## Open problems',
			'',
			...(open.length
				? open.flatMap((claim) => block(claim, `- Last seen on build: ${lastSeen(claim)}`))
				: ['None.', '']),
			'## Decisions of the product owner',
			'',
			...(answers.length || rejected.length
				? [
						...answers.map((question) => `- ${question.question} Answer: ${question.answer}`),
						...rejected.map((claim) =>
							`- Not a defect: ${claim.title}. ${claim.decision?.rationale ?? ''}`.trim()
						),
					]
				: ['None.']),
			'',
			'## Problems reported as fixed',
			'',
			...(newestFirst.length
				? withBlankEnd([
						'Check that each one does not come back. The newest fix is first.',
						'',
						...newestFirst
							.slice(0, full)
							.flatMap((claim) => block(claim, `- Reported fixed on build: ${fixedOn(claim)}`)),
						...newestFirst
							.slice(full)
							.map(
								(claim) => `- ${claim.id}: ${claim.title} (reported fixed on build ${fixedOn(claim)})`
							),
						...(shortened ? [`${shortened} older fixed problems are shortened to their title.`] : []),
					])
				: ['None.', '']),
			'## Areas tested before',
			'',
			...(areas.length ? areas.map((area) => `- ${area}`) : ['None recorded.']),
			'',
			'## Rules not tested yet',
			'',
			...(() => {
				const untested = criteria.filter((criterion) => !mentioned.has(criterion.id))
				return untested.length ? untested.map((criterion) => `- ${criterion.text}`) : ['None recorded.']
			})(),
		]
	}
	let full = newestFirst.length
	let lines = render(full)
	while (lines.length > maxKnownLines && full > 0) lines = render(--full)
	if (lines.length <= maxKnownLines) return lines.join('\n') + '\n'
	return [...lines.slice(0, maxKnownLines - 1), 'More results are left out.'].join('\n') + '\n'
}

function writeKnownState(store: Store, planId: string, explorationId: string, build: string) {
	if (!one(store, 'SELECT 1 FROM explorations WHERE plan_id = ? AND exploration_id != ?', planId, explorationId))
		return null
	const path = `${workFolder(explorationId)}/known-state.md`
	mkdirSync(join(store.workspace, workFolder(explorationId)), { recursive: true })
	writeFileSync(join(store.workspace, path), knownStateText(store, planId, build))
	return path
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
	change?: Change | null
	explorationId?: string
}

export function insertExploration(store: Store, input: OpenInput, operationId: string, at: string) {
	const planId = requireIdentifier(input.planId, 'plan ID')
	const { target } = planRequest(store, planId)
	const build = requireText(input.build, 'application build (--build)')
	const mode = requireChoice(input.mode ?? 'exploratory', explorationModes, 'mode (--mode)')
	const instance = runInstance(store, target.profile.targetId, input.instance)
	const explorationId = input.explorationId ?? nextExplorationId(store)
	const charter = charterOf(
		store,
		planId,
		input.scope ?? [],
		input.change ?? null,
		writeKnownState(store, planId, explorationId, build)
	)
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
	addPlanBuild(store, planId, build, at, operationId)
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
	const charter = JSON.parse(row.charter) as Charter
	return { ...row, charter: { ...charter, requirements: explorationRules(store, explorationId) } }
}
