import { describe, expect, it } from 'vitest'
import type { EvidencePolicyV1 } from '../../contracts/types.js'
import { retainsEvidence, type EvidenceContent, type StepOutcome } from '../../evidence/retention.js'

describe('evidence retention', () => {
	it.each([
		['on', 'passed', 'text', true],
		['on', 'failed', 'text', true],
		['retain-on-failure', 'passed', 'text', false],
		['retain-on-failure', 'failed', 'text', true],
		['off', 'passed', 'text', false],
		['off', 'failed', 'text', false],
		['on', 'passed', 'opaque', true],
		['on', 'failed', 'opaque', true],
		['retain-on-failure', 'passed', 'opaque', false],
		['retain-on-failure', 'failed', 'opaque', true],
		['off', 'passed', 'opaque', false],
		['off', 'failed', 'opaque', false],
	] as const)('%s / %s / %s -> %s', (retention, outcome, content, expected) => {
		const policy: EvidencePolicyV1 = { retention, redaction: 'on', allowOpaque: true }
		expect(retainsEvidence(policy, outcome as StepOutcome, content as EvidenceContent)).toBe(expected)
	})

	it.each(['on', 'retain-on-failure', 'off'] as const)(
		'discards opaque evidence under %s when opaque is disabled',
		(retention) => {
			expect(retainsEvidence({ retention, redaction: 'on', allowOpaque: false }, 'failed', 'opaque')).toBe(false)
		}
	)
})
