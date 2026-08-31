import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { ChatCompletion } from 'openai/resources/chat/completions'
import { TurnProcessor } from '../ai/turn-processor'
import { testConfig } from './test-types'
import { StepEvidence } from '../runtime/step-evidence'
import { Step } from '../runtime/types'
import { LoopDetectedError, LoopDetector } from '../tools/loop-detector'
import { ToolRegistry } from '../tools/registry'

interface TestableTurnProcessor {
	toolDispatcher: { dispatch: Mock }
	rateLimitPolicy: { wait: Mock }
}

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock('../../src/tools/dispatcher', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../tools/dispatcher')>()
	return {
		...actual,
		ToolDispatcher: class {
			dispatch = vi.fn()
		},
	}
})

vi.mock('../../src/ai/rate-limit-policy', () => ({
	RateLimitPolicy: class {
		wait = vi.fn().mockResolvedValue(undefined)
	},
}))

function response(overrides: Partial<ChatCompletion> & { choices: ChatCompletion['choices'] }): ChatCompletion {
	return {
		id: 'response_1',
		object: 'chat.completion',
		created: 0,
		model: 'gpt-4o-mini',
		...overrides,
	} as ChatCompletion
}

function toolCallChoice(toolCalls: unknown[], index = 0): ChatCompletion['choices'] {
	return [
		{
			index,
			logprobs: null,
			finish_reason: 'tool_calls',
			message: { role: 'assistant', content: null, refusal: null, tool_calls: toolCalls },
		},
	] as unknown as ChatCompletion['choices']
}

