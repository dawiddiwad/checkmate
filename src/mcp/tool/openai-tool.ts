import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"

export type ToolCallArgs = {
    name: string
    arguments?: Record<string, unknown>
}

export abstract class OpenAITool {
    abstract functionDeclarations: ChatCompletionFunctionTool[]
    abstract call(specified: ToolCallArgs, ...args: any[]): Promise<any> | any
}
