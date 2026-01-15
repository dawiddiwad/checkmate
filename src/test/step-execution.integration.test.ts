import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Page } from '@playwright/test'
import { OpenAIClient } from '../step/openai/openai-client'
import { OpenAITestManager } from '../step/openai/openai-test-manager'
import { ConfigurationManager } from '../step/configuration-manager'
import { Step, StepStatus, StepStatusCallback } from '../step/types'
import { ToolRegistry } from '../step/tool/tool-registry'
import { StepTool } from '../step/tool/step-tool'
import { BrowserTool } from '../step/tool/browser-tool'
import { SalesforceTool } from '../salesforce/salesforce-tool'
import { ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AriaPageSnapshot } from '../step/tool/page-snapshot'

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

vi.mock('../step/configuration-manager', () => {
	return {
		ConfigurationManager: class {
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
			getLoopMaxRepetitions = vi.fn().mockReturnValue(3)
			getTokenBudgetUSD = vi.fn().mockReturnValue(undefined)
			getTokenBudgetCount = vi.fn().mockReturnValue(undefined)
		},
	}
})

vi.mock('../step/logger', () => ({
	CheckmateLogger: {
		create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
	},
}))

vi.mock('../salesforce/salesforce-tool', () => ({
	SalesforceTool: class {
		functionDeclarations: ChatCompletionFunctionTool[] = []
		call = vi.fn()
	},
}))

