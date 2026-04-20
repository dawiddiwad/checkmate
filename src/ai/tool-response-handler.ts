import { Step, ResolveStepResult } from '../runtime/types.js'
import { ToolResponse } from '../tools/registry.js'
import { ToolCall } from '../tools/types.js'
import { AiClient } from './client.js'
import { MessageHistory } from './message-history.js'
import { ResponseProcessor } from './response-processor.js'
import { ExtensionHost } from '../runtime/extension.js'

export class ToolResponseHandler {
	constructor(
		private readonly aiClient: AiClient,
		private readonly messageHistory: MessageHistory,
		private readonly responseProcessor: ResponseProcessor,
		private readonly extensionHost: ExtensionHost
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

		for (const { toolCallId, toolResponse } of toolResponses) {
			await this.aiClient.addToolResponse(toolCallId, toolResponse.response)
		}

		const executionSummary = buildToolExecutionSummary(toolResponses)
		if (executionSummary) {
			await this.aiClient.addToolExecutionSummaryMessage(executionSummary)
		}

		await this.extensionHost.handleToolResponses({
			aiClient: this.aiClient,
			step,
			resolveStepResult,
			toolResponses,
		})

		const nextResponse = await this.aiClient.sendToolResponseWithRetry()
		await this.responseProcessor.handleResponse(nextResponse, step, resolveStepResult)
	}
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
