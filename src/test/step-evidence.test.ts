import { describe, expect, it } from 'vitest'
import { ChatCompletion } from 'openai/resources/chat/completions'
import { StepEvidence } from '../runtime/step-evidence'
import { Step, TerminationReason } from '../runtime/types'

const step: Step = { name: 'apply promo code', action: 'apply SPRING25', expect: 'the total drops' }

function usage(promptTokens: number, cachedTokens: number, completionTokens: number): ChatCompletion['usage'] {
	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens,
		prompt_tokens_details: { cached_tokens: cachedTokens },
	} as ChatCompletion['usage']
}

describe('StepEvidence', () => {
	it('carries the step identity and the assertion into the report', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })

		const report = evidence.buildReport({
			outcome: 'failed',
			reason: 'failed-expectation',
			actual: 'the total stayed at $40',
			turns: 6,
		})

		expect(report).toMatchObject({
			schemaVersion: 1,
			name: 'apply promo code',
			action: 'apply SPRING25',
			expect: 'the total drops',
			outcome: 'failed',
			category: 'app',
			reason: 'failed-expectation',
			actual: 'the total stayed at $40',
			turns: 6,
		})
	})

	it('omits the name and actual fields when the step has none', () => {
		const evidence = new StepEvidence({ step: { action: 'act', expect: 'done' }, model: 'gpt-5-mini' })

		const report = evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 })

		expect(report).not.toHaveProperty('name')
		expect(report).not.toHaveProperty('actual')
	})

	it('strips the source indentation a template literal leaves on the step', () => {
		const evidence = new StepEvidence({
			step: {
				action: '\n\t\t\tNavigate to /pricing\n\t\t\tApply SPRING25\n\t\t',
				expect: '\n\t\t\tthe total drops\n\t\t',
			},
			model: 'gpt-5-mini',
		})

		const report = evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 })

		expect(report.action).toBe('Navigate to /pricing\nApply SPRING25')
		expect(report.expect).toBe('the total drops')
	})

	it('maps every reason to the layer that produced it', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })
		const categories = (
			[
				'met-expectation',
				'failed-expectation',
				'loop-detected',
				'tool-error',
				'provider-error',
				'budget-exceeded',
			] as TerminationReason[]
		).map((reason) => evidence.buildReport({ outcome: 'failed', reason, turns: 1 }).category)

		expect(categories).toEqual(['app', 'app', 'model', 'infra', 'infra', 'infra'])
	})

	it('totals provider usage across turns and prices it', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })

		evidence.recordUsage(usage(1_000, 400, 100))
		evidence.recordUsage(usage(2_000, 1_000, 200))
		evidence.recordUsage(undefined)

		const report = evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 3 })

		expect(report.usage.promptTokens).toBe(3_000)
		expect(report.usage.cachedPromptTokens).toBe(1_400)
		expect(report.usage.completionTokens).toBe(300)
		expect(report.usage.costUsd).toBeGreaterThan(0)
	})

	it('never counts more cached prompt tokens than prompt tokens', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })

		evidence.recordUsage(usage(100, 500, 10))

		expect(evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 }).usage).toMatchObject({
			promptTokens: 100,
			cachedPromptTokens: 100,
		})
	})

	it('records tool calls and transcript entries per turn', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })

		evidence.recordAssistantMessage(1, 'looking for the promo field')
		evidence.recordToolCall(
			1,
			{ name: 'browser_type_or_select', arguments: { ref: 'e17', text: 'SPRING25' } },
			{ name: 'browser_type_or_select', response: 'typed SPRING25', status: 'success' }
		)
		evidence.recordToolCall(
			2,
			{ name: 'browser_click_or_hover', arguments: { ref: 'e18' } },
			{ name: 'browser_click_or_hover', response: 'element not found', status: 'error' }
		)

		const report = evidence.buildReport({ outcome: 'failed', reason: 'failed-expectation', turns: 2 })

		expect(report.toolCalls).toEqual([
			{ turn: 1, name: 'browser_type_or_select', arguments: { ref: 'e17', text: 'SPRING25' }, status: 'ok' },
			{ turn: 2, name: 'browser_click_or_hover', arguments: { ref: 'e18' }, status: 'error' },
		])
		expect(report.transcript).toEqual([
			{ turn: 1, role: 'assistant', content: 'looking for the promo field' },
			{ turn: 1, role: 'tool', content: 'browser_type_or_select -> typed SPRING25' },
			{ turn: 2, role: 'tool', content: 'browser_click_or_hover -> element not found' },
		])
	})

	it('truncates oversized transcript entries', () => {
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini' })

		evidence.recordAssistantMessage(1, 'x'.repeat(5_000))

		const report = evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 })
		expect(report.transcript[0].content).toHaveLength(2_000)
		expect(report.transcript[0].content.endsWith('...')).toBe(true)
	})

	it('measures the step duration', () => {
		let clock = 1_000
		const evidence = new StepEvidence({ step, model: 'gpt-5-mini', now: () => clock })

		clock = 47_900

		expect(evidence.buildReport({ outcome: 'passed', reason: 'met-expectation', turns: 1 }).durationMs).toBe(46_900)
	})
})
