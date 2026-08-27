import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { ResponseProcessor } from '../ai/response-processor'
import { AiClient } from '../ai/client'
import { ChatCompletion } from 'openai/resources/chat/completions'
import { Step, ResolveStepResult } from '../runtime/types'
import { MockOpenAIClient } from './test-types'

interface TestableResponseProcessor {
	tokenTracker: {
		log: Mock
		resetStep: Mock
	}
	toolDispatcher: {
		dispatch: Mock
	}
	toolResponseHandler: {
		handle: Mock
		handleMultiple: Mock
	}
	messageHandler: {
		handle: Mock
	}
	rateLimitPolicy: {
		wait: Mock
	}
}

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('../../src/ai/token-tracker', () => ({
	TokenTracker: class {
		log = vi.fn()
		resetStep = vi.fn()
	},
}))

vi.mock('../../src/tools/dispatcher', () => ({
	ToolDispatcher: class {
		getToolRegistry = vi.fn().mockReturnValue({})
		dispatch = vi.fn()
	},
}))

vi.mock('../../src/ai/tool-response-handler', () => ({
	ToolResponseHandler: class {
		handle = vi.fn()
		handleMultiple = vi.fn()
	},
}))

vi.mock('../../src/ai/rate-limit-policy', () => ({
	RateLimitPolicy: class {
		wait = vi.fn().mockResolvedValue(undefined)
	},
}))

vi.mock('../../src/ai/message-handler', () => ({
	MessageHandler: class {
		handle = vi.fn()
	},
}))

vi.mock('../../src/ai/message-history', () => ({
	MessageHistory: class {
		addInitialSnapshot = vi.fn()
	},
}))

