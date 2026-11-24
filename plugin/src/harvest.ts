import type { Store } from './store.ts'
import type { Plan, PlanCandidate } from './types.ts'
import type { Row } from './journal.ts'
import { all, one, write } from './store.ts'
import { requireCondition, unusedId } from './contracts.ts'
import { explorationRow, journal, planClaims } from './journal.ts'
import { planCandidate, planRequest, planRevision, storeEdit, storeRevision } from './plans.ts'
import type { Rule } from './rules.ts'
import { outsideRule, planRules, saveRules } from './rules.ts'

type Candidate = Required<PlanCandidate>
type Draft = {
	from: string
	title: string
	rule: string | undefined
	requirement: string
	source: string
	action: string
	checks: string[]
	via: string | undefined
	basis: 'claim' | 'observed'
}

const harvestedStates = ['observed', 'confirmed', 'accepted']

function stepsText(steps: string | string[] | undefined, fallback: string) {
	const text = [steps ?? []].flat().join(' ').trim()
	return text || fallback
}

function linkedCriterion(entry: Row | undefined, criteria: Map<string, Row>) {
	const ids = [...(entry?.links ?? []), ...(entry?.about ?? '').split(/[\s,;]+/)]
	return ids.map((id) => criteria.get(id)).find(Boolean)
}

// One assertion for each clause of an expected value. Every clause stays; none is dropped.
function checksOf(expected: string) {
	const clauses = expected
		.split(/\band\b|;/i)
		.map((clause) => clause.trim())
		.filter(Boolean)
	return (clauses.length ? clauses : [expected]).map((clause) => (clause.endsWith('.') ? clause : `${clause}.`))
}

function drafts(store: Store, explorationId: string, observations: boolean): Draft[] {
	const row = explorationRow(store, explorationId)
	const state = journal(store, row.plan_id)
	const own = state.team.filter((entry) => entry.explorationId === explorationId)
	const byId = new Map(state.team.map((entry) => [entry.id, entry]))
	const criteria = new Map(state.team.filter((entry) => entry.kind === 'criterion').map((entry) => [entry.id, entry]))
	const fromClaims = planClaims(store, row.plan_id)
		.filter((claim) => claim.explorationId === explorationId && harvestedStates.includes(claim.state))
		.map((claim): Draft => {
			const report = byId.get(claim.reports[0])
			const criterion = linkedCriterion(report, criteria)
			return {
				from: claim.id,
				title: claim.title,
				rule: claim.rule ?? undefined,
				requirement: criterion?.text ?? claim.expected,
				source: criterion?.source ?? `exploration:${explorationId}/${claim.id}`,
				action: stepsText(claim.steps ?? undefined, claim.title),
				checks: checksOf(claim.expected),
				via: report?.via,
				basis: 'claim',
			}
		})
	const fromObservations = observations
		? own
				.filter((entry) => entry.kind === 'observation' && entry.verdict === 'ok' && entry.steps)
				.map((entry): Draft => {
					const criterion = linkedCriterion(entry, criteria)
					return {
						from: entry.id,
						rule: criterion?.rule,
						title: `Observed: ${entry.about ?? entry.saw}`.slice(0, 200),
						requirement: criterion?.text ?? entry.saw!,
						source: criterion?.source ?? `exploration:${explorationId}/${entry.id}`,
						action: stepsText(entry.steps, entry.saw!),
						checks: [entry.value !== undefined ? `The result is ${entry.value}.` : entry.saw!],
						via: entry.via,
						basis: 'observed',
					}
				})
		: []
	return [...fromClaims, ...fromObservations]
}

function harvestedSources(tests: Array<{ metadata?: Record<string, unknown> }>) {
	return new Set(tests.map((test) => test.metadata?.harvestedFrom).filter(Boolean))
}

function notHarvested(items: Draft[], known: Set<unknown>, explorationId: string) {
	return items.filter((item) => !known.has(`${explorationId}/${item.from}`))
}

export function storableDefects(store: Store, planId: string) {
	const latest = one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', planId)
		? planRevision(store, planId)
		: null
	const known = harvestedSources(latest?.plan.tests ?? [])
	return all<{ exploration_id: string }>(
		store,
		'SELECT exploration_id FROM explorations WHERE plan_id = ? ORDER BY rowid',
		planId
	)
		.map(({ exploration_id }) => ({
			explorationId: exploration_id,
			claims: notHarvested(drafts(store, exploration_id, false), known, exploration_id).map((item) => item.from),
		}))
		.filter((item) => item.claims.length)
}

function capabilityOf(via: string | undefined, capabilities: string[]) {
	const wanted = via === 'ui' ? 'browser' : via === 'api' ? 'http' : undefined
	return wanted && capabilities.includes(wanted) ? wanted : capabilities[0]
}

