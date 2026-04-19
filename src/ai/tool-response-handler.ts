import { RuntimeConfig } from '../config/runtime-config'
import { CheckmateBrowserService, CheckmateContextItem, CheckmateServices } from '../runtime/module'
import { Step, ResolveStepResult } from '../runtime/types'
import { ToolResponse } from '../tools/registry'
import { ToolCall } from '../tools/types'
import { AiClient } from './client'
import { MessageHistory } from './message-history'
import { ResponseProcessor } from './response-processor'

export class ToolResponseHandler {
	constructor(
		private readonly aiClient: AiClient,
		private readonly messageHistory: MessageHistory,
		private readonly responseProcessor: ResponseProcessor,
		private readonly config: RuntimeConfig = new RuntimeConfig()
	) {}

	async handle(
		toolCallId: string,
		toolCall: ToolCall,
		toolResponse: ToolResponse,
		step: Step,
		resolveStepResult: ResolveStepResult
	): Promise<void> {
		await this.handleMultiple([{ toolCallId, toolCall, toolResponse }], step, resolveStepResult)
	}

	async handleMultiple(
		toolResponses: Array<{ toolCallId: string; toolCall: ToolCall; toolResponse: ToolResponse }>,
		step: Step,
		resolveStepResult: ResolveStepResult
	): Promise<void> {
		if (toolResponses.length === 0) {
			return
		}

		this.messageHistory.removeEphemeralStateMessages(this.aiClient)

		const latestContext: CheckmateContextItem[] = []
		for (const { toolResponse } of toolResponses) {
			if (toolResponse.context) {
				latestContext.splice(0, latestContext.length, ...toolResponse.context)
			}
		}

		for (const { toolCallId, toolResponse } of toolResponses) {
			await this.aiClient.addToolResponse(toolCallId, toolResponse.response)
		}

		const executionSummary = buildToolExecutionSummary(toolResponses)
		if (executionSummary) {
			await this.aiClient.addToolExecutionSummaryMessage(executionSummary)
		}

		if (this.config.includeScreenshotInSnapshot()) {
			const browser = getBrowserService(this.aiClient.getServices())
			if (browser) {
				latestContext.push(await browser.getScreenshotContextItem())
			}
		}

		if (latestContext.length > 0) {
			await this.aiClient.addMessages(this.messageHistory.buildContextMessages(latestContext))
		}

		const nextResponse = await this.aiClient.sendToolResponseWithRetry()
		await this.responseProcessor.handleResponse(nextResponse, step, resolveStepResult)
	}
}

function getBrowserService(services: CheckmateServices): CheckmateBrowserService | undefined {
	return services.browser as CheckmateBrowserService | undefined
}

function buildToolExecutionSummary(
	toolResponses: Array<{ toolCallId: string; toolCall: ToolCall; toolResponse: ToolResponse }>
): string {
	const summaryLines = toolResponses.map(({ toolCall, toolResponse }) =>
		formatToolExecutionSummary(toolCall, toolResponse)
	)
	return summaryLines.join('\n')
}

function formatToolExecutionSummary(toolCall: ToolCall, toolResponse: ToolResponse): string {
	const serializedArguments = truncateText(JSON.stringify(toolCall.arguments ?? {}), 300)
	if (toolResponse.status === 'error') {
		return `- tool call error: ${toolCall.name} ${serializedArguments} -> ${truncateText(toolResponse.response, 500)}`
	}

	return `- successfully executed: ${toolCall.name} ${serializedArguments}`
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value
	}

	return `${value.slice(0, maxLength - 3)}...`
}
