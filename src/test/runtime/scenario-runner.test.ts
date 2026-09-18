import { describe, expect, it, vi } from 'vitest'
import type { CheckmateDriverV1, DriverSession, DriverStartInput } from '../../driver.js'
import { DiagnosticSanitizer } from '../../redaction/diagnostic-sanitizer.js'
import { silentLogger } from '../../logging/types.js'
import { ScenarioControl } from '../../runtime/scenario-control.js'
import { createDriverEvidenceSink, EvidenceAttribution, runScenario } from '../../runtime/scenario-runner.js'
import { ScenarioState } from '../../runtime/scenario-state.js'
import { ScenarioUsageTracker } from '../../runtime/usage-tracker.js'
import type { InternalStepReport } from '../../runtime/types.js'
import { createStore, descriptor, request, temporaryRoot } from '../evidence/helpers.js'

describe('scenario runner', () => {
	it.each(['*', ['browser_extract']] as const)(
		'supplies frozen tool permissions and invocation sanitization for %s',
		async (allowedTools) => {
			const temporary = await temporaryRoot()
			const control = new ScenarioControl({ timeoutMs: 2000 })
			try {
				const store = await createStore(temporary.root)
				const plan = prepared(temporary.root)
				const start = vi.fn<(input: DriverStartInput) => Promise<DriverSession>>(async () =>
					fixtureSession(async () => {})
				)
				await runScenario({
					driver: { id: 'fixture', driverContractVersion: 1, start },
					prepared: {
						...plan,
						driver: {
							...plan.driver,
							allowedTools,
							descriptor: {
								...descriptor,
								driverContractVersion: 1,
								tools: [{ name: 'browser_extract' }, { name: 'browser_diagnostics' }],
							},
						},
					},
					state: scenarioState(store),
					control,
					store,
					usageTracker: new ScenarioUsageTracker(),
					secretValues: secretValues(),
					apiKey: 'provider-secret',
					exactSecrets: ['provider-secret'],
					logger: silentLogger,
					sanitizer: new DiagnosticSanitizer(['provider-secret']),
					createRunner: () => ({
						run: async (step) => report(step.id, 'met-expectation'),
						teardown: async () => {},
					}),
				})
				const input = start.mock.calls[0][0]
				expect(input.allowlistedTools).toEqual(
					allowedTools === '*' ? ['browser_extract', 'browser_diagnostics'] : ['browser_extract']
				)
				expect(Object.isFrozen(input.allowlistedTools)).toBe(true)
				expect(input.diagnostics.sanitizeText('provider-secret Bearer credential-token')).not.toMatch(
					/provider-secret|credential-token/
				)
			} finally {
				control.dispose()
				await temporary.cleanup()
			}
		}
	)

	it('uses one session, stops on the first failure, and attempts both cleanup callbacks', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const close = vi.fn(async () => undefined)
			const teardown = vi.fn(async () => undefined)
			const session = fixtureSession(close)
			const driver: CheckmateDriverV1 = {
				id: 'fixture',
				driverContractVersion: 1,
				start: vi.fn(async () => session),
			}
			const control = new ScenarioControl({ timeoutMs: 2_000 })
			const state = scenarioState(store)
			const run = vi.fn(async (step) => report(step.id, 'failed-expectation'))

			await runScenario({
				driver,
				prepared: prepared(temporary.root),
				state,
				control,
				store,
				usageTracker: new ScenarioUsageTracker(),
				secretValues: new Map([
					['provider-key', 'provider-secret'],
					['fixture-session', 'session-secret'],
				]),
				apiKey: 'provider-secret',
				exactSecrets: ['provider-secret', 'session-secret'],
				logger: silentLogger,
				sanitizer: new DiagnosticSanitizer(['provider-secret', 'session-secret']),
				createRunner: () => ({ run, teardown }),
			})

			expect(driver.start).toHaveBeenCalledOnce()
			expect(vi.mocked(driver.start).mock.calls[0][0]).toHaveProperty('allowlistedTools')
			expect(vi.mocked(driver.start).mock.calls[0][0]).toHaveProperty('diagnostics')
			expect(run).toHaveBeenCalledOnce()
			expect(teardown).toHaveBeenCalledOnce()
			expect(close).toHaveBeenCalledOnce()
			expect(candidate(state).steps).toEqual([
				expect.objectContaining({ id: 'open-cart', status: 'failed' }),
				{ id: 'apply-promo', status: 'not-run', reason: 'prior-step-failed', blockedBy: 'open-cart' },
			])
			control.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('lets cleanup failure override the top-level route without erasing the step', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const close = vi.fn(async () => {
				throw new Error('close failed')
			})
			const teardown = vi.fn(async () => {
				throw new Error('teardown failed')
			})
			const control = new ScenarioControl({ timeoutMs: 2_000 })
			const state = scenarioState(store)
			await runScenario({
				driver: { id: 'fixture', driverContractVersion: 1, start: async () => fixtureSession(close) },
				prepared: prepared(temporary.root),
				state,
				control,
				store,
				usageTracker: new ScenarioUsageTracker(),
				secretValues: new Map([
					['provider-key', 'provider-secret'],
					['fixture-session', 'session-secret'],
				]),
				apiKey: 'provider-secret',
				exactSecrets: [],
				logger: silentLogger,
				sanitizer: new DiagnosticSanitizer([]),
				createRunner: () => ({ run: async (step) => report(step.id, 'met-expectation'), teardown }),
			})

			expect(candidate(state)).toMatchObject({
				category: 'infra',
				reason: 'driver-teardown-failed',
				steps: [expect.objectContaining({ status: 'passed' }), expect.objectContaining({ status: 'passed' })],
			})
			expect(teardown).toHaveBeenCalledOnce()
			expect(close).toHaveBeenCalledOnce()
			control.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('latches interruption raised during cleanup', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const external = new AbortController()
			const timers = manualTimers()
			const control = new ScenarioControl({
				timeoutMs: 2_000,
				signal: external.signal,
				setTimer: timers.setTimer,
				clearTimer: timers.clearTimer,
			})
			const state = scenarioState(store)
			const close = vi.fn(async ({ signal }: Parameters<DriverSession['close']>[0]) => {
				expect(signal.aborted).toBe(true)
			})
			await runScenario({
				driver: {
					id: 'fixture',
					driverContractVersion: 1,
					start: async () => fixtureSession(close),
				},
				prepared: prepared(temporary.root),
				state,
				control,
				store,
				usageTracker: new ScenarioUsageTracker(),
				secretValues: secretValues(),
				apiKey: 'provider-secret',
				exactSecrets: [],
				logger: silentLogger,
				sanitizer: new DiagnosticSanitizer([]),
				createRunner: () => ({
					run: async (step) => report(step.id, 'met-expectation'),
					teardown: async () => {
						timers.callbacks[0]!()
						external.abort('test interruption')
					},
				}),
			})

			expect(candidate(state)).toMatchObject({ status: 'interrupted', category: 'infra', reason: 'interrupted' })
			expect(close).toHaveBeenCalledOnce()
			control.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('lets normal cleanup cross the scenario deadline under its fresh cleanup deadline', async () => {
		const temporary = await temporaryRoot()
		try {
			let time = 0
			const timers = manualTimers()
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const close = vi.fn(async ({ signal }: Parameters<DriverSession['close']>[0]) => {
				expect(signal.aborted).toBe(false)
			})
			const control = new ScenarioControl({
				timeoutMs: 50,
				now: () => time,
				setTimer: timers.setTimer,
				clearTimer: timers.clearTimer,
			})
			const state = scenarioState(store)

			await runScenario({
				driver: { id: 'fixture', driverContractVersion: 1, start: async () => fixtureSession(close) },
				prepared: prepared(temporary.root),
				state,
				control,
				store,
				usageTracker: new ScenarioUsageTracker(),
				secretValues: secretValues(),
				apiKey: 'provider-secret',
				exactSecrets: [],
				logger: silentLogger,
				sanitizer: new DiagnosticSanitizer([]),
				now: () => time,
				createRunner: () => ({
					run: async (step) => report(step.id, 'met-expectation'),
					teardown: async () => {
						time = 60
						timers.callbacks[0]!()
					},
				}),
			})

			expect(candidate(state)).toMatchObject({
				status: 'passed',
				category: 'passed',
				reason: 'scenario-complete',
			})
			expect(close).toHaveBeenCalledOnce()
			control.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('dispatches both cleanup callbacks when the first synchronously exhausts the shared deadline', async () => {
		const temporary = await temporaryRoot()
		try {
			let time = 0
			const now = () => time
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const close = vi.fn(async () => undefined)
			const teardown = vi.fn(() => {
				time = 200
			})
			const control = new ScenarioControl({ timeoutMs: 2_000, now })
			const state = scenarioState(store)

			await runScenario({
				driver: { id: 'fixture', driverContractVersion: 1, start: async () => fixtureSession(close) },
				prepared: prepared(temporary.root),
				state,
				control,
				store,
				usageTracker: new ScenarioUsageTracker(),
				secretValues: secretValues(),
				apiKey: 'provider-secret',
				exactSecrets: [],
				logger: silentLogger,
				sanitizer: new DiagnosticSanitizer([]),
				now,
				createRunner: () => ({
					run: async (step) => report(step.id, 'met-expectation'),
					teardown: teardown as unknown as () => Promise<void>,
				}),
			})

			expect(teardown).toHaveBeenCalledOnce()
			expect(close).toHaveBeenCalledOnce()
			expect(candidate(state).reason).toBe('driver-teardown-failed')
			control.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('turns unexpected runner errors into an executed internal-error step with known usage', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const finalizeStep = vi.spyOn(store, 'finalizeStep')
			const usageTracker = new ScenarioUsageTracker()
			const control = new ScenarioControl({ timeoutMs: 2_000 })
			const state = scenarioState(store)

			await runScenario({
				driver: {
					id: 'fixture',
					driverContractVersion: 1,
					start: async () => fixtureSession(vi.fn(async () => undefined)),
				},
				prepared: prepared(temporary.root),
				state,
				control,
				store,
				usageTracker,
				secretValues: secretValues(),
				apiKey: 'provider-secret',
				exactSecrets: [],
				logger: silentLogger,
				sanitizer: new DiagnosticSanitizer([]),
				createRunner: () => ({
					async run() {
						usageTracker.record({ prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } as never)
						throw new Error('runner failed unexpectedly')
					},
					teardown: async () => undefined,
				}),
			})

			const result = candidate(state)
			expect(result).toMatchObject({ category: 'infra', reason: 'internal-error' })
			expect(result.steps[0]).toMatchObject({
				id: 'open-cart',
				status: 'failed',
				category: 'infra',
				reason: 'internal-error',
				usage: { totalTokens: 3 },
			})
			expect(result.steps[1]).toEqual({
				id: 'apply-promo',
				status: 'not-run',
				reason: 'prior-step-failed',
				blockedBy: 'open-cart',
			})
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: 'scenario.internal-error', path: '/scenario/steps/0' })
			)
			expect(finalizeStep).toHaveBeenCalledTimes(1)
			control.dispose()
		} finally {
			await temporary.cleanup()
		}
	})

	it('cuts off implicit step attribution when runner.run settles', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
			})
			await store.writeInvocation(request)
			const attribution = new EvidenceAttribution()
			const sink = createDriverEvidenceSink(store, attribution, silentLogger)

			attribution.beginStep('open-cart')
			await sink.capture({ kind: 'aria-snapshot', mediaType: 'application/yaml', content: 'before: settle' })
			attribution.endStep('open-cart')
			await sink.capture({ kind: 'aria-snapshot', mediaType: 'application/yaml', content: 'after: settle' })
			await store.finalizeStep('open-cart', 'passed')
			await expect(
				sink.capture({
					stepId: 'open-cart',
					kind: 'aria-snapshot',
					mediaType: 'application/yaml',
					content: 'explicit: late',
				})
			).rejects.toThrow("Evidence for step 'open-cart' is already finalized")
			await store.finalizeScenario('passed')

			expect(store.committedReferences).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: 'aria-snapshot', stepId: 'open-cart' }),
					expect.not.objectContaining({ stepId: 'open-cart' }),
				])
			)
		} finally {
			await temporary.cleanup()
		}
	})
})

