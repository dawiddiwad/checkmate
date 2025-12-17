import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"

export type ToolCall = {
    name: string
    arguments?: Record<string, unknown>
}

export abstract class OpenAITool {
    abstract functionDeclarations: ChatCompletionFunctionTool[]
    abstract call(specified: ToolCall, ...args: any[]): Promise<any> | any
}
