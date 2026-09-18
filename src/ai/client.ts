import OpenAI from 'openai'
import {
	ChatCompletion,
	ChatCompletionAssistantMessageParam,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { RuntimeConfig } from '../runtime/config.js'
import { prepareModelRequest } from '../config/model-egress.js'
import type { ModelEgressPolicyV1 } from '../contracts/types.js'
import type { RuntimeLogger } from '../logging/types.js'
import { ToolRegistry } from '../tools/registry.js'
import { Step } from '../runtime/types.js'
import type { DriverStructuredGenerationRequest } from '../driver.js'

export type AiClientDependencies = {
	config: RuntimeConfig
	toolRegistry: ToolRegistry
	apiKey: string
	modelEgress?: ModelEgressPolicyV1
	exactSecrets?: Iterable<string>
	logger: RuntimeLogger
}

export type AiSendOptions = {
	step?: Step
	signal?: AbortSignal
}

export type AiResponse = {
	response: ChatCompletion
	assistantMessages: ChatCompletionAssistantMessageParam[]
}

export class AiClient {
	private client: OpenAI | null = null
	private readonly config: RuntimeConfig
	private readonly toolRegistry: ToolRegistry
	private readonly apiKey: string | undefined
	private readonly modelEgress: ModelEgressPolicyV1 | undefined
	private readonly exactSecrets: readonly string[]
	private readonly runtimeLogger: RuntimeLogger
	private readonly retryableStatus: (number | string)[] = [408, 409, 429, 500, 502, 503, 504]
	private sendsTemperature = true
	readonly temperature: number

	constructor({
		config,
		toolRegistry,
		apiKey,
		modelEgress,
		exactSecrets = [],
		logger: runtimeLogger,
	}: AiClientDependencies) {
		this.config = config
		this.toolRegistry = toolRegistry
		this.apiKey = apiKey
		this.modelEgress = modelEgress
		this.exactSecrets = [...exactSecrets]
		this.runtimeLogger = runtimeLogger
		this.temperature = config.temperature
	}

	async send(messages: ChatCompletionMessageParam[], options: AiSendOptions = {}): Promise<AiResponse> {
		return this.executeWithRetry(messages, options, async () => {
			const tools = await this.toolRegistry.getTools()
			return this.withTemperatureFallback((withTemperature) =>
				this.complete(messages, tools, withTemperature, options.signal)
			)
		})
	}

	async sendStructured(
		input: DriverStructuredGenerationRequest,
		options: AiSendOptions = {}
	): Promise<ChatCompletion> {
		const messages: ChatCompletionMessageParam[] = input.messages.map((message) => {
			if (message.role !== 'user') {
				if (message.content.some((part) => part.type !== 'text')) {
					throw new Error('Structured generation supports images only in user messages')
				}
				return {
					role: message.role,
					content: message.content.map((part) => (part as { text: string }).text).join('\n'),
				}
			}
			return {
				role: 'user',
				content: message.content.map((part) =>
					part.type === 'text'
						? { type: 'text', text: part.text }
						: { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } }
				),
			}
		})
		return this.executeWithRetry(
			messages,
			options,
			() =>
				this.withTemperatureFallback(async (withTemperature) => {
					const request: ChatCompletionCreateParamsNonStreaming = {
						model: this.config.model,
						messages,
						response_format: {
							type: 'json_schema',
							json_schema: { name: input.schemaName, schema: input.schema, strict: true },
						},
						...(withTemperature ? { temperature: this.temperature } : {}),
						reasoning_effort: this.config.reasoningEffort,
						n: 1,
					}
					const prepared = this.modelEgress
						? prepareModelRequest(request, this.modelEgress, this.exactSecrets)
						: request
					options.signal?.throwIfAborted()
					return this.openai().chat.completions.create(prepared, { signal: options.signal })
				}),
			false
		)
	}

	private async withTemperatureFallback<T>(operation: (withTemperature: boolean) => Promise<T>): Promise<T> {
		try {
			return await operation(this.sendsTemperature)
		} catch (error) {
			if (!this.sendsTemperature || !this.rejectsTemperature(error)) throw error
			this.runtimeLogger.warn(
				`${this.config.model} does not accept temperature ${this.temperature}; continuing on the provider default for the rest of this run`
			)
			this.sendsTemperature = false
			return operation(false)
		}
	}

	countHistoryTokens(messages: ChatCompletionMessageParam[]): number {
		const totalChars = messages.reduce((sum, message) => sum + this.countContentChars(message.content), 0)
		return Math.ceil(totalChars / 4)
	}

	private async complete(
		messages: ChatCompletionMessageParam[],
		tools: Awaited<ReturnType<ToolRegistry['getTools']>>,
		withTemperature: boolean,
		signal?: AbortSignal
	): Promise<AiResponse> {
		const request: ChatCompletionCreateParamsNonStreaming = {
			model: this.config.model,
			messages,
			tools,
			tool_choice: this.config.toolChoice,
			parallel_tool_calls: false,
			...(withTemperature ? { temperature: this.temperature } : {}),
			reasoning_effort: this.config.reasoningEffort,
			n: 1,
		}
		const providerRequest = this.modelEgress
			? prepareModelRequest(request, this.modelEgress, this.exactSecrets)
			: request
		signal?.throwIfAborted()
		const response = await this.openai().chat.completions.create(providerRequest, { signal })

		return { response, assistantMessages: this.retainAssistantMessages(response) }
	}

	/**
	 * Whether the provider rejected the request because of the configured temperature.
	 *
	 * Some models — OpenAI's `gpt-5` family and its reasoning models among them — accept only
	 * their own default temperature and answer any other value with a 400. Detecting that from
	 * the response is what keeps the policy temperature working against any OpenAI-compatible
	 * endpoint; a hard-coded list of model families would go stale the week after it was written.
	 */
	private rejectsTemperature(error: unknown): boolean {
		if (this.getStatus(error) !== 400) {
			return false
		}

		if (typeof error === 'object' && error !== null && 'param' in error) {
			return (error as { param?: unknown }).param === 'temperature'
		}

		return String(error).toLowerCase().includes('temperature')
	}

	private openai(): OpenAI {
		if (!this.client) {
			this.client = new OpenAI({
				apiKey: this.apiKey,
				baseURL: this.config.baseUrl,
				timeout: this.config.requestTimeout,
				maxRetries: 0,
				logLevel: this.config.logLevel,
				logger: this.runtimeLogger,
			})
		}

		return this.client
	}

	private retainAssistantMessages(response: ChatCompletion): ChatCompletionAssistantMessageParam[] {
		return (response.choices ?? [])
			.filter((choice) => choice.message)
			.map((choice) => this.sanitizeAssistantMessage(choice.message))
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

	private async executeWithRetry<T>(
		messages: ChatCompletionMessageParam[],
		options: AiSendOptions,
		operation: () => Promise<T>,
		repairToolCalls = true
	): Promise<T> {
		const maxRetries = this.config.maxRetries
		let lastError: Error | null = null

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			options.signal?.throwIfAborted()
			try {
				return await operation()
			} catch (error: unknown) {
				lastError = error instanceof Error ? error : new Error(String(error))

				if (
					(!this.isRetryable(error) && !(repairToolCalls && this.isToolError(error, messages, options))) ||
					attempt === maxRetries
				) {
					throw this.enhanceError(error, messages, options)
				}

				const retryAfter = this.getRetryAfterSeconds(error)
				const delay = retryAfter ? retryAfter * 1000 : this.calculateBackoff(attempt)
				this.runtimeLogger.warn(
					`status: ${this.getStatus(error)} retry attempt: ${attempt + 1}/${maxRetries} starting in: ${delay}ms ...`
				)
				this.runtimeLogger.debug(`retryable error details:\n${this.formatError(error)}`)
				if (options.signal) await this.sleep(delay, options.signal)
				else await this.sleep(delay)
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

	private sleep(ms: number, signal?: AbortSignal): Promise<void> {
		if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
		if (signal.aborted) return Promise.reject(signal.reason)
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				signal.removeEventListener('abort', onAbort)
				resolve()
			}, ms)
			const onAbort = () => {
				clearTimeout(timer)
				reject(signal.reason)
			}
			signal.addEventListener('abort', onAbort, { once: true })
		})
	}

	private enhanceError(error: unknown, messages: ChatCompletionMessageParam[], options: AiSendOptions): Error {
		const status = this.getStatus(error) ?? 'unknown'
		const message = error instanceof Error ? error.message : String(error)
		return new Error(
			[
				`OpenAI API error [${status}]: ${message}`,
				`model: ${this.config.model}`,
				`tool_choice: ${this.config.toolChoice}`,
				`reasoning_effort: ${this.config.reasoningEffort ?? 'unset'}`,
				`temperature: ${this.temperature}`,
				this.formatStepContext(options.step),
				`recent_messages:\n${this.formatRecentMessages(messages)}`,
				`provider_error:\n${this.formatError(error)}`,
			].join('\n'),
			{ cause: error }
		)
	}

	private isToolError(
		error: unknown,
		messages: ChatCompletionMessageParam[],
		options: AiSendOptions
	): error is Error {
		const errorAsString = this.formatError(error).toLowerCase()
		if (this.getStatus(error) === 400 && errorAsString.includes('tool')) {
			this.runtimeLogger.warn(
				`tool call error detected [400]\n${this.formatStepContext(options.step)}\nprovider_error:\n${this.formatError(error)}\nrecent_messages:\n${this.formatRecentMessages(messages)}`
			)
			messages.push({
				role: 'user',
				content:
					'you did not call a tool or called it incorrectly, try again and always only call a tool with correct parameters to proceed with the step.',
			})
			return true
		}

		return false
	}

	private formatStepContext(step: Step | undefined): string {
		return [`step_action: ${step?.action ?? '(unknown)'}`, `step_expect: ${step?.expect ?? '(unknown)'}`].join('\n')
	}

	private formatRecentMessages(messages: ChatCompletionMessageParam[]): string {
		const recentMessages = messages.slice(-6)
		if (recentMessages.length === 0) {
			return '(none)'
		}

		return recentMessages
			.map(
				(message, index) => `${index + 1}. ${message.role}: ${this.formatContentPreview(message.content, 500)}`
			)
			.join('\n')
	}

	private formatError(error: unknown): string {
		const seen = new WeakSet<object>()
		return this.formatContentPreview(
			JSON.stringify(
				error,
				(key, value) => {
					const lowerKey = key.toLowerCase()
					if (
						lowerKey.includes('authorization') ||
						lowerKey.includes('api_key') ||
						lowerKey.includes('apikey') ||
						lowerKey.includes('cookie')
					) {
						return '[secret omitted]'
					}
					if (value instanceof Error) {
						const errorRecord = value as unknown as Record<string, unknown>
						return {
							name: value.name,
							message: value.message,
							stack: value.stack,
							status: errorRecord.status,
							statusCode: errorRecord.statusCode,
							code: errorRecord.code,
							body: errorRecord.body,
							error: errorRecord.error,
						}
					}
					if (typeof value === 'object' && value !== null) {
						if (seen.has(value)) {
							return '[circular]'
						}
						seen.add(value)
					}
					return value
				},
				2
			) ?? String(error),
			2_000
		)
	}

	private formatContentPreview(content: unknown, maxLength: number): string {
		let text: string
		if (typeof content === 'string') {
			text = content
		} else if (Array.isArray(content)) {
			text = content
				.map((part) => {
					if (part && typeof part === 'object' && 'image_url' in part) {
						return '[image omitted]'
					}
					if (part && typeof part === 'object' && 'text' in part) {
						return String((part as { text?: unknown }).text ?? '')
					}
					return '[content omitted]'
				})
				.join(' ')
		} else {
			text = JSON.stringify(content) ?? String(content)
		}

		text = text
			.replace(/sk-[A-Za-z0-9_-]+/g, '[secret omitted]')
			.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]')
			.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64 omitted]')

		return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`
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