describe('TurnProcessor', () => {
	let turnProcessor: TurnProcessor
	let evidence: StepEvidence
	let step: Step

	beforeEach(() => {
		vi.clearAllMocks()
		step = { action: 'test action', expect: 'test expectation' }
		evidence = new StepEvidence({ step, model: 'gpt-4o-mini' })
		turnProcessor = new TurnProcessor({
			config: testConfig(),
			toolRegistry: {} as ToolRegistry,
			loopDetector: new LoopDetector(5),
			evidence,
		})
	})

	function dispatcher() {
		return (turnProcessor as unknown as TestableTurnProcessor).toolDispatcher
	}

	it('dispatches a tool call and returns the follow-up messages', async () => {
		dispatcher().dispatch.mockResolvedValue({
			name: 'browser_click',
			response: 'clicked',
			snapshot: null,
			status: 'success',
		})

		const outcome = await turnProcessor.process({
			response: response({
				choices: toolCallChoice([
					{
						id: 'call_1',
						type: 'function',
						function: { name: 'browser_click', arguments: '{"ref":"e123","goal":"click"}' },
					},
				]),
			}),
			step,
			turn: 1,
		})

		expect(dispatcher().dispatch).toHaveBeenCalledWith(
			{ name: 'browser_click', arguments: { ref: 'e123', goal: 'click' } },
			{ step }
		)
		expect(outcome).toEqual({
			kind: 'continue',
			toolResults: [
				{
					toolCallId: 'call_1',
					toolCall: { name: 'browser_click', arguments: { ref: 'e123', goal: 'click' } },
					toolResponse: { name: 'browser_click', response: 'clicked', snapshot: null, status: 'success' },
				},
			],
			messages: [
				{ role: 'tool', tool_call_id: 'call_1', content: 'clicked' },
				{
					role: 'user',
					content:
						'tool execution summary:\n- successfully executed: browser_click {"ref":"e123","goal":"click"}',
				},
			],
		})
	})

	it('returns an assertion when a tool asserts the step result', async () => {
		dispatcher().dispatch.mockResolvedValue({
			name: 'fail_test_step',
			response: 'the total did not change',
			snapshot: null,
			status: 'success',
			assertion: { passed: false, actual: 'the total did not change' },
		})

		const outcome = await turnProcessor.process({
			response: response({
				choices: toolCallChoice([
					{
						id: 'call_assert',
						type: 'function',
						function: { name: 'fail_test_step', arguments: '{"actualResult":"the total did not change"}' },
					},
				]),
			}),
			step,
			turn: 4,
		})

		expect(outcome).toEqual({ kind: 'assertion', passed: false, actual: 'the total did not change' })
	})

	it('reports a detected loop as stuck instead of throwing', async () => {
		dispatcher().dispatch.mockRejectedValue(
			new LoopDetectedError({ loopDetected: true, patternLength: 1, repetitions: 5, pattern: ['browser_wait()'] })
		)

		const outcome = await turnProcessor.process({
			response: response({
				choices: toolCallChoice([
					{ id: 'call_loop', type: 'function', function: { name: 'browser_wait', arguments: '{}' } },
				]),
			}),
			step,
			turn: 7,
		})

		expect(outcome).toEqual({ kind: 'stuck', reason: 'loop-detected' })
	})

	it('records every dispatched tool call on the evidence', async () => {
		dispatcher().dispatch.mockResolvedValue({
			name: 'browser_click',
			response: 'failed to click',
			snapshot: null,
			status: 'error',
		})

		await turnProcessor.process({
			response: response({
				choices: toolCallChoice([
					{ id: 'call_1', type: 'function', function: { name: 'browser_click', arguments: '{"ref":"e1"}' } },
				]),
			}),
			step,
			turn: 3,
		})

		const report = evidence.buildReport({ outcome: 'failed', reason: 'failed-expectation', turns: 3 })
		expect(report.toolCalls).toEqual([
			{ turn: 3, name: 'browser_click', arguments: { ref: 'e1' }, status: 'error' },
		])
	})

	it('treats a tool that returns nothing as a completed call', async () => {
		dispatcher().dispatch.mockResolvedValue(null)

		const outcome = await turnProcessor.process({
			response: response({
				choices: toolCallChoice([
					{ id: 'call_void', type: 'function', function: { name: 'custom_tool', arguments: '{}' } },
				]),
			}),
			step,
			turn: 1,
		})

		expect(outcome.kind).toBe('continue')
		expect(outcome.kind === 'continue' && outcome.toolResults[0].toolResponse.response).toBe(
			'tool completed without output'
		)
	})

	it('delegates responses without tool calls to the message handler', async () => {
		const outcome = await turnProcessor.process({
			response: response({
				choices: [
					{
						index: 0,
						logprobs: null,
						finish_reason: 'stop',
						message: { role: 'assistant', content: 'This is a text response', refusal: null },
					},
				] as ChatCompletion['choices'],
			}),
			step,
			turn: 1,
		})

		expect(outcome.kind).toBe('continue')
		expect(outcome.kind === 'continue' && outcome.toolResults).toEqual([])
		expect(JSON.stringify(outcome)).toContain('pass_test_step')
	})

	it('waits for the configured rate limit delay before processing', async () => {
		await turnProcessor.process({
			response: response({
				choices: [
					{
						index: 0,
						logprobs: null,
						finish_reason: 'stop',
						message: { role: 'assistant', content: 'text', refusal: null },
					},
				] as ChatCompletion['choices'],
			}),
			step,
			turn: 1,
		})

		expect((turnProcessor as unknown as TestableTurnProcessor).rateLimitPolicy.wait).toHaveBeenCalled()
	})

	it('throws when the response has no choices', async () => {
		await expect(turnProcessor.process({ response: response({ choices: [] }), step, turn: 1 })).rejects.toThrow(
			'No choices found in response'
		)
	})

	it('includes model context when tool arguments are malformed JSON', async () => {
		await expect(
			turnProcessor.process({
				response: response({
					choices: toolCallChoice(
						[
							{
								id: 'call_bad',
								type: 'function',
								function: { name: 'browser_click', arguments: '{bad json' },
							},
						],
						2
					),
				}),
				step,
				turn: 1,
			})
		).rejects.toThrow(
			/browser_click[\s\S]*call_bad[\s\S]*\{bad json[\s\S]*test action[\s\S]*test expectation[\s\S]*choice_index: 2[\s\S]*finish_reason: tool_calls/
		)
	})

	it('wraps dispatch failures with tool and model context', async () => {
		const cause = new Error('dispatch exploded')
		dispatcher().dispatch.mockRejectedValue(cause)

		let caught: unknown
		try {
			await turnProcessor.process({
				response: response({
					choices: toolCallChoice(
						[
							{
								id: 'call_dispatch',
								type: 'function',
								function: { name: 'browser_type', arguments: '{"text":"hello"}' },
							},
						],
						1
					),
				}),
				step,
				turn: 1,
			})
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toMatch(
			/browser_type[\s\S]*call_dispatch[\s\S]*hello[\s\S]*test action[\s\S]*choice_index: 1/
		)
		expect((caught as Error).cause).toBe(cause)
	})
})
