import { ResolveStepResult, Step } from '../runtime/types'

/**
 * Normalized tool call emitted by the model.
 *
 * @example
 * ```ts
 * const call: ToolCall = {
 *   name: 'browser_click_or_hover',
 *   arguments: { ref: 'e123', hover: false },
 * }
 * ```
 */
export type ToolCall = {
	/**
	 * Tool name requested by the model.
	 */
	name: string

	/**
	 * Parsed tool arguments.
	 */
	arguments?: unknown
}

/**
 * Serializable tool definition used by Checkmate.
 *
 * @example
 * ```ts
 * const definition: AgentToolDefinition = {
 *   name: 'check_api_health',
 *   description: 'Check whether the API is healthy',
 *   parameters: { type: 'object', properties: { url: { type: 'string' } } },
 *   strict: true,
 * }
 * ```
 */
export type AgentToolDefinition = {
	/**
	 * Stable tool name.
	 */
	name: string

	/**
	 * Short tool description shown to the model.
	 */
	description: string

	/**
	 * JSON schema for the tool parameters.
	 */
	parameters: Record<string, unknown>

	/**
	 * Whether the tool arguments should be validated strictly.
	 */
	strict: boolean
}

/**
 * Structured tool response returned to the model.
 *
 * @example
 * ```ts
 * const response: AgentToolResponse = {
 *   response: 'Clicked the Submit button.',
 *   status: 'success',
 * }
 * ```
 */
export type AgentToolResponse = {
	/**
	 * Human-readable result returned to the model.
	 */
	response: string

	/**
	 * Optional fresh snapshot to append after tool execution.
	 */
	snapshot?: string | null

	/**
	 * Outcome status used in tool execution summaries.
	 */
	status?: 'success' | 'error'
}

/**
 * Any valid value a tool can return.
 *
 * Tools may return a structured response, a plain string, or nothing.
 *
 * @example
 * ```ts
 * const result: AgentToolResult = {
 *   response: 'API health is good',
 *   status: 'success',
 * }
 * ```
 */
export type AgentToolResult = AgentToolResponse | string | void

/**
 * Context passed to every tool execution.
 *
 * @example
 * ```ts
 * const handler = async (_args: unknown, context: AgentToolContext) => {
 *   context.resolveStepResult({ passed: true, actual: context.step.expect })
 * }
 * ```
 */
export type AgentToolContext = {
	/**
	 * Step currently being executed.
	 */
	step: Step

	/**
	 * Callback used to finish the step.
	 */
	resolveStepResult: ResolveStepResult
}

/**
 * Tool contract used by the runner loop.
 *
 * Most users should create tools with `defineTool()` instead of building this object manually.
 *
 * @example
 * ```ts
 * const tool: AgentTool = defineTool({
 *   name: 'check_api_health',
 *   description: 'Check whether the API is healthy',
 *   schema: z.object({ url: z.string() }).strict(),
 *   handler: async ({ url }) => `API health is good for ${url}`,
 * })
 * ```
 */
export type AgentTool = {
	/**
	 * Tool definition exposed to the model.
	 */
	definition: AgentToolDefinition

	/**
	 * Tool implementation.
	 */
	execute: (args: unknown, context: AgentToolContext) => Promise<AgentToolResult> | AgentToolResult
}

export function getToolName(tool: AgentTool): string {
	return tool.definition.name
}
