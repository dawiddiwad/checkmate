import { logger } from '../logging/index.js'
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

		for (const { toolCallId, toolCall, toolResponse } of toolResponses) {
			if (toolResponse.status === 'error') {
				logger.warn(
					`tool response error:\ntool_call_id: ${toolCallId}\ntool: ${toolCall.name}\narguments: ${safePreview(JSON.stringify(toolCall.arguments ?? {}), 1_000)}\nresponse: ${safePreview(toolResponse.response, 2_000)}`
				)
			}
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

function safePreview(value: string, maxLength: number): string {
	return truncateText(redact(value), maxLength)
}

function redact(value: string): string {
	return redactSecretFields(value)
		.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
		.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')
		.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [secret omitted]')
		.replace(/Authorization\s*[:=]\s*[^\s,;}]+/gi, '[secret omitted]')
		.replace(/Cookie\s*[:=]\s*[^\n,;}]+/gi, '[secret omitted]')
}

function redactSecretFields(value: string): string {
	const secretKey = String.raw`(?:OPENAI_API_KEY|api[_-]?key|apikey|authorization|cookie)`
	return value
		.replace(
			new RegExp(String.raw`(["'])${secretKey}\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2\s*,?`, 'gi'),
			'[secret omitted]'
		)
		.replace(
			new RegExp(String.raw`\b${secretKey}\b\s*[:=]\s*(?:Bearer\s+[^\s,;}]+|"[^"]*"|'[^']*'|[^\s,;}]+)`, 'gi'),
			'[secret omitted]'
		)
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value
	}

	return `${value.slice(0, maxLength - 3)}...`
}
