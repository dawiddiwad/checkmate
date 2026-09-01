import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Page } from '@playwright/test'
import { createPlaywrightRunner } from '../playwright'
import { testConfig } from './test-types'

const createMock = vi.fn()

vi.mock('openai', () => ({
	default: class MockOpenAI {
		chat = { completions: { create: createMock } }
		constructor() {}
	},
}))

vi.mock('../logging', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	setLogLevel: vi.fn(),
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

		const runner = createPlaywrightRunner(
			{} as Page,
			testConfig({
				checkmateModel: 'gpt-4o-mini',
				checkmateMaxRetries: 0,
				checkmateToolChoice: 'auto',
				checkmateRequestTimeout: 5_000,
				checkmateLoopMaxRepetitions: 2,
			})
		)

		const first = await runner.run({ action: 'Open the home page', expect: 'Home is visible' })
		const second = await runner.run({ action: 'Open the home page again', expect: 'Home is visible' })

		expect(first).toMatchObject({ outcome: 'passed', reason: 'met-expectation' })
		expect(second).toMatchObject({ outcome: 'passed', reason: 'met-expectation' })
	})

	it('still terminates a step that repeats the same call within itself', async () => {
		const navigate = () => toolCallResponse('nav', 'browser_navigate', { url: 'https://example.com' })

		createMock.mockResolvedValue(navigate())

		const runner = createPlaywrightRunner(
			{} as Page,
			testConfig({
				checkmateModel: 'gpt-4o-mini',
				checkmateMaxRetries: 0,
				checkmateToolChoice: 'auto',
				checkmateRequestTimeout: 5_000,
				checkmateLoopMaxRepetitions: 2,
			})
		)
		const report = await runner.run({ action: 'Open the home page', expect: 'Home is visible' })

		expect(report).toMatchObject({ outcome: 'failed', category: 'model', reason: 'loop-detected' })
	})
})
