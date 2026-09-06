import type { EvidencePolicyV1 } from '../contracts/types.js'

export type EvidenceContent = 'text' | 'opaque'
export type StepOutcome = 'passed' | 'failed'

export function retainsEvidence(policy: EvidencePolicyV1, outcome: StepOutcome, content: EvidenceContent): boolean {
	if (content === 'opaque' && !policy.allowOpaque) return false
	if (policy.retention === 'off') return false
	if (policy.retention === 'on') return true
	return outcome === 'failed'
}
