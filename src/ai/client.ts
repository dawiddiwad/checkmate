import OpenAI from 'openai'
import {
	ChatCompletion,
	ChatCompletionAssistantMessageParam,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { Page } from '@playwright/test'
import { RuntimeConfig } from '../config/runtime-config'
import { logger } from '../logging'
import { CheckmateLogger } from '../logging/logger'
import { LoopDetectedError } from '../tools/loop-detector'
import { ToolRegistry } from '../tools/registry'
import { Step, ResolveStepResult } from '../runtime/types'
import { MessageHistory } from './message-history'
import { ResponseProcessor } from './response-processor'

export type AiClientDependencies = {
	runtimeConfig: RuntimeConfig
	toolRegistry: ToolRegistry
	page: Page
}

export class AiClient {
	private client!: OpenAI
	private messages: ChatCompletionMessageParam[] = []
	private readonly responseProcessor: ResponseProcessor
	private readonly retryableStatus: (number | string)[] = [
		408,
		409,
		429,
		500,
		502,
		503,
		504,
		LoopDetectedError.STATUS,
	]
	private step!: Step
	private resolveStepResult!: ResolveStepResult
	temperature: number

	constructor({ runtimeConfig, toolRegistry, page }: AiClientDependencies) {
		this.runtimeConfig = runtimeConfig
		this.toolRegistry = toolRegistry
		this.page = page
		this.responseProcessor = new ResponseProcessor({ page, aiClient: this })
		this.temperature = this.runtimeConfig.getTemperature()
	}

	private readonly runtimeConfig: RuntimeConfig
	private readonly toolRegistry: ToolRegistry
	readonly page: Page

	async initialize(step: Step, resolveStepResult: ResolveStepResult): Promise<void> {
		this.client = new OpenAI({
			apiKey: this.runtimeConfig.getApiKey(),
			baseURL: this.runtimeConfig.getBaseURL(),
			timeout: this.runtimeConfig.getTimeout(),
			maxRetries: 0,
			logLevel: this.runtimeConfig.getLogLevel(),
			logger: CheckmateLogger.create('ai_client', this.runtimeConfig.getLogLevel()),
		})

		this.messages = []
		this.step = step
		this.resolveStepResult = resolveStepResult
		this.responseProcessor.resetStepTokens()
		this.temperature = this.runtimeConfig.getTemperature()
	}

	getMessages(): ChatCompletionMessageParam[] {
		return this.messages
	}

	getToolRegistry(): ToolRegistry {
		return this.toolRegistry
	}

	getRuntimeConfig(): RuntimeConfig {
		return this.runtimeConfig
	}

	async sendMessage(userMessage: string | ChatCompletionMessageParam[]) {
		if (typeof userMessage === 'string') {
			this.messages.push({ role: 'user', content: userMessage })
		} else {
			this.messages.push(...userMessage)
		}

		return this.executeWithRetry(async () => {
			const tools = await this.toolRegistry.getTools()
			const response = await this.createChatCompletion(tools, true)
			this.appendResponseMessages(response)
			await this.responseProcessor.handleResponse(response, this.step, this.resolveStepResult)
		})
	}

	async addToolResponse(toolCallId: string, content: string): Promise<void> {
		this.messages.push({ role: 'tool', tool_call_id: toolCallId, content })
	}

	async addUserMessage(content: string): Promise<void> {
		this.messages.push({ role: 'user', content })
	}

	async addCurrentSnapshotMessage(snapshotContent: string): Promise<void> {
		this.messages.push({
			role: 'user',
			content: [{ type: 'text', text: `${MessageHistory.SNAPSHOT_IDENTIFIER}:\n${snapshotContent}` }],
		})
	}

	async addCurrentScreenshotMessage(base64Data: string, mimeType: string = 'image/png'): Promise<void> {
		this.messages.push({
			role: 'user',
			content: [
				{ type: 'text', text: MessageHistory.SCREENSHOT_IDENTIFIER },
				{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'high' } },
			],
		})
	}

	async sendToolResponseWithRetry(): Promise<ChatCompletion> {
		return this.executeWithRetry(async () => {
			const tools = await this.toolRegistry.getTools()
			const response = await this.createChatCompletion(tools, false)
			this.appendResponseMessages(response)
			return response
		})
	}

	private async createChatCompletion(tools: Awaited<ReturnType<ToolRegistry['getTools']>>, includeN: boolean) {
		return this.client.chat.completions.create({
			model: this.runtimeConfig.getModel(),
			messages: this.messages,
			tools,
			tool_choice: this.runtimeConfig.getToolChoice(),
			parallel_tool_calls: false,
			temperature: this.temperature,
			reasoning_effort: this.runtimeConfig.getReasoningEffort(),
			...(includeN ? { n: 1 } : {}),
		})
	}

	private appendResponseMessages(response: ChatCompletion): void {
		response.choices.forEach((choice) => {
			if (choice.message) {
				this.messages.push(this.sanitizeAssistantMessage(choice.message))
			}
		})
	}

	private sanitizeAssistantMessage(
		message: ChatCompletion['choices'][number]['message']
	): ChatCompletionAssistantMessageParam {
		const sanitizedMessage: ChatCompletionAssistantMessageParam = { role: 'assistant' }

		if (message.content !== undefined) {
			sanitizedMessage.content = message.content
		}

		if ('refusal' in message && message.refusal !== undefined) {
			sanitizedMessage.refusal = message.refusal
		}

		if ('tool_calls' in message && message.tool_calls !== undefined) {
			sanitizedMessage.tool_calls = message.tool_calls
		}

		if ('function_call' in message && message.function_call !== undefined) {
			sanitizedMessage.function_call = message.function_call
		}

		if ('name' in message && typeof message.name === 'string') {
			sanitizedMessage.name = message.name
		}

		if ('audio' in message && message.audio !== undefined) {
			sanitizedMessage.audio = message.audio
		}

		return sanitizedMessage
	}

	private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
		const maxRetries = this.runtimeConfig.getMaxRetries()
		let lastError: Error | null = null

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await operation()
			} catch (error: unknown) {
				lastError = error instanceof Error ? error : new Error(String(error))

				if ((!this.isRetryable(error) && !this.isToolError(error)) || attempt === maxRetries) {
					throw this.enhanceError(error)
				}

				if (error instanceof LoopDetectedError) {
					const antiLoopTempChange = Math.round(Math.random() * 10) / 10
					logger.warn(
						`repeated tool calls detected: adjusting temperature from ${this.temperature} to ${antiLoopTempChange} to mitigate looping`
					)
					this.temperature = antiLoopTempChange
				}

				const retryAfter = this.getRetryAfterSeconds(error)
				const delay = retryAfter ? retryAfter * 1000 : this.calculateBackoff(attempt)
				logger.warn(
					`status: ${this.getStatus(error)} retry attempt: ${attempt + 1}/${maxRetries} starting in: ${delay}ms ...`
				)
				logger.debug(`retryable error details:\n${JSON.stringify(error, null, 2)}`)
				await this.sleep(delay)
			}
		}

		throw lastError || new Error('Unexpected error in retry loop')
	}

	private getStatus(error: unknown): string | number | null {
		if (typeof error !== 'object' || error === null) {
			return null
		}

		const status =
			(error as Record<string, unknown>).status ??
			(error as Record<string, unknown>).statusCode ??
			(error as Record<string, unknown>).code
		return typeof status === 'number' || typeof status === 'string' ? status : null
	}

	private isRetryable(error: unknown): boolean {
		const statusCode = this.getStatus(error)
		return statusCode !== null && this.retryableStatus.includes(statusCode)
	}

	private getRetryAfterSeconds(error: unknown): number | null {
		if (typeof error !== 'object' || error === null) {
			return null
		}

		const headers = (error as Record<string, unknown>).headers as Record<string, unknown> | undefined
		if (!headers) {
			return null
		}

		const retryAfter =
			(headers as { get?: (key: string) => string | undefined; 'retry-after'?: string }).get?.('retry-after') ??
			(headers as { 'retry-after'?: string })['retry-after']
		if (!retryAfter) {
			return null
		}

		const seconds = parseInt(retryAfter, 10)
		return Number.isNaN(seconds) ? null : seconds
	}

	private calculateBackoff(attempt: number): number {
		const delays = [1_000, 10_000, 60_000]
		return delays[Math.min(attempt, delays.length - 1)]
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	countHistoryTokens(): number {
		const totalChars = this.messages.reduce((sum, msg) => sum + this.countContentChars(msg.content), 0)
		return Math.ceil(totalChars / 4)
	}

	replaceHistory(history: ChatCompletionMessageParam[]): void {
		this.messages = [...history]
	}

	private enhanceError(error: unknown): Error {
		const status = this.getStatus(error) ?? 'unknown'
		const message = error instanceof Error ? error.message : null
		return new Error(`OpenAI API error [${status}]: ${message ?? JSON.stringify(error, null, 2)}`)
	}

	private isToolError(error: unknown): boolean {
		const errorAsString = JSON.stringify(error, null, 2).toLowerCase()
		if (this.getStatus(error) === 400 && errorAsString.includes('tool')) {
			logger.warn('tool call error detected [400]')
			void this.addUserMessage(
				'you did not call a tool or called it incorrectly, try again and always only call a tool with correct parameters to proceed with the step.'
			)
			return true
		}

		return false
	}

	private countContentChars(content: ChatCompletionMessageParam['content']): number {
		if (typeof content === 'string') {
			return content.length
		}

		if (!Array.isArray(content)) {
			return 0
		}

		let totalChars = 0
		for (const part of content) {
			if ('text' in part && typeof part.text === 'string') {
				totalChars += part.text.length
				continue
			}

			if ('image_url' in part) {
				const imageUrl = part.image_url as { url?: string }
				if (typeof imageUrl.url === 'string') {
					totalChars += imageUrl.url.length
				}
			}
		}

		return totalChars
	}
}
