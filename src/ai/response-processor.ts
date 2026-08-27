import { ChatCompletion } from 'openai/resources/chat/completions'
import { Step, ResolveStepResult } from '../runtime/types.js'
import { ToolDispatcher } from '../tools/dispatcher.js'
import { ToolResponse } from '../tools/registry.js'
import { ToolCall } from '../tools/types.js'
import { AiClient } from './client.js'
import { MessageHandler } from './message-handler.js'
import { MessageHistory } from './message-history.js'
import { RateLimitPolicy } from './rate-limit-policy.js'
import { TokenTracker } from './token-tracker.js'
import { ToolResponseHandler } from './tool-response-handler.js'
import { ExtensionHost } from '../runtime/extension.js'

export type ResponseProcessorDependencies = {
	aiClient: AiClient
	extensionHost: ExtensionHost
}

export class ResponseProcessor {
	private readonly tokenTracker = new TokenTracker()
	private readonly toolDispatcher: ToolDispatcher
	private readonly toolResponseHandler: ToolResponseHandler
	private readonly rateLimitPolicy = new RateLimitPolicy()
	private readonly messageHandler: MessageHandler
	private readonly aiClient: AiClient

	constructor({ aiClient, extensionHost }: ResponseProcessorDependencies) {
		this.aiClient = aiClient
		this.toolDispatcher = new ToolDispatcher(aiClient.getToolRegistry())
		this.toolResponseHandler = new ToolResponseHandler(aiClient, new MessageHistory(), this, extensionHost)
		this.messageHandler = new MessageHandler(aiClient, this)
	}

	resetStepTokens(): void {
		this.tokenTracker.resetStep()
	}

	async handleResponse(response: ChatCompletion, step: Step, resolveStepResult: ResolveStepResult): Promise<void> {
		await this.rateLimitPolicy.wait()

		const historyTokenCount = this.aiClient.countHistoryTokens()
		this.tokenTracker.log(response, historyTokenCount, this.aiClient.getRuntimeConfig().getModel())

		if (!response.choices || response.choices.length === 0) {
			throw new Error(`No choices found in response:\n${JSON.stringify(response, null, 2)}`)
		}

		for (const choice of response.choices) {
			if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
				await this.messageHandler.handle(choice, step, resolveStepResult)
				continue
			}

			const toolResponses: Array<{ toolCallId: string; toolCall: ToolCall; toolResponse: ToolResponse }> = []
			let dispatchedToolCall = false

			for (const toolCall of choice.message.tool_calls) {
				if (toolCall.type !== 'function') {
					continue
				}

				dispatchedToolCall = true
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
				let toolResponse: ToolResponse | null
				try {
					toolResponse = await this.toolDispatcher.dispatch(parsedToolCall, { step, resolveStepResult })
				} catch (error) {
					throw new Error(
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
				if (toolResponse) {
					toolResponses.push({ toolCallId: toolCall.id, toolCall: parsedToolCall, toolResponse })
				}
			}

			if (toolResponses.length > 0) {
				await this.toolResponseHandler.handleMultiple(toolResponses, step, resolveStepResult)
				return
			}

			if (dispatchedToolCall) {
				return
			}

			await this.messageHandler.handle(choice, step, resolveStepResult)
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
			throw new Error(
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

function preview(value: unknown, maxLength: number): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	const safeText = (text ?? String(value))
		.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
		.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')
		.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
	return safeText.length <= maxLength ? safeText : `${safeText.slice(0, maxLength - 3)}...`
}
