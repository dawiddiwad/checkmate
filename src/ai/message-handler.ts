import { ChatCompletion } from 'openai/resources/chat/completions'
import { logger } from '../logging/index.js'
import { Step, ResolveStepResult } from '../runtime/types.js'
import { StepResultTool } from '../tools/step/result-tool.js'
import { AiClient } from './client.js'
import { ResponseProcessor } from './response-processor.js'

export class MessageHandler {
	constructor(
		private readonly aiClient: AiClient,
		private readonly responseProcessor: ResponseProcessor
	) {}

	async handle(choice: ChatCompletion.Choice, step: Step, resolveStepResult: ResolveStepResult): Promise<void> {
		const { message } = choice

		if (choice.finish_reason === 'stop' || message.content) {
			logger.warn(`text: ${message.content}`)
			logger.warn(
				`warning: model responded with text but no tool call. Prompting to use ${StepResultTool.TOOL_PASS_TEST_STEP} or ${StepResultTool.TOOL_FAIL_TEST_STEP}.`
			)
			await this.aiClient.addUserMessage(
				`You provided a text response but did not call a tool. Based on your analysis, call either '${StepResultTool.TOOL_PASS_TEST_STEP}' or '${StepResultTool.TOOL_FAIL_TEST_STEP}' with the actual result. Do not respond with text. Only use the tool.`
			)
			const followUpResponse = await this.aiClient.sendToolResponseWithRetry()
			await this.responseProcessor.handleResponse(followUpResponse, step, resolveStepResult)
			return
		}

		if (choice.finish_reason && choice.finish_reason !== 'tool_calls') {
			resolveStepResult({
				passed: false,
				actual: `OpenAI API finished unexpectedly with reason: ${choice.finish_reason}`,
			})
			return
		}

		if (!choice.message.content && (!choice.message.tool_calls || choice.message.tool_calls.length === 0)) {
			throw new Error(`No content or tool calls found in message:\n${JSON.stringify(choice.message, null, 2)}`)
		}

		throw new Error(`Unhandled choice on response from model:\n${JSON.stringify(choice, null, 2)}`)
	}
}
