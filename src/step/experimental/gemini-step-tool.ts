import { FunctionDeclaration, FunctionCall, Type } from "@google/genai"
import { StepStatusCallback } from "../types"
import { StepTool } from "../tool/step-tool"

export class GeminiStepTool {
    functionDeclarations: FunctionDeclaration[]
    
    constructor() {
        this.functionDeclarations = [
            {
                name: StepTool.TOOL_FAIL_TEST_STEP,
                description: 'Fail the test step with the actual result',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        actualResult: { type: Type.STRING, description: 'The actual result of the test step' }
                    },
                    required: ['actualResult']
                }
            },
            {
                name: StepTool.TOOL_PASS_TEST_STEP,
                description: 'Pass the test step with the actual result',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        actualResult: { type: Type.STRING, description: 'The actual result of the test step' }
                    },
                    required: ['actualResult']
                }
            }
        ]
    }

    call(specified: FunctionCall, callback: StepStatusCallback) {
        if (!specified.name) {
            throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
        }
        if (!this.functionDeclarations.find(declaration => declaration.name === specified.name)) {
            throw new Error(`Tool not found: ${specified.name}`)
        }
        if (specified.name === StepTool.TOOL_PASS_TEST_STEP) {
            callback({ passed: true, actual: specified.args?.actualResult as string })
        }
        if (specified.name === StepTool.TOOL_FAIL_TEST_STEP) {
            callback({ passed: false, actual: specified.args?.actualResult as string })
        }
    }
}
