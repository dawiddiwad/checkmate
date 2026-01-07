import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OpenAIClient } from '../step/openai/openai-client'
import { ConfigurationManager } from '../step/configuration-manager'
import { ToolRegistry } from '../step/tool/tool-registry'
import { LoopDetectedError } from '../step/tool/loop-detector'
import { Page } from '@playwright/test'

vi.mock('../../src/step/openai/openai-test-manager', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('../../src/step/openai/response-processor', () => {
	class MockResponseProcessor {
		static instance: any
		handleResponse = vi.fn()
		resetStepTokens = vi.fn()
		constructor() {
			MockResponseProcessor.instance = this
		}
	}
	return {
		ResponseProcessor: MockResponseProcessor,
		getResponseProcessorMock: () => MockResponseProcessor.instance,
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
	let mockConfig: ConfigurationManager
	let mockToolRegistry: ToolRegistry
	let mockPage: Page
	let mockOperation: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockConfig = {
			getApiKey: vi.fn().mockReturnValue('test-api-key'),
			getBaseURL: vi.fn().mockReturnValue(undefined),
			getModel: vi.fn().mockReturnValue('gpt-4o-mini'),
			getTimeout: vi.fn().mockReturnValue(60000),
			getMaxRetries: vi.fn().mockReturnValue(3),
			getLogLevel: vi.fn().mockReturnValue('off'),
			getTemperature: vi.fn().mockReturnValue(1),
		} as any

		mockToolRegistry = {
			getTools: vi.fn().mockResolvedValue([]),
			setStep: vi.fn(),
		} as any

		mockPage = {} as any

		openAIClient = new OpenAIClient({
			configurationManager: mockConfig,
			toolRegistry: mockToolRegistry,
			page: mockPage,
		})

		vi.spyOn(openAIClient as any, 'sleep').mockResolvedValue(undefined)

		mockOperation = vi.fn()
	})

	describe('isRetryable status codes', () => {
		const retryableStatuses = [408, 409, 429, 500, 502, 503, 504]

		retryableStatuses.forEach((status) => {
			it(`should retry on status code ${status}`, async () => {
				const error = new Error('Test error')
				;(error as any).status = status

				mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

				const result = await (openAIClient as any).executeWithRetry(mockOperation)

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

			const result = await (openAIClient as any).executeWithRetry(mockOperation)

			expect(result).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(2)
		})
	})

	describe('non-retryable status codes', () => {
		it('should not retry on status code 400', async () => {
			const error = new Error('Bad request')
			;(error as any).status = 400

			mockOperation.mockRejectedValueOnce(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry on status code 401', async () => {
			const error = new Error('Unauthorized')
			;(error as any).status = 401

			mockOperation.mockRejectedValueOnce(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry on status code 404', async () => {
			const error = new Error('Not found')
			;(error as any).status = 404

			mockOperation.mockRejectedValueOnce(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should not retry when error has no status', async () => {
			const error = new Error('Generic error without status')

			mockOperation.mockRejectedValueOnce(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow()
			expect(mockOperation).toHaveBeenCalledTimes(1)
		})
	})

	describe('max retries enforcement', () => {
		it('should respect max retries limit', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(3)

			const error = new Error('Persistent error')
			;(error as any).status = 500

			mockOperation.mockRejectedValue(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow()

			expect(mockOperation).toHaveBeenCalledTimes(4)
		})

		it('should work with zero max retries', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(0)

			const error = new Error('Error')
			;(error as any).status = 500

			mockOperation.mockRejectedValue(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow()

			expect(mockOperation).toHaveBeenCalledTimes(1)
		})

		it('should succeed before max retries if operation succeeds', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(5)

			const error = new Error('Temporary error')
			;(error as any).status = 503

			mockOperation.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const result = await (openAIClient as any).executeWithRetry(mockOperation)

			expect(result).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(3)
		})

		it('should throw unexpected error when max retries is negative', async () => {
			vi.mocked(mockConfig.getMaxRetries).mockReturnValue(-1 as any)

			const error = new Error('Error')
			;(error as any).status = 500

			mockOperation.mockRejectedValue(error)

			await expect((openAIClient as any).executeWithRetry(mockOperation)).rejects.toThrow(
				'Unexpected error in retry loop'
			)
		})
	})

	describe('backoff calculation', () => {
		it('should use 1 second delay for first retry', () => {
			const delay = (openAIClient as any).calculateBackoff(0)
			expect(delay).toBe(1000)
		})

		it('should use 10 second delay for second retry', () => {
			const delay = (openAIClient as any).calculateBackoff(1)
			expect(delay).toBe(10000)
		})

		it('should use 60 second delay for third retry and beyond', () => {
			expect((openAIClient as any).calculateBackoff(2)).toBe(60000)
			expect((openAIClient as any).calculateBackoff(3)).toBe(60000)
			expect((openAIClient as any).calculateBackoff(10)).toBe(60000)
		})
	})

	describe('Retry-After header handling', () => {
		it('should respect Retry-After header when present', async () => {
			const error = new Error('Rate limited')
			;(error as any).status = 429
			;(error as any).headers = {
				get: vi.fn().mockReturnValue('5'),
			}

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as any).sleep)
			sleepSpy.mockClear()

			await (openAIClient as any).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(5000)
		})

		it('should handle Retry-After as object property', async () => {
			const error = new Error('Rate limited')
			;(error as any).status = 429
			;(error as any).headers = {
				'retry-after': '10',
			}

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as any).sleep)
			sleepSpy.mockClear()

			await (openAIClient as any).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(10000)
		})

		it('should fall back to backoff when Retry-After is invalid', async () => {
			const error = new Error('Server error')
			;(error as any).status = 503
			;(error as any).headers = {
				get: vi.fn().mockReturnValue('invalid'),
			}

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as any).sleep)
			sleepSpy.mockClear()

			await (openAIClient as any).executeWithRetry(mockOperation)

			expect(sleepSpy).toHaveBeenCalledWith(1000)
		})

		it('should fall back to backoff when headers are missing', async () => {
			const error = new Error('Server error')
			;(error as any).status = 500

			mockOperation.mockRejectedValueOnce(error).mockResolvedValueOnce('success')

			const sleepSpy = vi.mocked((openAIClient as any).sleep)
			sleepSpy.mockClear()

			await (openAIClient as any).executeWithRetry(mockOperation)

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

			await (openAIClient as any).executeWithRetry(mockOperation)

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

			const result = await (openAIClient as any).executeWithRetry(mockOperation)

			expect(result).toBe('success')
			expect(mockOperation).toHaveBeenCalledTimes(2)
		})
	})

	describe('error enhancement', () => {
		it('should enhance error with status and message', async () => {
			const error = new Error('Original error message')
			;(error as any).status = 500

			mockOperation.mockRejectedValue(error)

			try {
				await (openAIClient as any).executeWithRetry(mockOperation)
				expect.fail('Should have thrown error')
			} catch (e: any) {
				expect(e.message).toContain('OpenAI API error [500]')
				expect(e.message).toContain('Original error message')
			}
		})

		it('should handle errors without status', async () => {
			const error = new Error('Generic error')

			mockOperation.mockRejectedValue(error)

			try {
				await (openAIClient as any).executeWithRetry(mockOperation)
				expect.fail('Should have thrown error')
			} catch (e: any) {
				expect(e.message).toContain('OpenAI API error [unknown]')
				expect(e.message).toContain('Generic error')
			}
		})

		it('should handle errors with statusCode property', async () => {
			const error = new Error('Error with statusCode')
			;(error as any).statusCode = 503

			mockOperation.mockRejectedValue(error)

			try {
				await (openAIClient as any).executeWithRetry(mockOperation)
				expect.fail('Should have thrown error')
			} catch (e: any) {
				expect(e.message).toContain('OpenAI API error [503]')
			}
		})
	})

	describe('getStatus helper', () => {
		it('should extract status from error.status', () => {
			const error = { status: 429 }
			expect((openAIClient as any).getStatus(error)).toBe(429)
		})

		it('should extract status from error.statusCode', () => {
			const error = { statusCode: 500 }
			expect((openAIClient as any).getStatus(error)).toBe(500)
		})

		it('should extract status from error.code', () => {
			const error = { code: 408 }
			expect((openAIClient as any).getStatus(error)).toBe(408)
		})

		it('should return null when no status is present', () => {
			const error = { message: 'Error without status' }
			expect((openAIClient as any).getStatus(error)).toBeNull()
		})

		it('should prioritize status over statusCode and code', () => {
			const error = { status: 429, statusCode: 500, code: 503 }
			expect((openAIClient as any).getStatus(error)).toBe(429)
		})
	})

	describe('sleep helper', () => {
		it('should sleep for specified milliseconds', async () => {
			vi.mocked((openAIClient as any).sleep).mockRestore()

			const start = Date.now()
			await (openAIClient as any).sleep(100)
			const elapsed = Date.now() - start

			expect(elapsed).toBeGreaterThanOrEqual(90)
			expect(elapsed).toBeLessThan(150)
		})
	})
})

