import type { DriverDescriptorV1, ModelEgressPolicyV1 } from '../contracts/types.js'
import type { DriverSession, StepIntent } from '../driver.js'
import { validateDriverSession } from '../drivers/loader.js'
import { adaptDriverTool } from './driver-session.js'
import type { StepControl } from './scenario-control.js'
import type { InternalStepReport } from './types.js'
import type { RuntimeConfig } from './config.js'
import { createStepResultTools } from '../tools/step/result-tool.js'
import { ToolRegistry } from '../tools/registry.js'
import { AiClient } from '../ai/client.js'
import { ScenarioUsageTracker } from './usage-tracker.js'
import { StepExecution } from './step-execution.js'
import { createInvocationLogger } from '../logging/invocation-logger.js'
import type { LogLevel } from '../logging/level-logger.js'
import { silentLogger, type RuntimeLogger } from '../logging/types.js'
import { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'

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
	logLevel?: LogLevel
	usageTracker?: ScenarioUsageTracker
	aiClient?: AiClient
}

export class CheckmateRunner {
	private readonly config: RuntimeConfig
	private readonly toolRegistry: ToolRegistry
	private readonly aiClient: AiClient
	private readonly usageTracker: ScenarioUsageTracker
	private readonly diagnosticSanitizer: DiagnosticSanitizer
	private readonly runtimeLogger: RuntimeLogger

	constructor(private readonly options: DriverCheckmateRunnerOptions) {
		const exactSecrets = [options.apiKey, ...(options.exactSecrets ?? [])]
		this.diagnosticSanitizer = new DiagnosticSanitizer(exactSecrets)
		this.runtimeLogger = createInvocationLogger(options.logger ?? silentLogger, this.diagnosticSanitizer)
		this.config = {
			model: options.modelEgress.provider.model,
			baseUrl: options.modelEgress.provider.baseUrl,
			reasoningEffort: options.modelEgress.provider.reasoningEffort,
			temperature: options.modelEgress.provider.temperature ?? 0,
			turnCap: options.limits.turnsPerStep,
			redact: options.modelEgress.textRedaction === 'on',
			toolChoice: 'required',
			maxRetries: options.limits.maxRetries,
			requestTimeout: options.limits.requestTimeoutMs,
			loopMaxRepetitions: options.limits.loopMaxRepetitions,
			rateLimitDelay: 0,
			logLevel: options.logLevel ?? 'off',
		}
		this.usageTracker = options.usageTracker ?? new ScenarioUsageTracker(options.limits.budgetTokens)
		this.toolRegistry = new ToolRegistry({ allowedTools: options.allowedTools })
		this.toolRegistry.register(createStepResultTools())
		const tools = validateDriverSession(options.session, options.descriptor, options.allowedTools)
		this.toolRegistry.register(tools.map((tool) => adaptDriverTool(options.driverId, tool)))
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
	}

	async teardown(): Promise<void> {}

	async run(step: StepIntent, control: StepControl): Promise<InternalStepReport> {
		return new StepExecution({
			config: this.config,
			aiClient: this.aiClient,
			toolRegistry: this.toolRegistry,
			driverSession: this.options.session,
			usageTracker: this.usageTracker,
			driverId: this.options.driverId,
			redact: this.config.redact,
			diagnosticSanitizer: this.diagnosticSanitizer,
			logger: this.runtimeLogger,
		}).run(step, control)
	}
}

export function createDriverRunner(options: DriverCheckmateRunnerOptions): CheckmateRunner {
	return new CheckmateRunner(options)
}
