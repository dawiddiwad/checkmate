import { afterEach, describe, expect, it, vi } from 'vitest'
import { StepDeadline, TEST_TIMEOUT_MARGIN_MS } from '../runtime/step-deadline'

describe('StepDeadline', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('uses the configured step timeout when the test has enough time left', () => {
		vi.useFakeTimers()
		const deadline = new StepDeadline({ stepTimeout: 100, testTimeoutRemaining: 100 + TEST_TIMEOUT_MARGIN_MS + 1 })

		vi.advanceTimersByTime(99)
		expect(deadline.poll()).toBeUndefined()
		vi.advanceTimersByTime(1)
		expect(deadline.poll()).toBe('step-timeout')
		expect(deadline.signal.aborted).toBe(true)
		deadline.dispose()
	})

	it('clamps to the remaining test budget and reports that bound', () => {
		vi.useFakeTimers()
		const deadline = new StepDeadline({ stepTimeout: 1_000, testTimeoutRemaining: TEST_TIMEOUT_MARGIN_MS + 25 })

		vi.advanceTimersByTime(24)
		expect(deadline.poll()).toBeUndefined()
		vi.advanceTimersByTime(1)
		expect(deadline.poll()).toBe('test-budget-exhausted')
		expect(deadline.signal.aborted).toBe(true)
		deadline.dispose()
	})

	it('is already expired when the test has no time beyond the margin', () => {
		const deadline = new StepDeadline({ stepTimeout: 1_000, testTimeoutRemaining: TEST_TIMEOUT_MARGIN_MS })

		expect(deadline.poll()).toBe('test-budget-exhausted')
		expect(deadline.signal.aborted).toBe(true)
		deadline.dispose()
	})
})
