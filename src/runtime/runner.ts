import { ResolvedConfig, resolveConfig } from '../config/resolved-config.js'
import { Step, StepReport } from './types.js'
import { createStepResultTools } from '../tools/step/result-tool.js'
import { ToolRegistry } from '../tools/registry.js'
import { AiClient } from '../ai/client.js'
import { TokenTracker } from '../ai/token-tracker.js'
import { StepExecution } from './step-execution.js'
import { CheckmateExtension, ExtensionHost } from './extension.js'
import { setLogLevel } from '../logging/index.js'

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
	private readonly tokenTracker: TokenTracker
	private readonly aiClient: AiClient
	private readonly extensionHost: ExtensionHost

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
	constructor(options: CheckmateRunnerOptions = {}) {
		this.config = options.config ?? resolveConfig()
		setLogLevel(this.config.logLevel)
		this.toolRegistry = new ToolRegistry(this.config)
		this.toolRegistry.register(createStepResultTools())
		this.tokenTracker = new TokenTracker(this.config)
		this.extensionHost = new ExtensionHost(this.config, this.toolRegistry, options.extensions ?? [])
		this.aiClient = new AiClient({ config: this.config, toolRegistry: this.toolRegistry })
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
		await this.extensionHost.teardown()
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
	async run(step: Step): Promise<StepReport> {
		return new StepExecution({
			config: this.config,
			aiClient: this.aiClient,
			toolRegistry: this.toolRegistry,
			extensionHost: this.extensionHost,
			tokenTracker: this.tokenTracker,
		}).run(step)
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
