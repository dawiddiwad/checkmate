import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { ResolveStepResult, Step } from '../runtime/types'

export type ToolCall = {
	name: string
	arguments?: Record<string, unknown>
}

export type ToolCallState = {
	response: string
	snapshot?: string | null
}

export type ToolCallResult = ToolCallState | string | void

export type ToolExecutionContext = {
	resolveStepResult: ResolveStepResult
}

export abstract class ToolContract {
	abstract functionDeclarations: ChatCompletionFunctionTool[]

	setStep(_step: Step): void {}

	abstract execute(specified: ToolCall, context: ToolExecutionContext): Promise<ToolCallResult> | ToolCallResult

	supports(toolName: string): boolean {
		return this.functionDeclarations.some((declaration) => declaration.function.name === toolName)
	}

	protected getFunctionNames(): string[] {
		return this.functionDeclarations.map((declaration) => declaration.function.name)
	}
}
