import { RuntimeConfig } from '../config/runtime-config'
import { Step } from './types'
import { createStepResultTools } from '../tools/step/result-tool'
import { ToolRegistry } from '../tools/registry'
import { AiClient } from '../ai/client'
import { StepExecution } from './step-execution'
import { CheckmateExtension, ExtensionHost } from './extension'

/**
 * Options for creating a Checkmate runner.
 *
 * @example
 * ```ts
 * import { createRunner } from '@xoxoai/checkmate/core'
 * import { web } from '@xoxoai/checkmate/playwright'
 *
 * const ai = createRunner({
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
	 * Advanced: provide a custom runtime config instance.
	 */
	runtimeConfig?: RuntimeConfig
}

/**
 * Public runtime entry point for executing natural-language steps with Checkmate.
 *
 * @example
 * ```ts
 * const runner = new CheckmateRunner()
 * await runner.run({
 *   action: 'Open the pricing page',
 *   expect: 'Pricing details are visible',
 * })
 * ```
 */
export class CheckmateRunner {
	private readonly aiClient: AiClient
	private readonly extensionHost: ExtensionHost

	/**
	 * Creates a new runner composed from extensions.
	 *
	 * @example
	 * ```ts
	 * const ai = new CheckmateRunner({
	 *   extensions: [web({ page })],
	 * })
	 * ```
	 */
	constructor(options: CheckmateRunnerOptions = {}) {
		const runtimeConfig = options.runtimeConfig ?? new RuntimeConfig()
		const toolRegistry = new ToolRegistry(runtimeConfig)
		toolRegistry.register(createStepResultTools())
		this.extensionHost = new ExtensionHost(runtimeConfig, toolRegistry, options.extensions ?? [])
		this.aiClient = new AiClient({ runtimeConfig, toolRegistry, extensionHost: this.extensionHost })
	}

	/**
	 * Releases any runner-owned resources.
	 *
	 * @example
	 * ```ts
	 * await ai.teardown()
	 * ```
	 */
	async teardown(): Promise<void> {
		await this.extensionHost.teardown()
	}

	/**
	 * Executes one natural-language test step.
	 *
	 * @param step - The step definition to execute.
	 *
	 * @example
	 * ```ts
	 * await runner.run({
	 *   action: 'Search for qwen3-vl',
	 *   expect: 'The qwen3-vl model page is displayed',
	 *   topPercent: 10,
	 * })
	 * ```
	 */
	async run(step: Step): Promise<void> {
		await new StepExecution(this.aiClient, this.extensionHost).run(step)
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
 * const ai = createRunner({
 *   extensions: [web({ page })],
 * })
 * ```
 */
export function createRunner(options: CheckmateRunnerOptions = {}): CheckmateRunner {
	return new CheckmateRunner(options)
}
