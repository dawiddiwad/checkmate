import { z } from 'zod/v4'
import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { AgentTool, AgentToolContext, AgentToolResult } from './types'

type ToolConfig<TSchema extends z.ZodType> = {
	name: string
	description: string
	schema: TSchema
	strict?: boolean
	handler: (args: z.infer<TSchema>, context: AgentToolContext) => Promise<AgentToolResult> | AgentToolResult
}

export function defineAgentTool<TSchema extends z.ZodType>(toolConfig: ToolConfig<TSchema>): AgentTool {
	const jsonSchema = z.toJSONSchema(toolConfig.schema) as Record<string, unknown>
	delete jsonSchema.$schema

	const definition: ChatCompletionFunctionTool = {
		type: 'function',
		function: {
			name: toolConfig.name,
			description: toolConfig.description,
			parameters: jsonSchema,
			strict: toolConfig.strict ?? true,
		},
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
