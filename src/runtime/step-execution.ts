import { logger } from '../logging'
import { Step, StepResult, StepResultPromise, ResolveStepResult } from './types'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts'
import { MessageHistory } from '../ai/message-history'
import { AiClient } from '../ai/client'
import { CheckmateContextProvider, CheckmateContextItem, CheckmateServices } from './module'

type StepExecutionOptions = {
	promptFragments?: string[]
	initialContextProviders?: CheckmateContextProvider[]
	services: CheckmateServices
}

export class StepExecution {
	private stepResult: StepResult = { passed: false, actual: '' }
	private resolveStepResult!: ResolveStepResult
	private readonly stepResultPromise: StepResultPromise

	constructor(
		private readonly aiClient: AiClient,
		private readonly options: StepExecutionOptions
	) {
		this.stepResultPromise = new Promise<StepResult>((resolve) => {
			this.resolveStepResult = resolve
		})
	}

	async run(step: Step): Promise<void> {
		this.logStepStart(step)

		try {
			await this.aiClient.initialize(step, this.resolveStepResult)
			const contextItems = await this.collectInitialContext(step)
			const initialMessages = new MessageHistory().buildInitialMessages({
				systemPrompt: STEP_SYSTEM_PROMPT(this.options.promptFragments ?? []),
				userPrompt: STEP_START_USER_PROMPT(step),
				contextItems,
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

	private async collectInitialContext(step: Step): Promise<CheckmateContextItem[]> {
		const providers = this.options.initialContextProviders ?? []
		const contextItems: CheckmateContextItem[] = []

		for (const provider of providers) {
			const provided = await provider(step, { services: this.options.services })
			if (provided && provided.length > 0) {
				contextItems.push(...provided)
			}
		}

		return contextItems
	}

	private assertStepResult(step: Step): void {
		if (!this.stepResult.passed) {
			throw new Error(this.assertionMessage(step))
		}
	}

	private assertionMessage(step: Step): string {
		return this.stepResult.passed ? step.expect : `\nExpected: ${step.expect}\nActual: ${this.stepResult.actual}`
	}
}
