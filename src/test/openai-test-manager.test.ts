import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { OpenAITestManager } from '../step/openai/openai-test-manager'
import { Step, StepStatusCallback } from '../step/types'
import { Page } from '@playwright/test'
import { ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AriaPageSnapshot } from '../step/tool/page-snapshot'

interface TestableTestManager {
	openaiClient: {
		initialize: Mock
		sendMessage: Mock
	}
}

vi.mock('../../src/step/configuration-manager', () => ({
	ConfigurationManager: class {
		getLogLevel = vi.fn().mockReturnValue('off')
		getApiKey = vi.fn().mockReturnValue('test-key')
		getBaseURL = vi.fn().mockReturnValue(undefined)
		getModel = vi.fn().mockReturnValue('gpt-4o-mini')
		getTimeout = vi.fn().mockReturnValue(60000)
		getMaxRetries = vi.fn().mockReturnValue(3)
		getTemperature = vi.fn().mockReturnValue(1)
	},
}))

vi.mock('../../src/step/logger', () => ({
	CheckmateLogger: {
		create: vi.fn().mockReturnValue({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		}),
	},
}))

vi.mock('../../src/step/tool/step-tool', () => ({
	StepTool: class {
		functionDeclarations: ChatCompletionFunctionTool[] = []
	},
}))

vi.mock('../../src/step/tool/browser-tool', () => ({
	BrowserTool: class {
		functionDeclarations: ChatCompletionFunctionTool[] = []
	},
}))

vi.mock('../../src/salesforce/salesforce-tool', () => ({
	SalesforceTool: class {
		functionDeclarations: ChatCompletionFunctionTool[] = []
	},
}))

vi.mock('../../src/step/tool/tool-registry', () => ({
	ToolRegistry: class {
		getTools = vi.fn().mockResolvedValue([])
	},
}))

vi.mock('../../src/step/openai/openai-client', () => ({
	OpenAIClient: class {
		initialize = vi.fn().mockResolvedValue(undefined)
		sendMessage = vi.fn().mockResolvedValue(undefined)
		page = {} as Page
	},
}))

vi.mock('../../src/step/openai/history-manager', () => {
	class MockHistoryManager {
		buildInitialMessages = vi.fn().mockReturnValue([
			{ role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
			{ role: 'user', content: [{ type: 'text', text: 'step prompt' }] },
			{ role: 'user', content: [{ type: 'text', text: 'snapshot prompt' }] },
		] as ChatCompletionMessageParam[])
		static instance: MockHistoryManager | null = null
		constructor() {
			MockHistoryManager.instance = this
		}
	}

	return {
		HistoryManager: MockHistoryManager,
		getBuildInitialMessagesMock: () => MockHistoryManager.instance?.buildInitialMessages,
	}
})

vi.mock('../../src/step/tool/page-snapshot', () => ({
	PageSnapshot: class {
		static lastSnapshot: AriaPageSnapshot = null
		get = vi.fn().mockResolvedValue('mocked snapshot')
	},
}))

vi.mock('../../src/step/openai/prompts', () => ({
	STEP_SYSTEM_PROMPT: vi.fn(() => 'system prompt'),
	STEP_START_USER_PROMPT: vi.fn((step) => `Execute: ${step.action}`),
}))

describe('OpenAITestManager', () => {
	let testManager: OpenAITestManager
	let mockPage: Page

	beforeEach(() => {
		mockPage = {} as Page
		testManager = new OpenAITestManager(mockPage)
	})

	describe('constructor', () => {
		it('should create test manager instance', () => {
			expect(testManager).toBeDefined()
		})
	})

	describe('teardown', () => {
		it('should complete teardown without error', async () => {
			await expect(testManager.teardown()).resolves.toBeUndefined()
		})
	})

	describe('run', () => {
		let mockStep: Step

		beforeEach(() => {
			mockStep = {
				action: 'Click the submit button',
				expect: 'Button should be clicked',
			}

			testManager = new OpenAITestManager(mockPage)
		})

		it('should successfully run when step passes', async () => {
			const mockClient = (testManager as unknown as TestableTestManager).openaiClient
			mockClient.initialize.mockImplementation((step: Step, callback: StepStatusCallback) => {
				setTimeout(() => callback({ passed: true, actual: 'Success' }), 0)
				return Promise.resolve()
			})

			await expect(testManager.run(mockStep)).resolves.toBeUndefined()
			expect(mockClient.initialize).toHaveBeenCalled()
			expect(mockClient.sendMessage).toHaveBeenCalled()
		})

		it('should throw error when step fails', async () => {
			const mockClient = (testManager as unknown as TestableTestManager).openaiClient
			mockClient.initialize.mockImplementation((step: Step, callback: StepStatusCallback) => {
				setTimeout(() => callback({ passed: false, actual: 'Button not found' }), 0)
				return Promise.resolve()
			})

			await expect(testManager.run(mockStep)).rejects.toThrow()
		})

		it('should include step action in error message when failing', async () => {
			const mockClient = (testManager as unknown as TestableTestManager).openaiClient
			mockClient.initialize.mockImplementation((step: Step, callback: StepStatusCallback) => {
				setTimeout(() => callback({ passed: false, actual: 'Failed' }), 0)
				return Promise.resolve()
			})

			try {
				await testManager.run(mockStep)
				expect.fail('Should have thrown error')
			} catch (error) {
				expect((error as Error).message).toContain('Click the submit button')
			}
		})

		it('should wrap errors from OpenAI client', async () => {
			const mockClient = (testManager as unknown as TestableTestManager).openaiClient
			mockClient.initialize.mockRejectedValue(new Error('API Error'))

			try {
				await testManager.run(mockStep)
				expect.fail('Should have thrown error')
			} catch (error) {
				const wrappedError = error as Error & { cause?: Error }
				expect(wrappedError.message).toContain('Failed to execute action')
				expect(wrappedError.message).toContain('Click the submit button')
				expect(wrappedError.cause?.message).toContain('API Error')
			}
		})

		it('should handle sendMessage errors', async () => {
			const mockClient = (testManager as unknown as TestableTestManager).openaiClient
			mockClient.initialize.mockResolvedValue(undefined)
			mockClient.sendMessage.mockRejectedValue(new Error('Send failed'))
			try {
				await testManager.run(mockStep)
				expect.fail('Should have thrown error')
			} catch (error) {
				expect((error as Error).message).toContain('Failed to execute action')
			}
		})

		it('should build initial messages and send them before the first model request', async () => {
			const mockClient = (testManager as unknown as TestableTestManager).openaiClient
			mockClient.initialize.mockImplementation((step: Step, callback: StepStatusCallback) => {
				setTimeout(() => callback({ passed: true, actual: 'Success' }), 0)
				return Promise.resolve()
			})

			const historyModule = (await import('../../src/step/openai/history-manager')) as unknown as {
				getBuildInitialMessagesMock: () => Mock | undefined
			}

			await expect(testManager.run(mockStep)).resolves.toBeUndefined()

			expect(historyModule.getBuildInitialMessagesMock()).toHaveBeenCalledWith({
				systemPrompt: 'system prompt',
				userPrompt: `Execute: ${mockStep.action}`,
				snapshotContent: 'mocked snapshot',
			})
			expect(mockClient.sendMessage).toHaveBeenCalledWith([
				{ role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
				{ role: 'user', content: [{ type: 'text', text: 'step prompt' }] },
				{ role: 'user', content: [{ type: 'text', text: 'snapshot prompt' }] },
			])
		})
	})
})
