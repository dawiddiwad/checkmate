import { RuntimeConfig } from '../config/runtime-config'
import { Step, ResolveStepResult } from '../runtime/types'
import { BrowserScreenshotService } from '../tools/browser/screenshot-service'
import { ToolResponse } from '../tools/registry'
import { ToolCall } from '../tools/types'
import { AiClient } from './client'
import { MessageHistory } from './message-history'
import { ResponseProcessor } from './response-processor'

export class ToolResponseHandler {
	constructor(
		private readonly aiClient: AiClient,
		private readonly messageHistory: MessageHistory,
		private readonly screenshotService: BrowserScreenshotService,
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

		let latestSnapshot: string | null = null
		for (const { toolResponse } of toolResponses) {
			if (toolResponse.snapshot) {
				latestSnapshot = toolResponse.snapshot
			}
		}

		for (const { toolCallId, toolResponse } of toolResponses) {
			await this.aiClient.addToolResponse(toolCallId, toolResponse.response)
		}

		const executionSummary = buildToolExecutionSummary(toolResponses)
		if (executionSummary) {
			await this.aiClient.addToolExecutionSummaryMessage(executionSummary)
		}

		for (const [index] of toolResponses.entries()) {
			const isLast = index === toolResponses.length - 1
			if (isLast && latestSnapshot) {
				await this.aiClient.addCurrentSnapshotMessage(latestSnapshot)
			}

			if (isLast && this.config.includeScreenshotInSnapshot()) {
				const screenshot = await this.screenshotService.getCompressedScreenshot()
				await this.aiClient.addCurrentScreenshotMessage(screenshot.data, screenshot.mimeType ?? 'image/png')
			}
		}

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
