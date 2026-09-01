import { logger } from '../logging/index.js'
import { scrub } from '../redaction/scrub.js'
import { LoopDetector } from './loop-detector.js'
import { ToolRegistry } from './registry.js'
import { AgentToolContext, AgentToolResponse, AgentToolResult, ToolCall, ToolResponse } from './types.js'

export class ToolDispatcher {
	constructor(
		private readonly toolRegistry: ToolRegistry,
		private readonly loopDetector: LoopDetector
	) {}

	getToolRegistry(): ToolRegistry {
		return this.toolRegistry
	}

	async dispatch(toolCall: ToolCall, context: AgentToolContext): Promise<ToolResponse | null> {
		this.loopDetector.recordToolCall(toolCall)
		logger.info(`executing tool: ${toolCall.name}:\n${JSON.stringify(toolCall.arguments ?? {}, null, 2)}`)

		const tool = this.toolRegistry.resolve(toolCall.name)
		if (!tool) {
			throw new ToolDispatchError(
				[
					`Invalid tool name: ${toolCall.name}`,
					`arguments: ${preview(toolCall.arguments, 1_000)}`,
					`registered_tools: ${this.toolRegistry.getRegisteredToolNames().join(', ') || '(none)'}`,
					`allowed_tools: ${this.formatAllowedToolNames()}`,
				].join('\n')
			)
		}

		let result: AgentToolResult
		try {
			result = await tool.execute(toolCall.arguments, context)
		} catch (error) {
			throw new ToolDispatchError(
				[
					`Tool execution failed: ${toolCall.name}`,
					`arguments: ${preview(toolCall.arguments, 1_000)}`,
					`original_error: ${error instanceof Error ? error.message : String(error)}`,
				].join('\n'),
				{ cause: error }
			)
		}

		const response = this.normalizeToolResponse(toolCall.name, result)
		if (response === null && this.toolRegistry.getConfig().logLevel === 'debug') {
			logger.debug(
				[
					'tool completed without model response:',
					`tool: ${toolCall.name}`,
					`arguments: ${preview(toolCall.arguments ?? {}, 1_000)}`,
				].join('\n')
			)
		}
		return response
	}

	private formatAllowedToolNames(): string {
		const allowedNames = this.toolRegistry.getConfig().allowedTools
		return allowedNames.length > 0 ? allowedNames.join(', ') : '(all registered tools allowed)'
	}

	private normalizeToolResponse(toolName: string, result: AgentToolResult): ToolResponse | null {
		if (result === undefined) {
			return null
		}

		if (typeof result === 'string') {
			return { name: toolName, response: result, status: inferToolResponseStatus(result) }
		}

		const normalizedResult = (result ?? { response: '' }) as AgentToolResponse
		return {
			name: toolName,
			response: normalizedResult.response,
			snapshot: normalizedResult.snapshot ?? null,
			status: normalizedResult.status ?? 'success',
			...(normalizedResult.assertion ? { assertion: normalizedResult.assertion } : {}),
		}
	}
}

export class ToolDispatchError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'ToolDispatchError'
	}
}

function preview(value: unknown, maxLength: number): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
	const safeText = scrub(text ?? String(value))
	return safeText.length <= maxLength ? safeText : `${safeText.slice(0, maxLength - 3)}...`
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
