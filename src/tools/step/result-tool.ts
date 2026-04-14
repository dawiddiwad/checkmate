import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { logger } from '../../logging'
import { ToolCall, ToolCallResult, ToolContract, ToolExecutionContext } from '../tool-contract'

export class StepResultTool extends ToolContract {
	static readonly TOOL_FAIL_TEST_STEP = 'fail_test_step'
	static readonly TOOL_PASS_TEST_STEP = 'pass_test_step'

	functionDeclarations: ChatCompletionFunctionTool[] = [
		{
			type: 'function',
			function: {
				name: StepResultTool.TOOL_FAIL_TEST_STEP,
				description: 'Fail the test step with the actual result',
				parameters: {
					type: 'object',
					properties: { actualResult: { type: 'string', description: 'The actual result of the test step' } },
					additionalProperties: false,
					required: ['actualResult'],
				},
				strict: true,
			},
		},
		{
			type: 'function',
			function: {
				name: StepResultTool.TOOL_PASS_TEST_STEP,
				description: 'Pass the test step with the actual result',
				parameters: {
					type: 'object',
					properties: { actualResult: { type: 'string', description: 'The actual result of the test step' } },
					additionalProperties: false,
					required: ['actualResult'],
				},
				strict: true,
			},
		},
	]

	call(specified: ToolCall, resolve: ToolExecutionContext['resolveStepResult']): ToolCallResult {
		if (!specified.name) {
			throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
		}

		if (specified.name === StepResultTool.TOOL_PASS_TEST_STEP) {
			resolve({ passed: true, actual: specified.arguments?.actualResult as string })
			return
		}

		if (specified.name === StepResultTool.TOOL_FAIL_TEST_STEP) {
			resolve({ passed: false, actual: specified.arguments?.actualResult as string })
			return
		}

		logger.error(`model tried to call not implemented tool: ${specified.name}`)
		return `Step result tool not implemented: ${specified.name}, use one of: ${this.getFunctionNames().join(', ')}`
	}

	execute(specified: ToolCall, context: ToolExecutionContext): ToolCallResult {
		return this.call(specified, context.resolveStepResult)
	}
}
