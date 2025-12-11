import { ConfigurationManager } from "../configuration-manager";
import { Step } from "../types";
import { StepTool } from "../tool/step-tool";
import { typeMap } from "../tool/snapshot-processor";
import { PageSnapshotStore } from "../tool/page-snapshot";
import { BrowserTool } from "../tool/browser-tool";
import { HistoryManager } from "./history-manager";

const INITIAL_PAGE_SNAPSHOT_INSTRUCTIONS = `
If there is no snapshot available to you marked with '${HistoryManager.SNAPSHOT_IDENTIFIER}' and unless instructed otherwise in step, start by taking a fresh page snapshot using the '${BrowserTool.TOOL_SNAPSHOT}' tool to understand the current state of the page.
`

const PAGE_SNAPSHOT_COMPRESSION_INSTRUCTIONS = `
#PAGE SNAPSHOT COMPRESSION:
The page snapshot uses a compressed accessibility tree format where:
- Element types are abbreviated (example: gen=generic, btn=button, lnk=link, etc.)
- Text is prefixed with # (example: #Description)
- Indentation shows hierarchy

### Element type abbreviations:
${typeMap ? Object.entries(typeMap).map(([key, value]) => `${key}=${value}`).join('\n') : ''}
`

export const RUN_STEP_PROMPT = (step: Step) => `
Here is the test step I want you to execute.

${new ConfigurationManager().enableSnapshotCompression() ? PAGE_SNAPSHOT_COMPRESSION_INSTRUCTIONS : ''}

#RULES:
${INITIAL_PAGE_SNAPSHOT_INSTRUCTIONS}
Do not close or re-open the browser, keep it open and use it for the entire test case.
Saving and navigating actions might take some time to complete without clear indication of completion, be patient and wait for the page to load before proceeding.
Some components might take some time to complete loading without clear indication of completion, be patient and wait for the component to load before proceeding.
Never ask for any user input, use only tools to proceed with the step. If you cannot proceed, fail the step providing reason as actual result.
After each step is finished, call the appropriate function to pass or fail the step.
If the step fails, call the '${StepTool.TOOL_FAIL_TEST_STEP}' function with the actual result.
If the step is successful, call the '${StepTool.TOOL_PASS_TEST_STEP}' function with the actual result.

#STEP:
${JSON.stringify(step, null, 2)}
`

export const RUN_STEP_PROMPT_LIVE_API = (step: Step) => `
Here is the test step I want you to execute.

#RULES#
Avoid using 'browser_run_code' tool.
Do not execute any code, do not give any code to the user, do not give any code snippets. USE ONLY TOOLS TO PROCEED WITH THE STEP.
Never ask for any user input, use only tools to proceed with the step. If you cannot proceed, fail the step providing reason as actual result.
Do not close or re-open the browser if any browser tool was used before, keep it open and use it for the entire test case.
Saving and navigating actions might take some time to complete without clear indication of completion, be patient and wait for the page to load before proceeding.
Some components might take some time to complete loading without clear indication of completion, be patient and wait for the component to load before proceeding.
After each step is finished, call the appropriate function to pass or fail the step.
If the step fails, call the '${StepTool.TOOL_FAIL_TEST_STEP}' function with the actual result.
If the step is successful, call the '${StepTool.TOOL_PASS_TEST_STEP}' function with the actual result.

#STEP#
${JSON.stringify(step, null, 2)}
`