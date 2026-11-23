import type { Reply, Store } from './store.ts'
import { explorationRow, factoryStates, planClaims } from './journal.ts'
import { harvestExploration } from './harvest.ts'
import { planRevision } from './plans.ts'
import { beginRun, checkAssertion, closeTest, finishRun, recordFinding } from './runs.ts'

type Claim = ReturnType<typeof planClaims>[number]

export function findingsRunId(explorationId: string) {
	return `findings-${explorationId}`
}

function evidenceText(claim: Claim) {
	return [`Observed: ${claim.actual}`, `Steps: ${claim.steps ?? 'none recorded'}`].join('\n')
}

// Stores the defects of a process-mode exploration as one run: each defect is a stored test
// whose assertion failed, with its finding. The run gives a report and JUnit without a harvest step.
export function storeFindingsRun(store: Store, actor: string | undefined, explorationId: string) {
	const row = explorationRow(store, explorationId)
	const claims = planClaims(store, row.plan_id)
	const defects = claims.filter(
		(claim) => claim.explorationId === explorationId && factoryStates.includes(claim.state)
	)
	if (!defects.length) return { runId: null, reason: `No claim of ${explorationId} is a defect for a run.` }
	const harvested = harvestExploration(store, actor, { explorationId, observations: false })
	// An open gap makes the harvest a decision, but the observed tests are stored. The run always records the findings.
	if (harvested.status !== 'completed' && harvested.status !== 'needs_decision')
		return { runId: null, reason: harvested.reasons.join(' ') }
	const { plan } = planRevision(store, row.plan_id)
	const runId = findingsRunId(explorationId)
	const tests = plan.tests.filter(
		(test) => test.metadata?.harvestedFrom && String(test.metadata.harvestedFrom).startsWith(`${explorationId}/`)
	)
	const begun: Reply = beginRun(store, actor, {
		runId,
		reference: `${row.plan_id}@${plan.revision}`,
		tests: tests.map((test) => test.id),
		build: row.build,
		instance: row.instance_id,
		partial: 'ready_only',
	})
	if (begun.status !== 'completed') return { runId: null, reason: begun.reasons.join(' ') }
	let number = 0
	for (const test of tests) {
		const claimId = String(test.metadata!.harvestedFrom).slice(explorationId.length + 1)
		const claim = defects.find((item) => item.id === claimId)
		if (!claim) continue
		const check = checkAssertion(store, actor, {
			runId,
			testId: test.id,
			assertionId: 'A1',
			result: 'failed',
			observed: claim.actual,
			evidence: [{ text: evidenceText(claim) }],
		})
		number += 1
		recordFinding(store, actor, {
			runId,
			finding: {
				id: `F${number}`,
				type: 'defect',
				severity: claim.severity,
				assertionIds: [`${test.id}.A1`],
				requirementIds: test.requirementIds,
				title: claim.title,
				expected: claim.expected,
				observed: claim.actual,
				reproduction: [claim.steps ?? 'See the observed result.'],
				evidenceIds: check.data.evidenceIds,
			},
		})
		closeTest(store, actor, { runId, testId: test.id })
	}
	const finished = finishRun(store, actor, {
		runId,
		completion: 'completed',
		cleanup: 'not_applicable',
		cleanupReason: 'The findings run keeps no work folder.',
	})
	return { runId, reason: finished.reasons.join(' ') }
}
