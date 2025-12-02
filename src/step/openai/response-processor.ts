import { ChatCompletion } from "openai/resources/chat/completions"
import { ToolCall } from "../../mcp/server/openai-mcp"
import { Step, StepStatusCallback } from "../types"
import { OpenAIClient } from "./openai-client"
import { HistoryManager } from "./history-manager"
import { ScreenshotProcessor } from "../tool/screenshot-processor"
import { SnapshotProcessor } from "../tool/snapshot-processor"
import { TokenTracker } from "./token-tracker"
import { OpenAIServerMCP } from "../../mcp/server/openai-mcp"
import { ToolDispatcher } from "../tool/tool-dispatcher"
import { ToolResponseHandler } from "../tool/tool-response-handler"
import { RateLimitHandler } from "./rate-limit-handler"
import { MessageContentHandler } from "./message-content-handler"

export type ResponseProcessorDependencies = {
    playwrightMCP: OpenAIServerMCP
    openaiClient: OpenAIClient
}

export class ResponseProcessor {
    private readonly tokenTracker: TokenTracker
    private readonly openaiClient: OpenAIClient
    private readonly toolDispatcher: ToolDispatcher
    private readonly toolResponseHandler: ToolResponseHandler
    private readonly rateLimitHandler: RateLimitHandler
    private readonly messageContentHandler: MessageContentHandler

    constructor({ playwrightMCP, openaiClient }: ResponseProcessorDependencies) {
        this.openaiClient = openaiClient
        this.tokenTracker = new TokenTracker()
        this.toolDispatcher = new ToolDispatcher(openaiClient.getToolRegistry())
        const historyManager = new HistoryManager()
        const screenshotProcessor = new ScreenshotProcessor(playwrightMCP)
        const snapshotProcessor = new SnapshotProcessor()
        this.toolResponseHandler = new ToolResponseHandler(
            openaiClient,
            historyManager,
            screenshotProcessor,
            snapshotProcessor,
            this
        )
        this.rateLimitHandler = new RateLimitHandler()
        this.messageContentHandler = new MessageContentHandler(openaiClient, this)
    }

    resetStepTokens(): void {
        this.tokenTracker.resetStep()
    }

    async handleResponse(response: ChatCompletion, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
        await this.rateLimitHandler.waitForRateLimit()

        const historyTokenCount = this.openaiClient.countHistoryTokens()
        this.tokenTracker.log(response, historyTokenCount, this.openaiClient.getConfigurationManager().getModel())

        if (!response.choices || response.choices.length === 0) {
            throw new Error(`No choices found in response:\n${JSON.stringify(response, null, 2)}`)
        }

        for (const choice of response.choices) {
            if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                for (const toolCall of choice.message.tool_calls) {
                    if (toolCall.type !== 'function') continue
                    const toolCallObj: ToolCall = {
                        name: toolCall.function.name,
                        arguments: JSON.parse(toolCall.function.arguments || '{}')
                    }
                    const toolResponse = await this.toolDispatcher.dispatch(toolCallObj, stepStatusCallback)
                    if (toolResponse) {
                        return await this.toolResponseHandler.handle(toolCall.id, toolResponse, step, stepStatusCallback)
                    }
                }
            } else {
                await this.messageContentHandler.handle(choice, step, stepStatusCallback)
            }
        }
    }
}
