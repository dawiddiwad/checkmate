import type { Store } from './store.ts'
import { all, completed, digest, one, write } from './store.ts'
import { requireChoice, requireCondition, requireText, requireWellFormed, revisionReference } from './contracts.ts'
import { planApproval, planRevision } from './plans.ts'
import { ruleSources } from './rules.ts'

type Evidence = { source: string; evidence: string }
type ReviewInput = Evidence & { reference: string; sha256: string; rationale: string }
type FindingInput = Evidence & { reference: string; sha256: string; gapId: string; kind: string }
type RecordRow = { rowid: number; actor: string; at: string; arguments: string; response: string }

function revision(store: Store, reference: string) {
	const parsed = revisionReference(requireText(reference, 'plan reference'), 'plan reference')
	requireWellFormed(parsed.revision !== null, `Name the ticket plan revision: ${parsed.id}@<revision>`)
	return planRevision(store, parsed.id, parsed.revision)
}

function current(store: Store, reference: string, sha256: string) {
	const selected = revision(store, reference)
	const latest = planRevision(store, selected.plan.planId)
	requireCondition(
		latest.plan.revision === selected.plan.revision,
		`${reference} is stale. Review ${selected.plan.planId}@${latest.plan.revision}.`
	)
	requireCondition(
		selected.sha256 === requireText(sha256, 'plan SHA (--expect-sha)'),
		`${reference} changed. Read its current SHA and review it again.`
	)
	return selected
}

function evidence(store: Store, planId: string, input: Evidence) {
	const source = requireText(input.source, 'source (--source)')
	const excerpt = requireText(input.evidence, 'evidence (--evidence)')
	const found = ruleSources(store, planId).find((item) => item.name === source)
	requireCondition(found, `Source ${source} is not a source of ticket ${planId}.`)
	requireCondition(
		found.text !== null,
		`Source ${source} is not a readable local ticket source. Add a local source when opening the plan.`
	)
	requireCondition(
		found.text.includes(excerpt),
		`Evidence is not present in ${source}. Read the source and quote the relevant text.`
	)
	return { source, evidence: excerpt }
}

function records(store: Store, planId: string, command: string) {
	return all<RecordRow>(
		store,
		`SELECT rowid, actor, at, arguments, response FROM operations WHERE command = ? AND status = 'completed' AND substr(json_extract(arguments, '$.reference'), 1, length(?) + 1) = ? || '@' ORDER BY rowid`,
		command,
		planId,
		planId
	)
}

export function specFinding(store: Store, actor: string | undefined, input: FindingInput) {
	return write(store, { actor, command: 'spec finding', subject: input.reference, input }, () => {
		const { plan } = current(store, input.reference, input.sha256)
		const gap = plan.gaps.find((item) => item.id === input.gapId)
		requireCondition(gap?.status === 'open', `Open gap ${input.gapId} is not in ${input.reference}.`)
		const kind = requireChoice(input.kind, ['question', 'gap', 'defect'] as const, 'kind (--kind)')
		const quote = evidence(store, plan.planId, input)
		return {
			reply: completed(input.reference, {
				planId: plan.planId,
				revision: plan.revision,
				sha256: input.sha256,
				gapId: gap.id,
				kind,
				...quote,
			}),
			subjects: [`plan:${plan.planId}`],
		}
	})
}

export function specReview(store: Store, actor: string | undefined, input: ReviewInput) {
	return write(store, { actor, command: 'spec review', subject: input.reference, input }, () => {
		const { plan } = current(store, input.reference, input.sha256)
		const quote = evidence(store, plan.planId, input)
		const rationale = requireText(input.rationale, 'review rationale (--rationale)')
		requireCondition(plan.requirements.length > 0, 'The ticket has no rules to review.')
		const sources = ruleSources(store, plan.planId)
		requireCondition(
			sources.length > 0 &&
				sources.every(
					(source) => source.text !== null && !source.text.endsWith('\n(The rest of the file is left out.)')
				),
			'Make each ticket source a readable local file of at most 40000 characters before review.'
		)
		const sourceDigests = Object.fromEntries(sources.map((source) => [source.name, digest(source.text!)]))
		return {
			reply: completed(input.reference, {
				planId: plan.planId,
				revision: plan.revision,
				sha256: input.sha256,
				rules: plan.requirements.map((item) => item.id),
				sourceDigests,
				...quote,
				rationale,
			}),
			subjects: [`plan:${plan.planId}`],
		}
	})
}

