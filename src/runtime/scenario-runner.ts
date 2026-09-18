import type { Diagnostic, ExecutedStepResult } from '../contracts/types.js'
import type { CheckmateDriverV1, DriverEvidenceSink, DriverSecretReader, DriverSession, StepIntent } from '../driver.js'
import { EvidenceCaptureError, type EvidenceStore } from '../evidence/store.js'
import type { RuntimeLogger } from '../logging/types.js'
import type { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'
import { createDriverRunner, type DriverCheckmateRunnerOptions } from './runner.js'
import { awaitDriverBoundary, DriverBoundaryError } from './driver-boundary.js'
import { adaptStepResult } from './result-adapter.js'
import type { ScenarioControl } from './scenario-control.js'
import type { ScenarioState } from './scenario-state.js'
import type { InternalStepReport } from './types.js'
import type { ScenarioUsageTracker } from './usage-tracker.js'

export type ScenarioStepRunner = Readonly<{
	run(step: StepIntent, control: ReturnType<ScenarioControl['createStepControl']>): Promise<InternalStepReport>
	teardown(): Promise<void>
}>

export type ScenarioRunnerFactory = (options: DriverCheckmateRunnerOptions) => ScenarioStepRunner

export type RunScenarioOptions = Readonly<{
	driver: CheckmateDriverV1
	prepared: import('../api/prepare-run.js').PreparedRun
	state: ScenarioState
	control: ScenarioControl
	store: EvidenceStore
	usageTracker: ScenarioUsageTracker
	secretValues: ReadonlyMap<string, string>
	apiKey: string
	exactSecrets: readonly string[]
	logger: RuntimeLogger
	sanitizer: DiagnosticSanitizer
	createRunner?: ScenarioRunnerFactory
	now?: () => number
	onCleanupStarted?: () => void
}>

export async function runScenario(options: RunScenarioOptions): Promise<void> {
	let session: DriverSession | undefined
	let runner: ScenarioStepRunner | undefined
	const attribution = new EvidenceAttribution()
	const now = options.now ?? Date.now

	try {
		session = await scenarioBoundary('driver-start', options.control, now, (signal) => {
			const input = {
				target: structuredClone(options.prepared.driver.target),
				settings: structuredClone(options.prepared.driver.settings),
				secrets: driverSecretReader(options.prepared.driver.secretBindings, options.secretValues),
				evidence: createDriverEvidenceSink(options.store, attribution, options.logger),
				logger: options.logger,
				signal,
			}
			const allowed = options.prepared.driver.allowedTools
			return options.driver.start({
				...input,
				allowlistedTools: Object.freeze(
					options.prepared.driver.descriptor.tools
						.map((tool) => tool.name)
						.filter((name) => allowed.includes('*') || allowed.includes(name))
				),
				diagnostics: Object.freeze({ sanitizeText: (value: string) => options.sanitizer.text(value) }),
			})
		})
		try {
			runner = (options.createRunner ?? createDriverRunner)({
				driverId: options.prepared.driver.id,
				descriptor: options.prepared.driver.descriptor,
				session,
				allowedTools: options.prepared.driver.allowedTools,
				modelEgress: options.prepared.modelEgress,
				limits: options.prepared.effectiveLimits,
				apiKey: options.apiKey,
				exactSecrets: options.exactSecrets,
				logger: options.logger,
				usageTracker: options.usageTracker,
			})
		} catch (error) {
			options.state.recordLifecycleFailure(
				'driver-start-failed',
				diagnostic('driver.start-failed', '/driver', error, options.sanitizer)
			)
			options.state.markNotStarted()
			return
		}

		for (const [stepIndex, step] of options.prepared.request.scenario.steps.entries()) {
			const expired = options.control.poll()
			if (expired.expired) {
				options.state.recordLifecycleFailure(
					expired.reason,
					diagnostic('scenario.expired', '', expired.reason, options.sanitizer)
				)
				options.state.markNotStarted()
				break
			}

			const intent = { id: step.id, action: step.action, expect: step.expect }
			const checkpoint = options.usageTracker.beginStep()
			const startedAt = now()
			const stepControl = options.control.createStepControl(options.prepared.effectiveLimits.stepTimeoutMs)
			let report: InternalStepReport | undefined
			let finalizationStarted = false
			try {
				attribution.beginStep(step.id)
				try {
					report = await runner.run(intent, stepControl)
				} finally {
					attribution.endStep(step.id)
				}
				const adapted = adaptStepResult(report)
				for (const candidate of adapted.evidence) {
					try {
						options.store.captureHarnessStep(candidate)
					} catch (error) {
						options.store.recordCaptureFailure(candidate.kind, error)
					}
				}
				finalizationStarted = true
				await options.store.finalizeStep(step.id, adapted.result.status)
				options.state.recordStep(adapted.result, report.diagnostics)
			} catch (error) {
				const failure = internalErrorStep(intent, stepIndex, report, checkpoint, startedAt, now, options, error)
				if (!finalizationStarted) {
					finalizationStarted = true
					try {
						await options.store.finalizeStep(step.id, 'failed')
					} catch (finalizationError) {
						failure.diagnostics.push(
							diagnostic('evidence.finalize-failed', '/evidence', finalizationError, options.sanitizer)
						)
					}
				}
				options.state.recordStep(failure.result, failure.diagnostics)
			} finally {
				attribution.endStep(step.id)
				stepControl.dispose()
			}

			await options.store.replaceCheckpoint({ completedSteps: options.state.completedSteps })
			const recorded = options.state.completedSteps.at(-1)!
			if (recorded.status === 'failed') {
				options.state.blockRemaining(step.id)
				break
			}
		}
	} catch (error) {
		const expiration = expirationReason(error, options.control)
		options.state.recordLifecycleFailure(
			expiration ?? (session ? 'internal-error' : 'driver-start-failed'),
			diagnostic(
				session ? 'scenario.internal-error' : 'driver.start-failed',
				session ? '' : '/driver',
				error,
				options.sanitizer
			)
		)
		options.state.markNotStarted()
	} finally {
		attribution.endStep()
		latchInterruption(options)
		if (session) {
			options.onCleanupStarted?.()
			await cleanup(runner, session, options, now)
		}
		latchInterruption(options)
	}
}

async function cleanup(
	runner: ScenarioStepRunner | undefined,
	session: DriverSession,
	options: RunScenarioOptions,
	now: () => number
): Promise<void> {
	const cleanupController = new AbortController()
	const boundaryController = new AbortController()
	const onInterruption = () => cleanupController.abort('interrupted')
	if (options.control.interruptionSignal.aborted) onInterruption()
	else options.control.interruptionSignal.addEventListener('abort', onInterruption, { once: true })
	const deadline = now() + options.prepared.effectiveLimits.cleanupTimeoutMs
	const runnerTeardown = runner ? startCleanupCall(() => runner.teardown()) : undefined
	if (now() >= deadline) {
		cleanupController.abort('driver-teardown-failed')
		boundaryController.abort('driver-teardown-failed')
	}
	const sessionClose = startCleanupCall(() => session.close({ signal: cleanupController.signal }))
	if (now() >= deadline) {
		cleanupController.abort('driver-teardown-failed')
		boundaryController.abort('driver-teardown-failed')
	}
	const operations = [
		...(runnerTeardown
			? [boundedCleanup('runner-teardown', runnerTeardown, boundaryController, deadline, now)]
			: []),
		boundedCleanup('driver-close', sessionClose, boundaryController, deadline, now),
	]
	try {
		const results = await Promise.allSettled(operations)
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		if (failures.length === 0) return
		cleanupController.abort('driver-teardown-failed')
		options.state.recordCleanupFailure({
			code: 'driver.teardown-failed',
			path: '/driver',
			message: failures.map((failure) => options.sanitizer.error(failure.reason)).join('; '),
		})
	} finally {
		options.control.interruptionSignal.removeEventListener('abort', onInterruption)
	}
}

function startCleanupCall(call: () => Promise<unknown> | unknown): Promise<unknown> {
	try {
		const operation = Promise.resolve(call())
		void operation.catch((): void => undefined)
		return operation
	} catch (error) {
		return Promise.reject(error)
	}
}

function boundedCleanup(
	operation: string,
	started: Promise<unknown>,
	controller: AbortController,
	deadline: number,
	now: () => number
): Promise<unknown> {
	return awaitDriverBoundary({
		operation,
		signal: controller.signal,
		deadline,
		now,
		reason: () => 'interrupted',
		call: () => started,
	})
}

function scenarioBoundary<T>(
	operation: string,
	control: ScenarioControl,
	now: () => number,
	call: (signal: AbortSignal) => Promise<T> | T
): Promise<T> {
	return awaitDriverBoundary({
		operation,
		signal: control.signal,
		deadline: control.deadline,
		now,
		reason: () => {
			const state = control.poll()
			return state.expired ? state.reason : 'scenario-timeout'
		},
		call,
	})
}

function internalErrorStep(
	step: StepIntent,
	stepIndex: number,
	report: InternalStepReport | undefined,
	checkpoint: ReturnType<ScenarioUsageTracker['beginStep']>,
	startedAt: number,
	now: () => number,
	options: RunScenarioOptions,
	error: unknown
): { result: ExecutedStepResult; diagnostics: Diagnostic[] } {
	const failure = diagnostic('scenario.internal-error', `/scenario/steps/${stepIndex}`, error, options.sanitizer)
	return {
		result: {
			id: step.id,
			status: 'failed',
			category: 'infra',
			reason: 'internal-error',
			actual: failure.message,
			turns: report?.turns ?? 0,
			durationMs: report?.durationMs ?? Math.max(0, now() - startedAt),
			usage: options.usageTracker.stepUsage(checkpoint),
			toolCalls: [],
		},
		diagnostics: [failure],
	}
}

function latchInterruption(options: RunScenarioOptions): void {
	if (!options.control.interruptionSignal.aborted) return
	options.state.latchInterruption({
		code: 'scenario.interrupted',
		path: '',
		message: 'Scenario execution was interrupted',
	})
}

function driverSecretReader(
	bindings: Readonly<Record<string, string>>,
	values: ReadonlyMap<string, string>
): DriverSecretReader {
	return {
		read(slot) {
			if (!Object.hasOwn(bindings, slot)) throw new Error(`Driver secret slot '${slot}' is not declared`)
			const binding = bindings[slot]
			const value = values.get(binding)
			if (value === undefined) throw new Error(`Driver secret binding '${binding}' is unavailable`)
			return value
		},
	}
}

export class EvidenceAttribution {
	private stepId: string | undefined

	beginStep(stepId: string): void {
		this.stepId = stepId
	}

	endStep(stepId?: string): void {
		if (stepId === undefined || this.stepId === stepId) this.stepId = undefined
	}

	currentStep(): string | undefined {
		return this.stepId
	}
}

export function createDriverEvidenceSink(
	store: EvidenceStore,
	attribution: EvidenceAttribution,
	logger: RuntimeLogger
): DriverEvidenceSink {
	return {
		async capture(input) {
			try {
				store.captureDriver({ ...input, stepId: input.stepId ?? attribution.currentStep() })
				return { status: 'accepted' }
			} catch (error) {
				if (!isDiscardableCaptureError(error)) throw error
				const diagnostic = store.recordCaptureFailure(input.kind, error)
				logger.warn(diagnostic.message)
				return { status: 'discarded' }
			}
		},
	}
}

function isDiscardableCaptureError(error: unknown): error is EvidenceCaptureError {
	return (
		error instanceof EvidenceCaptureError &&
		[
			'evidence.candidate-too-large',
			'evidence.invocation-buffer-too-large',
			'evidence.invalid-text',
			'evidence.invalid-structured-content',
		].includes(error.code)
	)
}

function expirationReason(error: unknown, control: ScenarioControl): 'scenario-timeout' | 'interrupted' | undefined {
	if (error instanceof DriverBoundaryError && error.reason !== 'step-timeout') return error.reason
	const state = control.poll()
	return state.expired && state.reason !== 'step-timeout' ? state.reason : undefined
}

function diagnostic(code: string, path: string, error: unknown, sanitizer: DiagnosticSanitizer): Diagnostic {
	return { code, path, message: sanitizer.error(error) }
}
