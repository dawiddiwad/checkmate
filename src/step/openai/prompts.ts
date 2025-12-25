import { Step } from '../types'
import { StepTool } from '../tool/step-tool'

export const RUN_STEP_PROMPT = (step: Step) => `
Here is the test step I want you to execute. 

#RULES:
Be objective when asserting if expected results are met and focus on executing all the actions.
Never ask for any user input, USE ONLY TOOLS TO PROCEED WITH THE STEP.
If you cannot proceed, fail the step providing reason as actual result.
If the step fails, call the '${StepTool.TOOL_FAIL_TEST_STEP}' function with the actual result.
If the step is successful, call the '${StepTool.TOOL_PASS_TEST_STEP}' function with the actual result.

#STEP:
${JSON.stringify(step, null, 2)}
`
