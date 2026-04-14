import { Page } from '@playwright/test'
import { ChatCompletion } from 'openai/resources/chat/completions'
import { Step, ResolveStepResult } from '../runtime/types'
import { BrowserScreenshotService } from '../tools/browser/screenshot-service'
import { ToolDispatcher } from '../tools/dispatcher'
import { ToolResponse } from '../tools/registry'
import { ToolCall } from '../tools/tool-contract'
import { AiClient } from './client'
import { MessageHandler } from './message-handler'
import { MessageHistory } from './message-history'
import { RateLimitPolicy } from './rate-limit-policy'
import { TokenTracker } from './token-tracker'
import { ToolResponseHandler } from './tool-response-handler'

export type ResponseProcessorDependencies = {
	page: Page
	aiClient: AiClient
}

export class ResponseProcessor {
	private readonly tokenTracker = new TokenTracker()
	private readonly toolDispatcher: ToolDispatcher
	private readonly toolResponseHandler: ToolResponseHandler
	private readonly rateLimitPolicy = new RateLimitPolicy()
	private readonly messageHandler: MessageHandler
	private readonly aiClient: AiClient

	constructor({ page, aiClient }: ResponseProcessorDependencies) {
		this.aiClient = aiClient
		this.toolDispatcher = new ToolDispatcher(aiClient.getToolRegistry())
		this.toolResponseHandler = new ToolResponseHandler(
			aiClient,
			new MessageHistory(),
			new BrowserScreenshotService(page),
			this
		)
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

			const toolResponses: Array<{ toolCallId: string; toolResponse: ToolResponse }> = []
			let dispatchedToolCall = false

			for (const toolCall of choice.message.tool_calls) {
				if (toolCall.type !== 'function') {
					continue
				}

				dispatchedToolCall = true
				const parsedToolCall: ToolCall = {
					name: toolCall.function.name,
					arguments: JSON.parse(toolCall.function.arguments || '{}'),
				}
				const toolResponse = await this.toolDispatcher.dispatch(parsedToolCall, resolveStepResult)
				if (toolResponse) {
					toolResponses.push({ toolCallId: toolCall.id, toolResponse })
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
}
