import { ChatCompletion } from 'openai/resources/chat/completions'
import { logger } from '../logging/index.js'
import { Step, TurnOutcome } from '../runtime/types.js'
import { StepResultTool } from '../tools/step/result-tool.js'

export class MessageHandler {
	handle(choice: ChatCompletion.Choice, step: Step): TurnOutcome {
		const { message } = choice

		if (choice.finish_reason === 'stop' || message.content) {
			logger.warn(`model response without tool call:\n${formatChoiceDetails(choice, step)}`)
			logger.warn(
				`warning: model responded with text but no tool call. Prompting to use ${StepResultTool.TOOL_PASS_TEST_STEP} or ${StepResultTool.TOOL_FAIL_TEST_STEP}.`
			)

			return {
				kind: 'continue',
				toolResults: [],
				messages: [
					{
						role: 'user',
						content: `You provided a text response but did not call a tool. Based on your analysis, call either '${StepResultTool.TOOL_PASS_TEST_STEP}' or '${StepResultTool.TOOL_FAIL_TEST_STEP}' with the actual result. Do not respond with text. Only use the tool.`,
					},
				],
			}
		}

		if (choice.finish_reason && choice.finish_reason !== 'tool_calls') {
			throw new Error(
				`OpenAI API finished unexpectedly with reason: ${choice.finish_reason}\n${formatChoiceDetails(choice, step)}`
			)
		}

		if (!message.content && (!message.tool_calls || message.tool_calls.length === 0)) {
			throw new Error(`No content or tool calls found in message:\n${formatChoiceDetails(choice, step)}`)
		}

		throw new Error(`Unhandled choice on response from model:\n${formatChoiceDetails(choice, step)}`)
	}
}

function formatChoiceDetails(choice: ChatCompletion.Choice, step: Step): string {
	return [
		`step_action: ${step.action}`,
		`step_expect: ${step.expect}`,
		`choice_index: ${choice.index}`,
		`finish_reason: ${choice.finish_reason}`,
		`content: ${preview(choice.message.content)}`,
		`refusal: ${preview(choice.message.refusal)}`,
	].join('\n')
}

function preview(value: unknown): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value)
	const safeText = (text ?? String(value))
		.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
		.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')
		.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
	return safeText.length <= 1_000 ? safeText : `${safeText.slice(0, 997)}...`
}
