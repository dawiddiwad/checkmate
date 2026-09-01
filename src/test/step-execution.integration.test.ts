import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Page } from '@playwright/test'
import { CheckmateRunner } from '../core'
import { Step } from '../runtime/types'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { createPlaywrightRunner } from '../playwright'
import { testConfig } from './test-types'

const createMock = vi.fn()
const browserCallMock = vi.fn()

vi.mock('openai', () => {
	return {
		default: class MockOpenAI {
			chat = { completions: { create: createMock } }
			constructor() {}
		},
	}
})

vi.mock('../logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
	setLogLevel: vi.fn(),
}))

vi.mock('../tools/salesforce/login-tool', () => ({
	createSalesforceTools: vi.fn(() => []),
}))

vi.mock('../tools/browser/tool', () => ({
	BrowserTool: {
		TOOL_NAVIGATE: 'browser_navigate',
		TOOL_TYPE_OR_SELECT: 'browser_type',
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
	createBrowserTools: vi.fn(() => [
		{
			definition: {
				name: 'browser_navigate',
				description: 'Navigate to a url',
				parameters: {
					type: 'object',
					properties: {
						url: { type: 'string' },
						goal: { type: 'string' },
					},
					required: ['url'],
					additionalProperties: false,
				},
				strict: true,
			},
			execute: vi.fn((args) => browserCallMock({ name: 'browser_navigate', arguments: args })),
		},
		{
			definition: {
				name: 'browser_type',
				description: 'Type text into a field',
				parameters: {
					type: 'object',
					properties: {
						ref: { type: 'string' },
						text: { type: 'string' },
						goal: { type: 'string' },
					},
					required: ['ref', 'text'],
					additionalProperties: false,
				},
				strict: true,
			},
			execute: vi.fn((args) => browserCallMock({ name: 'browser_type', arguments: args })),
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
		usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } },
	}
}

describe('Simple step execution integration', () => {
	let runner: CheckmateRunner
	let page: Page

	beforeEach(() => {
		vi.clearAllMocks()
		browserCallMock.mockReturnValue('nav-ok')
		page = {} as Page
		runner = createPlaywrightRunner(
			page,
			testConfig({
				checkmateModel: 'gpt-4o-mini',
				checkmateMaxRetries: 0,
				checkmateToolChoice: 'auto',
				checkmateRequestTimeout: 5_000,
				checkmateLoopMaxRepetitions: 3,
				checkmateSnapshotFilter: true,
			})
		)
	})

	it('runs a step and resolves a passing report', async () => {
		createMock
			.mockResolvedValueOnce(
				toolCallResponse('tool-1', 'browser_navigate', { url: 'https://example.com', goal: 'open home' })
			)
			.mockResolvedValueOnce(toolCallResponse('tool-2', 'pass_test_step', { actualResult: 'page opened' }))

		const step: Step = {
			name: 'open the homepage',
			action: 'Navigate to example.com',
			expect: 'Example homepage is shown',
		}

		const report = await runner.run(step)

		expect(report).toMatchObject({
			schemaVersion: 1,
			name: 'open the homepage',
			action: 'Navigate to example.com',
			expect: 'Example homepage is shown',
			outcome: 'passed',
			category: 'app',
			reason: 'met-expectation',
			actual: 'page opened',
			turns: 2,
		})
		expect(report.toolCalls).toEqual([
			{
				turn: 1,
				name: 'browser_navigate',
				arguments: { url: 'https://example.com', goal: 'open home' },
				status: 'ok',
			},
			{ turn: 2, name: 'pass_test_step', arguments: { actualResult: 'page opened' }, status: 'ok' },
		])
		expect(report.usage).toMatchObject({ promptTokens: 20, cachedPromptTokens: 8, completionTokens: 10 })
		expect(createMock).toHaveBeenCalledTimes(2)
		expect(browserCallMock).toHaveBeenCalledWith({
			name: 'browser_navigate',
			arguments: expect.objectContaining({ url: 'https://example.com', goal: 'open home' }),
		})
	})

	it('resolves a failing report instead of throwing when the model fails the step', async () => {
		createMock.mockResolvedValueOnce(
			toolCallResponse('tool-1', 'fail_test_step', { actualResult: 'the homepage never loaded' })
		)

		const report = await runner.run({ action: 'Navigate to example.com', expect: 'Example homepage is shown' })

		expect(report).toMatchObject({
			outcome: 'failed',
			category: 'app',
			reason: 'failed-expectation',
			actual: 'the homepage never loaded',
			turns: 1,
		})
	})

	it('runs a multi-step flow with multiple tool calls before pass', async () => {
		createMock
			.mockResolvedValueOnce(
				toolCallResponse('nav-1', 'browser_navigate', { url: 'https://example.com', goal: 'open home' })
			)
			.mockResolvedValueOnce(
				toolCallResponse('type-1', 'browser_type', { ref: 'e1', text: 'hello', goal: 'fill input' })
			)
			.mockResolvedValueOnce(toolCallResponse('pass-1', 'pass_test_step', { actualResult: 'completed' }))

		const report = await runner.run({ action: 'Navigate then type hello', expect: 'Input is filled' })

		expect(report.outcome).toBe('passed')
		expect(report.turns).toBe(3)
		expect(createMock).toHaveBeenCalledTimes(3)
		expect(browserCallMock).toHaveBeenNthCalledWith(1, {
			name: 'browser_navigate',
			arguments: expect.objectContaining({ url: 'https://example.com', goal: 'open home' }),
		})
		expect(browserCallMock).toHaveBeenNthCalledWith(2, {
			name: 'browser_type',
			arguments: expect.objectContaining({ ref: 'e1', text: 'hello', goal: 'fill input' }),
		})
	})

	it('runs two sequential steps, each with its own message history', async () => {
		createMock
			.mockResolvedValueOnce(
				toolCallResponse('nav-step1', 'browser_navigate', { url: 'https://example.com', goal: 'open home' })
			)
			.mockResolvedValueOnce(toolCallResponse('pass-step1', 'pass_test_step', { actualResult: 'home opened' }))
			.mockResolvedValueOnce(
				toolCallResponse('nav-step2', 'browser_navigate', {
					url: 'https://example.com/login',
					goal: 'go to login',
				})
			)
			.mockResolvedValueOnce(
				toolCallResponse('type-step2', 'browser_type', {
					ref: 'email',
					text: 'user@example.com',
					goal: 'enter email',
				})
			)
			.mockResolvedValueOnce(
				toolCallResponse('pass-step2', 'pass_test_step', { actualResult: 'login form filled' })
			)

		const first = await runner.run({ action: 'Open home page', expect: 'Home is visible' })
		const second = await runner.run({ action: 'Open login and enter email', expect: 'Email filled' })

		expect(first.outcome).toBe('passed')
		expect(second.outcome).toBe('passed')
		expect(createMock).toHaveBeenCalledTimes(5)

		const secondStepFirstRequest = createMock.mock.calls[2][0] as { messages: ChatCompletionMessageParam[] }
		expect(JSON.stringify(secondStepFirstRequest.messages)).not.toContain('home opened')
	})

	it('replaces the page snapshot instead of accumulating one per turn', async () => {
		browserCallMock.mockReturnValue({ response: 'nav-ok', snapshot: 'updated snapshot' })
		createMock
			.mockResolvedValueOnce(
				toolCallResponse('nav-1', 'browser_navigate', { url: 'https://example.com', goal: 'open home' })
			)
			.mockResolvedValueOnce(toolCallResponse('pass-1', 'pass_test_step', { actualResult: 'done' }))

		await runner.run({ action: 'Open home page', expect: 'Home is visible' })

		const secondRequest = createMock.mock.calls[1][0] as { messages: ChatCompletionMessageParam[] }
		const snapshots = secondRequest.messages.filter((message) =>
			JSON.stringify(message.content).includes('this is a current page snapshot')
		)
		expect(snapshots).toHaveLength(1)
		expect(JSON.stringify(snapshots[0].content)).toContain('updated snapshot')
	})

	it('recovers when the model replies with text by prompting for a pass/fail tool call', async () => {
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						index: 0,
						finish_reason: 'stop',
						message: { role: 'assistant', content: 'Here is your summary' },
					},
				],
				usage: { prompt_tokens: 8, completion_tokens: 3 },
			})
			.mockResolvedValueOnce(toolCallResponse('pass-1', 'pass_test_step', { actualResult: 'status ok' }))

		const report = await runner.run({ action: 'Report current status', expect: 'Status is reported' })

		expect(report).toMatchObject({ outcome: 'passed', actual: 'status ok', turns: 2 })
		expect(createMock).toHaveBeenCalledTimes(2)

		const secondCallMessages = (createMock.mock.calls[1][0] as { messages: ChatCompletionMessageParam[] }).messages
		const reminder = secondCallMessages
			.map((message) => message.content)
			.find(
				(content) =>
					typeof content === 'string' &&
					content.includes('You provided a text response but did not call a tool')
			)

		expect(reminder).toBeDefined()
		expect(report.transcript).toContainEqual({ turn: 1, role: 'assistant', content: 'Here is your summary' })
	})

	it('converts a provider failure into an infra report so the evidence survives', async () => {
		createMock.mockRejectedValue(Object.assign(new Error('provider exploded'), { status: 401 }))

		const report = await runner.run({ action: 'Open home page', expect: 'Home is visible' })

		expect(report).toMatchObject({ outcome: 'failed', category: 'infra', reason: 'provider-error', turns: 1 })
		expect(report.actual).toContain('provider exploded')
	})

	it('converts an unknown tool call into an infra tool-error report', async () => {
		createMock.mockResolvedValueOnce(toolCallResponse('call-1', 'not_a_tool', {}))

		const report = await runner.run({ action: 'Open home page', expect: 'Home is visible' })

		expect(report).toMatchObject({ outcome: 'failed', category: 'infra', reason: 'tool-error' })
		expect(report.actual).toContain('not_a_tool')
	})
})
