import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { ResolveStepResult, Step } from '../runtime/types'

export type ToolCall = {
	name: string
	arguments?: unknown
}

export type AgentToolResponse = {
	response: string
	snapshot?: string | null
}

export type AgentToolResult = AgentToolResponse | string | void

export type AgentToolContext = {
	step: Step
	resolveStepResult: ResolveStepResult
}

export type AgentTool = {
	definition: ChatCompletionFunctionTool
	execute: (args: unknown, context: AgentToolContext) => Promise<AgentToolResult> | AgentToolResult
}

export function getToolName(tool: AgentTool): string {
	return tool.definition.function.name
}
