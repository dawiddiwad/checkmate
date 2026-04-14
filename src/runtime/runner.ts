import { Page } from '@playwright/test'
import { RuntimeConfig } from '../config/runtime-config'
import { Step } from './types'
import { BrowserTool } from '../tools/browser/tool'
import { StepResultTool } from '../tools/step/result-tool'
import { SalesforceLoginTool } from '../tools/salesforce/login-tool'
import { ToolRegistry } from '../tools/registry'
import { AiClient } from '../ai/client'
import { StepExecution } from './step-execution'

export class CheckmateRunner {
	private readonly aiClient: AiClient

	constructor(page: Page) {
		const runtimeConfig = new RuntimeConfig()
		const browserTool = new BrowserTool(page)
		const toolRegistry = new ToolRegistry(runtimeConfig)
		toolRegistry.register(new StepResultTool())
		toolRegistry.register(browserTool)
		toolRegistry.register(new SalesforceLoginTool(browserTool))
		this.aiClient = new AiClient({ runtimeConfig, toolRegistry, page })
	}

	async teardown(): Promise<void> {
		return
	}

	async run(step: Step): Promise<void> {
		await new StepExecution(this.aiClient).run(step)
	}
}
