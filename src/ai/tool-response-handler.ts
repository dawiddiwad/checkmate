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
			this.logModelBoundToolResponse(toolCallId, toolCall, toolResponse)
			if (toolResponse.status === 'error') {
				this.logErrorResponse(toolCallId, toolCall, toolResponse)
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

	private logModelBoundToolResponse(toolCallId: string, toolCall: ToolCall, toolResponse: ToolResponse): void {
		if (!this.isDebugMode()) {
			return
		}

		logger.debug(
			[
				'tool response returned to model:',
				`tool_call_id: ${toolCallId}`,
				`tool: ${toolCall.name}`,
				`status: ${toolResponse.status}`,
				`arguments: ${safePreview(JSON.stringify(toolCall.arguments ?? {}), 1_000)}`,
				`response: ${safePreview(toolResponse.response, 2_000)}`,
				`snapshot: ${formatSnapshotMetadata(toolResponse.snapshot)}`,
			].join('\n')
		)
	}

	private logErrorResponse(toolCallId: string, toolCall: ToolCall, toolResponse: ToolResponse): void {
		const responseLine = this.isDebugMode()
			? 'response: logged at debug level'
			: `response: ${safePreview(toolResponse.response, 2_000)}`

		logger.warn(
			[
				'tool response error:',
				`tool_call_id: ${toolCallId}`,
				`tool: ${toolCall.name}`,
				`arguments: ${safePreview(JSON.stringify(toolCall.arguments ?? {}), 1_000)}`,
				responseLine,
			].join('\n')
		)
	}

	private isDebugMode(): boolean {
		return this.aiClient.getRuntimeConfig().getLogLevel() === 'debug'
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

function formatSnapshotMetadata(snapshot: string | null | undefined): string {
	if (!snapshot) {
		return 'none'
	}

	return `present (${snapshot.length} chars, content logged by SnapshotService)`
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