vi.mock('../step/tool/browser-tool', () => ({
	BrowserTool: class {
		functionDeclarations = [
			{
				type: 'function',
				function: {
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
			},
			{
				type: 'function',
				function: {
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
			},
		]
		call = browserCallMock
		setStep = vi.fn()
	},
}))

vi.mock('../step/tool/page-snapshot', () => ({
	PageSnapshot: class {
		static lastSnapshot: AriaPageSnapshot = null
		get = vi.fn().mockResolvedValue('mocked snapshot')
	},
}))

describe('Simple step execution integration', () => {
	let manager: OpenAITestManager
	let page: Page

	beforeEach(() => {
		vi.clearAllMocks()
		browserCallMock.mockReturnValue('nav-ok')
		page = {} as Page
		manager = new OpenAITestManager(page)
	})

	it('runs a step and routes tool calls from the model', async () => {
		const firstResponse = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'tool-1',
								type: 'function',
								function: {
									name: 'browser_navigate',
									arguments: JSON.stringify({ url: 'https://example.com', goal: 'open home' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		}

		const secondResponse = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'tool-2',
								type: 'function',
								function: {
									name: 'pass_test_step',
									arguments: JSON.stringify({ actualResult: 'page opened' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 6, completion_tokens: 4 },
		}

		createMock.mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse)

		const step: Step = {
			action: 'Navigate to example.com',
			expect: 'Example homepage is shown',
		}

		await expect(manager.run(step)).resolves.toBeUndefined()

		expect(createMock).toHaveBeenCalledTimes(2)
		expect(browserCallMock).toHaveBeenCalledWith({
			name: 'browser_navigate',
			arguments: expect.objectContaining({ url: 'https://example.com', goal: 'open home' }),
		})
	})

	it('runs a multi-step flow with multiple tool calls before pass', async () => {
		const navigateResponse = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'nav-1',
								type: 'function',
								function: {
									name: 'browser_navigate',
									arguments: JSON.stringify({ url: 'https://example.com', goal: 'open home' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 8, completion_tokens: 4 },
		}

		const typeResponse = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'type-1',
								type: 'function',
								function: {
									name: 'browser_type',
									arguments: JSON.stringify({ ref: 'e1', text: 'hello', goal: 'fill input' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 9, completion_tokens: 4 },
		}

		const passResponse = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'pass-1',
								type: 'function',
								function: {
									name: 'pass_test_step',
									arguments: JSON.stringify({ actualResult: 'completed' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 7, completion_tokens: 3 },
		}

		createMock
			.mockResolvedValueOnce(navigateResponse)
			.mockResolvedValueOnce(typeResponse)
			.mockResolvedValueOnce(passResponse)

		const step: Step = {
			action: 'Navigate then type hello',
			expect: 'Input is filled',
		}

		await expect(manager.run(step)).resolves.toBeUndefined()

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

	it('runs two sequential test steps, each with their own tool calls', async () => {
		const step1Navigate = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'nav-step1',
								type: 'function',
								function: {
									name: 'browser_navigate',
									arguments: JSON.stringify({ url: 'https://example.com', goal: 'open home' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 8, completion_tokens: 3 },
		}

		const step1Pass = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'pass-step1',
								type: 'function',
								function: {
									name: 'pass_test_step',
									arguments: JSON.stringify({ actualResult: 'home opened' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 2 },
		}

		const step2Navigate = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'nav-step2',
								type: 'function',
								function: {
									name: 'browser_navigate',
									arguments: JSON.stringify({
										url: 'https://example.com/login',
										goal: 'go to login',
									}),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 9, completion_tokens: 4 },
		}

		const step2Type = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'type-step2',
								type: 'function',
								function: {
									name: 'browser_type',
									arguments: JSON.stringify({
										ref: 'email',
										text: 'user@example.com',
										goal: 'enter email',
									}),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 4 },
		}

		const step2Pass = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'pass-step2',
								type: 'function',
								function: {
									name: 'pass_test_step',
									arguments: JSON.stringify({ actualResult: 'login form filled' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 6, completion_tokens: 3 },
		}

		createMock
			.mockResolvedValueOnce(step1Navigate)
			.mockResolvedValueOnce(step1Pass)
			.mockResolvedValueOnce(step2Navigate)
			.mockResolvedValueOnce(step2Type)
			.mockResolvedValueOnce(step2Pass)

		const stepOne: Step = {
			action: 'Open home page',
			expect: 'Home is visible',
		}

		const stepTwo: Step = {
			action: 'Open login and enter email',
			expect: 'Email filled',
		}

		await expect(manager.run(stepOne)).resolves.toBeUndefined()
		await expect(manager.run(stepTwo)).resolves.toBeUndefined()

		expect(createMock).toHaveBeenCalledTimes(5)
		expect(browserCallMock).toHaveBeenNthCalledWith(1, {
			name: 'browser_navigate',
			arguments: expect.objectContaining({ url: 'https://example.com', goal: 'open home' }),
		})
		expect(browserCallMock).toHaveBeenNthCalledWith(2, {
			name: 'browser_navigate',
			arguments: expect.objectContaining({ url: 'https://example.com/login', goal: 'go to login' }),
		})
		expect(browserCallMock).toHaveBeenNthCalledWith(3, {
			name: 'browser_type',
			arguments: expect.objectContaining({ ref: 'email', text: 'user@example.com', goal: 'enter email' }),
		})
	})

	it('recovers when the model replies with text by prompting for a pass/fail tool call', async () => {
		const textResponse = {
			choices: [
				{
					finish_reason: 'stop',
					message: {
						role: 'assistant',
						content: 'Here is your summary',
					},
				},
			],
			usage: { prompt_tokens: 8, completion_tokens: 3 },
		}

		const passResponse = {
			choices: [
				{
					message: {
						role: 'assistant',
						tool_calls: [
							{
								id: 'pass-1',
								type: 'function',
								function: {
									name: 'pass_test_step',
									arguments: JSON.stringify({ actualResult: 'status ok' }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 6, completion_tokens: 2 },
		}

		createMock.mockResolvedValueOnce(textResponse).mockResolvedValueOnce(passResponse)

		const configurationManager = new ConfigurationManager()
		const browserTool = new BrowserTool(page)
		const stepTool = new StepTool()
		const salesforceTool = new SalesforceTool(browserTool)
		const toolRegistry = new ToolRegistry({ browserTool, stepTool, salesforceTool, configurationManager })
		const client = new OpenAIClient({ configurationManager, toolRegistry, page })

		const step: Step = {
			action: 'Report current status',
			expect: 'Status is reported',
		}

		let reportedStatus: StepStatus | undefined
		const statusCallback: StepStatusCallback = (status: StepStatus) => {
			reportedStatus = status
		}

		await client.initialize(step, statusCallback)
		await client.sendMessage([{ role: 'user', content: 'Please report the current status' }])

		expect(createMock).toHaveBeenCalledTimes(2)
		expect(reportedStatus).toEqual({ passed: true, actual: 'status ok' })

		const secondCallMessages = (createMock.mock.calls[1][0] as { messages: ChatCompletionMessageParam[] }).messages
		const reminder = secondCallMessages
			.map((m) => m.content)
			.find(
				(content) =>
					typeof content === 'string' &&
					content.includes('You provided a text response but did not call a tool')
			)

		expect(reminder).toBeDefined()
	})
})
