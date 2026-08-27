import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatCompletion } from 'openai/resources/chat/completions'
import { MessageHandler } from '../ai/message-handler'
import { AiClient } from '../ai/client'
import { ResponseProcessor } from '../ai/response-processor'
import { logger } from '../logging'

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe('MessageHandler diagnostics', () => {
	let aiClient: Pick<AiClient, 'addUserMessage' | 'sendToolResponseWithRetry'>
	let responseProcessor: Pick<ResponseProcessor, 'handleResponse'>
	const step = { action: 'click submit', expect: 'form submitted' }

	beforeEach(() => {
		vi.clearAllMocks()
		aiClient = {
			addUserMessage: vi.fn().mockResolvedValue(undefined),
			sendToolResponseWithRetry: vi.fn().mockResolvedValue({ choices: [] }),
		}
		responseProcessor = {
			handleResponse: vi.fn().mockResolvedValue(undefined),
		}
	})

	it('includes finish reason, previews, and step context for unexpected finish reasons', async () => {
		const handler = new MessageHandler(aiClient as AiClient, responseProcessor as ResponseProcessor)
		const resolveStepResult = vi.fn()
		const choice: ChatCompletion.Choice = {
			index: 3,
			logprobs: null,
			finish_reason: 'length',
			message: {
				role: 'assistant',
				content: null,
				refusal: 'cannot continue',
			},
		}

		await handler.handle(choice, step, resolveStepResult)

		expect(resolveStepResult).toHaveBeenCalledWith({
			passed: false,
			actual: expect.stringMatching(
				/length[\s\S]*step_action: click submit[\s\S]*step_expect: form submitted[\s\S]*choice_index: 3[\s\S]*refusal: cannot continue/
			),
		})
	})

	it('throws enriched no-content and no-tool diagnostics', async () => {
		const handler = new MessageHandler(aiClient as AiClient, responseProcessor as ResponseProcessor)
		const choice: ChatCompletion.Choice = {
			index: 1,
			logprobs: null,
			finish_reason: null,
			message: {
				role: 'assistant',
				content: null,
				refusal: null,
			},
		}

		await expect(handler.handle(choice, step, vi.fn())).rejects.toThrow(
			/No content or tool calls[\s\S]*step_action: click submit[\s\S]*step_expect: form submitted[\s\S]*choice_index: 1[\s\S]*finish_reason: null/
		)
	})

	it('logs enriched text responses and keeps pass/fail follow-up behavior', async () => {
		const handler = new MessageHandler(aiClient as AiClient, responseProcessor as ResponseProcessor)
		const choice: ChatCompletion.Choice = {
			index: 0,
			logprobs: null,
			finish_reason: 'stop',
			message: {
				role: 'assistant',
				content: 'I think it passed',
				refusal: null,
			},
		}
		const resolveStepResult = vi.fn()

		await handler.handle(choice, step, resolveStepResult)

		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		expect(warnings).toMatch(/step_action: click submit[\s\S]*content: I think it passed/)
		expect(aiClient.addUserMessage).toHaveBeenCalledWith(expect.stringContaining('pass_test_step'))
		expect(aiClient.sendToolResponseWithRetry).toHaveBeenCalledTimes(1)
		expect(responseProcessor.handleResponse).toHaveBeenCalledWith({ choices: [] }, step, resolveStepResult)
	})
})
