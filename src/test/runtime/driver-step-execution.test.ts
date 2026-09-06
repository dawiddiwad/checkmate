import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type { ChatCompletion, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions'
import type { DriverDescriptorV1, ModelEgressPolicyV1 } from '../../contracts/types'
import { defineDriverTool, type DriverSession } from '../../driver'
import { createDriverRunner } from '../../runtime/runner'
import { ScenarioControl } from '../../runtime/scenario-control'
import type { RuntimeLogger } from '../../logging/types'
import type { StepControl } from '../../runtime/scenario-control'

const descriptor: DriverDescriptorV1 = {
	schemaVersion: 1,
	id: 'fixture',
	driverContractVersion: 1,
	targetSchema: { type: 'object' },
	settingsSchema: { type: 'object' },
	requiredSecretSlots: [],
	tools: [{ name: 'fixture_action' }],
	evidenceKinds: [],
}

const modelEgress: ModelEgressPolicyV1 = {
	provider: { id: 'openai', model: 'fixture-model', apiKeyBinding: 'provider-key' },
	textRedaction: 'on',
	allowOpaque: false,
	maxStepBytes: 1024 * 1024,
	maxMessageBytes: 256 * 1024,
}

function response(name: string, args: unknown, usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }) {
	return {
		response: {
			id: `response-${name}`,
			object: 'chat.completion',
			created: 0,
			model: 'fixture-model',
			choices: [
				{
					index: 0,
					logprobs: null,
					finish_reason: 'tool_calls',
					message: {
						role: 'assistant',
						content: null,
						refusal: null,
						tool_calls: [
							{
								id: `call-${name}`,
								type: 'function',
								function: { name, arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
			usage,
		} as ChatCompletion,
		assistantMessages: [] as ChatCompletionAssistantMessageParam[],
	}
}

function runnerWith(
	session: DriverSession,
	send: ReturnType<typeof vi.fn>,
	options: {
		budgetTokens?: number
		logger?: RuntimeLogger
		exactSecrets?: string[]
		textRedaction?: 'on' | 'off'
	} = {}
) {
	return createDriverRunner({
		driverId: 'fixture',
		descriptor,
		session,
		allowedTools: '*',
		modelEgress: { ...modelEgress, textRedaction: options.textRedaction ?? 'on' },
		limits: {
			turnsPerStep: 5,
			stepTimeoutMs: 1_000,
			requestTimeoutMs: 1_000,
			maxRetries: 0,
			loopMaxRepetitions: 3,
			budgetTokens: options.budgetTokens,
		},
		apiKey: 'fixture-key',
		exactSecrets: options.exactSecrets,
		logger: options.logger,
		aiClient: { send } as never,
	})
}

describe('driver-backed step execution', () => {
	afterEach(() => vi.useRealTimers())

	it('keeps a returned driver error model-visible and lets a private result tool finish', async () => {
		const execute = vi.fn(() => ({ response: 'target rejected the action', status: 'error' as const }))
		const session: DriverSession = {
			tools: [
				defineDriverTool({
					name: 'fixture_action',
					description: 'act',
					schema: z.object({}).strict(),
					handler: execute,
				}),
			],
			instructions: ['Use the fixture tool.'],
			buildInitialContext: vi.fn(async () => [{ content: 'initial state', ephemeral: true }]),
			handleToolResponses: vi.fn(async () => [{ content: 'fresh state', ephemeral: true }]),
			close: vi.fn(async () => undefined),
		}
		const send = vi
			.fn()
			.mockResolvedValueOnce(response('fixture_action', {}))
			.mockResolvedValueOnce(response('pass_test_step', { actualResult: 'recovered' }))
		const runner = runnerWith(session, send)
		const scenario = new ScenarioControl({ timeoutMs: 2_000 })

		const report = await runner.run(
			{ id: 'recover', action: 'perform the action', expect: 'the target accepts it' },
			scenario.createStepControl(1_000)
		)

		expect(report).toMatchObject({ outcome: 'passed', reason: 'met-expectation', actual: 'recovered', turns: 2 })
		expect(report.toolCalls[0]).toMatchObject({ driverId: 'fixture', name: 'fixture_action', status: 'error' })
		expect(report.usage.totalTokens).toBe(6)
		expect(session.handleToolResponses).toHaveBeenCalledOnce()
		scenario.dispose()
	})

	it('classifies a thrown driver tool as infrastructure', async () => {
		const session: DriverSession = {
			tools: [
				defineDriverTool({
					name: 'fixture_action',
					description: 'act',
					schema: z.object({}).strict(),
					handler: () => {
						throw new Error('driver broke')
					},
				}),
			],
			instructions: [],
			buildInitialContext: async () => [],
			handleToolResponses: async () => [],
			close: async () => undefined,
		}
		const runner = runnerWith(session, vi.fn().mockResolvedValue(response('fixture_action', {})))
		const scenario = new ScenarioControl({ timeoutMs: 2_000 })
		const report = await runner.run(
			{ id: 'broken', action: 'act', expect: 'done' },
			scenario.createStepControl(1_000)
		)

		expect(report).toMatchObject({ outcome: 'failed', category: 'infra', reason: 'tool-error' })
		expect(report.actual).toContain('driver broke')
		scenario.dispose()
	})

	it('includes the budget-crossing response and uses the explicit token reason', async () => {
		const session: DriverSession = {
			tools: [
				defineDriverTool({
					name: 'fixture_action',
					description: 'act',
					schema: z.object({}),
					handler: () => 'ok',
				}),
			],
			instructions: [],
			buildInitialContext: async () => [],
			handleToolResponses: async () => [],
			close: async () => undefined,
		}
		const runner = runnerWith(session, vi.fn().mockResolvedValue(response('fixture_action', {})), {
			budgetTokens: 2,
		})
		const scenario = new ScenarioControl({ timeoutMs: 2_000 })
		const report = await runner.run(
			{ id: 'budget', action: 'act', expect: 'done' },
			scenario.createStepControl(1_000)
		)

		expect(report).toMatchObject({ reason: 'token-budget-exceeded', usage: { totalTokens: 3 } })
		scenario.dispose()
	})

	it.each(['initial-context', 'tool', 'post-tool-context'] as const)(
		'classifies a deadline spent inside %s as a model step timeout',
		async (boundary) => {
			vi.useFakeTimers()
			const never = () => new Promise<never>(() => undefined)
			const session: DriverSession = {
				tools: [
					defineDriverTool({
						name: 'fixture_action',
						description: 'act',
						schema: z.object({}),
						handler: boundary === 'tool' ? never : () => 'ok',
					}),
				],
				instructions: [],
				buildInitialContext: boundary === 'initial-context' ? never : async () => [],
				handleToolResponses: boundary === 'post-tool-context' ? never : async () => [],
				close: async () => undefined,
			}
			const runner = runnerWith(session, vi.fn().mockResolvedValue(response('fixture_action', {})))
			const scenario = new ScenarioControl({ timeoutMs: 10_000 })
			const result = runner.run(
				{ id: boundary, action: 'act', expect: 'done' },
				scenario.createStepControl(1_000)
			)

			await vi.advanceTimersByTimeAsync(1_000)
			await expect(result).resolves.toMatchObject({
				outcome: 'failed',
				category: 'model',
				reason: 'step-timeout',
				diagnostics: [{ code: 'expired-boundary' }],
			})
			scenario.dispose()
		}
	)

	it.each([
		['partial', { prompt_tokens: 2, total_tokens: 2 }],
		['malformed', { prompt_tokens: 2, completion_tokens: -1, total_tokens: 1 }],
	] as const)('classifies %s provider usage as provider infrastructure failure', async (_name, usage) => {
		const execute = vi.fn(() => 'ok')
		const session = fixtureSession(execute)
		const runner = runnerWith(session, vi.fn().mockResolvedValue(response('fixture_action', {}, usage as never)))
		const scenario = new ScenarioControl({ timeoutMs: 2_000 })

		const report = await runner.run(
			{ id: 'usage', action: 'act', expect: 'done' },
			scenario.createStepControl(1_000)
		)

		expect(report).toMatchObject({ outcome: 'failed', category: 'infra', reason: 'provider-error' })
		expect(report.actual).toContain('invalid usage')
		expect(execute).not.toHaveBeenCalled()
		scenario.dispose()
	})

	it.each([
		['step-timeout', false],
		['interrupted', true],
	] as const)('rejects provider fulfillment after %s while retaining its usage', async (reason, aborted) => {
		let fulfilled = false
		const controller = new AbortController()
		const control: StepControl = {
			signal: controller.signal,
			deadline: Date.now() + 1_000,
			poll: () => (fulfilled ? { expired: true, reason } : { expired: false }),
			dispose: vi.fn(),
		}
		const send = vi.fn(async () => {
			fulfilled = true
			if (aborted) controller.abort('interrupted')
			return response('fixture_action', {})
		})
		const runner = runnerWith(fixtureSession(vi.fn(() => 'ok')), send)

		const report = await runner.run({ id: 'late', action: 'act', expect: 'done' }, control)

		expect(report).toMatchObject({ outcome: 'failed', reason, usage: { totalTokens: 3 } })
	})

	it('sanitizes exact secrets in errors, causes, and logs even when content redaction is off', async () => {
		const logs: string[] = []
		const logger = Object.fromEntries(
			(['debug', 'info', 'warn', 'error'] as const).map((level) => [
				level,
				(message: string) => logs.push(message),
			])
		) as RuntimeLogger
		const deepCause = new Error('deep cause includes driver-secret')
		const thrown = new Error('driver failed with fixture-key', { cause: deepCause })
		const session = fixtureSession(
			() => {
				throw thrown
			},
			z.object({ value: z.string() }).strict()
		)
		const runner = runnerWith(
			session,
			vi.fn().mockResolvedValue(response('fixture_action', { value: 'driver-secret' })),
			{
				logger,
				exactSecrets: ['driver-secret'],
				textRedaction: 'off',
			}
		)
		const scenario = new ScenarioControl({ timeoutMs: 2_000 })

		const report = await runner.run(
			{ id: 'sanitize', action: 'act', expect: 'done' },
			scenario.createStepControl(1_000)
		)

		expect(report).toMatchObject({ category: 'infra', reason: 'tool-error' })
		expect(report.actual).toContain('[secret omitted]')
		expect(report.actual).not.toContain('fixture-key')
		expect(report.actual).not.toContain('driver-secret')
		expect(report.actual).toContain('caused by:')
		expect(report.diagnostics.every((diagnostic) => !diagnostic.message.includes('driver-secret'))).toBe(true)
		expect(logs.join('\n')).toContain('[secret omitted]')
		expect(logs.join('\n')).not.toContain('driver-secret')
		scenario.dispose()
	})

	it('borrows the driver session and never competes with the scenario cleanup owner', async () => {
		const session = fixtureSession(vi.fn(() => 'ok'))
		const runner = runnerWith(session, vi.fn())
		await runner.teardown()
		expect(session.close).not.toHaveBeenCalled()
	})
})

function fixtureSession(
	handler: (...args: never[]) => unknown,
	schema: z.ZodType = z.object({}).strict()
): DriverSession {
	return {
		tools: [
			defineDriverTool({
				name: 'fixture_action',
				description: 'act',
				schema,
				handler: handler as never,
			}),
		],
		instructions: [],
		buildInitialContext: async () => [],
		handleToolResponses: async () => [],
		close: vi.fn(async () => undefined),
	}
}
