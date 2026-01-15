import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { StepStatusCallback } from '../types'

export type ToolCall = {
	name: string
	arguments?: Record<string, unknown>
}

export abstract class OpenAITool {
	abstract functionDeclarations: ChatCompletionFunctionTool[]
	abstract call(specified: ToolCall, callback?: StepStatusCallback): Promise<string> | string

	protected getFunctionNames(): string[] {
		return this.functionDeclarations.map((fn) => fn.function.name)
	}
}
