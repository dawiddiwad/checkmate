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
 * Creates an internal runner tool, which may return a step assertion.
 * Driver authors use defineDriverTool from '@xoxoai/checkmate/driver' instead.
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
 * Internal shorthand for defineAgentTool; not part of the public driver API.
 */
export const defineTool = defineAgentTool