export function specStatus(store: Store, reference: string) {
	const { plan, sha256 } = revision(store, reference)
	const latest = planRevision(store, plan.planId)
	const findings = records(store, plan.planId, 'spec finding').map((row) => ({
		...row,
		input: JSON.parse(row.arguments) as FindingInput,
	}))
	const reviews = records(store, plan.planId, 'spec review').map((row) => ({
		...row,
		input: JSON.parse(row.arguments) as ReviewInput,
	}))
	const review = reviews.filter((item) => item.input.reference === reference && item.input.sha256 === sha256).at(-1)
	const reasons: string[] = []
	if (latest.plan.revision !== plan.revision)
		reasons.push(`The reviewed revision is stale. Review ${plan.planId}@${latest.plan.revision}.`)
	if (review) {
		const saved = JSON.parse(review.response).data.sourceDigests
		const sources = ruleSources(store, plan.planId)
		if (!saved || sources.some((source) => source.text === null || saved[source.name] !== digest(source.text)))
			reasons.push('Ticket sources changed since the review. Review them again.')
	}
	if (!review || findings.some((item) => item.rowid > review.rowid))
		reasons.push('Review the current specification after recording its findings.')
	for (const gap of plan.gaps.filter((item) => item.status === 'open' || item.status === 'deferred'))
		reasons.push(`Gap ${gap.id} is ${gap.status}. Answer it and revise the plan.`)
	for (const finding of findings) {
		const gap = plan.gaps.find((item) => item.id === finding.input.gapId)
		if (
			!gap ||
			gap.status !== 'resolved' ||
			!gap.decisionId ||
			!plan.decisions.some((item) => item.id === gap.decisionId && item.gapId === gap.id)
		)
			reasons.push(`Specification finding ${finding.input.gapId} has no applied resolution.`)
	}
	if (one(store, 'SELECT id FROM decisions WHERE plan_id = ? AND applied_revision IS NULL LIMIT 1', plan.planId))
		reasons.push('Apply the pending oracle decision with plan revise.')
	if (
		!plan.requirements.length ||
		plan.requirements.some((rule) => !plan.tests.some((test) => test.requirementIds.includes(rule.id)))
	)
		reasons.push('Give each ticket rule a test before handoff.')
	const approval = planApproval(store, plan, sha256)
	if (approval.rejected || (approval.policy === 'required' && !approval.approved))
		reasons.push('The current plan revision needs oracle approval.')
	return {
		planId: plan.planId,
		revision: plan.revision,
		sha256,
		ready: reasons.length === 0,
		reasons: [...new Set(reasons)],
		review: review ? { actor: review.actor, at: review.at, ...review.input } : null,
		findings: findings.map((item) => ({ actor: item.actor, at: item.at, ...item.input })),
		approval,
	}
}

export function specHandoff(
	store: Store,
	actor: string | undefined,
	input: { reference: string; sha256: string; rationale: string }
) {
	return write(store, { actor, command: 'spec handoff', subject: input.reference, input }, () => {
		current(store, input.reference, input.sha256)
		const status = specStatus(store, input.reference)
		requireCondition(status.ready, status.reasons.join(' '))
		const rationale = requireText(input.rationale, 'handoff rationale (--rationale)')
		return {
			reply: completed(input.reference, { ...status, rationale }),
			subjects: [`plan:${status.planId}`, 'inbox'],
		}
	})
}
