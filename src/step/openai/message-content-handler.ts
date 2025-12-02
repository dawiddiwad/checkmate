import { ChatCompletion } from "openai/resources/chat/completions"
import { StepTool } from "../tool/step-tool"
import { OpenAIClient } from "./openai-client"
import { Step, StepStatusCallback } from "../types"
import { ResponseProcessor } from "./response-processor"

export class MessageContentHandler {
    private readonly openaiClient: OpenAIClient
    private readonly responseProcessor: ResponseProcessor

    constructor(openaiClient: OpenAIClient, responseProcessor: ResponseProcessor) {
        this.openaiClient = openaiClient
        this.responseProcessor = responseProcessor
    }

    public async handle(choice: ChatCompletion.Choice, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
        const { message } = choice

        if (message.content) {
            console.log(`\n| text: ${message.content}`)
        }

        if (choice.finish_reason === 'stop' && message.content) {
            console.log(`\n| warning: Model responded with text but no tool call. Prompting to use ${StepTool.TOOL_PASS_TEST_STEP} or ${StepTool.TOOL_FAIL_TEST_STEP} tool.`)
            await this.openaiClient.addUserMessage(
                `You provided a text response but did not call a tool. Based on your analysis, please call either '${StepTool.TOOL_PASS_TEST_STEP}' or '${StepTool.TOOL_FAIL_TEST_STEP}' with the actual result. Do not respond with text - only use the tool.`
            )
            const followUpResponse = await this.openaiClient.sendToolResponseWithRetry()
            await this.responseProcessor.handleResponse(followUpResponse, step, stepStatusCallback)
        }
    }
}