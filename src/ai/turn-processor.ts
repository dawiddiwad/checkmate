import { ChatCompletion } from 'openai/resources/chat/completions'
import { RuntimeConfig } from '../runtime/config.js'
import { InternalStepEvidence } from '../runtime/internal-step-evidence.js'
import type { StepControl } from '../runtime/scenario-control.js'
import type { StructuredGenerationGateway } from '../runtime/structured-generation.js'
import { Step, TurnOutcome } from '../runtime/types.js'
import type { RuntimeLogger } from '../logging/types.js'
import { ToolDispatcher, ToolDispatchError } from '../tools/dispatcher.js'
import { LoopDetectedError, LoopDetector } from '../tools/loop-detector.js'
import { ToolRegistry } from '../tools/registry.js'
import { ToolCall, ToolExecution, ToolResponse } from '../tools/types.js'
import { MessageHandler } from './message-handler.js'
import { MessageHistory } from './message-history.js'
import { RateLimitPolicy } from './rate-limit-policy.js'
import { ToolResponseHandler } from './tool-response-handler.js'

export type TurnProcessorDependencies = {
	config: RuntimeConfig
	toolRegistry: ToolRegistry
	loopDetector: LoopDetector
	evidence: Pick<InternalStepEvidence, 'recordAssistantMessage' | 'recordToolCall'>
	logger: RuntimeLogger
}

export type Turn = {
	response: ChatCompletion
	step: Step
	turn: number
	control?: StepControl
	generation?: StructuredGenerationGateway
}

export class TurnProcessor {
	private readonly toolDispatcher: ToolDispatcher
	private readonly toolResponseHandler: ToolResponseHandler
	private readonly messageHandler: MessageHandler
	private readonly rateLimitPolicy: RateLimitPolicy
	private readonly evidence: Pick<InternalStepEvidence, 'recordAssistantMessage' | 'recordToolCall'>

	constructor({ config, toolRegistry, loopDetector, evidence, logger: runtimeLogger }: TurnProcessorDependencies) {
		this.toolDispatcher = new ToolDispatcher(toolRegistry, loopDetector, runtimeLogger, config.logLevel === 'debug')
		this.toolResponseHandler = new ToolResponseHandler(config, new MessageHistory(), runtimeLogger)
		this.messageHandler = new MessageHandler(runtimeLogger)
		this.rateLimitPolicy = new RateLimitPolicy(config, runtimeLogger)
		this.evidence = evidence
	}

	async process({ response, step, turn, control, generation }: Turn): Promise<TurnOutcome> {
		await this.rateLimitPolicy.wait(control?.signal)

		if (!response.choices || response.choices.length === 0) {
			throw new Error(`No choices found in response:\n${JSON.stringify(response, null, 2)}`)
		}

		const choice = response.choices[0]
		this.recordAssistantMessage(choice, turn)

		const toolCalls = (choice.message.tool_calls ?? []).filter((toolCall) => toolCall.type === 'function')
		if (toolCalls.length === 0) {
			return this.messageHandler.handle(choice, step)
		}

		const toolResults: ToolExecution[] = []

		for (const toolCall of toolCalls) {
			const parsedToolCall: ToolCall = {
				name: toolCall.function.name,
				arguments: this.parseToolArguments(
					toolCall.function.arguments || '{}',
					toolCall.id,
					toolCall.function.name,
					choice,
					response,
					step
				),
			}

			let toolResponse: ToolResponse
			try {
				const context = control ? { step, turn, signal: control.signal, control, generation } : { step, turn }
				toolResponse =
					(await this.toolDispatcher.dispatch(parsedToolCall, context)) ??
					noOutputResponse(parsedToolCall.name)
			} catch (error) {
				if (error instanceof LoopDetectedError) {
					return { kind: 'stuck', reason: 'loop-detected' }
				}

				throw new ToolDispatchError(
					[
						`Tool dispatch failed: ${parsedToolCall.name}`,
						`tool_call_id: ${toolCall.id}`,
						`arguments: ${preview(parsedToolCall.arguments, 1_000)}`,
						this.formatChoiceContext(choice, response, step),
						`original_error: ${error instanceof Error ? error.message : String(error)}`,
					].join('\n'),
					{ cause: error }
				)
			}

			this.evidence.recordToolCall(turn, parsedToolCall, toolResponse)

			if (toolResponse.assertion) {
				return { kind: 'assertion', ...toolResponse.assertion }
			}

			toolResults.push({ toolCallId: toolCall.id, toolCall: parsedToolCall, toolResponse })
		}

		return { kind: 'continue', toolResults, messages: this.toolResponseHandler.build(toolResults) }
	}

	private recordAssistantMessage(choice: ChatCompletion.Choice, turn: number): void {
		if (typeof choice.message.content === 'string' && choice.message.content.trim().length > 0) {
			this.evidence.recordAssistantMessage(turn, choice.message.content)
		}
	}

	private parseToolArguments(
		rawArguments: string,
		toolCallId: string,
		toolName: string,
		choice: ChatCompletion.Choice,
		response: ChatCompletion,
		step: Step
	): unknown {
		try {
			return JSON.parse(rawArguments)
		} catch (error) {
			throw new ToolDispatchError(
				[
					`Malformed tool arguments for ${toolName}`,
					`tool_call_id: ${toolCallId}`,
					`raw_arguments: ${preview(rawArguments, 1_000)}`,
					this.formatChoiceContext(choice, response, step),
					`original_error: ${error instanceof Error ? error.message : String(error)}`,
				].join('\n'),
				{ cause: error }
			)
		}
	}

	private formatChoiceContext(choice: ChatCompletion.Choice, response: ChatCompletion, step: Step): string {
		return [
			`step_action: ${step.action}`,
			`step_expect: ${step.expect}`,
			`response_id: ${response.id}`,
			`response_model: ${response.model}`,
			`choice_index: ${choice.index}`,
			`finish_reason: ${choice.finish_reason}`,
			`assistant_content: ${preview(choice.message.content, 1_000)}`,
			`assistant_refusal: ${preview(choice.message.refusal, 1_000)}`,
		].join('\n')
	}
}

function noOutputResponse(toolName: string): ToolResponse {
	return { name: toolName, response: 'tool completed without output', snapshot: null, status: 'success' }
}

function preview(value: unknown, maxLength: number): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	const safeText = (text ?? String(value))
		.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
		.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')
		.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
	return safeText.length <= maxLength ? safeText : `${safeText.slice(0, maxLength - 3)}...`
}
