import { Tool } from "openai/resources/responses/responses.mjs"

export type ToolCall = {
    name: string
    arguments?: Record<string, unknown>
}

export abstract class OpenAITool {
    abstract functionDeclarations: Tool[]
    abstract call(specified: ToolCall, ...args: any[]): Promise<any> | any
}
