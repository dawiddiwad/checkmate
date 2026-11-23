import type { Store } from './store.ts'
import type { Gap, PlanCandidate, PlanRequest, Profile } from './types.ts'
import { all, one } from './store.ts'
import { compoundCheck } from './contracts.ts'
import { planRequest, savePlan } from './plans.ts'
import { anyTestOperation } from './targets.ts'

// The test flow saves plan revision 1 when a plan has none. The record of the test
// gives the rules, one checked test for each rule that the test checked, and the
// open questions as gaps. The same plan validation as `plan save` applies.

type Rule = { id: string; text: string; source: string; area: string }
type JournalEntry = {
	kind: string
	id?: string
	rule?: string
	verdict?: string
	question?: string
	blocking?: boolean
}

function latestRules(store: Store, planId: string): Rule[] {
	const row = one<{ body: string }>(
		store,
		"SELECT body FROM plan_rules WHERE plan_id = ? AND origin = 'derived' ORDER BY rowid DESC LIMIT 1",
		planId
	)
	return row ? (JSON.parse(row.body) as Rule[]) : []
}

function journalOf(store: Store, explorationId: string): JournalEntry[] {
	return all<{ body: string }>(store, 'SELECT body FROM journal_entries WHERE exploration_id = ?', explorationId).map(
		(row) => JSON.parse(row.body) as JournalEntry
	)
}

function capabilityOf(profile: Profile) {
	return profile.capabilities.includes('http') ? 'http' : profile.capabilities[0]
}

function operationOf(profile: Profile) {
	return profile.allowedOperations.includes(anyTestOperation) ? anyTestOperation : profile.allowedOperations[0]
}

// Saves revision 1 from the record of a finished test. A plan that has a revision is left alone.
export function saveFirstRevision(store: Store, actor: string | undefined, planId: string, explorationId: string) {
	if (one(store, 'SELECT 1 FROM plan_revisions WHERE plan_id = ?', planId)) return
	const { request, target } = planRequest(store, planId)
	const rules = latestRules(store, planId)
	const entries = journalOf(store, explorationId)
	const checked = new Map(
		entries
			.filter((entry) => entry.kind === 'criterion' && (entry.verdict === 'ok' || entry.verdict === 'wrong'))
			.map((entry) => [entry.rule ?? '', entry])
	)
	const gaps: Gap[] = []
	const tests: PlanCandidate['tests'] = []
	for (const rule of rules) {
		const verdict = checked.get(rule.id)
		if (!verdict || compoundCheck(rule.text)) {
			gaps.push(unverifiedGap(rule))
			continue
		}
		tests.push({
			id: `T${rule.id}`,
			title: rule.text.slice(0, 200),
			requirementIds: [rule.id],
			capability: capabilityOf(target.profile) ?? 'http',
			operations: [operationOf(target.profile) ?? anyTestOperation],
			dependsOn: [],
			preconditions: [],
			action: 'Perform the check of this rule on the running application, and record what you observe.',
			assertions: [{ id: 'A1', check: rule.text, checkKind: 'agent_observation' }],
		})
	}
	// Each tester numbers its own questions, so the IDs repeat. The gap IDs are numbered here.
	for (const [index, entry] of entries.filter((item) => item.kind === 'question').entries()) {
		gaps.push({
			id: `Q${index + 1}`,
			severity: entry.blocking ? 'blocking' : 'non_blocking',
			status: 'open',
			requirementIds: rules.some((rule) => rule.id === entry.rule) ? [entry.rule!] : [],
			testIds: [],
			question: entry.question!,
			consequence: 'The plan waits for the answer before the tests that this question affects can run.',
			decisionId: null,
		})
	}
	savePlan(store, actor, {
		planId,
		candidate: candidateFor(request, rules, tests, gaps),
	})
}

// Used by the test flow when a test is done. A refused revision does not fail the test:
// the reason goes into the done record, and status says that the plan has no revision.
export function firstRevision(
	store: Store,
	actor: string | undefined,
	planId: string,
	explorationId: string
): { revision: boolean; reason?: string } {
	try {
		saveFirstRevision(store, actor, planId, explorationId)
		return { revision: true }
	} catch (error) {
		return { revision: false, reason: error instanceof Error ? error.message : String(error) }
	}
}

function unverifiedGap(rule: Rule): Gap {
	return {
		id: `U${rule.id}`,
		severity: 'non_blocking',
		status: 'open',
		requirementIds: [rule.id],
		testIds: [],
		question: `Rule ${rule.id} was not checked by the test. Check it by hand, or retest it with a test of its own.`,
		consequence: 'No test of this plan checks the rule.',
		decisionId: null,
	}
}

function candidateFor(request: PlanRequest, rules: Rule[], tests: PlanCandidate['tests'], gaps: Gap[]) {
	// The plan request can name the requirements. Then the candidate must not repeat them.
	const requirements = request.requirements?.length ? {} : { requirements: rules }
	return { ...requirements, tests, gaps }
}
