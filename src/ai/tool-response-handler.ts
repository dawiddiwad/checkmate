import { RuntimeConfig } from '../config/runtime-config'
import { Step, ResolveStepResult } from '../runtime/types'
import { BrowserScreenshotService } from '../tools/browser/screenshot-service'
import { ToolResponse } from '../tools/registry'
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
		toolResponse: ToolResponse,
		step: Step,
		resolveStepResult: ResolveStepResult
	): Promise<void> {
		await this.handleMultiple([{ toolCallId, toolResponse }], step, resolveStepResult)
	}

	async handleMultiple(
		toolResponses: Array<{ toolCallId: string; toolResponse: ToolResponse }>,
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

		for (const [index, { toolCallId, toolResponse }] of toolResponses.entries()) {
			await this.aiClient.addToolResponse(toolCallId, toolResponse.response)

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
