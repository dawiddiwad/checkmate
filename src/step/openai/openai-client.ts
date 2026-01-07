import OpenAI from 'openai'
import { ChatCompletionMessageParam, ChatCompletion } from 'openai/resources/chat/completions'
import { ConfigurationManager } from '../configuration-manager'
import { ToolRegistry } from '../tool/tool-registry'
import { LoopDetectedError } from '../tool/loop-detector'
import { ResponseProcessor } from './response-processor'
import { Step, StepStatusCallback } from '../types'
import { Page } from '@playwright/test'
import { CheckmateLogger } from '../logger'
import { logger } from './openai-test-manager'

export type OpenAIClientDependencies = {
	configurationManager: ConfigurationManager
	toolRegistry: ToolRegistry
	page: Page
}

export class OpenAIClient {
	private client!: OpenAI
	private messages: ChatCompletionMessageParam[] = []
	private readonly configurationManager: ConfigurationManager
	private readonly toolRegistry: ToolRegistry
	private readonly RETRYABLE_STATUS = [408, 409, 429, 500, 502, 503, 504, LoopDetectedError.STATUS]
	private readonly responseProcessor: ResponseProcessor
	readonly page: Page
	step: Step
	stepStatusCallback: StepStatusCallback
	temperature: number

	constructor({ configurationManager, toolRegistry, page }: OpenAIClientDependencies) {
		this.configurationManager = configurationManager
		this.toolRegistry = toolRegistry
		this.responseProcessor = new ResponseProcessor({ page, openaiClient: this })
		this.temperature = this.configurationManager.getTemperature()
		this.page = page
	}

	async initialize(step: Step, stepStatusCallback: StepStatusCallback): Promise<void> {
		this.client = new OpenAI({
			apiKey: this.configurationManager.getApiKey(),
			baseURL: this.configurationManager.getBaseURL(),
			timeout: this.configurationManager.getTimeout(),
			maxRetries: 0,
			logLevel: this.configurationManager.getLogLevel(),
			logger: CheckmateLogger.create('openai_client', this.configurationManager.getLogLevel()),
		})
		this.messages = []
		this.step = step
		this.stepStatusCallback = stepStatusCallback
		this.responseProcessor.resetStepTokens()
		this.temperature = this.configurationManager.getTemperature()
		this.toolRegistry.setStep(step)
	}

	getMessages(): ChatCompletionMessageParam[] {
		return this.messages
	}

	getToolRegistry(): ToolRegistry {
		return this.toolRegistry
	}

	getConfigurationManager(): ConfigurationManager {
		return this.configurationManager
	}

	async sendMessage(userMessage: string | ChatCompletionMessageParam[]) {
		if (typeof userMessage === 'string') {
			this.messages.push({ role: 'user', content: userMessage })
		} else {
			this.messages.push(...userMessage)
		}

		return this.executeWithRetry(async () => {
			const tools = await this.toolRegistry.getTools()
			const response = await this.client.chat.completions.create({
				model: this.configurationManager.getModel(),
				messages: this.messages,
				tools,
				tool_choice: this.configurationManager.getToolChoice(),
				parallel_tool_calls: false,
				temperature: this.temperature,
				n: 1,
				reasoning_effort: this.configurationManager.getReasoningEffort(),
			})

			response.choices.forEach((choice) => {
				if (choice.message) {
					this.messages.push(choice.message)
				}
			})

			await this.responseProcessor.handleResponse(response, this.step, this.stepStatusCallback)
		})
	}

	async addToolResponse(toolCallId: string, content: string): Promise<void> {
		this.messages.push({
			role: 'tool',
			tool_call_id: toolCallId,
			content,
		})
	}

	async addUserMessage(content: string): Promise<void> {
		this.messages.push({
			role: 'user',
			content,
		})
	}

	async addScreenshotMessage(base64Data: string, mimeType: string = 'image/png'): Promise<void> {
		this.messages.push({
			role: 'user',
			content: [
				{
					type: 'text',
					text: 'Here is the current screenshot of the page:',
				},
				{
					type: 'image_url',
					image_url: {
						url: `data:${mimeType};base64,${base64Data}`,
						detail: 'high',
					},
				},
			],
		})
	}

	async sendToolResponseWithRetry(): Promise<ChatCompletion> {
		return this.executeWithRetry(async () => {
			const tools = await this.toolRegistry.getTools()
			const response = await this.client.chat.completions.create({
				model: this.configurationManager.getModel(),
				messages: this.messages,
				tools,
				tool_choice: this.configurationManager.getToolChoice(),
				temperature: this.temperature,
			})

			response.choices.forEach((choice) => {
				if (choice.message) {
					this.messages.push(choice.message)
				}
			})

			return response
		})
	}

	private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
		const maxRetries = this.configurationManager.getMaxRetries()
		let lastError: Error | null = null
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const result = await operation()
				return result
			} catch (error: any) {
				lastError = error

				if ((!this.isRetryable(error) && !this.isToolError(error)) || attempt === maxRetries) {
					throw this.enhanceError(error, attempt, maxRetries)
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

	private getStatus(error: any): number | null {
		return error?.status || error?.statusCode || error?.code || null
	}

	private isRetryable(error: any): boolean {
		const statusCode = this.getStatus(error)
		if (this.getStatus(error) === null) return false
		return this.RETRYABLE_STATUS.includes(statusCode)
	}

	private getRetryAfterSeconds(error: any): number | null {
		const headers = error?.headers
		if (!headers) return null

		const retryAfter = headers.get?.('retry-after') || headers['retry-after']
		if (!retryAfter) return null

		const seconds = parseInt(retryAfter, 10)
		return isNaN(seconds) ? null : seconds
	}

	private calculateBackoff(attempt: number): number {
		const delays = [1_000, 10_000, 60_000]
		const baseDelay = delays[Math.min(attempt, delays.length - 1)]
		return baseDelay
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	countHistoryTokens(): number {
		const totalChars = this.messages.reduce((sum, msg) => {
			if (typeof msg.content === 'string') {
				return sum + msg.content.length
			}
			return sum
		}, 0)
		return Math.ceil(totalChars / 4)
	}

	replaceHistory(history: ChatCompletionMessageParam[]): void {
		this.messages = [...history]
	}

	private enhanceError(error: any, attempt?: number, maxRetries?: number): Error {
		const status = error?.status || error?.statusCode || error?.code || 'unknown'
		const message = error?.message || null

		const details = `OpenAI API error [${status}]: ${message ?? JSON.stringify(error, null, 2)}`
		return new Error(details)
	}

	private isToolError(error: any): boolean {
		const errorAsString = JSON.stringify(error, null, 2).toLowerCase()
		if (this.getStatus(error) === 400 && errorAsString.includes('tool')) {
			logger.warn('tool call error detected [400]')
			this.addUserMessage(
				`you did not call a tool or called it incorrectly, try again and always only call a tool with correct parameters to proceed with the step.`
			)
			return true
		} else return false
	}
}
