import { z } from 'zod/v4'
import { defineAgentTool } from '../define-agent-tool'
import { AgentTool } from '../types'

export const StepResultTool = {
	TOOL_FAIL_TEST_STEP: 'fail_test_step',
	TOOL_PASS_TEST_STEP: 'pass_test_step',
} as const

const stepResultSchema = z
	.object({
		actualResult: z.string().describe('The actual result of the test step'),
	})
	.strict()

export function createStepResultTools(): AgentTool[] {
	return [
		defineAgentTool({
			name: StepResultTool.TOOL_FAIL_TEST_STEP,
			description: 'Fail the test step with the actual result',
			schema: stepResultSchema,
			handler: ({ actualResult }, context) => {
				context.resolveStepResult({ passed: false, actual: actualResult })
			},
		}),
		defineAgentTool({
			name: StepResultTool.TOOL_PASS_TEST_STEP,
			description: 'Pass the test step with the actual result',
			schema: stepResultSchema,
			handler: ({ actualResult }, context) => {
				context.resolveStepResult({ passed: true, actual: actualResult })
			},
		}),
	]
}
