import { describe, expect, it } from 'vitest'
import type { TestInfo } from '@playwright/test'
import { attachmentPrefix, attachStepEvidence, retainsHeavyEvidence } from '../playwright/attachments'
import { EvidenceLevel } from '../config/resolved-config'
import { Step, StepReport } from '../runtime/types'

function report(overrides: Partial<StepReport> = {}): StepReport {
	return {
		schemaVersion: 1,
		action: 'apply the seasonal promo code SPRING25',
		expect: 'the order total drops',
		outcome: 'passed',
		category: 'app',
		reason: 'met-expectation',
		turns: 2,
		durationMs: 4_500,
		usage: { promptTokens: 100, cachedPromptTokens: 0, completionTokens: 20, costUsd: 0.001 },
		toolCalls: [{ turn: 1, name: 'browser_navigate', arguments: { url: 'https://example.com' }, status: 'ok' }],
		transcript: [{ turn: 1, role: 'tool', content: 'browser_navigate -> Navigated to https://example.com' }],
		...overrides,
	}
}

function fakeTestInfo(): {
	testInfo: TestInfo
	attachments: Array<{ name: string; body: string; contentType: string }>
} {
	const attachments: Array<{ name: string; body: string; contentType: string }> = []
	const testInfo = {
		attach: async (name: string, options: { body: string | Buffer; contentType?: string }) => {
			attachments.push({ name, body: String(options.body), contentType: options.contentType ?? '' })
		},
	} as unknown as TestInfo

	return { testInfo, attachments }
}

describe('attachmentPrefix', () => {
	it('slugs from the step name when present', () => {
		const step: Step = { name: 'Apply Promo Code!', action: 'irrelevant', expect: 'irrelevant' }
		expect(attachmentPrefix(2, step)).toBe('ai-step-2-apply-promo-code')
	})

	it('falls back to a slugged, truncated action when there is no name', () => {
		const step: Step = { action: '  Navigate to /pricing and click "Buy Now"  ', expect: 'irrelevant' }
		expect(attachmentPrefix(1, step)).toBe('ai-step-1-navigate-to-pricing-and-click-buy-now')
	})

	it('never produces an empty slug', () => {
		const step: Step = { action: '!!!', expect: 'irrelevant' }
		expect(attachmentPrefix(1, step)).toBe('ai-step-1-step')
	})
})

describe('retainsHeavyEvidence', () => {
	it.each<[EvidenceLevel, StepReport['outcome'], boolean]>([
		['off', 'passed', false],
		['off', 'failed', false],
		['on', 'passed', true],
		['on', 'failed', true],
		['retain-on-failure', 'passed', false],
		['retain-on-failure', 'failed', true],
	])('evidence=%s outcome=%s -> retains=%s', (evidence, outcome, expected) => {
		expect(retainsHeavyEvidence(evidence, outcome)).toBe(expected)
	})
})

describe('attachStepEvidence', () => {
	const step: Step = { name: 'apply promo code', action: 'apply SPRING25', expect: 'the total drops' }

	it('always attaches the lean summary, named with the ordinal and slug', async () => {
		const { testInfo, attachments } = fakeTestInfo()

		await attachStepEvidence({ testInfo, step, report: report(), ordinal: 2, evidence: 'off' })

		expect(attachments).toHaveLength(1)
		expect(attachments[0].name).toBe('ai-step-2-apply-promo-code.json')
		expect(attachments[0].contentType).toBe('application/json')
	})

	it('excludes per-turn snapshots from the summary attachment even when they were recorded', async () => {
		const { testInfo, attachments } = fakeTestInfo()
		const withSnapshots = report({ snapshots: [{ turn: 1, content: 'page snapshot:\n{button Submit}' }] })

		await attachStepEvidence({ testInfo, step, report: withSnapshots, ordinal: 1, evidence: 'on' })

		const summary = JSON.parse(attachments[0].body)
		expect(summary).not.toHaveProperty('snapshots')
	})

	it('does not retain the heavy tier for a passing step at the default evidence level', async () => {
		const { testInfo, attachments } = fakeTestInfo()

		await attachStepEvidence({
			testInfo,
			step,
			report: report({ outcome: 'passed' }),
			ordinal: 1,
			evidence: 'retain-on-failure',
		})

		expect(attachments).toHaveLength(1)
	})

	it('retains the transcript and per-turn snapshots for a failing step at the default evidence level', async () => {
		const { testInfo, attachments } = fakeTestInfo()
		const failed = report({
			outcome: 'failed',
			snapshots: [
				{ turn: 1, content: 'page snapshot:\nturn one' },
				{ turn: 2, content: 'page snapshot:\nturn two' },
			],
		})

		await attachStepEvidence({ testInfo, step, report: failed, ordinal: 1, evidence: 'retain-on-failure' })

		const names = attachments.map((attachment) => attachment.name)
		expect(names).toEqual([
			'ai-step-1-apply-promo-code.json',
			'ai-step-1-apply-promo-code-transcript.md',
			'ai-step-1-apply-promo-code/turn-01.yml',
			'ai-step-1-apply-promo-code/turn-02.yml',
		])
	})

	it('retains the heavy tier for a passing step when evidence is "on"', async () => {
		const { testInfo, attachments } = fakeTestInfo()
		const passed = report({ outcome: 'passed', snapshots: [{ turn: 1, content: 'page snapshot:\nturn one' }] })

		await attachStepEvidence({ testInfo, step, report: passed, ordinal: 1, evidence: 'on' })

		expect(attachments.map((attachment) => attachment.name)).toEqual([
			'ai-step-1-apply-promo-code.json',
			'ai-step-1-apply-promo-code-transcript.md',
			'ai-step-1-apply-promo-code/turn-01.yml',
		])
	})

	it('skips the transcript attachment when there is nothing in it', async () => {
		const { testInfo, attachments } = fakeTestInfo()
		const failed = report({ outcome: 'failed', transcript: [] })

		await attachStepEvidence({ testInfo, step, report: failed, ordinal: 1, evidence: 'on' })

		expect(attachments.map((attachment) => attachment.name)).toEqual(['ai-step-1-apply-promo-code.json'])
	})

	it('writes each turn snapshot body verbatim as its own yaml attachment', async () => {
		const { testInfo, attachments } = fakeTestInfo()
		const failed = report({
			outcome: 'failed',
			snapshots: [{ turn: 7, content: 'page snapshot:\n{heading Done}' }],
		})

		await attachStepEvidence({ testInfo, step, report: failed, ordinal: 1, evidence: 'on' })

		const turnAttachment = attachments.find((attachment) => attachment.name.endsWith('turn-07.yml'))
		expect(turnAttachment?.body).toBe('page snapshot:\n{heading Done}')
		expect(turnAttachment?.contentType).toBe('application/yaml')
	})
})
