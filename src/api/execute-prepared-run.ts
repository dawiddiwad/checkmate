import type { CheckmateDriverV1 } from '../driver.js'
import { loadValidatedDriver, type DriverModuleImporter } from '../drivers/loader.js'
import { EvidenceStore } from '../evidence/store.js'
import { TerminalFinalizer } from '../evidence/terminal-finalizer.js'
import type { RunIdentity } from '../evidence/layout.js'
import { createInvocationLogger } from '../logging/invocation-logger.js'
import { silentLogger, type RuntimeLogger } from '../logging/types.js'
import { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'
import { awaitDriverBoundary, DriverBoundaryError } from '../runtime/driver-boundary.js'
import { ScenarioControl } from '../runtime/scenario-control.js'
import { runScenario, type ScenarioRunnerFactory } from '../runtime/scenario-runner.js'
import { ScenarioState } from '../runtime/scenario-state.js'
import { ScenarioUsageTracker } from '../runtime/usage-tracker.js'
import type { ExecutionResultV1 } from '../contracts/types.js'
import type { EnvironmentReader } from '../config/secrets.js'
import type { PreparedRun } from './prepare-run.js'

export type ExecutePreparedRunOptions = Readonly<{
	signal?: AbortSignal
	readEnvironment?: EnvironmentReader
	importDriver?: DriverModuleImporter
	logger?: RuntimeLogger
	createRunner?: ScenarioRunnerFactory
	now?: () => number
	setTimer?: typeof setTimeout
	clearTimer?: typeof clearTimeout
	createStore?: (options: ConstructorParameters<typeof EvidenceStore>[0]) => EvidenceStore
	onCleanupStarted?: () => void
}>

export async function executePreparedRun(
	prepared: PreparedRun,
	identity: RunIdentity,
	options: ExecutePreparedRunOptions = {}
): Promise<ExecutionResultV1> {
	const now = options.now ?? Date.now
	const control = new ScenarioControl({
		timeoutMs: prepared.effectiveLimits.scenarioTimeoutMs,
		signal: options.signal,
		now,
		setTimer: options.setTimer,
		clearTimer: options.clearTimer,
	})
	const usageTracker = new ScenarioUsageTracker(prepared.effectiveLimits.budgetTokens)
	const state = new ScenarioState({
		request: prepared.request,
		identity,
		driver: { id: prepared.driver.id, contractVersion: prepared.driver.descriptor.driverContractVersion },
		policy: { id: prepared.policy.id, effectiveLimits: prepared.effectiveLimits },
		now,
	})
	let store: EvidenceStore | undefined

	try {
		const resolvedSecrets = resolveSecrets(prepared, options.readEnvironment)
		const exactSecrets = [...resolvedSecrets.values.values()]
		const sanitizer = new DiagnosticSanitizer(exactSecrets)
		const logger = createInvocationLogger(options.logger ?? silentLogger, sanitizer)
		store = (options.createStore ?? ((storeOptions) => new EvidenceStore(storeOptions)))({
			invocationRoot: prepared.invocationRoot,
			identity,
			policy: prepared.policy.evidence,
			stepIds: prepared.request.scenario.steps.map((step) => step.id),
			driverDescriptor: prepared.driver.descriptor,
			exactSecrets,
			now: () => new Date(now()),
		})
		try {
			await store.writeInvocation(prepared.request)
		} catch (error) {
			store.markPartial()
			state.recordLifecycleFailure('evidence-write-failed', {
				code: 'evidence.write-failed',
				path: '/evidence',
				message: sanitizer.error(error),
			})
			state.markNotStarted()
			const candidate = state.buildCandidateResult({
				usage: usageTracker.usage(),
				evidence: { state: store.state, references: store.committedReferences },
			})
			return (await new TerminalFinalizer(store).finalize(candidate)).result
		}

		if (resolvedSecrets.error) {
			state.recordLifecycleFailure('driver-start-failed', {
				code: 'secret.unavailable',
				path: '/secretBindings',
				message: sanitizer.error(resolvedSecrets.error),
			})
			state.markNotStarted()
		} else {
			const driver = await loadDriver(prepared, control, state, sanitizer, now, options.importDriver)
			if (driver) {
				await runScenario({
					driver,
					prepared,
					state,
					control,
					store,
					usageTracker,
					secretValues: resolvedSecrets.values,
					apiKey: resolvedSecrets.values.get(prepared.modelEgress.provider.apiKeyBinding)!,
					exactSecrets,
					logger,
					sanitizer,
					createRunner: options.createRunner,
					now,
					onCleanupStarted: options.onCleanupStarted,
				})
			}
		}

		await store.finalizeScenario(state.hasFailure ? 'failed' : 'passed')
		const candidate = state.buildCandidateResult({
			usage: usageTracker.usage(),
			evidence: { state: store.state, references: store.committedReferences },
		})
		return (await new TerminalFinalizer(store).finalize(candidate)).result
	} finally {
		control.dispose()
		store?.dispose()
	}
}

async function loadDriver(
	prepared: PreparedRun,
	control: ScenarioControl,
	state: ScenarioState,
	sanitizer: DiagnosticSanitizer,
	now: () => number,
	importDriver?: DriverModuleImporter
): Promise<CheckmateDriverV1 | undefined> {
	const expired = control.poll()
	if (expired.expired) {
		state.recordLifecycleFailure(expired.reason, {
			code: 'scenario.expired',
			path: '',
			message: expired.reason,
		})
		state.markNotStarted()
		return undefined
	}

	state.markMutationPossible()
	try {
		return await awaitDriverBoundary({
			operation: 'driver-load',
			signal: control.signal,
			deadline: control.deadline,
			now,
			reason: () => {
				const current = control.poll()
				return current.expired ? current.reason : 'scenario-timeout'
			},
			call: () =>
				loadValidatedDriver({
					invocationRoot: prepared.invocationRoot,
					packageName: prepared.driver.packageName,
					descriptor: prepared.driver.descriptor,
					importModule: importDriver,
				}),
		})
	} catch (error) {
		const reason = error instanceof DriverBoundaryError ? error.reason : 'driver-load-failed'
		state.recordLifecycleFailure(reason, {
			code: reason === 'driver-load-failed' ? 'driver.load-failed' : 'scenario.expired',
			path: '/driver',
			message: sanitizer.error(error),
		})
		state.markNotStarted()
		return undefined
	}
}

function resolveSecrets(
	prepared: PreparedRun,
	readEnvironment: EnvironmentReader = (name) => process.env[name]
): { values: Map<string, string>; error?: Error } {
	const values = new Map<string, string>()
	for (const [binding, definition] of Object.entries(prepared.secretBindings)) {
		let value: string | undefined
		try {
			value = readEnvironment(definition.name)
		} catch (error) {
			return { values, error: error instanceof Error ? error : new Error(String(error)) }
		}
		if (typeof value !== 'string' || value.trim().length === 0) {
			return { values, error: new Error(`Secret binding '${binding}' is unavailable`) }
		}
		values.set(binding, value)
	}
	return { values }
}
