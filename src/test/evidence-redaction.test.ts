import { describe, expect, it } from 'vitest'
import type { TestInfo } from '@playwright/test'
import { StepEvidence } from '../runtime/step-evidence'
import { Step } from '../runtime/types'
import { attachStepEvidence } from '../playwright/attachments'
import { EvidenceLevel } from '../config/resolved-config'

const step: Step = { name: 'log in', action: 'sign in with the test account', expect: 'the dashboard is shown' }
const credential = 'sk-super-secret-credential-value'

function typedCredentialToolCall(evidence: StepEvidence, turn = 1): void {
	evidence.recordToolCall(
		turn,
		{ name: 'browser_type_or_select', arguments: { elements: [{ ref: 'e17', text: credential }] } },
		{
			name: 'browser_type_or_select',
			response: `typed '${credential}' into the password field`,
			snapshot: `page snapshot:\n{textbox 'Password' value:'${credential}'}`,
			status: 'success',
		}
	)
}

describe('evidence redaction', () => {
	it('never lets a typed credential reach the report, at the default redact setting', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })
		typedCredentialToolCall(evidence)

		const report = evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 })
		const serialized = JSON.stringify(report)

		expect(serialized).not.toContain(credential)
		expect(report.toolCalls[0].arguments).toEqual({ elements: [{ ref: 'e17', text: '[secret omitted]' }] })
		expect(report.transcript.some((entry) => entry.content.includes(credential))).toBe(false)
		expect(report.snapshots?.[0].content).not.toContain(credential)
	})

	it('leaves the credential untouched when checkmateRedact is explicitly disabled', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini', redact: false })
		typedCredentialToolCall(evidence)

		const report = evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 })

		expect(JSON.stringify(report)).toContain(credential)
	})

	it('keeps a credential out of every checkmateEvidence tier the Playwright layer can attach', async () => {
		const levels: EvidenceLevel[] = ['off', 'retain-on-failure', 'on']

		for (const level of levels) {
			const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })
			typedCredentialToolCall(evidence)
			const report = evidence.buildReport({
				outcome: 'failed',
				reason: 'failed-expectation',
				actual: `login still shows the credential ${credential}`,
				turns: 1,
			})

			const attached: string[] = []
			const testInfo = {
				attach: async (_name: string, options: { body: string }) => {
					attached.push(options.body)
				},
			} as unknown as TestInfo

			await attachStepEvidence({ testInfo, step, report, ordinal: 1, evidence: level })

			for (const body of attached) {
				expect(body, `evidence level: ${level}`).not.toContain(credential)
			}
		}
	})
})
