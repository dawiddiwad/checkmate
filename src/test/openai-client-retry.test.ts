import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { OpenAIClient } from '../step/openai/openai-client'
import { ConfigurationManager } from '../step/configuration-manager'
import { ToolRegistry } from '../step/tool/tool-registry'
import { LoopDetectedError } from '../step/tool/loop-detector'
import { Page } from '@playwright/test'
import {
	MockConfigurationManager,
	MockToolRegistry,
	OpenAIClientTestable,
	createHttpError,
	MockResponseProcessor,
	ScreenshotMessageContent,
} from './test-types'

vi.mock('../../src/step/openai/openai-test-manager', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('../../src/step/openai/response-processor', () => {
	class MockResponseProcessorClass {
		static instance: MockResponseProcessorClass | null = null
		handleResponse = vi.fn()
		resetStepTokens = vi.fn()
		constructor() {
			MockResponseProcessorClass.instance = this
		}
	}
	return {
		ResponseProcessor: MockResponseProcessorClass,
		getResponseProcessorMock: () => MockResponseProcessorClass.instance,
	}
})

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

describe('OpenAIClient - Retry Logic', () => {
	let openAIClient: OpenAIClient
	let mockConfig: MockConfigurationManager
	let mockToolRegistry: MockToolRegistry
	let mockPage: Page
	let mockOperation: Mock<() => Promise<unknown>>

	beforeEach(() => {
		mockConfig = {
			getApiKey: vi.fn().mockReturnValue('test-api-key'),
			getBaseURL: vi.fn().mockReturnValue(undefined),
			getModel: vi.fn().mockReturnValue('gpt-4o-mini'),
			getTimeout: vi.fn().mockReturnValue(60000),
			getMaxRetries: vi.fn().mockReturnValue(3),
			getLogLevel: vi.fn().mockReturnValue('off'),
			getTemperature: vi.fn().mockReturnValue(1),
		} as MockConfigurationManager

		mockToolRegistry = {
			getTools: vi.fn().mockResolvedValue([]),
			setStep: vi.fn(),
		} as MockToolRegistry

		mockPage = {} as Page

		openAIClient = new OpenAIClient({
			configurationManager: mockConfig as unknown as ConfigurationManager,
			toolRegistry: mockToolRegistry as unknown as ToolRegistry,
			page: mockPage,
		})

		vi.spyOn(openAIClient as unknown as OpenAIClientTestable, 'sleep').mockResolvedValue(undefined)

		mockOperation = vi.fn<() => Promise<unknown>>()
	})

	describe('isRetryable status codes', () => {
		const retryableStatuses = [408, 409, 429, 500, 502, 503, 504]

		retryableStatuses.forEach((status) => {
			it(`should retry on status code ${status}`, async () => {
				const error = createHttpError('Test error', status)

				mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

				const result = await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

				expect(result).toBe('success')
				expect(mockOperation).toHaveBeenCalledTimes(2)
			})
		})

		it('should retry on LoopDetectedError status', async () => {
			const loopError = new LoopDetectedError({
				loopDetected: true,
				patternLength: 1,
				repetitions: 5,
				pattern: ['test()'],
			})

			mockOperation.mockRejectedValueOnce(loopError).mockResolvedValueOnce('success')

			const result = await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(result).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(2)
		})
	})

	describe('non-retryable status codes', () => {
		it('should not retry on status code 400', async () => {
			const error = createHttpError('Bad request', 400)

			mockOperation.mockRejectedValueOnce(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry on status code 401', async () => {
			const error = createHttpError('Unauthorized', 401)

			mockOperation.mockRejectedValueOnce(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry on status code 404', async () => {
			const error = createHttpError('Not found', 404)

			mockOperation.mockRejectedValueOnce(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry when error has no status', async () => {
			const error = new Error('Generic error without status')

			mockOperation.mockRejectedValueOnce(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})
	})

	describe('max retries enforcement', () => {
		it('should respect max retries limit', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(3)

			const error = createHttpError('Persistent error', 500)

			mockOperation.mockRejectedValue(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow()

			expect(mockOperation).toHaveBeenCalledTimes(4)
		})

		it('should work with zero max retries', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(0)

			const error = createHttpError('Error', 500)

			mockOperation.mockRejectedValue(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow()

			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should succeed before max retries if operation succeeds', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(5)

			const error = createHttpError('Temporary error', 503)

			mockOperation.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const result = await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(result).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(3)
		})

		it('should throw unexpected error when max retries is negative', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(-1)

			const error = createHttpError('Error', 500)

			mockOperation.mockRejectedValue(error)

			await expect(
				(openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
			).rejects.toThrow('Unexpected error in retry loop')
		})
	})

	describe('backoff calculation', () => {
		it('should use 1 second delay for first retry', () => {
			const delay = (openAIClient as unknown as OpenAIClientTestable).calculateBackoff(0)
			expect(delay).toBe(1000)
		})

		it('should use 10 second delay for second retry', () => {
			const delay = (openAIClient as unknown as OpenAIClientTestable).calculateBackoff(1)
			expect(delay).toBe(10000)
		})

		it('should use 60 second delay for third retry and beyond', () => {
			expect((openAIClient as unknown as OpenAIClientTestable).calculateBackoff(2)).toBe(60000)
			expect((openAIClient as unknown as OpenAIClientTestable).calculateBackoff(3)).toBe(60000)
			expect((openAIClient as unknown as OpenAIClientTestable).calculateBackoff(10)).toBe(60000)
		})
	})

	describe('Retry-After header handling', () => {
		it('should respect Retry-After header when present', async () => {
			const error = createHttpError('Rate limited', 429)
			error.headers = {
				get: vi.fn().mockReturnValue('5'),
			}

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as unknown as OpenAIClientTestable).sleep)
			sleepSpy.mockClear()

			await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(5000)
		})

		it('should handle Retry-After as object property', async () => {
			const error = createHttpError('Rate limited', 429)
			error.headers = {
				'retry-after': '10',
			}

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as unknown as OpenAIClientTestable).sleep)
			sleepSpy.mockClear()

			await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(10000)
		})

		it('should fall back to backoff when Retry-After is invalid', async () => {
			const error = createHttpError('Server error', 503)
			error.headers = {
				get: vi.fn().mockReturnValue('invalid'),
			}

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as unknown as OpenAIClientTestable).sleep)
			sleepSpy.mockClear()

			await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(1000)
		})

		it('should fall back to backoff when headers are missing', async () => {
			const error = createHttpError('Server error', 500)

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as unknown as OpenAIClientTestable).sleep)
			sleepSpy.mockClear()

			await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(1000)
		})
	})

	describe('LoopDetectedError handling', () => {
		it('should adjust temperature on LoopDetectedError', async () => {
			const loopError = new LoopDetectedError({
				loopDetected: true,
				patternLength: 2,
				repetitions: 5,
				pattern: ['tool1()', 'tool2()'],
			})

			const initialTemp = openAIClient.temperature

			const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5)

			mockOperation.mockRejectedValueOnce(loopError).mockResolvedValueOnce('success')

			await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(openAIClient.temperature).toBe(0.5)
			expect(openAIClient.temperature).not.toBe(initialTemp)

			mockRandom.mockRestore()
		})

		it('should retry after adjusting temperature for loop', async () => {
			const loopError = new LoopDetectedError({
				loopDetected: true,
				patternLength: 1,
				repetitions: 5,
				pattern: ['repeating_tool()'],
			})

			mockOperation.mockRejectedValueOnce(loopError).mockResolvedValueOnce('success')

			const result = await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)

			expect(result).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(2)
		})
	})

	describe('error enhancement', () => {
		it('should enhance error with status and message', async () => {
			const error = createHttpError('Original error message', 500)

			mockOperation.mockRejectedValue(error)

			try {
				await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
				expect.fail('Should have thrown error')
			} catch (e) {
				const caughtError = e as Error
				expect(caughtError.message).toContain('OpenAI API error [500]')
				expect(caughtError.message).toContain('Original error message')
			}
		})

		it('should handle errors without status', async () => {
			const error = new Error('Generic error')

			mockOperation.mockRejectedValue(error)

			try {
				await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
				expect.fail('Should have thrown error')
			} catch (e) {
				const caughtError = e as Error
				expect(caughtError.message).toContain('OpenAI API error [unknown]')
				expect(caughtError.message).toContain('Generic error')
			}
		})

		it('should handle errors with statusCode property', async () => {
			const error = createHttpError('Error with statusCode')
			error.statusCode = 503

			mockOperation.mockRejectedValue(error)

			try {
				await (openAIClient as unknown as OpenAIClientTestable).executeWithRetry(mockOperation)
				expect.fail('Should have thrown error')
			} catch (e) {
				const caughtError = e as Error
				expect(caughtError.message).toContain('OpenAI API error [503]')
			}
		})
	})

	describe('getStatus helper', () => {
		it('should extract status from error.status', () => {
			const error = { status: 429 }
			expect((openAIClient as unknown as OpenAIClientTestable).getStatus(error)).toBe(429)
		})

		it('should extract status from error.statusCode', () => {
			const error = { statusCode: 500 }
			expect((openAIClient as unknown as OpenAIClientTestable).getStatus(error)).toBe(500)
		})

		it('should extract status from error.code', () => {
			const error = { code: 408 }
			expect((openAIClient as unknown as OpenAIClientTestable).getStatus(error)).toBe(408)
		})

		it('should return null when no status is present', () => {
			const error = { message: 'Error without status' }
			expect((openAIClient as unknown as OpenAIClientTestable).getStatus(error)).toBeNull()
		})

		it('should prioritize status over statusCode and code', () => {
			const error = { status: 429, statusCode: 500, code: 503 }
			expect((openAIClient as unknown as OpenAIClientTestable).getStatus(error)).toBe(429)
		})
	})

	describe('sleep helper', () => {
		it('should sleep for specified milliseconds', async () => {
			vi.mocked((openAIClient as unknown as OpenAIClientTestable).sleep).mockRestore()

			const start = Date.now()
			await (openAIClient as unknown as OpenAIClientTestable).sleep(100)
			const elapsed = Date.now() - start

			expect(elapsed).toBeGreaterThanOrEqual(90)
			expect(elapsed).toBeLessThan(150)
		})
	})
})

