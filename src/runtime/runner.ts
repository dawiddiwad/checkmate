import { Page } from '@playwright/test'
import { RuntimeConfig } from '../config/runtime-config'
import { Step } from './types'
import { BrowserToolRuntime, createBrowserTools } from '../tools/browser/tool'
import { createStepResultTools } from '../tools/step/result-tool'
import { createSalesforceTools } from '../tools/salesforce/login-tool'
import { ToolRegistry } from '../tools/registry'
import { AiClient } from '../ai/client'
import { StepExecution } from './step-execution'

/**
 * Public runtime entry point for executing natural-language steps with Checkmate.
 *
 * @example
 * ```ts
 * const runner = new CheckmateRunner(page)
 * await runner.run({
 *   action: 'Open the pricing page',
 *   expect: 'Pricing details are visible',
 * })
 * ```
 */
export class CheckmateRunner {
	private readonly aiClient: AiClient

	/**
	 * Creates a new runner bound to a Playwright page.
	 *
	 * @param page - The Playwright page used for browser automation.
	 */
	constructor(page: Page) {
		const runtimeConfig = new RuntimeConfig()
		const browserRuntime = new BrowserToolRuntime(page)
		const toolRegistry = new ToolRegistry(runtimeConfig)
		toolRegistry.register(createStepResultTools())
		toolRegistry.register(createBrowserTools(browserRuntime))
		toolRegistry.register(createSalesforceTools(browserRuntime))
		this.aiClient = new AiClient({ runtimeConfig, toolRegistry, page })
	}

	/**
	 * Releases any runner-owned resources.
	 */
	async teardown(): Promise<void> {
		return
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
		await new StepExecution(this.aiClient).run(step)
	}
}
