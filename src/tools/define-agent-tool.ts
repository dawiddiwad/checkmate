import { z } from 'zod/v4'
import { AgentTool, AgentToolContext, AgentToolDefinition, AgentToolResult } from './types.js'

type ToolConfig<TSchema extends z.ZodType> = {
	name: string
	description: string
	schema: TSchema
	strict?: boolean
	handler: (args: z.infer<TSchema>, context: AgentToolContext) => Promise<AgentToolResult> | AgentToolResult
}

/**
 * Creates a typed Checkmate tool from a Zod schema and handler.
 *
 * @example
 * ```ts
 * import { defineAgentTool } from '@xoxoai/checkmate/core'
 * import { z } from 'zod/v4'
 *
 * const apiHealthTool = defineAgentTool({
 *   name: 'check_api_health',
 *   description: 'Check whether the API is healthy',
 *   schema: z.object({ url: z.string() }).strict(),
 *   handler: async ({ url }) => `API health is good for ${url}`,
 * })
 * ```
 */
export function defineAgentTool<TSchema extends z.ZodType>(toolConfig: ToolConfig<TSchema>): AgentTool {
	const jsonSchema = z.toJSONSchema(toolConfig.schema) as Record<string, unknown>
	delete jsonSchema.$schema

	const definition: AgentToolDefinition = {
		name: toolConfig.name,
		description: toolConfig.description,
		parameters: jsonSchema,
		strict: toolConfig.strict ?? true,
	}

	return {
		definition,
		execute: async (args: unknown, context: AgentToolContext) => {
			const parsed = toolConfig.schema.safeParse(args)
			if (!parsed.success) {
				return JSON.stringify({ error: `Invalid args for '${toolConfig.name}': ${parsed.error.message}` })
			}

			return toolConfig.handler(parsed.data, context)
		},
	}
}

/**
 * Preferred alias for `defineAgentTool()`.
 *
 * @example
 * ```ts
 * import { defineTool } from '@xoxoai/checkmate/core'
 * import { z } from 'zod/v4'
 *
 * const tool = defineTool({
 *   name: 'check_api_health',
 *   description: 'Check whether the API is healthy',
 *   schema: z.object({ url: z.string() }).strict(),
 *   handler: async ({ url }) => `API health is good for ${url}`,
 * })
 * ```
 */
export const defineTool = defineAgentTool