function fixtureSession(close: DriverSession['close']): DriverSession {
	return {
		tools: [],
		instructions: [],
		buildInitialContext: async () => [],
		handleToolResponses: async () => [],
		close,
	}
}

function report(stepId: string, reason: 'met-expectation' | 'failed-expectation'): InternalStepReport {
	return {
		step: { id: stepId, action: 'act', expect: 'done' },
		outcome: reason === 'met-expectation' ? ('passed' as const) : ('failed' as const),
		category: 'app' as const,
		reason,
		actual: 'observed',
		turns: 1,
		durationMs: 10,
		usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2 },
		toolCalls: [],
		transcript: [],
		diagnostics: [],
	}
}

function prepared(root: string): import('../../api/prepare-run.js').PreparedRun {
	return {
		invocationRoot: root,
		outputDirectory: `${root}/.checkmate/runs`,
		request,
		policy: {
			id: 'ci',
			bounds: limits(),
			evidence: { retention: 'retain-on-failure', redaction: 'on', allowOpaque: false },
		},
		modelEgress: {
			provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider-key' },
			textRedaction: 'on',
			allowOpaque: false,
			maxStepBytes: 1_000,
			maxMessageBytes: 1_000,
		},
		effectiveLimits: limits(),
		secretBindings: {
			'provider-key': { source: 'environment', name: 'PROVIDER' },
			'fixture-session': { source: 'environment', name: 'SESSION' },
		},
		driver: {
			id: 'fixture',
			packageName: 'fixture',
			descriptor,
			settings: {},
			target: {},
			allowedTools: '*',
			secretBindings: { session: 'fixture-session' },
		},
	}
}

