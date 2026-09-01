import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { ResolvedConfig } from '../config/resolved-config.js'
import { AgentTool, getToolName } from './types.js'

export type { ToolResponse } from './types.js'

export class ToolRegistry {
	private readonly tools: AgentTool[] = []
	private readonly toolsByName = new Map<string, AgentTool>()

	constructor(private readonly config: ResolvedConfig) {}

	register(tool: AgentTool | AgentTool[]): void {
		const tools = Array.isArray(tool) ? tool : [tool]

		for (const registeredTool of tools) {
			const toolName = getToolName(registeredTool)
			if (this.toolsByName.has(toolName)) {
				throw new Error(`Duplicate tool registration for '${toolName}'`)
			}

			this.tools.push(registeredTool)
			this.toolsByName.set(toolName, registeredTool)
		}
	}

	getConfig(): ResolvedConfig {
		return this.config
	}

	resolve(toolName: string): AgentTool | undefined {
		return this.toolsByName.get(toolName)
	}

	getRegisteredToolNames(): string[] {
		return this.tools.map((tool) => getToolName(tool))
	}

	async getTools(): Promise<ChatCompletionFunctionTool[]> {
		const allowedNames = this.config.allowedTools
		const definitions = this.tools.map((tool) => this.toOpenAiTool(tool))

		if (allowedNames.length === 0) {
			return definitions
		}

		return definitions.filter((tool) => allowedNames.includes(tool.function.name))
	}

	private toOpenAiTool(tool: AgentTool): ChatCompletionFunctionTool {
		return {
			type: 'function',
			function: {
				name: tool.definition.name,
				description: tool.definition.description,
				parameters: tool.definition.parameters,
				strict: tool.definition.strict,
			},
		}
	}
}
