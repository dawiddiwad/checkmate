import { ChatCompletion } from "openai/resources/chat/completions"
import { ToolCall } from "../../mcp/server/openai-mcp"
import { Step, StepStatusCallback } from "../types"
import { OpenAIClient } from "./openai-client"
import { HistoryManager } from "./history-manager"
import { ScreenshotProcessor } from "../tool/screenshot-processor"
import { SnapshotProcessor } from "../tool/snapshot-processor"
import { TokenTracker } from "./token-tracker"
import { env } from "process"
import { OpenAIServerMCP } from "../../mcp/server/openai-mcp"
import { StepTool } from "../tool/step-tool"

export type ResponseProcessorDependencies = {
    playwrightMCP: OpenAIServerMCP
    openaiClient: OpenAIClient
}

export class ResponseProcessor {
    private readonly historyManager: HistoryManager
    private readonly screenshotProcessor: ScreenshotProcessor
    private readonly snapshotProcessor: SnapshotProcessor
    private readonly tokenTracker: TokenTracker
    private readonly playwrightMCP: OpenAIServerMCP
    private readonly openaiClient: OpenAIClient

    constructor({ playwrightMCP, openaiClient }: ResponseProcessorDependencies) {
        this.playwrightMCP = playwrightMCP
        this.openaiClient = openaiClient
        this.historyManager = new HistoryManager()
        this.screenshotProcessor = new ScreenshotProcessor(this.playwrightMCP)
        this.snapshotProcessor = new SnapshotProcessor()
        this.tokenTracker = new TokenTracker()
    }

    resetStepTokens(): void {
        this.tokenTracker.resetStep()
    }

    async handleResponse(response: ChatCompletion, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
        if (env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS) {
            console.log(`\nwaiting ${env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS} seconds to avoid rate limit`)
            await new Promise(resolve => setTimeout(resolve, parseInt(env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS ?? "0") * 1000))
        }
        
        const historyTokenCount = this.openaiClient.countHistoryTokens()
        this.tokenTracker.log(response, historyTokenCount, this.openaiClient.getConfigurationManager().getModel())
        
        if (!response.choices || response.choices.length === 0) {
            throw new Error(`No choices found in response:\n${JSON.stringify(response, null, 2)}`)
        }

        for (const choice of response.choices) {
            const message = choice.message
            
            if (message.content) {
                console.log(`\n| text: ${message.content}`)
            }
            
            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    if (toolCall.type !== 'function') continue
                    
                    const name = toolCall.function.name
                    const args = JSON.parse(toolCall.function.arguments || '{}')
                    const toolCallObj: ToolCall = { name, arguments: args }
                    const toolRegistry = this.openaiClient.getToolRegistry()
                    
                    if (name.includes("browser")) {
                        const toolResponse = await toolRegistry.executeBrowserTool(toolCallObj)
                        await this.dispatchToolResponse(toolCall.id, name, toolResponse, step, stepStatusCallback)
                    } else if (name.includes("test_step")) {
                        toolRegistry.executeStepTool(toolCallObj, stepStatusCallback)
                    } else if (name.includes("salesforce")) {
                        const toolResponse = await toolRegistry.executeSalesforceTool(toolCallObj)
                        await this.dispatchToolResponse(toolCall.id, name, toolResponse, step, stepStatusCallback)
                    } else {
                        throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(toolCall, null, 2)}`)
                    }
                }
            } else if (choice.finish_reason === 'stop' && message.content) {
                console.log(`\n| warning: Model responded with text but no tool call. Prompting to use ${StepTool.TOOL_PASS_TEST_STEP} or ${StepTool.TOOL_FAIL_TEST_STEP} tool.`)
                await this.openaiClient.addUserMessage(
                    `You provided a text response but did not call a tool. Based on your analysis, please call either '${StepTool.TOOL_PASS_TEST_STEP}' or '${StepTool.TOOL_FAIL_TEST_STEP}' with the actual result. Do not respond with text - only use the tool.`
                )
                const followUpResponse = await this.openaiClient.sendToolResponseWithRetry()
                await this.handleResponse(followUpResponse, step, stepStatusCallback)
                return
            }
            
            if (!message.content && (!message.tool_calls || message.tool_calls.length === 0)) {
                throw new Error(`No content or tool calls found in message:\n${JSON.stringify(message, null, 2)}`)
            }
            
            if (choice.finish_reason && choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') {
                const actualResult = `OpenAI API finished unexpectedly with reason: ${choice.finish_reason}`
                stepStatusCallback({ passed: false, actual: actualResult })
            }
        }
    }

    private async dispatchToolResponse(
        toolCallId: string,
        name: string,
        toolResponse: { name?: string; response: any },
        step: Step,
        stepStatusCallback: StepStatusCallback
    ): Promise<void> {
        const config = this.openaiClient.getConfigurationManager()
        const shouldCompress = config.enableSnapshotCompression()
        
        const processedResponse = shouldCompress 
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
        await this.handleResponse(nextResponse, step, stepStatusCallback)
    }
}
