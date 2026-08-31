import { describe, expect, it, vi } from 'vitest'
import { AiClient } from '../ai/client'
import { TokenTracker } from '../ai/token-tracker'
import { ExtensionHost } from '../runtime/extension'
import { StepExecution } from '../runtime/step-execution'
import { ToolRegistry } from '../tools/registry'
import { testConfig } from './test-types'

describe('step bounds', () => {
	it('resolves a turn-cap report for a provider that never asserts', async () => {
		const config = testConfig({ checkmateTurnCap: 2 })
		const send = vi.fn().mockResolvedValue({
			response: {
				choices: [{ message: { role: 'assistant', content: 'I will keep looking.' } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			},
			assistantMessages: [],
		})
		const execution = new StepExecution({
			config,
			aiClient: { send, countHistoryTokens: () => 0 } as unknown as AiClient,
			toolRegistry: new ToolRegistry(config),
			extensionHost: new ExtensionHost(config, new ToolRegistry(config), []),
			tokenTracker: new TokenTracker(config),
		})

		const report = await execution.run({ action: 'keep checking the page', expect: 'a result is asserted' })

		expect(report).toMatchObject({
			outcome: 'failed',
			category: 'model',
			reason: 'turn-cap-exceeded',
			turns: 2,
		})
		expect(send).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
	})

	it('resolves the clamped test-budget report before sending a request', async () => {
		const config = testConfig({ checkmateStepTimeout: 1_000 })
		const send = vi.fn()
		const registry = new ToolRegistry(config)
		const execution = new StepExecution({
			config,
			aiClient: { send, countHistoryTokens: () => 0 } as unknown as AiClient,
			toolRegistry: registry,
			extensionHost: new ExtensionHost(config, registry, []),
			tokenTracker: new TokenTracker(config),
		})

		const report = await execution.run(
			{ action: 'keep checking the page', expect: 'a result is asserted' },
			{ testTimeoutRemaining: 10_000 }
		)

		expect(report).toMatchObject({
			outcome: 'failed',
			category: 'infra',
			reason: 'test-budget-exhausted',
			turns: 0,
		})
		expect(send).not.toHaveBeenCalled()
	})
})
