import type { Store } from './store.ts'
import { all, completed, execute, one, write } from './store.ts'
import { requireBuild, requireCondition, requireText, requireWellFormed, revisionReference } from './contracts.ts'
import { planCandidate, planRequest, planRevision, storeEdit } from './plans.ts'
import { resultAcceptance, runResult, runState } from './runs.ts'
import { planStatus } from './views.ts'
import { planRules } from './rules.ts'

type Promotion = {
	plan_id: string
	source_revision: number
	promoted_revision: number
	build: string
	run_id: string
	result_sha256: string
	tests: string
	rationale: string
}

export function planPromotions(store: Store, planId: string) {
	planRequest(store, planId)
	return all<Promotion & { actor: string; at: string }>(
		store,
		`SELECT p.*, o.actor, o.at FROM plan_promotions p JOIN operations o ON o.id = p.operation_id
		WHERE p.plan_id = ? ORDER BY p.source_revision`,
		planId
	).map((row) => ({
		planId: row.plan_id,
		sourceRevision: row.source_revision,
		revision: row.promoted_revision,
		build: row.build,
		runId: row.run_id,
		resultSha256: row.result_sha256,
		accepted: resultAcceptance(store, runState(store, row.run_id).row, row.result_sha256).approved,
		tests: JSON.parse(row.tests) as string[],
		rationale: row.rationale,
		actor: row.actor,
		at: row.at,
	}))
}

export function promotePlan(
	store: Store,
	actor: string | undefined,
	input: { reference: string; runId: string; build: string; rationale: string }
) {
	return write(store, { actor, command: 'plan promote', subject: input.reference, input }, (operationId) => {
		const reference = revisionReference(requireText(input.reference, 'plan reference'), 'plan reference')
		requireWellFormed(reference.revision !== null, 'Name the plan revision to promote.')
		const build = requireBuild(input.build)
		const rationale = requireText(input.rationale, 'rationale (--rationale)')
		const run = runState(store, input.runId)
		const result = runResult(store, input.runId)
		requireCondition(result, `Run ${input.runId} is not finished.`)
		requireCondition(
			run.row.plan_id === reference.id && run.row.plan_revision === reference.revision,
			`Run ${input.runId} does not belong to ${input.reference}.`
		)
		requireCondition(run.row.application_build === build, `Run ${input.runId} is not on build ${build}.`)
		requireCondition(
			resultAcceptance(store, run.row, result.sha256).approved,
			`Accept result ${input.runId} first.`
		)
		const current = planRevision(store, reference.id)
		const latestBuild = one<{ build: string }>(
			store,
			`SELECT build FROM (
				SELECT x.build AS build, o.rowid AS position FROM explorations x
				JOIN operations o ON o.id = x.operation_id WHERE x.plan_id = ?
				UNION ALL
				SELECT r.application_build AS build, o.rowid AS position FROM runs r
				JOIN operations o ON o.id = r.operation_id WHERE r.plan_id = ?
			) ORDER BY position DESC LIMIT 1`,
			reference.id,
			reference.id
		)?.build
		requireCondition(latestBuild === build, `Build ${build} is not the latest build of ${reference.id}.`)
		const previous = one<Promotion>(
			store,
			'SELECT * FROM plan_promotions WHERE plan_id = ? AND source_revision = ?',
			reference.id,
			reference.revision
		)
		if (previous) {
			requireCondition(
				previous.run_id === input.runId &&
					previous.build === build &&
					previous.result_sha256 === result.sha256 &&
					previous.rationale === rationale,
				`${input.reference} was promoted with a different decision.`
			)
			requireCondition(
				current.plan.revision === previous.promoted_revision,
				`Plan ${reference.id} has changed since promotion.`
			)
			const changed = one(
				store,
				`SELECT 1 FROM operations o JOIN plan_promotions p ON p.plan_id = ? AND p.source_revision = ?
				WHERE o.rowid > (SELECT rowid FROM operations WHERE id = p.operation_id)
				AND o.status = 'completed' AND EXISTS (SELECT 1 FROM json_each(o.subjects) WHERE value = ?) LIMIT 1`,
				reference.id,
				reference.revision,
				`plan:${reference.id}`
			)
			requireCondition(!changed, `The record of ${reference.id} has changed since promotion.`)
			return {
				reply: completed(`${reference.id}@${previous.promoted_revision}`, {
					planId: reference.id,
					sourceRevision: reference.revision,
					revision: previous.promoted_revision,
					build,
					runId: input.runId,
					tests: JSON.parse(previous.tests),
					recorded: false,
				}),
				subjects: [],
			}
		}
		requireCondition(
			current.plan.revision === reference.revision,
			`Plan ${input.reference} is not the latest revision.`
		)
		requireCondition(run.row.plan_sha256 === current.sha256, `Run ${input.runId} uses a different plan snapshot.`)
		const plan = current.plan
		requireCondition(
			plan.requirements.length > 0 && plan.tests.length > 0,
			'The plan needs rules and tests to promote.'
		)
		requireCondition(!plan.gaps.some((gap) => gap.status === 'open'), 'Resolve all plan gaps before promotion.')
		const status = planStatus(store, reference.id)
		requireCondition(status.state === 'accepted', `Plan ${reference.id} is ${status.state}, not accepted.`)
		const exploration = status.explorations.filter((item) => item.build === build).at(-1)
		requireCondition(
			!exploration || exploration.state === 'completed',
			`Exploration ${exploration?.explorationId} on ${build} is ${exploration?.state}.`
		)
		requireCondition(
			!status.questions.length && !status.claims.length,
			'Resolve the open exploration questions and claims before promotion.'
		)
		for (const rule of planRules(store, reference.id).rules)
			requireCondition(
				plan.tests.some((test) => test.requirementIds.includes(rule.id)),
				`Rule ${rule.id} has no test.`
			)
		requireCondition(result.result.completion === 'completed', `Run ${input.runId} did not complete.`)
		for (const test of plan.tests) {
			requireCondition(
				test.readiness === 'ready' && test.assertions.length,
				`Test ${test.id} is not ready for promotion.`
			)
			const tested = result.result.tests.find((item) => item.testId === test.id)
			requireCondition(tested?.outcome === 'passed', `Test ${test.id} did not pass in ${input.runId}.`)
			for (const assertion of test.assertions) {
				const checked = tested.assertions.find((item) => item.assertionId === assertion.id)
				requireCondition(
					checked?.result === 'passed' && checked.observed && checked.evidenceIds.length,
					`Assertion ${test.id}.${assertion.id} needs a passing observation and evidence in ${input.runId}.`
				)
			}
		}
		const candidate = planCandidate(plan)
		const change = storeEdit(store, operationId, current, candidate)
		const promoted = planRevision(store, reference.id)
		const tests = candidate.tests.map((test) => test.id)
		execute(
			store,
			'INSERT INTO plan_promotions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			reference.id,
			reference.revision,
			promoted.plan.revision,
			build,
			input.runId,
			result.sha256,
			JSON.stringify(tests),
			rationale,
			operationId
		)
		return {
			reply: completed(`${reference.id}@${promoted.plan.revision}`, {
				planId: reference.id,
				sourceRevision: reference.revision,
				revision: promoted.plan.revision,
				build,
				runId: input.runId,
				tests,
				recorded: true,
			}),
			subjects: [...change.subjects, `run:${input.runId}`],
		}
	})
}
