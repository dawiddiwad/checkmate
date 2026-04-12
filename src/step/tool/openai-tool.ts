import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { StepStatusCallback } from '../types'

export type ToolCall = {
	name: string
	arguments?: Record<string, unknown>
}

export type ToolCallState = {
	response: string
	snapshot?: string | null
}

export type ToolCallResult = ToolCallState | string | void

export abstract class OpenAITool {
	abstract functionDeclarations: ChatCompletionFunctionTool[]
	abstract call(specified: ToolCall, callback?: StepStatusCallback): Promise<ToolCallResult> | ToolCallResult

	protected getFunctionNames(): string[] {
		return this.functionDeclarations.map((fn) => fn.function.name)
	}
}
