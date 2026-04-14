import { logger } from '../logging'
import { LoopDetector } from './loop-detector'
import { ToolRegistry, ToolResponse } from './registry'
import { AgentToolContext, AgentToolResult, ToolCall } from './types'

export class ToolDispatcher {
	private readonly loopDetector: LoopDetector

	constructor(private readonly toolRegistry: ToolRegistry) {
		this.loopDetector = new LoopDetector(toolRegistry.getRuntimeConfig().getLoopMaxRepetitions())
	}

	getToolRegistry(): ToolRegistry {
		return this.toolRegistry
	}

	async dispatch(toolCall: ToolCall, context: AgentToolContext): Promise<ToolResponse | null> {
		this.loopDetector.recordToolCall(toolCall)
		logger.info(`executing tool: ${toolCall.name}:\n${JSON.stringify(toolCall.arguments ?? {}, null, 2)}`)

		const tool = this.toolRegistry.resolve(toolCall.name)
		if (!tool) {
			throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(toolCall, null, 2)}`)
		}

		const result = await tool.execute(toolCall.arguments, context)
		return this.normalizeToolResponse(toolCall.name, result)
	}

	private normalizeToolResponse(toolName: string, result: AgentToolResult): ToolResponse | null {
		if (result === undefined) {
			return null
		}

		if (typeof result === 'string') {
			return { name: toolName, response: result, status: inferToolResponseStatus(result) }
		}

		const normalizedResult = (result ?? { response: '' }) as {
			response: string
			snapshot?: string | null
			status?: 'success' | 'error'
		}
		return {
			name: toolName,
			response: normalizedResult.response,
			snapshot: normalizedResult.snapshot ?? null,
			status: normalizedResult.status ?? 'success',
		}
	}
}

function inferToolResponseStatus(response: string): 'success' | 'error' {
	const normalizedResponse = response.trim().toLowerCase()
	if (
		normalizedResponse.startsWith('failed') ||
		normalizedResponse.startsWith('error') ||
		normalizedResponse.startsWith('tool call error') ||
		normalizedResponse.startsWith('{"error"')
	) {
		return 'error'
	}

	return 'success'
}
