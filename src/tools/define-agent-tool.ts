import { z } from 'zod/v4'
import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { CheckmateServices } from '../runtime/module'
import { AgentTool, AgentToolContext, AgentToolResult } from './types'

type ToolConfig<TSchema extends z.ZodType, TServices extends CheckmateServices> = {
	name: string
	description: string
	schema: TSchema
	strict?: boolean
	handler: (
		args: z.infer<TSchema>,
		context: AgentToolContext<TServices>
	) => Promise<AgentToolResult> | AgentToolResult
}

/**
 * Define a model-callable Checkmate tool from a Zod schema and handler.
 *
 * @param toolConfig - Tool definition, schema, and execution handler.
 * @returns Normalized Checkmate tool contract.
 *
 * @example
 * ```ts
 * const tool = defineCheckmateTool({
 *   name: 'example_echo',
 *   description: 'Echo a message',
 *   schema: z.object({ message: z.string() }).strict(),
 *   handler: ({ message }) => ({ response: message }),
 * })
 * ```
 */
export function defineCheckmateTool<TSchema extends z.ZodType, TServices extends CheckmateServices = CheckmateServices>(
	toolConfig: ToolConfig<TSchema, TServices>
): AgentTool<TServices> {
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
		execute: async (args: unknown, context: AgentToolContext<TServices>) => {
			const parsed = toolConfig.schema.safeParse(args)
			if (!parsed.success) {
				return JSON.stringify({ error: `Invalid args for '${toolConfig.name}': ${parsed.error.message}` })
			}

			return toolConfig.handler(parsed.data, context)
		},
	}
}

export const defineAgentTool = defineCheckmateTool