describe('ResponseProcessor', () => {
	let responseProcessor: ResponseProcessor
	let mockOpenAIClient: MockOpenAIClient
	let mockStep: Step
	let mockCallback: ResolveStepResult

	beforeEach(() => {
		mockOpenAIClient = {
			countHistoryTokens: vi.fn().mockReturnValue(1000),
			getRuntimeConfig: vi.fn().mockReturnValue({
				getModel: vi.fn().mockReturnValue('gpt-4o-mini'),
			}),
			getToolRegistry: vi.fn().mockReturnValue({}),
			getMessages: vi.fn().mockReturnValue([]),
			replaceHistory: vi.fn(),
		}

		responseProcessor = new ResponseProcessor({
			aiClient: mockOpenAIClient as unknown as AiClient,
			extensionHost: {} as never,
		})

		mockStep = {
			action: 'test action',
			expect: 'test expectation',
		}

		mockCallback = vi.fn()
	})

	describe('constructor', () => {
		it('should initialize all dependencies', () => {
			expect(responseProcessor).toBeDefined()
		})
	})

	describe('resetStepTokens', () => {
		it('should call resetStep on token tracker', () => {
			const tokenTrackerInstance = (responseProcessor as unknown as TestableResponseProcessor).tokenTracker

			responseProcessor.resetStepTokens()

			expect(tokenTrackerInstance.resetStep).toHaveBeenCalled()
		})
	})

	describe('handleResponse - with tool calls', () => {
		it('should process response with tool calls', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							role: 'assistant',
							content: null,
							refusal: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: {
										name: 'browser_click',
										arguments: '{"ref":"e123","name":"Button","goal":"click"}',
									},
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
			}

			const toolDispatcher = (responseProcessor as unknown as TestableResponseProcessor).toolDispatcher
			const toolResponseHandler = (responseProcessor as unknown as TestableResponseProcessor).toolResponseHandler

			vi.mocked(toolDispatcher.dispatch).mockResolvedValue('tool response')

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(toolDispatcher.dispatch).toHaveBeenCalledWith(
				{
					name: 'browser_click',
					arguments: { ref: 'e123', name: 'Button', goal: 'click' },
				},
				{ step: mockStep, resolveStepResult: mockCallback }
			)
			expect(toolResponseHandler.handleMultiple).toHaveBeenCalledWith(
				[
					{
						toolCallId: 'call_1',
						toolCall: {
							name: 'browser_click',
							arguments: { ref: 'e123', name: 'Button', goal: 'click' },
						},
						toolResponse: 'tool response',
					},
				],
				mockStep,
				mockCallback
			)
		})

		it('should handle multiple tool calls in sequence', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							role: 'assistant',
							content: null,
							refusal: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: {
										name: 'browser_click',
										arguments: '{"ref":"e123"}',
									},
								},
								{
									id: 'call_2',
									type: 'function',
									function: {
										name: 'browser_type',
										arguments: '{"ref":"e456","text":"test"}',
									},
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
			}

			const toolDispatcher = (responseProcessor as unknown as TestableResponseProcessor).toolDispatcher
			vi.mocked(toolDispatcher.dispatch).mockResolvedValue('response')

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(toolDispatcher.dispatch).toHaveBeenCalledTimes(2)
		})

		it('should skip non-function tool calls', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							role: 'assistant',
							content: null,
							refusal: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'unknown' as 'function',
									function: {
										name: 'test',
										arguments: '{}',
									},
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
			}

			const toolDispatcher = (responseProcessor as unknown as TestableResponseProcessor).toolDispatcher

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(toolDispatcher.dispatch).not.toHaveBeenCalled()
		})

		it('should continue when tool returns no response', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							role: 'assistant',
							refusal: null,
							content: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: {
										name: 'test_tool',
										arguments: '{}',
									},
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
			}

			const toolDispatcher = (responseProcessor as unknown as TestableResponseProcessor).toolDispatcher
			const toolResponseHandler = (responseProcessor as unknown as TestableResponseProcessor).toolResponseHandler

			vi.mocked(toolDispatcher.dispatch).mockResolvedValue(null)

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(toolResponseHandler.handle).not.toHaveBeenCalled()
		})
	})

	describe('handleResponse - without tool calls', () => {
		it('should handle message content when no tool calls', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							refusal: null,
							role: 'assistant',
							content: 'This is a text response',
						},
						finish_reason: 'stop',
					},
				],
			}

			const messageContentHandler = (responseProcessor as unknown as TestableResponseProcessor).messageHandler

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(messageContentHandler.handle).toHaveBeenCalledWith(mockResponse.choices[0], mockStep, mockCallback)
		})

		it('should handle empty tool_calls array as no tool calls', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							refusal: null,
							role: 'assistant',
							content: 'Response',
							tool_calls: [],
						},
						finish_reason: 'stop',
					},
				],
			}

			const messageContentHandler = (responseProcessor as unknown as TestableResponseProcessor).messageHandler

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(messageContentHandler.handle).toHaveBeenCalled()
		})
	})

	describe('handleResponse - error handling', () => {
		it('should throw error when no choices in response', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [],
			}

			await expect(responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)).rejects.toThrow(
				'No choices found in response'
			)
		})

		it('should throw error when choices is undefined', async () => {
			const mockResponse = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: undefined,
			} as unknown as ChatCompletion

			await expect(responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)).rejects.toThrow(
				'No choices found in response'
			)
		})

		it('should include model context when tool arguments are malformed JSON', async () => {
			const mockResponse: ChatCompletion = {
				id: 'response_1',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 2,
						logprobs: null,
						message: {
							role: 'assistant',
							content: 'calling tool',
							refusal: null,
							tool_calls: [
								{
									id: 'call_bad',
									type: 'function',
									function: { name: 'browser_click', arguments: '{bad json' },
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
			}

			await expect(responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)).rejects.toThrow(
				/browser_click[\s\S]*call_bad[\s\S]*\{bad json[\s\S]*test action[\s\S]*test expectation[\s\S]*choice_index: 2[\s\S]*finish_reason: tool_calls/
			)
		})

		it('should wrap dispatch failures with tool and model context', async () => {
			const mockResponse: ChatCompletion = {
				id: 'response_2',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 1,
						logprobs: null,
						message: {
							role: 'assistant',
							content: null,
							refusal: null,
							tool_calls: [
								{
									id: 'call_dispatch',
									type: 'function',
									function: { name: 'browser_type', arguments: '{"text":"hello"}' },
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
			}
			const cause = new Error('dispatch exploded')
			const toolDispatcher = (responseProcessor as unknown as TestableResponseProcessor).toolDispatcher
			vi.mocked(toolDispatcher.dispatch).mockRejectedValue(cause)

			let caught: unknown
			try {
				await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)
			} catch (error) {
				caught = error
			}

			expect(caught).toBeInstanceOf(Error)
			expect((caught as Error).message).toMatch(
				/browser_type[\s\S]*call_dispatch[\s\S]*hello[\s\S]*test action[\s\S]*choice_index: 1/
			)
			expect((caught as Error).cause).toBe(cause)
		})
	})

	describe('handleResponse - rate limiting and token tracking', () => {
		it('should wait for rate limit before processing', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							refusal: null,
							role: 'assistant',
							content: 'test',
						},
						finish_reason: 'stop',
					},
				],
			}

			const rateLimitHandler = (responseProcessor as unknown as TestableResponseProcessor).rateLimitPolicy

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(rateLimitHandler.wait).toHaveBeenCalled()
		})

		it('should log token usage', async () => {
			const mockResponse: ChatCompletion = {
				id: 'test',
				object: 'chat.completion',
				created: Date.now(),
				model: 'gpt-4o-mini',
				choices: [
					{
						index: 0,
						logprobs: null,
						message: {
							refusal: null,
							role: 'assistant',
							content: 'test',
						},
						finish_reason: 'stop',
					},
				],
			}

			const tokenTracker = (responseProcessor as unknown as TestableResponseProcessor).tokenTracker

			await responseProcessor.handleResponse(mockResponse, mockStep, mockCallback)

			expect(mockOpenAIClient.countHistoryTokens).toHaveBeenCalled()
			expect(tokenTracker.log).toHaveBeenCalledWith(mockResponse, 1000, 'gpt-4o-mini')
		})
	})
})