function limits() {
	return {
		scenarioTimeoutMs: 2_000,
		stepTimeoutMs: 1_000,
		turnsPerStep: 3,
		requestTimeoutMs: 500,
		maxRetries: 0,
		loopMaxRepetitions: 2,
		cleanupTimeoutMs: 100,
	}
}

function scenarioState(store: Awaited<ReturnType<typeof createStore>>): ScenarioState {
	return new ScenarioState({
		request,
		identity: store.runIdentity,
		driver: { id: 'fixture', contractVersion: 1 },
		policy: { id: 'ci', effectiveLimits: limits() },
	})
}

function candidate(state: ScenarioState) {
	return state.buildCandidateResult({
		usage: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0, state: 'unavailable' },
		evidence: { state: 'complete', references: [] },
	})
}

function secretValues(): Map<string, string> {
	return new Map([
		['provider-key', 'provider-secret'],
		['fixture-session', 'session-secret'],
	])
}

function manualTimers(): {
	callbacks: Array<() => void>
	setTimer: typeof setTimeout
	clearTimer: typeof clearTimeout
} {
	const callbacks: Array<() => void> = []
	const setTimer = ((callback: Parameters<typeof setTimeout>[0]) => {
		if (typeof callback !== 'function') throw new Error('Expected a timer callback')
		callbacks.push(callback)
		return callbacks.length as unknown as ReturnType<typeof setTimeout>
	}) as typeof setTimeout
	const clearTimer = (() => undefined) as typeof clearTimeout
	return { callbacks, setTimer, clearTimer }
}
