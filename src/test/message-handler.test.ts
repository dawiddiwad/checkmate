import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatCompletion } from 'openai/resources/chat/completions'
import { MessageHandler } from '../ai/message-handler'
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
	const step = { action: 'click submit', expect: 'form submitted' }
	let handler: MessageHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new MessageHandler()
	})

	it('throws enriched diagnostics for unexpected finish reasons', () => {
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

		expect(() => handler.handle(choice, step)).toThrow(
			/length[\s\S]*step_action: click submit[\s\S]*step_expect: form submitted[\s\S]*choice_index: 3[\s\S]*refusal: cannot continue/
		)
	})

	it('throws enriched no-content and no-tool diagnostics', () => {
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

		expect(() => handler.handle(choice, step)).toThrow(
			/No content or tool calls[\s\S]*step_action: click submit[\s\S]*step_expect: form submitted[\s\S]*choice_index: 1[\s\S]*finish_reason: null/
		)
	})

	it('returns a corrective user message for text-only responses', () => {
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

		const outcome = handler.handle(choice, step)

		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		expect(warnings).toMatch(/step_action: click submit[\s\S]*content: I think it passed/)
		expect(outcome).toEqual({
			kind: 'continue',
			toolResults: [],
			messages: [{ role: 'user', content: expect.stringContaining('pass_test_step') }],
		})
	})
})
