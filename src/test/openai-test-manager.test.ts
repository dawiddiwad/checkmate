import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { CheckmateRunner } from '../core'
import { Step } from '../runtime/types'
import { Page } from '@playwright/test'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { createPlaywrightRunner } from '../playwright'

interface TestableRunner {
	aiClient: {
		send: Mock
		countHistoryTokens: Mock
	}
}

vi.mock('../../src/config/runtime-config', () => ({
	RuntimeConfig: class {
		getLogLevel = vi.fn().mockReturnValue('off')
		getApiKey = vi.fn().mockReturnValue('test-key')
		getBaseURL = vi.fn().mockReturnValue(undefined)
		getModel = vi.fn().mockReturnValue('gpt-4o-mini')
		getTimeout = vi.fn().mockReturnValue(60000)
		getMaxRetries = vi.fn().mockReturnValue(3)
		getTemperature = vi.fn().mockReturnValue(1)
		getLoopMaxRepetitions = vi.fn().mockReturnValue(5)
		getTokenBudgetUSD = vi.fn().mockReturnValue(undefined)
		getTokenBudgetCount = vi.fn().mockReturnValue(undefined)
		getApiRateLimitDelayMs = vi.fn().mockReturnValue(0)
		includeScreenshotInSnapshot = vi.fn().mockReturnValue(false)
	},
}))

vi.mock('../../src/logging/logger', () => ({
	CheckmateLogger: {
		create: vi.fn().mockReturnValue({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		}),
	},
}))

vi.mock('../../src/tools/browser/tool', () => ({
	BrowserTool: {
		TOOL_SNAPSHOT: 'browser_snapshot',
	},
	BrowserToolRuntime: class {
		constructor(private readonly page: Page) {}
		getActivePage() {
			return this.page
		}
		ensureActivePage() {
			return this.page
		}
		getBrowserContext() {
			return this.page.context?.() ?? {}
		}
	},
	createBrowserTools: vi.fn(() => []),
}))

vi.mock('../../src/tools/registry', () => ({
	ToolRegistry: class {
		register = vi.fn()
		getTools = vi.fn().mockResolvedValue([])
		resolve = vi.fn().mockReturnValue(undefined)
		getRegisteredToolNames = vi.fn().mockReturnValue([])
		getRuntimeConfig = vi.fn()
	},
}))

vi.mock('../../src/ai/client', () => ({
	AiClient: class {
		send = vi.fn()
		countHistoryTokens = vi.fn().mockReturnValue(0)
	},
}))

vi.mock('../../src/tools/browser/snapshot-service', () => ({
	SnapshotService: class {
		get = vi.fn().mockResolvedValue('mocked snapshot')
	},
}))

vi.mock('../../src/ai/prompts', () => ({
	STEP_SYSTEM_PROMPT: vi.fn(() => 'system prompt'),
	STEP_START_USER_PROMPT: vi.fn((step) => `Execute: ${step.action}`),
}))

function assertionResponse(name: string, passed: boolean, actual: string) {
	return {
		response: {
			choices: [
				{
					index: 0,
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null as string | null,
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name, arguments: JSON.stringify({ actual }) },
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 2 },
		},
		assistantMessages: [{ role: 'assistant', content: null as string | null }],
		assertion: { passed, actual },
	}
}

describe('CheckmateRunner', () => {
	let runner: CheckmateRunner
	let mockPage: Page
	let mockStep: Step

	beforeEach(() => {
		vi.clearAllMocks()
		mockPage = {} as Page
		runner = createPlaywrightRunner(mockPage)
		mockStep = {
			action: 'Click the submit button',
			expect: 'Button should be clicked',
		}
	})

	function aiClient() {
		return (runner as unknown as TestableRunner).aiClient
	}

	describe('constructor', () => {
		it('should create a runner instance', () => {
			expect(runner).toBeDefined()
		})
	})

	describe('teardown', () => {
		it('should complete teardown without error', async () => {
			await expect(runner.teardown()).resolves.toBeUndefined()
		})
	})

	describe('run', () => {
		it('sends the initial messages before the first model request', async () => {
			aiClient().send.mockRejectedValue(new Error('stop here'))

			await runner.run(mockStep)

			const [messages] = aiClient().send.mock.calls[0] as [ChatCompletionMessageParam[]]
			expect(messages).toEqual([
				{ role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
				{ role: 'user', content: [{ type: 'text', text: 'Execute: Click the submit button' }] },
				{
					role: 'user',
					content: [{ type: 'text', text: 'this is a current page snapshot:\nmocked snapshot' }],
				},
			])
		})

		it('reports a client failure as an infra provider error instead of throwing', async () => {
			aiClient().send.mockRejectedValue(new Error('API Error'))

			const report = await runner.run(mockStep)

			expect(report).toMatchObject({
				action: 'Click the submit button',
				outcome: 'failed',
				category: 'infra',
				reason: 'provider-error',
			})
			expect(report.actual).toContain('API Error')
		})

		it('resolves the assertion produced by the result tool', async () => {
			const registry = (runner as unknown as { toolRegistry: { resolve: Mock } }).toolRegistry
			registry.resolve.mockReturnValue({
				definition: { name: 'pass_test_step', description: '', parameters: {}, strict: true },
				execute: vi.fn(() => ({ response: 'Success', assertion: { passed: true, actual: 'Success' } })),
			})
			aiClient().send.mockResolvedValue(assertionResponse('pass_test_step', true, 'Success'))

			const report = await runner.run(mockStep)

			expect(report).toMatchObject({
				outcome: 'passed',
				category: 'app',
				reason: 'met-expectation',
				actual: 'Success',
				turns: 1,
			})
		})
	})
})
