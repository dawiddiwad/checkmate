import { Step, StepStatusCallback } from "../types"
import { OpenAIClient } from "./openai-client"
import { HistoryManager } from "./history-manager"
import { ScreenshotProcessor } from "../tool/screenshot-processor"
import { TokenTracker } from "./token-tracker"
import { ToolDispatcher } from "../tool/tool-dispatcher"
import { ToolResponseHandler } from "../tool/tool-response-handler"
import { RateLimitHandler } from "./rate-limit-handler"
import { MessageContentHandler } from "./message-content-handler"
import { Page } from "@playwright/test"
import { ToolCall } from "../tool/openai-tool"
import { Response } from "openai/resources/responses/responses.mjs"

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
        this.toolResponseHandler = new ToolResponseHandler(
            openaiClient,
            historyManager,
            screenshotProcessor,
            this
        )
        this.rateLimitHandler = new RateLimitHandler()
        this.messageContentHandler = new MessageContentHandler(openaiClient, this)
    }

    resetStepTokens(): void {
        this.tokenTracker.resetStep()
    }

    async handleResponse(response: Response, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
        await this.rateLimitHandler.waitForRateLimit()

        const historyTokenCount = this.openaiClient.countHistoryTokens()
        this.tokenTracker.log(response, historyTokenCount, this.openaiClient.getConfigurationManager().getModel())

        if (!response.output || response.output.length === 0) {
            throw new Error(`No outputs found in response:\n${JSON.stringify(response, null, 2)}`)
        }

        for (const output of response.output) {
            if (output.type === 'function_call' && output.name) {
                const toolCallObj: ToolCall = {
                    name: output.name,
                    arguments: JSON.parse(output.arguments || '{}')
                }
                const toolResponse = await this.toolDispatcher.dispatch(toolCallObj, stepStatusCallback)
                if (toolResponse) {
                    return await this.toolResponseHandler.handle(output.call_id, toolResponse, step, stepStatusCallback)
                }
            } else {
                await this.messageContentHandler.handle(output, step, stepStatusCallback)
            }
        }
    }
}
