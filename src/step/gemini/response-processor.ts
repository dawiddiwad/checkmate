import { FinishReason, FunctionResponse, GenerateContentResponse, PartUnion } from "@google/genai"
import { ToolCall } from "../../mcp/server/gemini-mcp"
import { Step, StepStatusCallback } from "../types"
import { ToolRegistry } from "../tool/tool-registry"
import { GeminiClient } from "./gemini-client"
import { HistoryManager } from "./history-manager"
import { ScreenshotProcessor } from "../tool/screenshot-processor"
import { TokenTracker } from "./token-tracker"
import { ConfigurationManager } from "../configuration-manager"
import { env } from "process"

export class ResponseProcessor {
    constructor(
        private readonly toolRegistry: ToolRegistry,
        private readonly geminiClient: GeminiClient,
        private readonly historyManager: HistoryManager,
        private readonly screenshotProcessor: ScreenshotProcessor,
        private readonly tokenTracker: TokenTracker,
        private readonly configurationManager: ConfigurationManager
    ) { }

    async handleResponse(response: GenerateContentResponse, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
        if (env.GEMINI_API_RATE_LIMIT_DELAY_SECONDS) {
            console.log(`\nwaiting ${env.GEMINI_API_RATE_LIMIT_DELAY_SECONDS} seconds to avoid rate limit`)
            await new Promise(resolve => setTimeout(resolve, parseInt(env.GEMINI_API_RATE_LIMIT_DELAY_SECONDS ?? "0") * 1000))
        }
        const historyTokenCount = await this.geminiClient.countHistoryTokens()
        this.tokenTracker.log(response, historyTokenCount, this.configurationManager.getModel())
        if (!response.candidates || response.candidates.length === 0) {
            throw new Error(`No candidates found in response:\n${JSON.stringify(response, null, 2)}`)
        }
        for (const candidate of response.candidates) {
            for (const part of candidate.content?.parts ?? []) {
                if (part.text) {
                    console.log(`\n| text: ${part.text}`)
                }
                if (part.thought) {
                    console.log(`\n| thought: ${part.thought}`)
                }
                if (part.functionCall) {
                    const name = part.functionCall.name ?? ""
                    if (name.includes("browser")) {
                        const toolResponse = await this.toolRegistry.executeBrowserTool(part.functionCall as ToolCall)
                        await this.dispatchToolResponse(name, toolResponse, step, stepStatusCallback)
                    } else if (name.includes("test_step")) {
                        this.toolRegistry.executeStepTool(part.functionCall, stepStatusCallback)
                    } else if (name.includes("salesforce")) {
                        const toolResponse = await this.toolRegistry.executeSalesforceTool(part.functionCall)
                        await this.dispatchToolResponse(name, toolResponse, step, stepStatusCallback)
                    } else {
                        throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(part.functionCall, null, 2)}`)
                    }
                }
                if (!part.text && !part.functionCall) {
                    throw new Error(`No text or function call found in part:\n${JSON.stringify(part, null, 2)}`)
                }
            }
            if (candidate.finishReason && candidate.finishReason !== FinishReason.STOP) {
                const actualResult = `gemini api finished unexpectedly with reason:\n${candidate.finishReason}${candidate.finishMessage ? `\nand message: \n${candidate.finishMessage}` : ""}`
                stepStatusCallback({ passed: false, actual: actualResult })
            } else {
                stepStatusCallback({ passed: false, actual: "something went wrong - check logs" })
            }
        }
    }

    private async dispatchToolResponse(
        name: string,
        toolResponse: FunctionResponse,
        step: Step,
        stepStatusCallback: StepStatusCallback
    ): Promise<void> {
        await this.historyManager.removeSnapshotEntries(this.geminiClient)
        const message: PartUnion[] = []
        if (name.includes("snapshot") && this.configurationManager.includeScreenshotInSnapshot()) {
            const screenshot = await this.screenshotProcessor.compressSnapshot()
            message.push({
                inlineData: {
                    mimeType: screenshot.mimeType,
                    data: screenshot.data
                }
            })
        }
        message.push({
            functionResponse: toolResponse
        })
        const nextResponse = await this.geminiClient.sendMessageWithRetry(message)
        await this.handleResponse(nextResponse, step, stepStatusCallback)
    }
}