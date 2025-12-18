import { OpenAITool, ToolCall } from "./openai-tool"
import { StepStatusCallback } from "../types"
import { Tool } from "openai/resources/responses/responses.mjs"

export class StepTool implements OpenAITool {
    static readonly TOOL_FAIL_TEST_STEP = 'fail_test_step'
    static readonly TOOL_PASS_TEST_STEP = 'pass_test_step'

    functionDeclarations: Tool[]

    constructor() {
        this.functionDeclarations = [
            {
                type: 'function',
                name: StepTool.TOOL_FAIL_TEST_STEP,
                description: 'Fail the test step with the actual result',
                parameters: {
                    type: 'object',
                    properties: {
                        actualResult: { type: 'string', description: 'The actual result of the test step' }
                    },
                    additionalProperties: false,
                    required: ['actualResult']
                },
                strict: true
            },
            {
                type: 'function',
                name: StepTool.TOOL_PASS_TEST_STEP,
                description: 'Pass the test step with the actual result',
                parameters: {
                    type: 'object',
                    properties: {
                        actualResult: { type: 'string', description: 'The actual result of the test step' }
                    },
                    additionalProperties: false,
                    required: ['actualResult']
                },
                strict: true
            }
        ]
    }

    call(specified: ToolCall, callback: StepStatusCallback) {
        if (!specified.name) {
            throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
        }
        const declaration = this.functionDeclarations.find(d => d.type === 'function' && d.name === specified.name)
        if (!declaration) {
            throw new Error(`Tool not found: ${specified.name}`)
        }
        if (specified.name === StepTool.TOOL_PASS_TEST_STEP) {
            callback({ passed: true, actual: specified.arguments?.actualResult as string })
        }
        if (specified.name === StepTool.TOOL_FAIL_TEST_STEP) {
            callback({ passed: false, actual: specified.arguments?.actualResult as string })
        }
    }
}
