import { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { ResolvedConfig } from '../config/resolved-config.js'
import { StepResultTool } from './step/result-tool.js'
import { AgentTool, getToolName } from './types.js'

export type { ToolResponse } from './types.js'

export class ToolRegistry {
	private readonly tools: AgentTool[] = []
	private readonly toolsByName = new Map<string, AgentTool>()
	private readonly config: ResolvedConfig | undefined
	private readonly allowedNames: '*' | readonly string[]

	constructor(config: ResolvedConfig)
	constructor(options: { allowedTools: '*' | readonly string[] })
	constructor(input: ResolvedConfig | { allowedTools: '*' | readonly string[] }) {
		if ('model' in input) {
			this.config = input
			this.allowedNames = input.allowedTools.length === 0 ? '*' : [...input.allowedTools]
		} else {
			this.allowedNames = input.allowedTools === '*' ? '*' : [...input.allowedTools]
		}
	}

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
		if (!this.config) throw new Error('Legacy resolved config is not available on this tool registry')
		return this.config
	}

	resolve(toolName: string): AgentTool | undefined {
		if (!this.isAllowed(toolName)) return undefined
		return this.toolsByName.get(toolName)
	}

	getRegisteredToolNames(): string[] {
		return this.tools.map((tool) => getToolName(tool))
	}

	async getTools(): Promise<ChatCompletionFunctionTool[]> {
		const definitions = this.tools.map((tool) => this.toOpenAiTool(tool))

		return definitions.filter((tool) => this.isAllowed(tool.function.name))
	}

	getAllowedToolNames(): '*' | readonly string[] {
		return this.allowedNames === '*' ? '*' : [...this.allowedNames]
	}

	private isAllowed(toolName: string): boolean {
		return (
			toolName === StepResultTool.TOOL_FAIL_TEST_STEP ||
			toolName === StepResultTool.TOOL_PASS_TEST_STEP ||
			this.allowedNames === '*' ||
			this.allowedNames.includes(toolName)
		)
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
