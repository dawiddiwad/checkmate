import { ResolvedConfig, resolveConfig } from '../config/resolved-config.js'
import type { DriverDescriptorV1, ModelEgressPolicyV1 } from '../contracts/types.js'
import type { DriverSession, StepIntent } from '../driver.js'
import { validateDriverSession } from '../drivers/loader.js'
import { adaptDriverTool } from './driver-session.js'
import type { StepControl } from './scenario-control.js'
import { Step, type InternalStepReport, StepReport } from './types.js'
import { createStepResultTools } from '../tools/step/result-tool.js'
import { ToolRegistry } from '../tools/registry.js'
import { AiClient } from '../ai/client.js'
import { TokenTracker } from '../ai/token-tracker.js'
import { ScenarioUsageTracker } from './usage-tracker.js'
import { StepExecution } from './step-execution.js'
import { CheckmateExtension, ExtensionHost } from './extension.js'
import { logger, setLogLevel } from '../logging/index.js'
import { createInvocationLogger } from '../logging/invocation-logger.js'
import { silentLogger, type RuntimeLogger } from '../logging/types.js'
import { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'
import { LegacyExtensionSession } from './legacy-extension-session.js'

/**
 * Options for creating a Checkmate runner.
 *
 * @example
 * ```ts
 * import { createRunner } from '@xoxoai/checkmate/core'
 * import { web } from '@xoxoai/checkmate/playwright'
 *
 * const runner = createRunner({
 *   extensions: [web({ page })],
 * })
 * ```
 */
export type CheckmateRunnerOptions = {
	/**
	 * Extensions to compose into the runner.
	 */
	extensions?: CheckmateExtension[]

	/**
	 * Resolved `checkmate*` configuration for this runner.
	 *
	 * Inside a Playwright test the `ai` fixture supplies this from the `checkmateConfig`
	 * fixture. A script that drives the runner directly builds one with `resolveConfig()`.
	 */
	config?: ResolvedConfig
}

export type DriverCheckmateRunnerOptions = {
	driverId: string
	descriptor: DriverDescriptorV1
	session: DriverSession
	allowedTools: '*' | readonly string[]
	modelEgress: ModelEgressPolicyV1
	limits: {
		turnsPerStep: number
		stepTimeoutMs: number
		requestTimeoutMs: number
		maxRetries: number
		loopMaxRepetitions: number
		budgetTokens?: number
	}
	apiKey: string
	exactSecrets?: Iterable<string>
	logger?: RuntimeLogger
	usageTracker?: ScenarioUsageTracker
	aiClient?: AiClient
}

export type RunStepOptions = {
	/**
	 * Time left in the enclosing test, in milliseconds.
	 *
	 * Playwright callers provide this so the step can reserve time to attach its report before
	 * the enclosing test timeout aborts the worker.
	 */
	testTimeoutRemaining?: number
}

/**
 * Public runtime entry point for executing natural-language steps with Checkmate.
 *
 * `run()` resolves a `StepReport` instead of throwing, so a caller outside Playwright
 * Test can decide what a failed step means.
 *
 * @example
 * ```ts
 * const runner = new CheckmateRunner()
 * const report = await runner.run({
 *   action: 'Open the pricing page',
 *   expect: 'Pricing details are visible',
 * })
 * console.log(report.outcome, report.category, report.usage.costUsd)
 * ```
 */
export class CheckmateRunner {
	private readonly config: ResolvedConfig
	private readonly toolRegistry: ToolRegistry
	private readonly tokenTracker: TokenTracker | undefined
	private readonly aiClient: AiClient
	private readonly extensionHost: ExtensionHost | undefined
	private readonly legacySession: LegacyExtensionSession | undefined
	private readonly driverSession: DriverSession | undefined
	private readonly usageTracker: ScenarioUsageTracker | undefined
	private readonly driverId: string | undefined
	private readonly diagnosticSanitizer: DiagnosticSanitizer | undefined
	private readonly runtimeLogger: RuntimeLogger | undefined

	/**
	 * Creates a new runner composed from extensions.
	 *
	 * @example
	 * ```ts
	 * const runner = new CheckmateRunner({
	 *   extensions: [web({ page })],
	 * })
	 * ```
	 */
	constructor(options?: CheckmateRunnerOptions)
	constructor(options: DriverCheckmateRunnerOptions)
	constructor(options: CheckmateRunnerOptions | DriverCheckmateRunnerOptions = {}) {
		if (isDriverOptions(options)) {
			const exactSecrets = [options.apiKey, ...(options.exactSecrets ?? [])]
			this.diagnosticSanitizer = new DiagnosticSanitizer(exactSecrets)
			this.runtimeLogger = createInvocationLogger(options.logger ?? silentLogger, this.diagnosticSanitizer)
			this.config = driverRuntimeConfig(options)
			this.driverSession = options.session
			this.driverId = options.driverId
			this.usageTracker = options.usageTracker ?? new ScenarioUsageTracker(options.limits.budgetTokens)
			this.toolRegistry = new ToolRegistry({ allowedTools: options.allowedTools })
			this.toolRegistry.register(createStepResultTools())
			const tools = validateDriverSession(options.session, options.descriptor, options.allowedTools)
			this.toolRegistry.register(tools.map((tool) => adaptDriverTool(options.driverId, tool)))
			this.tokenTracker = undefined
			this.extensionHost = undefined
			this.legacySession = undefined
			this.aiClient =
				options.aiClient ??
				new AiClient({
					config: this.config,
					toolRegistry: this.toolRegistry,
					apiKey: options.apiKey,
					modelEgress: options.modelEgress,
					exactSecrets,
					logger: this.runtimeLogger,
				})
			return
		}

		this.config = options.config ?? resolveConfig()
		setLogLevel(this.config.logLevel)
		this.toolRegistry = new ToolRegistry(this.config)
		this.toolRegistry.register(createStepResultTools())
		this.tokenTracker = new TokenTracker(this.config)
		this.extensionHost = new ExtensionHost(this.config, this.toolRegistry, options.extensions ?? [])
		this.aiClient = new AiClient({ config: this.config, toolRegistry: this.toolRegistry, logger })
		this.legacySession = new LegacyExtensionSession({
			config: this.config,
			aiClient: this.aiClient,
			toolRegistry: this.toolRegistry,
			extensionHost: this.extensionHost,
			tokenTracker: this.tokenTracker,
		})
		this.diagnosticSanitizer = undefined
		this.runtimeLogger = undefined
	}

	/**
	 * Releases any runner-owned resources.
	 *
	 * @example
	 * ```ts
	 * await runner.teardown()
	 * ```
	 */
	async teardown(): Promise<void> {
		// Driver sessions are borrowed until Phase 5 gives the scenario lifecycle one cleanup owner.
		if (this.driverSession) return
		await this.extensionHost!.teardown()
	}

	/**
	 * Executes one natural-language test step and resolves its report.
	 *
	 * @param step - The step definition to execute.
	 *
	 * @example
	 * ```ts
	 * const report = await runner.run({
	 *   action: 'Search for qwen3-vl',
	 *   expect: 'The qwen3-vl model page is displayed',
	 *   topPercent: 10,
	 * })
	 * ```
	 */
	async run(step: Step, options?: RunStepOptions): Promise<StepReport>
	async run(step: StepIntent, control: StepControl): Promise<InternalStepReport>
	async run(
		step: Step | StepIntent,
		options: RunStepOptions | StepControl = {}
	): Promise<StepReport | InternalStepReport> {
		if (this.driverSession) {
			if (!isStepControl(options)) throw new Error('Driver-backed runner requires StepControl')
			return new StepExecution({
				config: this.config,
				aiClient: this.aiClient,
				toolRegistry: this.toolRegistry,
				driverSession: this.driverSession,
				usageTracker: this.usageTracker!,
				driverId: this.driverId!,
				redact: this.config.redact,
				diagnosticSanitizer: this.diagnosticSanitizer!,
				logger: this.runtimeLogger!,
			}).run(step as StepIntent, options)
		}
		return this.legacySession!.run(step as Step, options as RunStepOptions)
	}
}

/**
 * Creates a runner from the provided extensions.
 *
 * This is the main programmatic entry point from `@xoxoai/checkmate/core`.
 *
 * @example
 * ```ts
 * import { createRunner } from '@xoxoai/checkmate/core'
 * import { web } from '@xoxoai/checkmate/playwright'
 *
 * const runner = createRunner({
 *   extensions: [web({ page })],
 * })
 * ```
 */
export function createRunner(options: CheckmateRunnerOptions = {}): CheckmateRunner {
	return new CheckmateRunner(options)
}

export function createDriverRunner(options: DriverCheckmateRunnerOptions): CheckmateRunner {
	return new CheckmateRunner(options)
}

function isDriverOptions(
	options: CheckmateRunnerOptions | DriverCheckmateRunnerOptions
): options is DriverCheckmateRunnerOptions {
	return 'session' in options
}

function isStepControl(options: RunStepOptions | StepControl): options is StepControl {
	return 'signal' in options && 'poll' in options
}

function driverRuntimeConfig(options: DriverCheckmateRunnerOptions): ResolvedConfig {
	return resolveConfig({
		checkmateModel: options.modelEgress.provider.model,
		checkmateOpenaiBaseUrl: options.modelEgress.provider.baseUrl,
		checkmateReasoningEffort: options.modelEgress.provider.reasoningEffort,
		checkmateTemperature: options.modelEgress.provider.temperature ?? 0,
		checkmateTurnCap: options.limits.turnsPerStep,
		checkmateStepTimeout: options.limits.stepTimeoutMs,
		checkmateBudgetUsd: undefined,
		checkmateBudgetTokens: undefined,
		checkmateEvidence: 'off',
		checkmateRedact: options.modelEgress.textRedaction === 'on',
		checkmateToolChoice: 'required',
		checkmateAllowedTools: [],
		checkmateMaxRetries: options.limits.maxRetries,
		checkmateRequestTimeout: options.limits.requestTimeoutMs,
		checkmateLoopMaxRepetitions: options.limits.loopMaxRepetitions,
		checkmateRateLimitDelay: 0,
		checkmateLogLevel: 'off',
	})
}
