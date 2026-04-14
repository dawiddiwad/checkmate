import { logger } from '../logging'
import { ResolveStepResult } from '../runtime/types'
import { LoopDetector } from './loop-detector'
import { ToolRegistry, ToolResponse } from './registry'
import { ToolCall, ToolCallResult } from './tool-contract'

export class ToolDispatcher {
	private readonly loopDetector: LoopDetector

	constructor(private readonly toolRegistry: ToolRegistry) {
		this.loopDetector = new LoopDetector(toolRegistry.getRuntimeConfig().getLoopMaxRepetitions())
	}

	getToolRegistry(): ToolRegistry {
		return this.toolRegistry
	}

	async dispatch(toolCall: ToolCall, resolveStepResult: ResolveStepResult): Promise<ToolResponse | null> {
		this.loopDetector.recordToolCall(toolCall)
		logger.info(`executing tool: ${toolCall.name}:\n${JSON.stringify(toolCall.arguments ?? {}, null, 2)}`)

		const tool = this.toolRegistry.resolve(toolCall.name)
		if (!tool) {
			throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(toolCall, null, 2)}`)
		}

		const result = await tool.execute(toolCall, { resolveStepResult })
		return this.normalizeToolResponse(toolCall.name, result)
	}

	private normalizeToolResponse(toolName: string, result: ToolCallResult): ToolResponse | null {
		if (result === undefined) {
			return null
		}

		if (typeof result === 'string') {
			return { name: toolName, response: result }
		}

		const normalizedResult = (result ?? { response: '' }) as { response: string; snapshot?: string | null }
		return {
			name: toolName,
			response: normalizedResult.response,
			snapshot: normalizedResult.snapshot ?? null,
		}
	}
}