describe('OpenAIClient - message flow', () => {
	let openAIClient: OpenAIClient
	let mockConfig: ConfigurationManager
	let mockToolRegistry: ToolRegistry
	let mockPage: Page
	let createMock: any
	let responseProcessorMock: any

	beforeEach(async () => {
		vi.clearAllMocks()

		const openaiModule: any = await import('openai')
		createMock = openaiModule.getCreateMock()

		const rpModule: any = await import('../../src/step/openai/response-processor')
		responseProcessorMock = rpModule.getResponseProcessorMock()

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
		} as any

		mockToolRegistry = {
			getTools: vi.fn().mockResolvedValue([]),
			setStep: vi.fn(),
		} as any

		mockPage = {} as any

		openAIClient = new OpenAIClient({
			configurationManager: mockConfig,
			toolRegistry: mockToolRegistry,
			page: mockPage,
		})
	})

	it('sends a user string, appends assistant message, and calls response processor', async () => {
		const assistantMessage = { role: 'assistant', content: 'ack' }
		createMock.mockResolvedValueOnce({
			choices: [{ message: assistantMessage }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'do', expect: 'done' } as any
		const statusCb = vi.fn()

		await openAIClient.initialize(step, statusCb)
		const rpModule: any = await import('../../src/step/openai/response-processor')
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
			choices: [{ message: null as any }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'array', expect: 'done' } as any
		const statusCb = vi.fn()

		await openAIClient.initialize(step, statusCb)
		const rpModule: any = await import('../../src/step/openai/response-processor')
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

		const step = { action: 'do', expect: 'done' } as any
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
			choices: [{ message: null as any }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		})

		const step = { action: 'do', expect: 'done' } as any
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
		const step = { action: 'shot', expect: 'done' } as any
		const statusCb = vi.fn()
		await openAIClient.initialize(step, statusCb)

		await openAIClient.addScreenshotMessage('YmFzZTY0', 'image/png')

		const last = openAIClient.getMessages().at(-1) as any
		expect(last.role).toBe('user')
		expect(Array.isArray(last.content)).toBe(true)
		expect(last.content[1].image_url.url).toContain('data:image/png;base64,YmFzZTY0')
	})

	it('counts only string history when estimating tokens', () => {
		;(openAIClient as any).messages = [
			{ role: 'user', content: 'abcd' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ignored' }] },
		]

		const tokens = openAIClient.countHistoryTokens()
		expect(tokens).toBe(1)
	})
})
