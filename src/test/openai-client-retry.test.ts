import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AiClient } from '../ai/client'
import { RuntimeConfig } from '../config/runtime-config'
import { logger } from '../logging'
import { ToolRegistry } from '../tools/registry'
import { MockConfigurationManager, MockToolRegistry, AiClientTestable, createHttpError } from './test-types'

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('openai', () => {
	const createMock = vi.fn()
	return {
		default: class MockOpenAI {
			chat = { completions: { create: createMock } }
			constructor() {}
		},
		getCreateMock: () => createMock,
	}
})

function testable(client: AiClient): AiClientTestable {
	return client as unknown as AiClientTestable
}

describe('AiClient - Retry Logic', () => {
	let openAIClient: AiClient
	let mockConfig: MockConfigurationManager
	let mockToolRegistry: MockToolRegistry
	let mockOperation: Mock<() => Promise<unknown>>
	let messages: ChatCompletionMessageParam[]

	beforeEach(() => {
		mockConfig = {
			getApiKey: vi.fn().mockReturnValue('test-api-key'),
			getBaseURL: vi.fn().mockReturnValue(undefined),
			getModel: vi.fn().mockReturnValue('gpt-4o-mini'),
			getTimeout: vi.fn().mockReturnValue(60000),
			getMaxRetries: vi.fn().mockReturnValue(3),
			getLogLevel: vi.fn().mockReturnValue('off'),
			getTemperature: vi.fn().mockReturnValue(1),
			getToolChoice: vi.fn().mockReturnValue('required'),
			getReasoningEffort: vi.fn().mockReturnValue('low'),
		} as MockConfigurationManager

		mockToolRegistry = {
			getTools: vi.fn().mockResolvedValue([]),
		} as MockToolRegistry

		openAIClient = new AiClient({
			runtimeConfig: mockConfig as unknown as RuntimeConfig,
			toolRegistry: mockToolRegistry as unknown as ToolRegistry,
		})

		vi.spyOn(testable(openAIClient), 'sleep').mockResolvedValue(undefined)

		mockOperation = vi.fn<() => Promise<unknown>>()
		messages = []
	})

	function run() {
		return testable(openAIClient).executeWithRetry(messages, {}, mockOperation)
	}

	describe('isRetryable status codes', () => {
		const retryableStatuses = [408, 409, 429, 500, 502, 503, 504]

		retryableStatuses.forEach((status) => {
			it(`should retry on status code ${status}`, async () => {
				mockOperation
					.mockRejectedValueOnce(createHttpError('Test error', status))
					.mockResolvedValueOnce('success')

				expect(await run()).toBe('success')
				expect(mockOperation).toHaveBeenCalledTimes(2)
			})
		})
	})

	describe('non-retryable status codes', () => {
		it.each([400, 401, 404])('should not retry on status code %i', async (status) => {
			mockOperation.mockRejectedValueOnce(createHttpError('Bad request', status))

			await expect(run()).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry when error has no status', async () => {
			mockOperation.mockRejectedValueOnce(new Error('Generic error without status'))

			await expect(run()).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})
	})

	describe('max retries enforcement', () => {
		it('should respect max retries limit', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(3)
			mockOperation.mockRejectedValue(createHttpError('Persistent error', 500))

			await expect(run()).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(4)
		})

		it('should work with zero max retries', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(0)
			mockOperation.mockRejectedValue(createHttpError('Error', 500))

			await expect(run()).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should succeed before max retries if operation succeeds', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(5)
			const error = createHttpError('Temporary error', 503)
			mockOperation.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			expect(await run()).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(3)
		})

		it('should throw unexpected error when max retries is negative', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(-1)
			mockOperation.mockRejectedValue(createHttpError('Error', 500))

			await expect(run()).rejects.toThrow('Unexpected error in retry loop')
		})
	})

	describe('backoff calculation', () => {
		it('should use 1 second delay for first retry', () => {
			expect(testable(openAIClient).calculateBackoff(0)).toBe(1000)
		})

		it('should use 10 second delay for second retry', () => {
			expect(testable(openAIClient).calculateBackoff(1)).toBe(10000)
		})

		it('should use 60 second delay for third retry and beyond', () => {
			expect(testable(openAIClient).calculateBackoff(2)).toBe(60000)
			expect(testable(openAIClient).calculateBackoff(3)).toBe(60000)
			expect(testable(openAIClient).calculateBackoff(10)).toBe(60000)
		})
	})

	describe('Retry-After header handling', () => {
		it('should respect Retry-After header when present', async () => {
			const error = createHttpError('Rate limited', 429)
			error.headers = { get: vi.fn().mockReturnValue('5') }
			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked(testable(openAIClient).sleep)
			sleepSpy.mockClear()

			await run()

			expect(sleepSpy).toHaveBeenCalledWith(5000)
		})

		it('should handle Retry-After as object property', async () => {
			const error = createHttpError('Rate limited', 429)
			error.headers = { 'retry-after': '10' }
			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked(testable(openAIClient).sleep)
			sleepSpy.mockClear()

			await run()

			expect(sleepSpy).toHaveBeenCalledWith(10000)
		})

		it('should fall back to backoff when Retry-After is invalid', async () => {
			const error = createHttpError('Server error', 503)
			error.headers = { get: vi.fn().mockReturnValue('invalid') }
			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked(testable(openAIClient).sleep)
			sleepSpy.mockClear()

			await run()

			expect(sleepSpy).toHaveBeenCalledWith(1000)
		})

		it('should fall back to backoff when headers are missing', async () => {
			mockOperation.mockRejectedValueOnce(createHttpError('Server error', 500)).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked(testable(openAIClient).sleep)
			sleepSpy.mockClear()

			await run()

			expect(sleepSpy).toHaveBeenCalledWith(1000)
		})
	})

	describe('error enhancement', () => {
		it('should enhance error with status, message, and cause', async () => {
			const error = createHttpError('Original error message', 500)
			mockOperation.mockRejectedValue(error)

			await expect(run()).rejects.toThrow(/OpenAI API error \[500\][\s\S]*Original error message/)
			await expect(run()).rejects.toHaveProperty('cause', error)
		})

		it('should handle errors without status', async () => {
			mockOperation.mockRejectedValue(new Error('Generic error'))

			await expect(run()).rejects.toThrow(/OpenAI API error \[unknown\][\s\S]*Generic error/)
		})

		it('should handle errors with statusCode property', async () => {
			const error = createHttpError('Error with statusCode')
			error.statusCode = 503
			mockOperation.mockRejectedValue(error)

			await expect(run()).rejects.toThrow(/OpenAI API error \[503\]/)
		})
	})

	describe('getStatus helper', () => {
		it('should extract status from error.status', () => {
			expect(testable(openAIClient).getStatus({ status: 429 })).toBe(429)
		})

		it('should extract status from error.statusCode', () => {
			expect(testable(openAIClient).getStatus({ statusCode: 500 })).toBe(500)
		})

		it('should extract status from error.code', () => {
			expect(testable(openAIClient).getStatus({ code: 408 })).toBe(408)
		})

		it('should return null when no status is present', () => {
			expect(testable(openAIClient).getStatus({ message: 'Error without status' })).toBeNull()
		})

		it('should prioritize status over statusCode and code', () => {
			expect(testable(openAIClient).getStatus({ status: 429, statusCode: 500, code: 503 })).toBe(429)
		})
	})

	describe('sleep helper', () => {
		it('should sleep for specified milliseconds', async () => {
			vi.mocked(testable(openAIClient).sleep).mockRestore()

			const start = Date.now()
			await testable(openAIClient).sleep(100)
			const elapsed = Date.now() - start

			expect(elapsed).toBeGreaterThanOrEqual(90)
			expect(elapsed).toBeLessThan(150)
		})
	})
})

