import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { ResolveStepResult, Step } from '../runtime/types'
import { CheckmateContextItem, CheckmateServices } from '../runtime/module'

export type ToolCall = {
	name: string
	arguments?: unknown
}

/**
 * Normalized tool response consumed by the Checkmate runtime.
 */
export type CheckmateToolResponse = {
	response: string
	context?: CheckmateContextItem[]
	status?: 'success' | 'error'
}

/**
 * Return type of a Checkmate tool.
 */
export type CheckmateToolResult = CheckmateToolResponse | string | void

/**
 * Execution context passed to each Checkmate tool.
 */
export type CheckmateToolContext<TServices extends CheckmateServices = CheckmateServices> = {
	step: Step
	services: TServices
	pass: (actual: string) => void
	fail: (actual: string) => void
	resolveStepResult: ResolveStepResult
}

/**
 * Model-callable tool contract used by the Checkmate runtime.
 */
export type CheckmateTool<TServices extends CheckmateServices = CheckmateServices> = {
	definition: ChatCompletionFunctionTool
	execute: (
		args: unknown,
		context: CheckmateToolContext<TServices>
	) => Promise<CheckmateToolResult> | CheckmateToolResult
}

export type AnyCheckmateTool = CheckmateTool<CheckmateServices>
export type AgentToolResponse = CheckmateToolResponse
export type AgentToolResult = CheckmateToolResult
export type AgentToolContext<TServices extends CheckmateServices = CheckmateServices> = CheckmateToolContext<TServices>
export type AgentTool<TServices extends CheckmateServices = CheckmateServices> = CheckmateTool<TServices>

/**
 * Read the registered name from a tool definition.
 *
 * @param tool - Tool definition.
 * @returns Tool name.
 */
export function getToolName(tool: CheckmateTool<CheckmateServices>): string {
	return tool.definition.function.name
}
