import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type { ChatCompletion, ChatCompletionAssistantMessageParam } from 'openai/resources/chat/completions'
import type { DriverDescriptorV1, ModelEgressPolicyV1 } from '../../contracts/types'
import { defineDriverTool, type DriverSession, type DriverToolContext } from '../../driver'
import { generationRequest, generationSession, structuredResponse } from '../fixtures/structured-generation'
import { ScenarioUsageTracker } from '../../runtime/usage-tracker'
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
		sendStructured?: ReturnType<typeof vi.fn>
		usageTracker?: ScenarioUsageTracker
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
		aiClient: { send, sendStructured: options.sendStructured } as never,
		usageTracker: options.usageTracker,
	})
}

describe('driver-backed step execution', () => {
	afterEach(() => vi.useRealTimers())

	it('attributes combined outer and nested usage to each ordered step and revokes old callbacks', async () => {
		const callbacks: DriverToolContext['generateStructured'][] = []
		const session = generationSession(async (context) => {
			callbacks.push(context.generateStructured)
			await context.generateStructured(generationRequest)
			return JSON.stringify((await context.generateStructured(generationRequest)).value)
		})
		const send = vi.fn()
		for (let index = 0; index < 2; index++) {
			send.mockResolvedValueOnce(response('fixture_action', {})).mockResolvedValueOnce(
				response('pass_test_step', { actualResult: 'ready' })
			)
		}
		const sendStructured = vi.fn().mockResolvedValue(structuredResponse())
		const usageTracker = new ScenarioUsageTracker()
		const runner = runnerWith(session, send, { sendStructured, usageTracker })
		const scenario = new ScenarioControl({ timeoutMs: 5000 })
		for (const id of ['first', 'second']) {
			const report = await runner.run(
				{ id, action: 'inspect', expect: 'ready' },
				scenario.createStepControl(1000)
			)
			expect(report).toMatchObject({ outcome: 'passed', usage: { totalTokens: 20, cachedPromptTokens: 6 } })
			await expect(callbacks[0](generationRequest)).rejects.toThrow('scope ended')
		}
		expect(usageTracker.usage()).toMatchObject({ totalTokens: 40, cachedPromptTokens: 12 })
		expect(sendStructured).toHaveBeenCalledTimes(4)
		scenario.dispose()
	})

	it.each(['budget', 'provider', 'output', 'usage', 'browser'] as const)(
		'preserves the authoritative %s failure through swallowed errors',
		async (mode) => {
			const sendStructured = vi.fn().mockResolvedValue(structuredResponse())
			if (mode === 'provider') sendStructured.mockRejectedValue(new Error('provider rejected request'))
			if (mode === 'output') sendStructured.mockResolvedValue(structuredResponse('invalid'))
			if (mode === 'usage') sendStructured.mockResolvedValue({ ...structuredResponse(), usage: undefined })
			const session = generationSession(async ({ generateStructured }) => {
				if (mode === 'browser') throw new Error('ordinary browser failure')
				await generateStructured(generationRequest).catch((): void => undefined)
				await generateStructured(generationRequest).catch((): void => undefined)
				return 'swallowed failure'
			})
			const send = vi
				.fn()
				.mockResolvedValueOnce(response('fixture_action', {}))
				.mockResolvedValueOnce(response('pass_test_step', { actualResult: 'must not pass' }))
			const runner = runnerWith(session, send, {
				sendStructured,
				budgetTokens: mode === 'budget' ? 5 : 100,
			})
			const scenario = new ScenarioControl({ timeoutMs: 5000 })
			const report = await runner.run(
				{ id: 'failure', action: 'inspect', expect: 'ready' },
				scenario.createStepControl(1000)
			)
			expect(report).toMatchObject({
				outcome: 'failed',
				reason:
					mode === 'budget' ? 'token-budget-exceeded' : mode === 'browser' ? 'tool-error' : 'provider-error',
			})
			expect(send).toHaveBeenCalledOnce()
			expect(sendStructured).toHaveBeenCalledTimes(mode === 'browser' ? 0 : 1)
			if (mode === 'budget' || mode === 'output') expect(report.usage.totalTokens).toBe(10)
			scenario.dispose()
		}
	)

	it('preserves a nested budget failure when the driver throws a different error', async () => {
		const session = generationSession(async ({ generateStructured }) => {
			try {
				await generateStructured(generationRequest)
			} catch {
				throw new Error('RPC replaced the original failure')
			}
			return 'unreachable'
		})
		const send = vi.fn().mockResolvedValue(response('fixture_action', {}))
		const runner = runnerWith(session, send, {
			budgetTokens: 5,
			sendStructured: vi.fn().mockResolvedValue(structuredResponse()),
		})
		const scenario = new ScenarioControl({ timeoutMs: 5000 })
		const report = await runner.run(
			{ id: 'replace', action: 'inspect', expect: 'ready' },
			scenario.createStepControl(1000)
		)
		expect(report).toMatchObject({ reason: 'token-budget-exceeded', usage: { totalTokens: 10 } })
		expect(send).toHaveBeenCalledOnce()
		scenario.dispose()
	})

	it('fails and aborts generation that a driver starts without awaiting', async () => {
		let settle!: (value: ReturnType<typeof structuredResponse>) => void
		const sendStructured = vi.fn(
			(_request, options) =>
				new Promise((resolve) => {
					settle = resolve
					expect(options.signal.aborted).toBe(false)
				})
		)
		const session = generationSession(async ({ generateStructured }) => {
			void generateStructured(generationRequest)
			return 'premature success'
		})
		const send = vi.fn().mockResolvedValue(response('fixture_action', {}))
		const usageTracker = new ScenarioUsageTracker()
		const runner = runnerWith(session, send, { sendStructured, usageTracker })
		const scenario = new ScenarioControl({ timeoutMs: 5000 })
		const report = await runner.run(
			{ id: 'unawaited', action: 'inspect', expect: 'ready' },
			scenario.createStepControl(1000)
		)
		expect(report).toMatchObject({ reason: 'provider-error', usage: { totalTokens: 3 } })
		expect(sendStructured.mock.calls[0][1].signal.aborted).toBe(true)
		settle(structuredResponse())
		await Promise.resolve()
		expect(usageTracker.usage().totalTokens).toBe(3)
		expect(send).toHaveBeenCalledOnce()
		scenario.dispose()
	})

	it('ends pending nested work at the tool deadline without late usage mutation', async () => {
		vi.useFakeTimers()
		let settle!: (value: ReturnType<typeof structuredResponse>) => void
		const sendStructured = vi.fn(
			() =>
				new Promise((resolve) => {
					settle = resolve
				})
		)
		const session = generationSession(async ({ generateStructured }) =>
			JSON.stringify(await generateStructured(generationRequest))
		)
		const usageTracker = new ScenarioUsageTracker()
		const runner = runnerWith(session, vi.fn().mockResolvedValue(response('fixture_action', {})), {
			sendStructured,
			usageTracker,
		})
		const scenario = new ScenarioControl({ timeoutMs: 5000 })
		const pending = runner.run(
			{ id: 'timeout', action: 'inspect', expect: 'ready' },
			scenario.createStepControl(1000)
		)
		await vi.advanceTimersByTimeAsync(1000)
		const report = await pending
		expect(report).toMatchObject({ reason: 'step-timeout', usage: { totalTokens: 3 } })
		settle(structuredResponse())
		await vi.advanceTimersByTimeAsync(0)
		expect(usageTracker.usage().totalTokens).toBe(3)
		scenario.dispose()
	})

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

	it('uses the invocation clock for a real initial-context driver deadline', async () => {
		let time = 0
		const buildInitialContext = vi.fn(async () => {
			time = 101
			return []
		})
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
			buildInitialContext,
			handleToolResponses: async () => [],
			close: async () => undefined,
		}
		const send = vi.fn()
		const runner = runnerWith(session, send)
		const scenario = new ScenarioControl({ timeoutMs: 1_000, now: () => time })

		const report = await runner.run(
			{ id: 'custom-clock', action: 'act', expect: 'done' },
			scenario.createStepControl(100)
		)

		expect(report).toMatchObject({
			outcome: 'failed',
			category: 'model',
			reason: 'step-timeout',
			durationMs: 101,
		})
		expect(buildInitialContext).toHaveBeenCalledOnce()
		expect(send).not.toHaveBeenCalled()
		scenario.dispose()
	})

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
			now: Date.now,
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
