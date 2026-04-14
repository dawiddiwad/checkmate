import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { RuntimeConfig } from '../config/runtime-config'
import { Step } from '../runtime/types'
import { ToolContract } from './tool-contract'

export type ToolResponse = {
	name?: string
	response: string
	snapshot?: string | null
}

export class ToolRegistry {
	private readonly tools: ToolContract[] = []
	private readonly toolsByName = new Map<string, ToolContract>()

	constructor(private readonly runtimeConfig: RuntimeConfig) {}

	register(tool: ToolContract): void {
		this.tools.push(tool)
		for (const declaration of tool.functionDeclarations) {
			const toolName = declaration.function.name
			if (this.toolsByName.has(toolName)) {
				throw new Error(`Duplicate tool registration for '${toolName}'`)
			}
			this.toolsByName.set(toolName, tool)
		}
	}

	setStep(step: Step): void {
		for (const tool of this.tools) {
			if (typeof tool.setStep === 'function') {
				tool.setStep(step)
			}
		}
	}

	getRuntimeConfig(): RuntimeConfig {
		return this.runtimeConfig
	}

	resolve(toolName: string): ToolContract | undefined {
		return this.toolsByName.get(toolName)
	}

	async getTools(): Promise<ChatCompletionFunctionTool[]> {
		const allowedNames = this.runtimeConfig.getAllowedFunctionNames()
		const declarations = this.tools.flatMap((tool) => tool.functionDeclarations)

		if (allowedNames.length === 0) {
			return declarations
		}

		return declarations.filter((tool) => allowedNames.includes(tool.function.name))
	}
}