describe('AiClient - send', () => {
	let openAIClient: AiClient
	let mockConfig: MockConfigurationManager
	let mockToolRegistry: MockToolRegistry
	let createMock: Mock

	beforeEach(async () => {
		vi.clearAllMocks()

		const openaiModule = (await import('openai')) as unknown as { getCreateMock: () => Mock }
		createMock = openaiModule.getCreateMock()

		mockConfig = {
			getApiKey: vi.fn().mockReturnValue('test-api-key'),
			getBaseURL: vi.fn().mockReturnValue(undefined),
			getModel: vi.fn().mockReturnValue('gpt-4o-mini'),
			getTimeout: vi.fn().mockReturnValue(60000),
			getMaxRetries: vi.fn().mockReturnValue(0),
			getLogLevel: vi.fn().mockReturnValue('off'),
			getToolChoice: vi.fn().mockReturnValue('auto'),
			getTemperature: vi.fn().mockReturnValue(0.2),
			getReasoningEffort: vi.fn().mockReturnValue(undefined),
		} as MockConfigurationManager

		mockToolRegistry = {
			getTools: vi.fn().mockResolvedValue([]),
		} as MockToolRegistry

		openAIClient = new AiClient({
			runtimeConfig: mockConfig as unknown as RuntimeConfig,
			toolRegistry: mockToolRegistry as unknown as ToolRegistry,
		})
	})

	it('sends the caller-owned message array and returns the assistant messages to retain', async () => {
		const assistantMessage = { role: 'assistant', content: 'ack' }
		createMock.mockResolvedValueOnce({
			choices: [{ message: assistantMessage }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: 'hello' }]
		const { response, assistantMessages } = await openAIClient.send(messages, {
			step: { action: 'do', expect: 'done' },
		})

		expect(createMock).toHaveBeenCalledTimes(1)
		expect(createMock.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				model: 'gpt-4o-mini',
				messages,
				parallel_tool_calls: false,
				temperature: 0.2,
				tool_choice: 'auto',
			})
		)
		expect(response.choices[0].message).toEqual(assistantMessage)
		expect(assistantMessages).toEqual([assistantMessage])
	})

	it('returns no assistant messages when the choice has none', async () => {
		createMock.mockResolvedValueOnce({
			choices: [{ message: null as unknown as Record<string, unknown> }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const { assistantMessages } = await openAIClient.send([{ role: 'user', content: 'first' }])

		expect(assistantMessages).toEqual([])
	})

	it('retains assistant messages without reasoning payloads', async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: null,
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name: 'browser_navigate', arguments: '{"url":"https://example.com"}' },
							},
						],
						reasoning: 'internal reasoning that should not be replayed',
						reasoning_details: [{ type: 'reasoning.text', text: 'details', index: 0, format: 'unknown' }],
					} as Record<string, unknown>,
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const { assistantMessages } = await openAIClient.send([{ role: 'user', content: 'hello' }])

		expect(assistantMessages[0]).toMatchObject({ role: 'assistant', content: null })
		expect(assistantMessages[0]).not.toHaveProperty('reasoning')
		expect(assistantMessages[0]).not.toHaveProperty('reasoning_details')
	})

	it('includes request and recent message context in final API errors', async () => {
		vi.mocked(mockConfig.getMaxRetries).mockReturnValue(0)
		vi.mocked(mockConfig.getToolChoice).mockReturnValue('required')
		vi.mocked(mockConfig.getReasoningEffort).mockReturnValue('low')
		const error = createHttpError('provider failed', 500)
		;(error as unknown as Record<string, unknown>).body = { error: { message: 'bad model response' } }
		createMock.mockRejectedValue(error)

		await expect(
			openAIClient.send([{ role: 'user', content: 'click submit' }], {
				step: { action: 'submit form', expect: 'success page' },
			})
		).rejects.toThrow(
			/model: gpt-4o-mini[\s\S]*tool_choice: required[\s\S]*reasoning_effort: low[\s\S]*temperature: 0.2[\s\S]*step_action: submit form[\s\S]*step_expect: success page[\s\S]*user: click submit[\s\S]*bad model response/
		)
	})

	it('appends a corrective message and retries recoverable 400 tool errors', async () => {
		vi.mocked(mockConfig.getMaxRetries).mockReturnValue(1)
		const base64 = 'A'.repeat(220)
		const error = createHttpError('tool call rejected', 400)
		;(error as unknown as Record<string, unknown>).body = {
			error: 'invalid tool arguments',
			api_key: 'sk-secret123',
			image: `data:image/png;base64,${base64}`,
		}
		createMock.mockRejectedValueOnce(error).mockResolvedValueOnce({
			choices: [{ message: { role: 'assistant', content: 'ok' } }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const messages: ChatCompletionMessageParam[] = [
			{ role: 'user', content: 'before image' },
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'see screenshot' },
					{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
				],
			},
		]

		vi.spyOn(testable(openAIClient), 'sleep').mockResolvedValue(undefined)
		await openAIClient.send(messages, { step: { action: 'use upload tool', expect: 'file uploaded' } })

		expect(createMock).toHaveBeenCalledTimes(2)
		expect(messages.at(-1)).toEqual({
			role: 'user',
			content: expect.stringContaining('you did not call a tool or called it incorrectly'),
		})

		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		expect(warnings).toContain('tool call error detected [400]')
		expect(warnings).toContain('step_action: use upload tool')
		expect(warnings).toContain('step_expect: file uploaded')
		expect(warnings).toContain('before image')
		expect(warnings).toContain('[image omitted]')
		expect(warnings).not.toContain('sk-secret123')
		expect(warnings).not.toContain(base64)
	})

	it('counts string and array history when estimating tokens', () => {
		const tokens = openAIClient.countHistoryTokens([
			{ role: 'user', content: 'abcd' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ignored' }] },
		])

		expect(tokens).toBe(3)
	})
})
