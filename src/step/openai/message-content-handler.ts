import { StepTool } from "../tool/step-tool"
import { OpenAIClient } from "./openai-client"
import { Step, StepStatusCallback } from "../types"
import { ResponseProcessor } from "./response-processor"
import { logger } from "./openai-test-manager"
import { ResponseOutputItem } from "openai/resources/responses/responses.mjs"

export class MessageContentHandler {
    private readonly openaiClient: OpenAIClient
    private readonly responseProcessor: ResponseProcessor

    constructor(openaiClient: OpenAIClient, responseProcessor: ResponseProcessor) {
        this.openaiClient = openaiClient
        this.responseProcessor = responseProcessor
    }

    public async handle(output: ResponseOutputItem, step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
        if (output.type === 'message' && output.status === 'completed') {
            logger.warn(`message: ${JSON.stringify(output.content, null, 2)}`)
            logger.warn(`warning: Model responded with message but no tool call. Prompting to use ${StepTool.TOOL_PASS_TEST_STEP} or ${StepTool.TOOL_FAIL_TEST_STEP} tool.`)
            await this.openaiClient.addUserMessage(
                `You provided a message response with id ${output.id} but did not call a tool. Based on your analysis, please call either '${StepTool.TOOL_PASS_TEST_STEP}' or '${StepTool.TOOL_FAIL_TEST_STEP}' with the actual result. Do not respond with message or text - only use tools.`
            )
            const followUpResponse = await this.openaiClient.sendToolResponseWithRetry()
            await this.responseProcessor.handleResponse(followUpResponse, step, stepStatusCallback)
            // } else if (output.finish_reason && output.finish_reason !== 'tool_calls') {
            //     stepStatusCallback({ passed: false, actual: `OpenAI API finished unexpectedly with reason: ${output.finish_reason}` })
            // } else if (!output.message.content && (!output.message.tool_calls || output.message.tool_calls.length === 0)) {
            //     throw new Error(`No content or tool calls found in message:\n${JSON.stringify(output.message, null, 2)}`)
        } else {
            return
            // throw new Error(`Unhandled choice on response from model:\n${JSON.stringify(output, null, 2)}`)
        }
    }
}