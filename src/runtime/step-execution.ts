import { expect } from '@playwright/test'
import { logger } from '../logging'
import { Step, StepResult, StepResultPromise, ResolveStepResult } from './types'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts'
import { MessageHistory } from '../ai/message-history'
import { AiClient } from '../ai/client'
import { SnapshotService } from '../tools/browser/snapshot-service'

export class StepExecution {
	private stepResult: StepResult = { passed: false, actual: '' }
	private resolveStepResult!: ResolveStepResult
	private readonly stepResultPromise: StepResultPromise

	constructor(private readonly aiClient: AiClient) {
		this.stepResultPromise = new Promise<StepResult>((resolve) => {
			this.resolveStepResult = resolve
		})
	}

	async run(step: Step): Promise<void> {
		this.logStepStart(step)

		try {
			await this.aiClient.initialize(step, this.resolveStepResult)
			const snapshotService = new SnapshotService(this.aiClient.page, step)
			const initialMessages = new MessageHistory().buildInitialMessages({
				systemPrompt: STEP_SYSTEM_PROMPT(),
				userPrompt: STEP_START_USER_PROMPT(step),
				snapshotContent: await snapshotService.get(),
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
