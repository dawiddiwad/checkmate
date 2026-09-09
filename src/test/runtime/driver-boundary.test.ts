import { afterEach, describe, expect, it, vi } from 'vitest'
import { awaitDriverBoundary } from '../../runtime/driver-boundary'
import { ScenarioControl } from '../../runtime/scenario-control'

describe('driver boundary', () => {
	afterEach(() => vi.useRealTimers())

	it('classifies ignored work by the owning step deadline and observes late rejection', async () => {
		vi.useFakeTimers()
		const control = new ScenarioControl({ timeoutMs: 1_000 })
		const step = control.createStepControl(20)
		let rejectLate!: (error: Error) => void
		const late = new Promise<never>((_, reject) => {
			rejectLate = reject
		})

		const result = awaitDriverBoundary({
			operation: 'driver-tool',
			signal: step.signal,
			deadline: step.deadline,
			reason: () => {
				const expired = step.poll()
				return expired.expired ? expired.reason : 'step-timeout'
			},
			call: () => late,
		})
		const assertion = expect(result).rejects.toMatchObject({
			operation: 'driver-tool',
			reason: 'step-timeout',
		})
		await vi.advanceTimersByTimeAsync(20)
		await assertion
		rejectLate(new Error('late failure'))
		await vi.runAllTimersAsync()
		step.dispose()
		control.dispose()
	})

	it('classifies scenario expiry when it owns the earlier deadline', async () => {
		vi.useFakeTimers()
		const control = new ScenarioControl({ timeoutMs: 10 })
		const step = control.createStepControl(100)
		const result = awaitDriverBoundary({
			operation: 'initial-context',
			signal: step.signal,
			deadline: step.deadline,
			reason: () => {
				const expired = step.poll()
				return expired.expired ? expired.reason : 'scenario-timeout'
			},
			call: () => new Promise(() => undefined),
		})
		const assertion = expect(result).rejects.toMatchObject({ reason: 'scenario-timeout' })
		await vi.advanceTimersByTimeAsync(10)
		await assertion
		step.dispose()
		control.dispose()
	})

	it('starts the callback inside the original budget and interrupts immediately', async () => {
		let now = 10
		const controller = new AbortController()
		let calledAt = 0
		const result = awaitDriverBoundary({
			operation: 'driver-start',
			signal: controller.signal,
			deadline: 100,
			now: () => now,
			reason: () => 'interrupted',
			call: () => {
				calledAt = now
				return new Promise(() => undefined)
			},
		})
		expect(calledAt).toBe(10)
		now = 11
		controller.abort('interrupted')
		await expect(result).rejects.toMatchObject({ reason: 'interrupted' })
	})

	it('rejects fulfillment returned after the deadline without claiming synchronous containment', async () => {
		let now = 10
		const result = awaitDriverBoundary({
			operation: 'driver-tool',
			signal: new AbortController().signal,
			deadline: 20,
			now: () => now,
			call: () => {
				now = 21
				return 'late value'
			},
		})

		await expect(result).rejects.toMatchObject({ operation: 'driver-tool', reason: 'step-timeout' })
	})

	it('rejects fulfillment returned after cancellation even when the callback ignores its signal', async () => {
		const controller = new AbortController()
		const result = awaitDriverBoundary({
			operation: 'driver-tool',
			signal: controller.signal,
			deadline: Date.now() + 1_000,
			call: async () => {
				controller.abort('interrupted')
				return 'late value'
			},
		})

		await expect(result).rejects.toMatchObject({ operation: 'driver-tool', reason: 'interrupted' })
	})
})
