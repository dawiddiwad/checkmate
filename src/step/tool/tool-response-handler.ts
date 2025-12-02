import { OpenAIClient } from "../openai/openai-client"
import { HistoryManager } from "../openai/history-manager"
import { ScreenshotProcessor } from "./screenshot-processor"
import { SnapshotProcessor } from "./snapshot-processor"
import { ToolResponse } from "./tool-registry"
import { Step, StepStatusCallback } from "../types"
import { ResponseProcessor } from "../openai/response-processor"

export class ToolResponseHandler {
    private readonly openaiClient: OpenAIClient
    private readonly historyManager: HistoryManager
    private readonly screenshotProcessor: ScreenshotProcessor
    private readonly snapshotProcessor: SnapshotProcessor
    private readonly responseProcessor: ResponseProcessor

    constructor(
        openaiClient: OpenAIClient, 
        historyManager: HistoryManager, 
        screenshotProcessor: ScreenshotProcessor, 
        snapshotProcessor: SnapshotProcessor,
        responseProcessor: ResponseProcessor
    ) {
        this.openaiClient = openaiClient
        this.historyManager = historyManager
        this.screenshotProcessor = screenshotProcessor
        this.snapshotProcessor = snapshotProcessor
        this.responseProcessor = responseProcessor
    }

    public async handle(
        toolCallId: string,
        toolResponse: ToolResponse,
        step: Step,
        stepStatusCallback: StepStatusCallback
    ): Promise<void> {
        const config = this.openaiClient.getConfigurationManager()

        const processedResponse = config.enableSnapshotCompression()
            ? this.snapshotProcessor.getCompressed(toolResponse)
            : toolResponse
        const responseContent = JSON.stringify(processedResponse.response)

        await this.openaiClient.addToolResponse(toolCallId, responseContent)

        if (config.includeScreenshotInSnapshot()) {
            const screenshot = await this.screenshotProcessor.getCompressedScreenshot()
            await this.openaiClient.addScreenshotMessage(screenshot.data, screenshot.mimeType ?? 'image/png')
        }

        await this.historyManager.removeSnapshotEntries(this.openaiClient, toolCallId)

        const nextResponse = await this.openaiClient.sendToolResponseWithRetry()
        await this.responseProcessor.handleResponse(nextResponse, step, stepStatusCallback)
    }
}