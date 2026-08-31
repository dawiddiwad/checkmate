import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AiClient } from '../ai/client.js'
import { MessageHistory } from '../ai/message-history.js'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts.js'
import { BudgetExceededError, TokenTracker } from '../ai/token-tracker.js'
import { TurnProcessor } from '../ai/turn-processor.js'
import { ResolvedConfig } from '../config/resolved-config.js'
import { logger } from '../logging/index.js'
import { ToolDispatchError } from '../tools/dispatcher.js'
import { LoopDetector } from '../tools/loop-detector.js'
import { ToolRegistry } from '../tools/registry.js'
import { ExtensionHost } from './extension.js'
import { StepEvidence, StepTermination } from './step-evidence.js'
import { StepDeadline } from './step-deadline.js'
import { ContextMessage, Step, StepReport, TerminationReason } from './types.js'
import type { RunStepOptions } from './runner.js'

export type StepExecutionDependencies = {
	config: ResolvedConfig
	aiClient: AiClient
	toolRegistry: ToolRegistry
	extensionHost: ExtensionHost
	tokenTracker: TokenTracker
}

export class StepExecution {
	private readonly config: ResolvedConfig
	private readonly aiClient: AiClient
	private readonly toolRegistry: ToolRegistry
	private readonly extensionHost: ExtensionHost
	private readonly tokenTracker: TokenTracker
	private readonly messages: ChatCompletionMessageParam[] = []
	private readonly ephemeralMessages = new Set<ChatCompletionMessageParam>()

	constructor({ config, aiClient, toolRegistry, extensionHost, tokenTracker }: StepExecutionDependencies) {
		this.config = config
		this.aiClient = aiClient
		this.toolRegistry = toolRegistry
		this.extensionHost = extensionHost
		this.tokenTracker = tokenTracker
	}

	async run(step: Step, options: RunStepOptions = {}): Promise<StepReport> {
		logger.info(`step started:\n${JSON.stringify(step, null, 2).replaceAll('  ', '').trim()}`)

		const model = this.config.model
		const evidence = new StepEvidence({ step, model })
		const deadline = new StepDeadline({
			stepTimeout: this.config.stepTimeout,
			testTimeoutRemaining: options.testTimeoutRemaining,
		})
		const turnProcessor = new TurnProcessor({
			config: this.config,
			toolRegistry: this.toolRegistry,
			loopDetector: new LoopDetector(this.config.loopMaxRepetitions),
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
		try {
			for (;;) {
				if (turns >= this.config.turnCap) {
					return this.finish(evidence, { outcome: 'failed', reason: 'turn-cap-exceeded', turns })
				}

				const deadlineReason = deadline.poll()
				if (deadlineReason) {
					return this.finish(evidence, { outcome: 'failed', reason: deadlineReason, turns })
				}

				turns++

				try {
					const { response, assistantMessages } = await this.aiClient.send(this.messages, {
						step,
						signal: deadline.signal,
					})
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
					const deadlineReason = deadline.poll()
					if (deadlineReason) {
						return this.finish(evidence, { outcome: 'failed', reason: deadlineReason, turns })
					}

					return this.finish(evidence, {
						outcome: 'failed',
						reason: infraReason(error),
						actual: describeError(error),
						turns,
					})
				}
			}
		} finally {
			deadline.dispose()
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
