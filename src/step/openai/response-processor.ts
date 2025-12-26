import { ChatCompletion } from 'openai/resources/chat/completions'
import { Step, StepStatusCallback } from '../types'
import { OpenAIClient } from './openai-client'
import { HistoryManager } from './history-manager'
import { ScreenshotProcessor } from '../tool/screenshot-processor'
import { TokenTracker } from './token-tracker'
import { ToolDispatcher } from '../tool/tool-dispatcher'
import { ToolResponseHandler } from '../tool/tool-response-handler'
import { ToolResponse } from '../tool/tool-registry'
import { RateLimitHandler } from './rate-limit-handler'
import { MessageContentHandler } from './message-content-handler'
import { Page } from '@playwright/test'
import { ToolCall } from '../tool/openai-tool'

export type ResponseProcessorDependencies = {
	page: Page
	openaiClient: OpenAIClient
}

export class ResponseProcessor {
	private readonly tokenTracker: TokenTracker
	private readonly openaiClient: OpenAIClient
	private readonly toolDispatcher: ToolDispatcher
	private readonly toolResponseHandler: ToolResponseHandler
	private readonly rateLimitHandler: RateLimitHandler
	private readonly messageContentHandler: MessageContentHandler

	constructor({ page, openaiClient }: ResponseProcessorDependencies) {
		this.openaiClient = openaiClient
		this.tokenTracker = new TokenTracker()
		this.toolDispatcher = new ToolDispatcher(openaiClient.getToolRegistry())
		const historyManager = new HistoryManager()
		const screenshotProcessor = new ScreenshotProcessor(page)
		this.toolResponseHandler = new ToolResponseHandler(openaiClient, historyManager, screenshotProcessor, this)
		this.rateLimitHandler = new RateLimitHandler()
		this.messageContentHandler = new MessageContentHandler(openaiClient, this)
	}

	resetStepTokens(): void {
		this.tokenTracker.resetStep()
	}

	async handleResponse(response: ChatCompletion, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
		await this.rateLimitHandler.waitForRateLimit()

		const historyTokenCount = this.openaiClient.countHistoryTokens()
		this.tokenTracker.log(response, historyTokenCount, this.openaiClient.getConfigurationManager().getModel())

		if (!response.choices || response.choices.length === 0) {
			throw new Error(`No choices found in response:\n${JSON.stringify(response, null, 2)}`)
		}

		for (const choice of response.choices) {
			if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
				const toolResponses: Array<{ toolCallId: string; toolResponse: ToolResponse }> = []
				let dispatchedToolCall = false

				for (const toolCall of choice.message.tool_calls) {
					if (toolCall.type !== 'function') continue
					dispatchedToolCall = true
					const toolCallObj: ToolCall = {
						name: toolCall.function.name,
						arguments: JSON.parse(toolCall.function.arguments || '{}'),
					}
					const toolResponse = await this.toolDispatcher.dispatch(toolCallObj, stepStatusCallback)
					if (toolResponse) {
						toolResponses.push({ toolCallId: toolCall.id, toolResponse })
					}
				}

				if (toolResponses.length > 0) {
					await this.toolResponseHandler.handleMultiple(toolResponses, step, stepStatusCallback)
					return
				}

				if (dispatchedToolCall) {
					return
				}

				await this.messageContentHandler.handle(choice, step, stepStatusCallback)
			} else {
				await this.messageContentHandler.handle(choice, step, stepStatusCallback)
			}
		}
	}
}
