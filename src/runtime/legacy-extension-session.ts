import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AiClient } from '../ai/client.js'
import { MessageHistory } from '../ai/message-history.js'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts.js'
import { BudgetExceededError, TokenTracker } from '../ai/token-tracker.js'
import { TurnProcessor } from '../ai/turn-processor.js'
import type { ResolvedConfig } from '../config/resolved-config.js'
import { logger } from '../logging/index.js'
import { ToolDispatchError } from '../tools/dispatcher.js'
import { LoopDetector } from '../tools/loop-detector.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ExtensionHost } from './extension.js'
import { StepDeadline } from './step-deadline.js'
import { StepEvidence, type StepTermination } from './step-evidence.js'
import type { ContextMessage, Step, StepReport, TerminationReason } from './types.js'
import type { RunStepOptions } from './runner.js'

export type LegacyExtensionSessionDependencies = {
	config: ResolvedConfig
	aiClient: AiClient
	toolRegistry: ToolRegistry
	extensionHost: ExtensionHost
	tokenTracker: TokenTracker
}

/** Transitional Phase 4-6 owner for the legacy extension execution graph. */
export class LegacyExtensionSession {
	constructor(private readonly dependencies: LegacyExtensionSessionDependencies) {}

	async run(step: Step, options: RunStepOptions = {}): Promise<StepReport> {
		const { config, aiClient, toolRegistry, extensionHost, tokenTracker } = this.dependencies
		const messages: ChatCompletionMessageParam[] = []
		const ephemeralMessages = new Set<ChatCompletionMessageParam>()
		logger.info(`step started:\n${JSON.stringify(step, null, 2).replaceAll('  ', '').trim()}`)

		const evidence = new StepEvidence({ step, model: config.model, redact: config.redact })
		const deadline = new StepDeadline({
			stepTimeout: config.stepTimeout,
			testTimeoutRemaining: options.testTimeoutRemaining,
		})
		const turnProcessor = new TurnProcessor({
			config,
			toolRegistry,
			loopDetector: new LoopDetector(config.loopMaxRepetitions),
			evidence,
			logger,
		})

		tokenTracker.resetStep()
		messages.push(
			...new MessageHistory().buildInitialMessages({
				systemPrompt: STEP_SYSTEM_PROMPT(extensionHost.getInstructions()),
				userPrompt: STEP_START_USER_PROMPT(step),
			})
		)
		appendContext(messages, ephemeralMessages, await extensionHost.buildInitialMessages(step))

		let turns = 0
		try {
			for (;;) {
				if (turns >= config.turnCap)
					return finish(evidence, { outcome: 'failed', reason: 'turn-cap-exceeded', turns })

				const deadlineReason = deadline.poll()
				if (deadlineReason) return finish(evidence, { outcome: 'failed', reason: deadlineReason, turns })

				turns++
				try {
					const { response, assistantMessages } = await aiClient.send(messages, {
						step,
						signal: deadline.signal,
					})
					messages.push(...assistantMessages)
					tokenTracker.log(response, aiClient.countHistoryTokens(messages), config.model)
					evidence.recordUsage(response.usage)
					const outcome = await turnProcessor.process({ response, step, turn: turns })

					if (outcome.kind === 'assertion') {
						return finish(evidence, {
							outcome: outcome.passed ? 'passed' : 'failed',
							reason: outcome.passed ? 'met-expectation' : 'failed-expectation',
							actual: outcome.actual,
							turns,
						})
					}
					if (outcome.kind === 'stuck') {
						return finish(evidence, {
							outcome: 'failed',
							reason: 'loop-detected',
							actual: 'the model repeated the same tool calls without reaching a result',
							turns,
						})
					}

					dropEphemeralMessages(messages, ephemeralMessages)
					messages.push(...outcome.messages)
					appendContext(
						messages,
						ephemeralMessages,
						await extensionHost.handleToolResponses({
							step,
							turn: turns,
							toolResponses: outcome.toolResults,
						})
					)
				} catch (error) {
					const expired = deadline.poll()
					return finish(evidence, {
						outcome: 'failed',
						reason: expired ?? legacyInfraReason(error),
						actual: describeLegacyError(error),
						turns,
					})
				}
			}
		} finally {
			deadline.dispose()
		}
	}
}

function finish(evidence: StepEvidence, termination: StepTermination): StepReport {
	const report = evidence.buildReport(termination)
	logger.info(`step finished: ${report.outcome} (${report.category} / ${report.reason})`)
	return report
}

function appendContext(
	messages: ChatCompletionMessageParam[],
	ephemeralMessages: Set<ChatCompletionMessageParam>,
	contextMessages: ContextMessage[]
): void {
	for (const { message, ephemeral } of contextMessages) {
		messages.push(message)
		if (ephemeral) ephemeralMessages.add(message)
	}
}

function dropEphemeralMessages(
	messages: ChatCompletionMessageParam[],
	ephemeralMessages: Set<ChatCompletionMessageParam>
): void {
	if (ephemeralMessages.size === 0) return
	const retained = messages.filter((message) => !ephemeralMessages.has(message))
	messages.length = 0
	messages.push(...retained)
	ephemeralMessages.clear()
}

function legacyInfraReason(error: unknown): TerminationReason {
	if (error instanceof BudgetExceededError) return 'budget-exceeded'
	if (error instanceof ToolDispatchError) return 'tool-error'
	return 'provider-error'
}

function describeLegacyError(error: unknown): string {
	if (!(error instanceof Error)) return String(error)
	const messages = [error.message]
	let cause = error.cause
	while (cause instanceof Error) {
		messages.push(cause.message)
		cause = cause.cause
	}
	return messages.join('\ncaused by: ')
}
