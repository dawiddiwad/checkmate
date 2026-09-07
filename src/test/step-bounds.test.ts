import { describe, expect, it, vi } from 'vitest'
import { ScenarioControl } from '../runtime/scenario-control'
import { runnerFixture, emptySession } from './runtime/runner-fixture'

describe('step bounds', () => {
	it('resolves a turn-cap report for a provider that never asserts', async () => {
		const send = vi.fn().mockResolvedValue({
			response: {
				choices: [{ message: { role: 'assistant', content: 'I will keep looking.' } }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			},
			assistantMessages: [],
		})
		const runner = runnerFixture(emptySession(), {
			aiClient: { send } as never,
			limits: {
				turnsPerStep: 2,
				stepTimeoutMs: 1000,
				requestTimeoutMs: 1000,
				maxRetries: 0,
				loopMaxRepetitions: 3,
			},
		})
		const scenario = new ScenarioControl({ timeoutMs: 5000 })
		try {
			const report = await runner.run(
				{ id: 'step', action: 'keep checking', expect: 'a result is asserted' },
				scenario.createStepControl(1000)
			)
			expect(report).toMatchObject({
				outcome: 'failed',
				category: 'model',
				reason: 'turn-cap-exceeded',
				turns: 2,
			})
			expect(send).toHaveBeenCalledTimes(2)
			expect(send.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
		} finally {
			scenario.dispose()
		}
	})

	it('reports scenario expiry before sending a request', async () => {
		let now = 0
		const send = vi.fn()
		const scenario = new ScenarioControl({ timeoutMs: 100, now: () => now })
		now = 101
		try {
			const report = await runnerFixture(emptySession(), { aiClient: { send } as never }).run(
				{ id: 'step', action: 'keep checking', expect: 'a result is asserted' },
				scenario.createStepControl(1000)
			)
			expect(report).toMatchObject({ outcome: 'failed', category: 'infra', reason: 'scenario-timeout', turns: 0 })
			expect(send).not.toHaveBeenCalled()
		} finally {
			scenario.dispose()
		}
	})
})
