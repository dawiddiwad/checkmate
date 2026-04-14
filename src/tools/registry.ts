import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { RuntimeConfig } from '../config/runtime-config'
import { AgentTool, getToolName } from './types'

export type ToolResponse = {
	name?: string
	response: string
	snapshot?: string | null
}

export class ToolRegistry {
	private readonly tools: AgentTool[] = []
	private readonly toolsByName = new Map<string, AgentTool>()

	constructor(private readonly runtimeConfig: RuntimeConfig) {}

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

	getRuntimeConfig(): RuntimeConfig {
		return this.runtimeConfig
	}

	resolve(toolName: string): AgentTool | undefined {
		return this.toolsByName.get(toolName)
	}

	async getTools(): Promise<ChatCompletionFunctionTool[]> {
		const allowedNames = this.runtimeConfig.getAllowedFunctionNames()
		const definitions = this.tools.map((tool) => tool.definition)

		if (allowedNames.length === 0) {
			return definitions
		}

		return definitions.filter((tool) => allowedNames.includes(tool.function.name))
	}
}
