import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertionMessage, CheckmateStepError, runAiStep, stepLabel, testTimeoutRemaining } from '../playwright/ai-step'
import { attachmentPrefix } from '../playwright/attachments'
import { CheckmateRunner } from '../runtime/runner'
import { StepReport } from '../runtime/types'

const playwright = vi.hoisted(() => ({
	stepNames: [] as string[],
	attachments: [] as Array<{ name: string; body: string; contentType: string }>,
	testInfo: { timeout: 30_000, duration: 0 },
}))

vi.mock('@playwright/test', () => ({
	test: {
		step: async (name: string, body: () => Promise<void>) => {
			playwright.stepNames.push(name)
			await body()
		},
		info: () => ({
			...playwright.testInfo,
			attach: async (name: string, options: { body: string; contentType: string }) => {
				playwright.attachments.push({ name, body: options.body, contentType: options.contentType })
			},
		}),
	},
}))

function report(overrides: Partial<StepReport> = {}): StepReport {
	return {
		schemaVersion: 1,
		action: 'apply the seasonal promo code SPRING25',
		expect: 'the order total drops',
		outcome: 'passed',
		category: 'app',
		reason: 'met-expectation',
		turns: 3,
		durationMs: 1_200,
		usage: { promptTokens: 10, cachedPromptTokens: 0, completionTokens: 2, costUsd: 0.001 },
		toolCalls: [],
		transcript: [],
		...overrides,
	}
}

function runnerReturning(stepReport: StepReport): CheckmateRunner {
	return { run: vi.fn().mockResolvedValue(stepReport) } as unknown as CheckmateRunner
}

describe('ai.step', () => {
	beforeEach(() => {
		playwright.stepNames.length = 0
		playwright.attachments.length = 0
		playwright.testInfo = { timeout: 30_000, duration: 0 }
	})

	it('reports the test timeout remaining, minus time already spent', () => {
		playwright.testInfo = { timeout: 30_000, duration: 5_000 }
		expect(testTimeoutRemaining()).toBe(25_000)
	})

	it('treats a disabled test timeout (0) as unbounded rather than already exhausted', () => {
		playwright.testInfo = { timeout: 0, duration: 5_000 }
		expect(testTimeoutRemaining()).toBeUndefined()
	})

	it('labels the step with its name', () => {
		expect(stepLabel({ name: 'apply promo code', action: 'a', expect: 'b' })).toBe('ai: apply promo code')
	})

	it('falls back to a collapsed, truncated action when there is no name', () => {
		const label = stepLabel({ action: `\n\tNavigate to https://example.com\n\t${'long '.repeat(40)}`, expect: 'b' })

		expect(label.startsWith('ai: Navigate to https://example.com long')).toBe(true)
		expect(label.length).toBe('ai: '.length + 80)
		expect(label.endsWith('...')).toBe(true)
	})

	it('creates a labelled test step and attaches the report on a pass', async () => {
		const stepReport = report({ name: 'apply promo code' })
		const step = {
			name: 'apply promo code',
			action: 'apply the seasonal promo code SPRING25',
			expect: 'the order total drops',
		}

		await runAiStep(runnerReturning(stepReport), step)

		expect(playwright.stepNames).toEqual(['ai: apply promo code'])
		expect(playwright.attachments).toHaveLength(1)
		expect(playwright.attachments[0].name).toBe(`${attachmentPrefix(1, step)}.json`)
		expect(playwright.attachments[0].contentType).toBe('application/json')
		expect(JSON.parse(playwright.attachments[0].body)).toEqual(stepReport)
	})

	it('names the attachment from its ordinal within the test', async () => {
		const stepReport = report({ name: 'apply promo code' })
		const step = { name: 'apply promo code', action: 'apply SPRING25', expect: 'the order total drops' }

		await runAiStep(runnerReturning(stepReport), step, { ordinal: 3 })

		expect(playwright.attachments[0].name).toBe('ai-step-3-apply-promo-code.json')
	})

	it('attaches a bounded report before failing the step', async () => {
		const stepReport = report({
			outcome: 'failed',
			category: 'model',
			reason: 'turn-cap-exceeded',
			actual: 'the model did not reach an assertion before the turn cap',
		})

		await expect(
			runAiStep(runnerReturning(stepReport), { action: 'apply SPRING25', expect: 'the order total drops' })
		).rejects.toThrow(CheckmateStepError)

		expect(playwright.attachments).toHaveLength(1)
		expect(JSON.parse(playwright.attachments[0].body).reason).toBe('turn-cap-exceeded')
	})

	it('carries the report on the thrown error', async () => {
		const stepReport = report({
			outcome: 'failed',
			reason: 'failed-expectation',
			actual: 'the total stayed at $40',
		})

		const error = await runAiStep(runnerReturning(stepReport), {
			action: 'apply SPRING25',
			expect: 'the order total drops',
		}).catch((thrown: unknown) => thrown)

		expect(error).toBeInstanceOf(CheckmateStepError)
		expect((error as CheckmateStepError).report).toEqual(stepReport)
	})

	it('states the expectation, the observation, and the layer in the assertion message', () => {
		const message = assertionMessage(
			report({ outcome: 'failed', reason: 'failed-expectation', actual: 'the total stayed at $40' })
		)

		expect(message).toBe(
			[
				'Checkmate step failed: app / failed-expectation',
				'',
				'Action:',
				'  apply the seasonal promo code SPRING25',
				'',
				'Expected:',
				'  the order total drops',
				'',
				'Actual:',
				'  the total stayed at $40',
				'',
				'3 turns · 1.2s · $0.0010',
			].join('\n')
		)
	})

	it('indents every line of a multi-line action so the blocks stay readable', () => {
		const message = assertionMessage(
			report({ outcome: 'failed', reason: 'failed-expectation', action: 'Navigate to /pricing\nApply SPRING25' })
		)

		expect(message).toContain('Action:\n  Navigate to /pricing\n  Apply SPRING25\n')
	})

	it('reports a missing observation instead of undefined', () => {
		expect(assertionMessage(report({ outcome: 'failed', reason: 'provider-error' }))).toContain(
			'Actual:\n  (not reported)'
		)
	})
})
