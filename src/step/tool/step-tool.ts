import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"
import { OpenAITool, ToolCallArgs } from "../../mcp/tool/openai-tool"
import { StepStatusCallback } from "../types"

export class StepTool implements OpenAITool {
    functionDeclarations: ChatCompletionFunctionTool[]
    
    constructor() {
        this.functionDeclarations = [
            {
                type: 'function',
                function: {
                    name: 'fail_test_step',
                    description: 'Fail the test step with the actual result',
                    parameters: {
                        type: 'object',
                        properties: {
                            actualResult: { type: 'string', description: 'The actual result of the test step' }
                        },
                        required: ['actualResult']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'pass_test_step',
                    description: 'Pass the test step with the actual result',
                    parameters: {
                        type: 'object',
                        properties: {
                            actualResult: { type: 'string', description: 'The actual result of the test step' }
                        },
                        required: ['actualResult']
                    }
                }
            }
        ]
    }

    call(specified: ToolCallArgs, callback: StepStatusCallback) {
        if (!specified.name) {
            throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
        }
        const declaration = this.functionDeclarations.find(d => d.function.name === specified.name)
        if (!declaration) {
            throw new Error(`Tool not found: ${specified.name}`)
        }
        if (specified.name === 'pass_test_step') {
            callback({ passed: true, actual: specified.arguments?.actualResult as string })
        }
        if (specified.name === 'fail_test_step') {
            callback({ passed: false, actual: specified.arguments?.actualResult as string })
        }
    }
}
