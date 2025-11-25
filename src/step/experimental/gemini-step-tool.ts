import { FunctionDeclaration, FunctionCall, Type } from "@google/genai"
import { StepStatusCallback } from "../types"

// Gemini-specific StepTool for the experimental Live API
export class GeminiStepTool {
    functionDeclarations: FunctionDeclaration[]
    
    constructor() {
        this.functionDeclarations = [
            {
                name: 'fail_test_step',
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
                name: 'pass_test_step',
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
        if (specified.name === 'pass_test_step') {
            callback({ passed: true, actual: specified.args?.actualResult as string })
        }
        if (specified.name === 'fail_test_step') {
            callback({ passed: false, actual: specified.args?.actualResult as string })
        }
    }
}
