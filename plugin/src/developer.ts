import type { Store } from './store.ts'
import { requireCondition } from './contracts.ts'
import { buildStateWords, claimDetails } from './rulemap.ts'
import { outsideRule, planRules } from './rules.ts'
import { mergedClaims } from './views.ts'

const separator = `\n\n${'-'.repeat(40)}\n\n`

export function developerText(store: Store, planId: string, claimIds: string[]) {
	const claims = mergedClaims(store, planId)
	const details = claimDetails(store, planId)
	const rules = planRules(store, planId).rules
	const texts = claimIds.map((claimId) => {
		const claim = claims.find((item) => item.id === claimId)
		requireCondition(claim, `Unknown defect ${claimId} of plan ${planId}.`)
		const detail = details.find((item) => item.id === claimId)!
		const rule = rules.find((item) => item.id === claim.rule)
		const steps = [claim.steps ?? []].flat()
		const files = [...new Set(detail.evidence.flatMap((item) => (item.name ? [item.name] : [])))]
		return [
			claim.title,
			`Severity: ${claim.severity}`,
			`Rule: ${rule ? `${rule.id} ${rule.text}` : claim.rule === outsideRule || !claim.rule ? 'Outside the rules of the plan.' : `${claim.rule} is not a rule of the plan now.`}`,
			...(steps.length
				? ['Steps:', ...steps.map((step, index) => `${index + 1}. ${step}`)]
				: ['Steps: none recorded']),
			`Expected: ${claim.expected}`,
			`Actual: ${claim.actual}`,
			`State: ${detail.builds.map((on) => `${on.build} ${buildStateWords[on.state]}`).join('; ') || 'not tested on a build'}`,
			`Evidence: ${files.join(', ') || 'none'}`,
		].join('\n')
	})
	return texts.join(separator)
}
