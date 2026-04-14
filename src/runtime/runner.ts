import { Page } from '@playwright/test'
import { RuntimeConfig } from '../config/runtime-config'
import { Step } from './types'
import { BrowserToolRuntime, createBrowserTools } from '../tools/browser/tool'
import { createStepResultTools } from '../tools/step/result-tool'
import { createSalesforceTools } from '../tools/salesforce/login-tool'
import { ToolRegistry } from '../tools/registry'
import { AiClient } from '../ai/client'
import { StepExecution } from './step-execution'

export class CheckmateRunner {
	private readonly aiClient: AiClient

	constructor(page: Page) {
		const runtimeConfig = new RuntimeConfig()
		const browserRuntime = new BrowserToolRuntime(page)
		const toolRegistry = new ToolRegistry(runtimeConfig)
		toolRegistry.register(createStepResultTools())
		toolRegistry.register(createBrowserTools(browserRuntime))
		toolRegistry.register(createSalesforceTools(browserRuntime))
		this.aiClient = new AiClient({ runtimeConfig, toolRegistry, page })
	}

	async teardown(): Promise<void> {
		return
	}

	async run(step: Step): Promise<void> {
		await new StepExecution(this.aiClient).run(step)
	}
}
