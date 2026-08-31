import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AiClient } from '../ai/client.js'
import { MessageHistory } from '../ai/message-history.js'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts.js'
import { BudgetExceededError, TokenTracker } from '../ai/token-tracker.js'
import { TurnProcessor } from '../ai/turn-processor.js'
import { RuntimeConfig } from '../config/runtime-config.js'
import { logger } from '../logging/index.js'
import { ToolDispatchError } from '../tools/dispatcher.js'
import { LoopDetector } from '../tools/loop-detector.js'
import { ToolRegistry } from '../tools/registry.js'
import { ExtensionHost } from './extension.js'
import { StepEvidence, StepTermination } from './step-evidence.js'
import { ContextMessage, Step, StepReport, TerminationReason } from './types.js'

export type StepExecutionDependencies = {
	runtimeConfig: RuntimeConfig
	aiClient: AiClient
	toolRegistry: ToolRegistry
	extensionHost: ExtensionHost
	tokenTracker: TokenTracker
}

export class StepExecution {
	private readonly runtimeConfig: RuntimeConfig
	private readonly aiClient: AiClient
	private readonly toolRegistry: ToolRegistry
	private readonly extensionHost: ExtensionHost
	private readonly tokenTracker: TokenTracker
	private readonly messages: ChatCompletionMessageParam[] = []
	private readonly ephemeralMessages = new Set<ChatCompletionMessageParam>()

	constructor({ runtimeConfig, aiClient, toolRegistry, extensionHost, tokenTracker }: StepExecutionDependencies) {
		this.runtimeConfig = runtimeConfig
		this.aiClient = aiClient
		this.toolRegistry = toolRegistry
		this.extensionHost = extensionHost
		this.tokenTracker = tokenTracker
	}

	async run(step: Step): Promise<StepReport> {
		logger.info(`step started:\n${JSON.stringify(step, null, 2).replaceAll('  ', '').trim()}`)

		const model = this.runtimeConfig.getModel()
		const evidence = new StepEvidence({ step, model })
		const turnProcessor = new TurnProcessor({
			runtimeConfig: this.runtimeConfig,
			toolRegistry: this.toolRegistry,
			loopDetector: new LoopDetector(this.runtimeConfig.getLoopMaxRepetitions()),
			evidence,
		})

		this.tokenTracker.resetStep()
		this.messages.push(
			...new MessageHistory().buildInitialMessages({
				systemPrompt: STEP_SYSTEM_PROMPT(this.extensionHost.getInstructions()),
				userPrompt: STEP_START_USER_PROMPT(step),
			})
		)
		this.appendContext(await this.extensionHost.buildInitialMessages(step))

		let turns = 0
		for (;;) {
			turns++

			try {
				const { response, assistantMessages } = await this.aiClient.send(this.messages, { step })
				this.messages.push(...assistantMessages)
				this.tokenTracker.log(response, this.aiClient.countHistoryTokens(this.messages), model)
				evidence.recordUsage(response.usage)

				const outcome = await turnProcessor.process({ response, step, turn: turns })

				if (outcome.kind === 'assertion') {
					return this.finish(evidence, {
						outcome: outcome.passed ? 'passed' : 'failed',
						reason: outcome.passed ? 'met-expectation' : 'failed-expectation',
						actual: outcome.actual,
						turns,
					})
				}

				if (outcome.kind === 'stuck') {
					return this.finish(evidence, {
						outcome: 'failed',
						reason: 'loop-detected',
						actual: 'the model repeated the same tool calls without reaching a result',
						turns,
					})
				}

				this.dropEphemeralMessages()
				this.messages.push(...outcome.messages)
				this.appendContext(
					await this.extensionHost.handleToolResponses({
						step,
						turn: turns,
						toolResponses: outcome.toolResults,
					})
				)
			} catch (error) {
				return this.finish(evidence, {
					outcome: 'failed',
					reason: infraReason(error),
					actual: describeError(error),
					turns,
				})
			}
		}
	}

	private finish(evidence: StepEvidence, termination: StepTermination): StepReport {
		const report = evidence.buildReport(termination)
		logger.info(`step finished: ${report.outcome} (${report.category} / ${report.reason})`)
		return report
	}

	private appendContext(contextMessages: ContextMessage[]): void {
		for (const { message, ephemeral } of contextMessages) {
			this.messages.push(message)
			if (ephemeral) {
				this.ephemeralMessages.add(message)
			}
		}
	}

	private dropEphemeralMessages(): void {
		if (this.ephemeralMessages.size === 0) {
			return
		}

		const retained = this.messages.filter((message) => !this.ephemeralMessages.has(message))
		this.messages.length = 0
		this.messages.push(...retained)
		this.ephemeralMessages.clear()
	}
}

function infraReason(error: unknown): TerminationReason {
	if (error instanceof BudgetExceededError) {
		return 'budget-exceeded'
	}

	if (error instanceof ToolDispatchError) {
		return 'tool-error'
	}

	return 'provider-error'
}

function describeError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error)
	}

	const messages = [error.message]
	let cause = error.cause
	while (cause instanceof Error) {
		messages.push(cause.message)
		cause = cause.cause
	}

	return messages.join('\ncaused by: ')
}
