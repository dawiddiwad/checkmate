import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AiClient } from '../ai/client.js'
import { MessageHistory } from '../ai/message-history.js'
import { STEP_START_USER_PROMPT, STEP_SYSTEM_PROMPT } from '../ai/prompts.js'
import { TurnProcessor } from '../ai/turn-processor.js'
import type { ResolvedConfig } from '../config/resolved-config.js'
import type { DriverSession, StepIntent } from '../driver.js'
import type { RuntimeLogger } from '../logging/types.js'
import { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'
import { ToolDispatchError } from '../tools/dispatcher.js'
import { LoopDetector } from '../tools/loop-detector.js'
import type { ToolRegistry } from '../tools/registry.js'
import { DriverBoundaryError } from './driver-boundary.js'
import { buildInitialDriverContext, buildPostToolDriverContext, isEphemeralDriverMessage } from './driver-session.js'
import { InternalStepEvidence, type InternalStepTermination } from './internal-step-evidence.js'
import type { StepControl } from './scenario-control.js'
import type { InternalStepReport, InternalTerminationReason } from './types.js'
import {
	ProviderUsageInvalidError,
	ProviderUsageUnavailableError,
	ScenarioUsageTracker,
	TokenBudgetExceededError,
} from './usage-tracker.js'

export type StepExecutionDependencies = {
	config: ResolvedConfig
	aiClient: AiClient
	toolRegistry: ToolRegistry
	driverSession: DriverSession
	usageTracker: ScenarioUsageTracker
	driverId: string
	redact: boolean
	diagnosticSanitizer: DiagnosticSanitizer
	logger: RuntimeLogger
}

/** Authoritative driver-backed model/tool loop. */
export class StepExecution {
	constructor(private readonly dependencies: StepExecutionDependencies) {}

	async run(step: StepIntent, control: StepControl): Promise<InternalStepReport> {
		const {
			config,
			aiClient,
			toolRegistry,
			driverSession,
			usageTracker,
			driverId,
			redact,
			diagnosticSanitizer,
			logger,
		} = this.dependencies
		const evidence = new InternalStepEvidence(step, driverId, redact, diagnosticSanitizer)
		const checkpoint = usageTracker.beginStep()
		const messages: ChatCompletionMessageParam[] = []
		const ephemeralMessages = new Set<ChatCompletionMessageParam>()
		const turnProcessor = new TurnProcessor({
			config,
			toolRegistry,
			loopDetector: new LoopDetector(config.loopMaxRepetitions),
			evidence,
			logger,
		})
		messages.push(
			...new MessageHistory().buildInitialMessages({
				systemPrompt: STEP_SYSTEM_PROMPT([...driverSession.instructions]),
				userPrompt: STEP_START_USER_PROMPT(step),
			})
		)
		logger.info(`step started: ${step.id}`)

		let turns = 0
		try {
			try {
				appendDriverContext(
					messages,
					ephemeralMessages,
					await buildInitialDriverContext(driverSession, step, control)
				)
			} catch (error) {
				return finish(
					evidence,
					usageTracker,
					checkpoint,
					failureFrom(error, control, turns, diagnosticSanitizer),
					logger
				)
			}

			for (;;) {
				if (turns >= config.turnCap) {
					return finish(
						evidence,
						usageTracker,
						checkpoint,
						{ outcome: 'failed', reason: 'turn-cap-exceeded', turns },
						logger
					)
				}
				const expired = control.poll()
				if (expired.expired) {
					return finish(
						evidence,
						usageTracker,
						checkpoint,
						{ outcome: 'failed', reason: expired.reason, turns },
						logger
					)
				}

				turns++
				try {
					const { response, assistantMessages } = await aiClient.send(messages, {
						step,
						signal: control.signal,
					})
					usageTracker.record(response.usage)
					assertControlLive(control, 'provider-response')
					messages.push(...assistantMessages)
					const outcome = await turnProcessor.process({ response, step, turn: turns, control })
					assertControlLive(control, 'turn-processing')

					if (outcome.kind === 'assertion') {
						return finish(
							evidence,
							usageTracker,
							checkpoint,
							{
								outcome: outcome.passed ? 'passed' : 'failed',
								reason: outcome.passed ? 'met-expectation' : 'failed-expectation',
								actual: outcome.actual,
								turns,
							},
							logger
						)
					}
					if (outcome.kind === 'stuck') {
						return finish(
							evidence,
							usageTracker,
							checkpoint,
							{
								outcome: 'failed',
								reason: 'loop-detected',
								actual: 'the model repeated the same tool calls without reaching a result',
								turns,
							},
							logger
						)
					}

					dropEphemeralMessages(messages, ephemeralMessages)
					messages.push(...outcome.messages)
					appendDriverContext(
						messages,
						ephemeralMessages,
						await buildPostToolDriverContext(driverSession, step, turns, outcome.toolResults, control)
					)
				} catch (error) {
					return finish(
						evidence,
						usageTracker,
						checkpoint,
						failureFrom(error, control, turns, diagnosticSanitizer),
						logger
					)
				}
			}
		} finally {
			control.dispose()
		}
	}
}

function finish(
	evidence: InternalStepEvidence,
	usageTracker: ScenarioUsageTracker,
	checkpoint: ReturnType<ScenarioUsageTracker['beginStep']>,
	termination: InternalStepTermination,
	logger: RuntimeLogger
): InternalStepReport {
	if (termination.reason === 'step-timeout' || termination.reason === 'scenario-timeout') {
		evidence.recordDiagnostic({
			code: 'expired-boundary',
			path: '',
			message: termination.actual ?? `Step execution expired with ${termination.reason}`,
		})
	}
	const report = evidence.buildReport(termination, usageTracker.stepUsage(checkpoint))
	logger.info(`step finished: ${report.step.id} ${report.outcome} (${report.category} / ${report.reason})`)
	return report
}

function appendDriverContext(
	messages: ChatCompletionMessageParam[],
	ephemeralMessages: Set<ChatCompletionMessageParam>,
	context: ChatCompletionMessageParam[]
): void {
	for (const message of context) {
		messages.push(message)
		if (isEphemeralDriverMessage(message)) ephemeralMessages.add(message)
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

function assertControlLive(control: StepControl, operation: string): void {
	const expired = control.poll()
	if (expired.expired) throw new DriverBoundaryError(operation, expired.reason)
}

function failureFrom(
	error: unknown,
	control: StepControl,
	turns: number,
	sanitizer: DiagnosticSanitizer
): InternalStepTermination {
	const actual = sanitizer.error(error)
	const expired = control.poll()
	if (expired.expired) return { outcome: 'failed', reason: expired.reason, actual, turns }
	if (error instanceof DriverBoundaryError) return { outcome: 'failed', reason: error.reason, actual, turns }
	if (error instanceof TokenBudgetExceededError) {
		return { outcome: 'failed', reason: 'token-budget-exceeded', actual, turns }
	}
	if (error instanceof ProviderUsageUnavailableError || error instanceof ProviderUsageInvalidError) {
		return { outcome: 'failed', reason: 'provider-error', actual, turns }
	}
	if (error instanceof ToolDispatchError) return { outcome: 'failed', reason: 'tool-error', actual, turns }
	return { outcome: 'failed', reason: driverInfraReason(error), actual, turns }
}

function driverInfraReason(error: unknown): InternalTerminationReason {
	return error instanceof ToolDispatchError ? 'tool-error' : 'provider-error'
}
