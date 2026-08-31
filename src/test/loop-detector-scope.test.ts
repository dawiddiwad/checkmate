import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Page } from '@playwright/test'
import { createPlaywrightRunner } from '../playwright'

const createMock = vi.fn()

vi.mock('openai', () => ({
	default: class MockOpenAI {
		chat = { completions: { create: createMock } }
		constructor() {}
	},
}))

vi.mock('../config/runtime-config', () => ({
	RuntimeConfig: class {
		getLogLevel = vi.fn().mockReturnValue('off')
		getApiKey = vi.fn().mockReturnValue('test-key')
		getBaseURL = vi.fn().mockReturnValue(undefined)
		getModel = vi.fn().mockReturnValue('gpt-4o-mini')
		getTimeout = vi.fn().mockReturnValue(5_000)
		getMaxRetries = vi.fn().mockReturnValue(0)
		getToolChoice = vi.fn().mockReturnValue('auto')
		getTemperature = vi.fn().mockReturnValue(0)
		getReasoningEffort = vi.fn().mockReturnValue(undefined)
		includeScreenshotInSnapshot = vi.fn().mockReturnValue(false)
		getAllowedFunctionNames = vi.fn().mockReturnValue([])
		getLoopMaxRepetitions = vi.fn().mockReturnValue(2)
		getTokenBudgetUSD = vi.fn().mockReturnValue(undefined)
		getTokenBudgetCount = vi.fn().mockReturnValue(undefined)
		getApiRateLimitDelayMs = vi.fn().mockReturnValue(0)
		isSnapshotFilteringEnabled = vi.fn().mockReturnValue(false)
	},
}))

vi.mock('../logging', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../tools/browser/tool', () => ({
	BrowserTool: { TOOL_NAVIGATE: 'browser_navigate' },
	BrowserToolRuntime: class {
		constructor(private readonly page: Page) {}
		getActivePage() {
			return this.page
		}
		ensureActivePage() {
			return this.page
		}
		getBrowserContext() {
			return {}
		}
	},
	createBrowserTools: vi.fn(() => [
		{
			definition: {
				name: 'browser_navigate',
				description: 'Navigate to a url',
				parameters: {
					type: 'object',
					properties: { url: { type: 'string' } },
					required: ['url'],
					additionalProperties: false,
				},
				strict: true,
			},
			execute: vi.fn(() => 'navigated'),
		},
	]),
}))

vi.mock('../tools/browser/snapshot-service', () => ({
	SnapshotService: class {
		get = vi.fn().mockResolvedValue('mocked snapshot')
	},
}))

function toolCallResponse(id: string, name: string, args: Record<string, unknown>) {
	return {
		choices: [
			{
				index: 0,
				finish_reason: 'tool_calls',
				message: {
					role: 'assistant',
					content: null as string | null,
					tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
				},
			},
		],
		usage: { prompt_tokens: 4, completion_tokens: 2 },
	}
}

describe('loop detection scope', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('does not let a step inherit the previous step repetitions', async () => {
		const navigate = () => toolCallResponse('nav', 'browser_navigate', { url: 'https://example.com' })
		const pass = () => toolCallResponse('pass', 'pass_test_step', { actualResult: 'done' })

		createMock
			.mockResolvedValueOnce(navigate())
			.mockResolvedValueOnce(pass())
			.mockResolvedValueOnce(navigate())
			.mockResolvedValueOnce(pass())

		const runner = createPlaywrightRunner({} as Page)

		const first = await runner.run({ action: 'Open the home page', expect: 'Home is visible' })
		const second = await runner.run({ action: 'Open the home page again', expect: 'Home is visible' })

		expect(first).toMatchObject({ outcome: 'passed', reason: 'met-expectation' })
		expect(second).toMatchObject({ outcome: 'passed', reason: 'met-expectation' })
	})

	it('still terminates a step that repeats the same call within itself', async () => {
		const navigate = () => toolCallResponse('nav', 'browser_navigate', { url: 'https://example.com' })

		createMock.mockResolvedValue(navigate())

		const runner = createPlaywrightRunner({} as Page)
		const report = await runner.run({ action: 'Open the home page', expect: 'Home is visible' })

		expect(report).toMatchObject({ outcome: 'failed', category: 'model', reason: 'loop-detected' })
	})
})
