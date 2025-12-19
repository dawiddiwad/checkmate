import { OpenAIClient } from "../openai/openai-client"
import { HistoryManager } from "../openai/history-manager"
import { ScreenshotProcessor } from "./screenshot-processor"
import { ToolResponse } from "./tool-registry"
import { Step, StepStatusCallback } from "../types"
import { ResponseProcessor } from "../openai/response-processor"

export class ToolResponseHandler {
    private readonly openaiClient: OpenAIClient
    private readonly historyManager: HistoryManager
    private readonly screenshotProcessor: ScreenshotProcessor
    private readonly responseProcessor: ResponseProcessor

    constructor(
        openaiClient: OpenAIClient,
        historyManager: HistoryManager,
        screenshotProcessor: ScreenshotProcessor,
        responseProcessor: ResponseProcessor
    ) {
        this.openaiClient = openaiClient
        this.historyManager = historyManager
        this.screenshotProcessor = screenshotProcessor
        this.responseProcessor = responseProcessor
    }

    public async handle(
        toolCallId: string,
        toolResponse: ToolResponse,
        step: Step,
        stepStatusCallback: StepStatusCallback
    ): Promise<void> {
        await this.handleMultiple([{ toolCallId, toolResponse }], step, stepStatusCallback)
    }

    public async handleMultiple(
        toolResponses: Array<{ toolCallId: string, toolResponse: ToolResponse }>,
        step: Step,
        stepStatusCallback: StepStatusCallback
    ): Promise<void> {
        if (toolResponses.length === 0) return

        const config = this.openaiClient.getConfigurationManager()

        await this.historyManager.removeSnapshotEntries(this.openaiClient)

        for (const [index, { toolCallId, toolResponse }] of toolResponses.entries()) {
            const responseContent = toolResponse.response
            await this.openaiClient.addToolResponse(toolCallId, responseContent)

            const isLast = index === toolResponses.length - 1
            if (isLast && config.includeScreenshotInSnapshot()) {
                const screenshot = await this.screenshotProcessor.getCompressedScreenshot()
                await this.openaiClient.addScreenshotMessage(screenshot.data, screenshot.mimeType ?? 'image/png')
            }
        }

        await this.historyManager.removeSnapshotEntries(this.openaiClient)

        const nextResponse = await this.openaiClient.sendToolResponseWithRetry()
        await this.responseProcessor.handleResponse(nextResponse, step, stepStatusCallback)
    }
}