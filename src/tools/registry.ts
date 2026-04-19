import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { RuntimeConfig } from '../config/runtime-config'
import { CheckmateContextItem } from '../runtime/module'
import { AnyCheckmateTool, getToolName } from './types'

export type ToolResponse = {
	name?: string
	response: string
	context?: CheckmateContextItem[]
	status: 'success' | 'error'
}

export class ToolRegistry {
	private readonly tools: AnyCheckmateTool[] = []
	private readonly toolsByName = new Map<string, AnyCheckmateTool>()

	constructor(private readonly runtimeConfig: RuntimeConfig) {}

	register(tool: AnyCheckmateTool | AnyCheckmateTool[]): void {
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

	resolve(toolName: string): AnyCheckmateTool | undefined {
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