describe('OpenAIClient - message flow', () => {
	let openAIClient: OpenAIClient
	let mockConfig: MockConfigurationManager
	let mockToolRegistry: MockToolRegistry
	let mockPage: Page
	let createMock: Mock

	beforeEach(async () => {
		vi.clearAllMocks()

		const openaiModule = (await import('openai')) as unknown as { getCreateMock: () => Mock }
		createMock = openaiModule.getCreateMock()

		const rpModule = (await import('../../src/step/openai/response-processor')) as unknown as {
			getResponseProcessorMock: () => MockResponseProcessor
		}
		rpModule.getResponseProcessorMock()

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
			setStep: vi.fn(),
		} as MockToolRegistry

		mockPage = {} as Page

		openAIClient = new OpenAIClient({
			configurationManager: mockConfig as unknown as ConfigurationManager,
			toolRegistry: mockToolRegistry as unknown as ToolRegistry,
			page: mockPage,
		})
	})

	it('sends a user string, appends assistant message, and calls response processor', async () => {
		const assistantMessage = { role: 'assistant', content: 'ack' }
		createMock.mockResolvedValueOnce({
			choices: [{ message: assistantMessage }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'do', expect: 'done' }
		const statusCb = vi.fn()

		await openAIClient.initialize(step, statusCb)
		const rpModule = (await import('../../src/step/openai/response-processor')) as unknown as {
			getResponseProcessorMock: () => MockResponseProcessor
		}
		const rpInstance = rpModule.getResponseProcessorMock()
		rpInstance.handleResponse.mockClear()
		await openAIClient.sendMessage('hello')

		expect(createMock).toHaveBeenCalledTimes(1)
		const messages = openAIClient.getMessages()
		expect(messages[0]).toEqual({ role: 'user', content: 'hello' })
		expect(messages[messages.length - 1]).toEqual(assistantMessage)
		expect(rpInstance.handleResponse).toHaveBeenCalledTimes(1)
	})

	it('accepts message arrays and skips pushing when choice message is absent', async () => {
		createMock.mockResolvedValueOnce({
			choices: [{ message: null as unknown as Record<string, unknown> }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'array', expect: 'done' }
		const statusCb = vi.fn()

		await openAIClient.initialize(step, statusCb)
		const rpModule = (await import('../../src/step/openai/response-processor')) as unknown as {
			getResponseProcessorMock: () => MockResponseProcessor
		}
		const rpInstance = rpModule.getResponseProcessorMock()
		rpInstance.handleResponse.mockClear()

		await openAIClient.sendMessage([
			{ role: 'user', content: 'first' },
			{ role: 'assistant', content: 'prior' },
		])

		const messages = openAIClient.getMessages()
		expect(messages[0]).toEqual({ role: 'user', content: 'first' })
		expect(messages[1]).toEqual({ role: 'assistant', content: 'prior' })
		expect(messages[messages.length - 1]).toEqual({ role: 'assistant', content: 'prior' })

		expect(createMock).toHaveBeenCalledTimes(1)
		expect(rpInstance.handleResponse).toHaveBeenCalledTimes(1)
	})

	it('sends a tool response with retry wrapper and stores assistant reply', async () => {
		const assistantReply = { role: 'assistant', content: 'next' }
		createMock.mockResolvedValueOnce({
			choices: [{ message: assistantReply }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'do', expect: 'done' }
		const statusCb = vi.fn()

		await openAIClient.initialize(step, statusCb)
		await openAIClient.addToolResponse('t1', 'result')
		const response = await openAIClient.sendToolResponseWithRetry()

		expect(response).toBeDefined()
		expect(createMock).toHaveBeenCalledTimes(1)
		const messages = openAIClient.getMessages()
		expect(messages[messages.length - 1]).toEqual(assistantReply)
	})

	it('skips appending when tool response choice has no message', async () => {
		createMock.mockResolvedValueOnce({
			choices: [{ message: null as unknown as Record<string, unknown> }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'do', expect: 'done' }
		const statusCb = vi.fn()

		await openAIClient.initialize(step, statusCb)
		await openAIClient.addToolResponse('t1', 'result')
		const before = openAIClient.getMessages().length
		await openAIClient.sendToolResponseWithRetry()

		const afterMessages = openAIClient.getMessages()
		expect(afterMessages.length).toBe(before)
		expect(createMock).toHaveBeenCalledTimes(1)
	})

	it('adds screenshot message with expected content shape', async () => {
		const step = { action: 'shot', expect: 'done' }
		const statusCb = vi.fn()
		await openAIClient.initialize(step, statusCb)

		await openAIClient.addScreenshotMessage('YmFzZTY0', 'image/png')

		const last = openAIClient.getMessages().at(-1) as ScreenshotMessageContent
		expect(last.role).toBe('user')
		expect(Array.isArray(last.content)).toBe(true)
		const imageContent = last.content[1] as { type: 'image_url'; image_url: { url: string } }
		expect(imageContent.image_url.url).toContain('data:image/png;base64,YmFzZTY0')
	})

	it('counts only string history when estimating tokens', () => {
		;(openAIClient as unknown as OpenAIClientTestable).messages = [
			{ role: 'user', content: 'abcd' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ignored' }] },
		]

		const tokens = openAIClient.countHistoryTokens()
		expect(tokens).toBe(1)
	})
})
