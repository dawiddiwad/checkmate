import { StepTool } from '../tool/step-tool'
import { SalesforceTool } from '../../salesforce/salesforce-tool'
import { Step, StepFinishedCallback, StepStatus, StepStatusCallback } from '../types'
import { expect, Page } from '@playwright/test'
import { RUN_STEP_PROMPT } from './prompts'
import { ConfigurationManager } from '../configuration-manager'
import { ToolRegistry } from '../tool/tool-registry'
import { OpenAIClient } from './openai-client'
import { BrowserTool } from '../tool/browser-tool'
import { HistoryManager } from './history-manager'
import { PageSnapshot } from '../tool/page-snapshot'
import { CheckmateLogger } from '../logger'

export const logger = CheckmateLogger.create('openai_test_manager', new ConfigurationManager().getLogLevel())

export class OpenAITestManager {
	private readonly openaiClient: OpenAIClient

	constructor(page: Page) {
		const configurationManager = new ConfigurationManager()
		const stepTool = new StepTool()
		const browserTool = new BrowserTool(page)
		const salesforceTool = new SalesforceTool(browserTool)
		const toolRegistry = new ToolRegistry({ browserTool, stepTool, salesforceTool, configurationManager })
		const openaiClient = new OpenAIClient({ configurationManager, toolRegistry, page })
		this.openaiClient = openaiClient
	}

	public async teardown() {
		PageSnapshot.lastSnapshot = null
	}

	public async run(step: Step) {
		const testStep = new OpenAITestStep(this.openaiClient)
		await testStep.run(step)
	}
}

class OpenAITestStep {
	private stepStatus: StepStatus
	private stepStatusCallback!: StepStatusCallback
	private stepFinishedCallback: StepFinishedCallback

	constructor(private readonly openaiClient: OpenAIClient) {
		this.stepStatus = { passed: false, actual: '' }
		this.stepFinishedCallback = new Promise<StepStatus>((finishStep) => {
			this.stepStatusCallback = finishStep
		})
	}

	async run(step: Step): Promise<void> {
		this.logStepStart(step)
		try {
			await this.openaiClient.initialize(step, this.stepStatusCallback)
			// Clear the previous step's cached snapshot to ensure fresh filtering with new step's keywords
			PageSnapshot.lastSnapshot = null
			new HistoryManager().addInitialSnapshot(
				this.openaiClient,
				await new PageSnapshot(this.openaiClient.page, step).get()
			)
			await this.openaiClient.sendMessage(RUN_STEP_PROMPT(step))
			this.stepStatus = await this.stepFinishedCallback
			this.assertStepResult(step)
		} catch (error) {
			throw new Error(`\nFailed to execute action:\n${step.action}\n\n${error}`)
		}
		this.logStepFinish()
	}

	private logStepStart(step: Step): void {
		logger.info(`step started:\n${JSON.stringify(step, null, 2).replaceAll('  ', '').trim()}`)
	}

	private logStepFinish(): void {
		logger.info(`step finished`)
	}

	private assertStepResult(step: Step): void {
		expect(this.stepStatus.passed, this.assertionMessage(step)).toBeTruthy()
	}

	private assertionMessage(step: Step): string {
		if (this.stepStatus.passed) {
			return step.expect
		} else {
			return `\nExpected: ${step.expect}\nActual: ${this.stepStatus.actual}`
		}
	}
}
