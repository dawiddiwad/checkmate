import type { Store } from './store.ts'
import type { Plan } from './types.ts'
import { canonical, digest, one } from './store.ts'
import {
	Refusal,
	requireCondition,
	requireIdentifier,
	requireText,
	requireWellFormed,
	revisionReference,
} from './contracts.ts'

type SavedPromotion = {
	plan_id: string
	source_revision: number
	promoted_revision: number
	build: string
	run_id: string
	result_sha256: string
	tests: string
	snapshot: string
	snapshot_sha256: string
	source: string
	source_sha256: string
	result_digest: string
	result_body: string
	run_plan: string
	run_revision: number
	run_build: string
	run_plan_sha256: string
}

type Decision = { verdict: string; subject_sha256: string }

export function permanentSelection(store: Store, planId: string, requested?: string) {
	requireIdentifier(planId, 'ticket plan ID')
	if (requested !== undefined) {
		const reference = revisionReference(requireText(requested, 'promotion (--promotion)'), 'promotion reference')
		requireWellFormed(
			reference.revision !== null,
			'Name the promoted plan revision with --promotion <planId@revision>.'
		)
		requireCondition(reference.id === planId, `Promotion ${requested} does not belong to ticket ${planId}.`)
	}
	const saved = one<SavedPromotion>(
		store,
		`SELECT p.*, v.body AS snapshot, v.sha256 AS snapshot_sha256, source.body AS source, source.sha256 AS source_sha256,
		s.sha256 AS result_digest, s.body AS result_body, r.plan_id AS run_plan, r.plan_revision AS run_revision, r.application_build AS run_build,
		r.plan_sha256 AS run_plan_sha256
		FROM plan_promotions p LEFT JOIN plan_revisions v ON v.plan_id = p.plan_id AND v.revision = p.promoted_revision
		LEFT JOIN plan_revisions source ON source.plan_id = p.plan_id AND source.revision = p.source_revision
		LEFT JOIN runs r ON r.run_id = p.run_id LEFT JOIN results s ON s.run_id = r.run_id
		WHERE p.plan_id = ? ORDER BY p.source_revision DESC LIMIT 1`,
		planId
	)
	requireCondition(
		saved,
		`Ticket ${planId} has no permanent test promotion.`,
		`Promote an accepted plan first: checkmate plan promote ${planId}@<revision> --run <runId> --build <build> --rationale "<why>"`
	)
	const reference = `${planId}@${saved.promoted_revision}`
	requireCondition(
		requested === undefined || requested === reference,
		`Promotion ${requested} is not the current promotion for ${planId}.`,
		`Use --promotion ${reference}.`
	)
	requireCondition(
		typeof saved.snapshot === 'string' &&
			typeof saved.source === 'string' &&
			typeof saved.result_body === 'string' &&
			digest(saved.snapshot) === saved.snapshot_sha256 &&
			digest(saved.source) === saved.source_sha256 &&
			saved.run_plan_sha256 === saved.source_sha256 &&
			saved.run_plan === planId &&
			saved.run_revision === saved.source_revision &&
			saved.run_build === saved.build &&
			saved.result_digest === saved.result_sha256 &&
			digest(saved.result_body) === saved.result_sha256 &&
			saved.promoted_revision === saved.source_revision + 1,
		`Promotion ${reference} has inconsistent provenance.`
	)
	const acceptance = one<Decision>(
		store,
		"SELECT verdict, subject_sha256 FROM approvals WHERE subject_kind = 'result' AND subject_id = ? ORDER BY rowid DESC LIMIT 1",
		saved.run_id
	)
	requireCondition(
		acceptance?.verdict === 'approved' && acceptance.subject_sha256 === saved.result_sha256,
		`Promotion ${reference} is withdrawn or its result is not accepted.`,
		`Review checkmate plan promotions ${planId}.`
	)
	const planDecision = one<Decision>(
		store,
		"SELECT verdict, subject_sha256 FROM approvals WHERE subject_kind = 'plan' AND subject_id = ? ORDER BY rowid DESC LIMIT 1",
		reference
	)
	requireCondition(
		!(planDecision?.verdict === 'rejected' && planDecision.subject_sha256 === saved.snapshot_sha256),
		`Promotion ${reference} is rejected.`,
		`Review checkmate plan show ${reference} and checkmate plan promotions ${planId}.`
	)
	let tests: unknown
	try {
		tests = JSON.parse(saved.tests)
	} catch {
		tests = null
	}
	let plan: Plan
	let source: Plan
	try {
		plan = JSON.parse(saved.snapshot) as Plan
		source = JSON.parse(saved.source) as Plan
	} catch {
		throw new Refusal('prohibited', `Promotion ${reference} has an invalid plan snapshot.`)
	}
	requireCondition(
		plan && typeof plan === 'object' && source && typeof source === 'object',
		`Promotion ${reference} has an invalid plan snapshot.`
	)
	const { revision: _revision, previousRevision: _previousRevision, ...snapshotContent } = plan
	const { revision: _sourceRevision, previousRevision: _sourcePreviousRevision, ...sourceContent } = source
	requireCondition(
		plan.planId === planId &&
			plan.revision === saved.promoted_revision &&
			source.planId === planId &&
			source.revision === saved.source_revision &&
			Array.isArray(plan.tests) &&
			Array.isArray(source.tests) &&
			canonical(snapshotContent) === canonical(sourceContent),
		`Promotion ${reference} does not match its accepted test definitions.`
	)
	const ids = plan.tests.map((test) => test.id)
	requireCondition(
		Array.isArray(tests) &&
			tests.length > 0 &&
			tests.every((id) => typeof id === 'string') &&
			new Set(tests).size === tests.length &&
			tests.length === ids.length &&
			tests.every((id) => ids.includes(id)),
		`Promotion ${reference} has no valid permanent test selection.`,
		`Review checkmate plan promotions ${planId}.`
	)
	return {
		planId,
		sourceRevision: saved.source_revision,
		revision: saved.promoted_revision,
		reference,
		tests: tests as string[],
		resultSha256: saved.result_sha256,
		snapshotSha256: saved.snapshot_sha256,
	}
}
