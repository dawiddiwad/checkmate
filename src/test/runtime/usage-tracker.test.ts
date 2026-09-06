import { describe, expect, it } from 'vitest'
import {
	ProviderUsageUnavailableError,
	ProviderUsageInvalidError,
	ScenarioUsageTracker,
	TokenBudgetExceededError,
} from '../../runtime/usage-tracker'

describe('ScenarioUsageTracker', () => {
	it('records the response that crosses the token ceiling', () => {
		const tracker = new ScenarioUsageTracker(10)
		const checkpoint = tracker.beginStep()

		expect(() =>
			tracker.record({
				prompt_tokens: 8,
				completion_tokens: 4,
				total_tokens: 12,
				prompt_tokens_details: { cached_tokens: 3 },
			})
		).toThrow(TokenBudgetExceededError)
		expect(tracker.stepUsage(checkpoint)).toEqual({
			promptTokens: 8,
			cachedPromptTokens: 3,
			completionTokens: 4,
			totalTokens: 12,
		})
	})

	it('marks missing usage partial without a ceiling and rejects it with a ceiling', () => {
		const unbounded = new ScenarioUsageTracker()
		unbounded.record(undefined)
		unbounded.record({ prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 })
		expect(unbounded.usage().state).toBe('partial')

		const bounded = new ScenarioUsageTracker(10)
		expect(() => bounded.record(undefined)).toThrow(ProviderUsageUnavailableError)
		expect(bounded.usage().state).toBe('unavailable')
	})

	it('returns checkpoint deltas while retaining scenario totals', () => {
		const tracker = new ScenarioUsageTracker()
		tracker.record({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })
		const checkpoint = tracker.beginStep()
		tracker.record({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 })

		expect(tracker.stepUsage(checkpoint).totalTokens).toBe(4)
		expect(tracker.usage()).toMatchObject({
			promptTokens: 8,
			completionTokens: 3,
			totalTokens: 11,
			state: 'complete',
		})
	})

	it.each([
		[{ completion_tokens: 1, total_tokens: 1 }, 'prompt_tokens'],
		[{ prompt_tokens: 1, total_tokens: 1 }, 'completion_tokens'],
		[{ prompt_tokens: 1, completion_tokens: 1 }, 'total_tokens'],
		[{ prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 }, 'total_tokens'],
		[{ prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 }, 'prompt_tokens'],
		[{ prompt_tokens: 1.5, completion_tokens: 1, total_tokens: 2.5 }, 'prompt_tokens'],
		[
			{
				prompt_tokens: 1,
				completion_tokens: 1,
				total_tokens: 2,
				prompt_tokens_details: { cached_tokens: 2 },
			},
			'cached_tokens',
		],
	] as const)('rejects malformed or partial provider usage without recording it', (usage, field) => {
		const tracker = new ScenarioUsageTracker()
		expect(() => tracker.record(usage as never)).toThrow(ProviderUsageInvalidError)
		expect(() => tracker.record(usage as never)).toThrow(field)
		expect(tracker.usage()).toEqual({
			promptTokens: 0,
			cachedPromptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			state: 'unavailable',
		})
	})
})
