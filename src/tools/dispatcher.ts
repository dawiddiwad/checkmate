import { logger } from '../logging/index.js'
import { LoopDetector } from './loop-detector.js'
import { ToolRegistry, ToolResponse } from './registry.js'
import { AgentToolContext, AgentToolResult, ToolCall } from './types.js'

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
			throw new Error(
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
			throw new Error(
				[
					`Tool execution failed: ${toolCall.name}`,
					`arguments: ${preview(toolCall.arguments, 1_000)}`,
					`original_error: ${error instanceof Error ? error.message : String(error)}`,
				].join('\n'),
				{ cause: error }
			)
		}

		const response = this.normalizeToolResponse(toolCall.name, result)
		if (response === null && this.toolRegistry.getRuntimeConfig().getLogLevel() === 'debug') {
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
		const allowedNames = this.toolRegistry.getRuntimeConfig().getAllowedFunctionNames()
		return allowedNames.length > 0 ? allowedNames.join(', ') : '(all registered tools allowed)'
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

function preview(value: unknown, maxLength: number): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
	const safeText = redact(text ?? String(value))
	return safeText.length <= maxLength ? safeText : `${safeText.slice(0, maxLength - 3)}...`
}

function redact(value: string): string {
	return redactSecretFields(value)
		.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
		.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')
		.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [secret omitted]')
		.replace(/Authorization\s*[:=]\s*[^\s,;}]+/gi, '[secret omitted]')
		.replace(/Cookie\s*[:=]\s*[^\n,;}]+/gi, '[secret omitted]')
}

function redactSecretFields(value: string): string {
	const secretKey = String.raw`(?:OPENAI_API_KEY|api[_-]?key|apikey|authorization|cookie)`
	return value
		.replace(
			new RegExp(String.raw`(["'])${secretKey}\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2\s*,?`, 'gi'),
			'[secret omitted]'
		)
		.replace(
			new RegExp(String.raw`\b${secretKey}\b\s*[:=]\s*(?:Bearer\s+[^\s,;}]+|"[^"]*"|'[^']*'|[^\s,;}]+)`, 'gi'),
			'[secret omitted]'
		)
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
