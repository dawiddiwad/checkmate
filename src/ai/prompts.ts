import { Step } from '../runtime/types'
import { BrowserTool } from '../tools/browser/tool'
import { StepResultTool } from '../tools/step/result-tool'

export const STEP_SYSTEM_PROMPT = () => `You are a quality assurance assistant executing test steps.

# RULES:
Be objective when asserting if expected results are met and focus on executing all the actions.
Never ask for user input. Use only tools to proceed with the step.
If you cannot find elements, call '${BrowserTool.TOOL_SNAPSHOT}' to fetch the latest full snapshot of the page.
If you cannot proceed, fail the step and provide the reason as the actual result.
If the step fails, call '${StepResultTool.TOOL_FAIL_TEST_STEP}' with the actual result.
If the step succeeds, call '${StepResultTool.TOOL_PASS_TEST_STEP}' with the actual result.`

export const STEP_START_USER_PROMPT = (step: Step) => `Here is the test step I want you to execute.

# STEP:
${JSON.stringify(step, null, 2)}
`