function harvested(
	base: Candidate,
	rules: Rule[],
	items: Draft[],
	explorationId: string,
	build: string,
	capabilities: string[],
	operations: string[]
) {
	const fresh = notHarvested(items, harvestedSources(base.tests), explorationId)
	const requirements = [...base.requirements]
	const tests = [...base.tests]
	const added: Array<{ test: string; rule: string }> = []
	for (const item of fresh) {
		const named = item.rule === outsideRule ? undefined : rules.find((rule) => rule.id === item.rule)
		const cited =
			named ??
			requirements.find((entry) => entry.text === item.requirement) ??
			rules.find((rule) => rule.text === item.requirement)
		let requirement = requirements.find((entry) => entry.id === cited?.id)
		if (!requirement && cited) {
			requirement = { ...cited }
			requirements.push(requirement)
		}
		if (!requirement) {
			requirement = {
				id: unusedId(
					'HR',
					requirements.map((entry) => entry.id)
				),
				text: item.requirement,
				source: item.source,
			}
			requirements.push(requirement)
		}
		const id = unusedId(
			'H',
			tests.map((test) => test.id)
		)
		tests.push({
			id,
			title: item.title.slice(0, 200),
			requirementIds: [requirement.id],
			capability: capabilityOf(item.via, capabilities),
			operations,
			dependsOn: [],
			preconditions: [`Make new test data that starts with qa-<runId>-${id}.`],
			action: item.action,
			assertions: [
				...item.checks.map((check, index) => ({
					id: `A${index + 1}`,
					check,
					// Harvested checks have no expected value, so the agent judges them.
					checkKind: 'agent_observation' as const,
				})),
			],
			metadata: {
				type: 'regression',
				origin: 'harvest',
				basis: item.basis,
				harvestedFrom: `${explorationId}/${item.from}`,
				build,
			},
		})
		added.push({ test: id, rule: requirement.id })
	}
	return { candidate: { ...base, requirements, tests }, added, skipped: items.length - fresh.length }
}

export function harvestExploration(
	store: Store,
	actor: string | undefined,
	input: { explorationId: string; observations: boolean }
) {
	return write(store, { actor, command: 'harvest', subject: input.explorationId, input }, (operationId) => {
		const row = explorationRow(store, input.explorationId)
		const { request, target } = planRequest(store, row.plan_id)
		const items = drafts(store, row.exploration_id, input.observations)
		requireCondition(
			items.length,
			`Exploration ${row.exploration_id} has nothing to harvest: no claim that is observed, confirmed, or accepted${input.observations ? ', and no observation with verdict ok and steps' : ''}.`,
			input.observations ? undefined : 'Add --observations to harvest the observations with verdict ok and steps.'
		)
		const hasRevision = one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', row.plan_id)
		const latest = hasRevision ? planRevision(store, row.plan_id) : null
		const base: Candidate = latest ? planCandidate(latest.plan) : { requirements: [], tests: [], gaps: [] }
		const before = planRules(store, row.plan_id)
		const result = harvested(
			base,
			before.rules,
			items,
			row.exploration_id,
			row.build,
			target.profile.capabilities,
			target.profile.allowedOperations
		)
		requireCondition(
			result.added.length,
			`Each item of ${row.exploration_id} is harvested already into ${row.plan_id}.`,
			`Run checkmate plan show ${row.plan_id} to read the harvested tests.`
		)
		const change = latest
			? storeEdit(store, operationId, latest, result.candidate)
			: storeRevision(
					store,
					{
						contractVersion: 'toolkit-2',
						planId: row.plan_id,
						revision: 1,
						previousRevision: null,
						target: { targetId: target.profile.targetId, revision: target.revision, sha256: target.sha256 },
						objective: request.objective,
						requirements: result.candidate.requirements as Plan['requirements'],
						tests: result.candidate.tests,
						gaps: [],
						assumptions: [],
						decisions: [],
					},
					operationId
				)
		if (!latest && before.rules.length && before.origin !== 'harvested')
			saveRules(store, operationId, row.plan_id, before.rules, 'harvested')
		const { plan } = planRevision(store, row.plan_id)
		const stocked = new Set(plan.tests.flatMap((item) => item.requirementIds))
		const rules = planRules(store, row.plan_id).rules
		return {
			reply: {
				...change.reply,
				data: {
					...change.reply.data,
					explorationId: row.exploration_id,
					tests: result.added.map((item) => item.test),
					attached: result.added,
					skipped: result.skipped,
					rules: rules.length,
					rulesWithTests: rules.filter((rule) => stocked.has(rule.id)).length,
				},
			},
			subjects: [...change.subjects, `exploration:${row.exploration_id}`],
		}
	})
}
