import type { Store } from './store.ts'
import type { Claim, Row } from './journal.ts'
import { buildOrder, journal, planClaims, planQuestions, shortName } from './journal.ts'
import { outsideRule, planRules } from './rules.ts'
import { fileName, mediaTypeOf, mergedEntries } from './views.ts'

export type ClaimBuildState = 'new' | 'still_present' | 'fixed' | 'returned' | 'not_retested'
export type CellStatus = 'failed' | 'question' | 'passed' | 'not_checked'
type Question = ReturnType<typeof planQuestions>[number]

const severities = ['critical', 'high', 'medium', 'low'] as const
const presentStates: ClaimBuildState[] = ['new', 'still_present', 'returned']

export function claimBuildStates(claim: Claim, builds: string[]) {
	let fixedBefore = false
	return builds.slice(Math.max(0, builds.indexOf(claim.build))).map((build, index) => {
		const on = claim.statuses[build]
		const state: ClaimBuildState =
			index === 0
				? 'new'
				: !on || on.status === 'no verdict'
					? 'not_retested'
					: on.status === 'fixed'
						? 'fixed'
						: fixedBefore
							? 'returned'
							: 'still_present'
		if (state === 'fixed') fixedBefore = true
		if (state === 'still_present' || state === 'returned') fixedBefore = false
		return { build, state }
	})
}

function planRecord(store: Store, planId: string) {
	const keep = mergedEntries(store, planId)
	const state = journal(store, planId, undefined, keep)
	return { state, claims: planClaims(store, planId, keep), questions: planQuestions(store, planId, keep) }
}

export function ruleMap(store: Store, planId: string) {
	const record = planRecord(store, planId)
	const { state, questions } = record
	const claims = record.claims.filter((claim) => claim.state !== 'rejected')
	const builds = state.builds
	const stored = planRules(store, planId)
	const rules = [
		...stored.rules,
		{ id: outsideRule, text: 'Behaviour outside the rules of the plan.', source: null as string | null },
	]
	const states = new Map(
		claims.map((claim) => [claim.id, new Map(claimBuildStates(claim, builds).map((on) => [on.build, on.state]))])
	)
	const criteria = state.team.filter((entry) => entry.kind === 'criterion' && entry.rule !== undefined)
	const cellOf = (rule: string, build: string) => {
		const own = claims.filter((claim) => claim.rule === rule && states.get(claim.id)!.has(build))
		const present = own.filter((claim) => presentStates.includes(states.get(claim.id)!.get(build)!))
		const asked = questions.filter(
			(question) => question.rule === rule && question.answer === null && question.builds.includes(build)
		)
		const checked = criteria.filter((entry) => entry.rule === rule && entry.build === build)
		const wrong = checked.filter((entry) => entry.verdict === 'wrong').length
		const right = checked.filter((entry) => entry.verdict === 'ok').length
		const status: CellStatus =
			present.length || wrong ? 'failed' : asked.length ? 'question' : right ? 'passed' : 'not_checked'
		const changes = Object.fromEntries(
			(['new', 'still_present', 'fixed', 'returned', 'not_retested'] as const).map((name) => [
				name,
				own.filter((claim) => states.get(claim.id)!.get(build) === name).map((claim) => claim.id),
			])
		) as Record<ClaimBuildState, string[]>
		return {
			build,
			status,
			severities: Object.fromEntries(
				severities.map((severity) => [severity, present.filter((claim) => claim.severity === severity).length])
			) as Record<(typeof severities)[number], number>,
			claims: present.map((claim) => ({
				id: claim.id,
				title: claim.title,
				severity: claim.severity,
				state: claim.state,
				change: states.get(claim.id)!.get(build)!,
			})),
			questions: asked.map((question) => ({
				id: question.id,
				question: question.question,
				label: question.label,
			})),
			criteria: { right, wrong },
			changes,
		}
	}
	return {
		planId,
		rulesOrigin: stored.origin,
		builds: buildOrder(store, planId).filter((item) => builds.includes(item.build)),
		rows: rules.map((rule) => {
			const cells = builds.map((build) => cellOf(rule.id, build))
			return {
				rule,
				cells: cells.map((cell, index) => ({ ...cell, before: index ? cells[index - 1].status : null })),
			}
		}),
		unlinked: {
			claims: claims.filter((claim) => claim.rule === null).map((claim) => claim.id),
			questions: questions
				.filter((question) => question.rule === null && question.answer === null)
				.map((question) => question.id),
		},
	}
}

function evidenceKind(mediaType: string) {
	if (mediaType.startsWith('image/')) return 'image'
	if (mediaType === 'application/json') return 'json'
	if (mediaType.startsWith('text/')) return 'text'
	return 'file'
}

function claimEvidenceList(reports: Row[]) {
	return reports.flatMap((report) =>
		(report.evidence ?? []).map((item, index) => {
			const base = { report: report.id, explorationId: report.explorationId, index }
			if (!('path' in item))
				return {
					...base,
					kind: 'note',
					name: null,
					mediaType: 'text/plain',
					size: 0,
					thumbnail: false,
					text: item.text,
				}
			const mediaType = mediaTypeOf(item.path)
			const kind = evidenceKind(mediaType)
			return {
				...base,
				kind,
				name: fileName(item.path),
				mediaType,
				size: item.size,
				thumbnail: kind === 'image',
				text: null,
			}
		})
	)
}

function questionOf(questions: Question[], ref: string) {
	return questions.find((question) => question.id === ref || question.members.includes(ref))
}

function uncertainty(claim: Claim, reports: Row[], questions: Question[]) {
	if (claim.decision) return []
	const asked = [
		...new Set(reports.flatMap((report) => [...(report.links ?? []), ...(report.about ?? '').split(/[\s,;]+/)])),
	].flatMap((ref) => {
		const question = questionOf(questions, ref)
		return question && question.answer === null ? [question] : []
	})
	return [
		...(claim.state === 'suspected'
			? [
					{
						reason: 'tester_unsure' as const,
						text: reports.map((report) => report.question).find(Boolean) ?? null,
					},
				]
			: []),
		...(claim.verified === 'refuted' ? [{ reason: 'not_reproduced' as const, text: claim.verifierSaw }] : []),
		...[...new Set(asked)].map((question) => ({
			reason: 'open_question' as const,
			text: question.question,
			questionId: question.id,
		})),
	]
}

export function claimDetails(store: Store, planId: string) {
	const { state, claims, questions } = planRecord(store, planId)
	const byId = new Map(state.team.map((entry) => [entry.id, entry]))
	return claims.map((claim) => {
		const reports = claim.reports.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
		return {
			id: claim.id,
			title: claim.title,
			severity: claim.severity,
			state: claim.state,
			rule: claim.rule,
			handoff: claim.handoff,
			reporters: reports.map((report) => ({
				explorer: shortName(report.actor),
				report: report.id,
				build: report.build ?? null,
				explorationId: report.explorationId,
				rule: report.rule ?? null,
			})),
			builds: claimBuildStates(claim, state.builds),
			uncertain: uncertainty(claim, reports, questions),
			evidence: claimEvidenceList(reports),
		}
	})
}
