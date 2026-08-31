import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { ResolvedConfig } from '../config/resolved-config.js'
import { logger } from '../logging/index.js'
import { scrub } from '../redaction/scrub.js'
import { ToolCall, ToolExecution, ToolResponse } from '../tools/types.js'
import { MessageHistory } from './message-history.js'

export class ToolResponseHandler {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly messageHistory: MessageHistory
	) {}

	build(toolResults: ToolExecution[]): ChatCompletionMessageParam[] {
		if (toolResults.length === 0) {
			return []
		}

		const messages: ChatCompletionMessageParam[] = []

		for (const { toolCallId, toolCall, toolResponse } of toolResults) {
			this.logModelBoundToolResponse(toolCallId, toolCall, toolResponse)
			if (toolResponse.status === 'error') {
				this.logErrorResponse(toolCallId, toolCall, toolResponse)
			}
			messages.push({ role: 'tool', tool_call_id: toolCallId, content: toolResponse.response })
		}

		const executionSummary = buildToolExecutionSummary(toolResults)
		if (executionSummary) {
			messages.push(this.messageHistory.createToolExecutionSummaryMessage(executionSummary))
		}

		return messages
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
		return this.config.logLevel === 'debug'
	}
}

function buildToolExecutionSummary(toolResults: ToolExecution[]): string {
	const summaryLines = toolResults.map(({ toolCall, toolResponse }) =>
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
	return truncateText(scrub(value), maxLength)
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value
	}

	return `${value.slice(0, maxLength - 3)}...`
}
