import { expect } from '@playwright/test'
import { logger } from '../logging/index.js'
import { Step, StepResult, StepResultPromise, ResolveStepResult } from './types.js'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts.js'
import { MessageHistory } from '../ai/message-history.js'
import { AiClient } from '../ai/client.js'
import { ExtensionHost } from './extension.js'

export class StepExecution {
	private stepResult: StepResult = { passed: false, actual: '' }
	private resolveStepResult!: ResolveStepResult
	private readonly stepResultPromise: StepResultPromise

	constructor(
		private readonly aiClient: AiClient,
		private readonly extensionHost: ExtensionHost
	) {
		this.stepResultPromise = new Promise<StepResult>((resolve) => {
			this.resolveStepResult = resolve
		})
	}

	async run(step: Step): Promise<void> {
		this.logStepStart(step)

		try {
			await this.aiClient.initialize(step, this.resolveStepResult)
			const initialMessages = new MessageHistory().buildInitialMessages({
				systemPrompt: STEP_SYSTEM_PROMPT(this.extensionHost.getInstructions()),
				userPrompt: STEP_START_USER_PROMPT(step),
				contextMessages: await this.extensionHost.buildInitialMessages(step),
			})
			await this.aiClient.sendMessage(initialMessages)
			this.stepResult = await this.stepResultPromise
			this.assertStepResult(step)
		} catch (error) {
			throw new Error(`\nFailed to execute action:\n${step.action}`, { cause: error })
		}

		this.logStepFinish()
	}

	private logStepStart(step: Step): void {
		logger.info(`step started:\n${JSON.stringify(step, null, 2).replaceAll('  ', '').trim()}`)
	}

	private logStepFinish(): void {
		logger.info('step finished')
	}

	private assertStepResult(step: Step): void {
		expect(this.stepResult.passed, this.assertionMessage(step)).toBeTruthy()
	}

	private assertionMessage(step: Step): string {
		return this.stepResult.passed ? step.expect : `\nExpected: ${step.expect}\nActual: ${this.stepResult.actual}`
	}
}
