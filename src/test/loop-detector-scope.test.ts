import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ScenarioControl } from '../runtime/scenario-control'
import { runnerFixture, emptySession } from './runtime/runner-fixture'
const createMock = vi.fn()
vi.mock('openai', () => ({
	default: class {
		chat = { completions: { create: createMock } }
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
		usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
	}
}

describe('loop detection scope', () => {
	let scenario: ScenarioControl
	afterEach(() => scenario.dispose())
	beforeEach(() => {
		vi.clearAllMocks()
		scenario = new ScenarioControl({ timeoutMs: 30_000 })
	})

	it('does not let a step inherit the previous step repetitions', async () => {
		const navigate = () => toolCallResponse('nav', 'browser_navigate', { url: 'https://example.com' })
		const pass = () => toolCallResponse('pass', 'pass_test_step', { actualResult: 'done' })

		createMock
			.mockResolvedValueOnce(navigate())
			.mockResolvedValueOnce(pass())
			.mockResolvedValueOnce(navigate())
			.mockResolvedValueOnce(pass())

		const session = emptySession()
		session.tools = [
			{
				definition: {
					name: 'browser_navigate',
					description: 'navigate',
					parameters: { type: 'object' },
					strict: false,
				},
				execute: async () => 'navigated',
			},
		]
		const runner = runnerFixture(session)

		const first = await runner.run(
			{ id: 'step', action: 'Open the home page', expect: 'Home is visible' },
			scenario.createStepControl(5000)
		)
		const second = await runner.run(
			{ id: 'step', action: 'Open the home page again', expect: 'Home is visible' },
			scenario.createStepControl(5000)
		)

		expect(first).toMatchObject({ outcome: 'passed', reason: 'met-expectation' })
		expect(second).toMatchObject({ outcome: 'passed', reason: 'met-expectation' })
	})

	it('still terminates a step that repeats the same call within itself', async () => {
		const navigate = () => toolCallResponse('nav', 'browser_navigate', { url: 'https://example.com' })

		createMock.mockResolvedValue(navigate())

		const session = emptySession()
		session.tools = [
			{
				definition: {
					name: 'browser_navigate',
					description: 'navigate',
					parameters: { type: 'object' },
					strict: false,
				},
				execute: async () => 'navigated',
			},
		]
		const runner = runnerFixture(session)
		const report = await runner.run(
			{ id: 'step', action: 'Open the home page', expect: 'Home is visible' },
			scenario.createStepControl(5000)
		)

		expect(report).toMatchObject({ outcome: 'failed', category: 'model', reason: 'loop-detected' })
	})
})
