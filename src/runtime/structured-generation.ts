import { createRequire } from 'node:module'
import type { Ajv2020 } from 'ajv/dist/2020.js'
import type { FormatsPlugin } from 'ajv-formats'
import { z } from 'zod/v4'
import type { AiClient } from '../ai/client.js'
import type { DriverStructuredGenerationRequest, DriverStructuredGenerationResult, StepIntent } from '../driver.js'
import { inspectJsonStructure } from '../config/ingestion.js'
import type { StepControl } from './scenario-control.js'
import { DriverBoundaryError } from './driver-boundary.js'
import { ScenarioUsageTracker, TokenBudgetExceededError } from './usage-tracker.js'

const require = createRequire(import.meta.url)
const Ajv = require('ajv/dist/2020.js') as typeof Ajv2020
const addFormats = require('ajv-formats') as FormatsPlugin
const requestSchema = z
	.object({
		messages: z
			.array(
				z
					.object({
						role: z.enum(['system', 'user', 'assistant']),
						content: z
							.array(
								z.discriminatedUnion('type', [
									z.object({ type: z.literal('text'), text: z.string() }).strict(),
									z
										.object({
											type: z.literal('image'),
											mediaType: z.string().regex(/^image\/[a-zA-Z0-9.+-]+$/),
											data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
										})
										.strict(),
								])
							)
							.min(1),
					})
					.strict()
			)
			.min(1),
		schemaName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
		schema: z.record(z.string(), z.json()),
	})
	.strict()

export class StructuredGenerationError extends Error {
	constructor(
		readonly reason: 'provider-error' | 'token-budget-exceeded',
		cause: unknown
	) {
		super('Driver structured generation failed', { cause })
		this.name = 'StructuredGenerationError'
	}
}

export class StructuredGenerationGateway {
	failure: StructuredGenerationError | undefined

	constructor(
		private readonly client: AiClient,
		private readonly usage: ScenarioUsageTracker,
		private readonly step: StepIntent,
		private readonly control: StepControl
	) {}

	openScope(): StructuredGenerationScope {
		this.assertLive()
		return new StructuredGenerationScope(this, this.client, this.usage, this.step, this.control.signal)
	}

	assertLive(): void {
		const expired = this.control.poll()
		if (expired.expired) throw new DriverBoundaryError('structured-generation', expired.reason)
		if (this.failure) throw this.failure
	}

	latch(error: unknown): StructuredGenerationError {
		this.failure ??= new StructuredGenerationError(
			error instanceof TokenBudgetExceededError ? 'token-budget-exceeded' : 'provider-error',
			error
		)
		return this.failure
	}
}

export class StructuredGenerationScope {
	private active = true
	private pending = false
	private readonly controller = new AbortController()
	private readonly onAbort = () => this.controller.abort(this.parentSignal.reason)

	constructor(
		private readonly gateway: StructuredGenerationGateway,
		private readonly client: AiClient,
		private readonly usage: ScenarioUsageTracker,
		private readonly step: StepIntent,
		private readonly parentSignal: AbortSignal
	) {
		if (parentSignal.aborted) this.onAbort()
		else parentSignal.addEventListener('abort', this.onAbort, { once: true })
	}

	readonly generateStructured = (
		request: DriverStructuredGenerationRequest
	): Promise<DriverStructuredGenerationResult> => {
		const operation = this.generate(request)
		void operation.catch((): void => undefined)
		return operation
	}

	assertComplete(): void {
		if (this.pending)
			throw this.gateway.latch(new Error('Driver tool returned with structured generation still pending'))
		this.gateway.assertLive()
	}

	close(): void {
		this.active = false
		this.controller.abort('Structured generation scope ended')
		this.parentSignal.removeEventListener('abort', this.onAbort)
	}

	private assertLive(): void {
		if (!this.active) throw new Error('Structured generation scope ended')
		this.controller.signal.throwIfAborted()
		this.gateway.assertLive()
	}

	private async generate(request: DriverStructuredGenerationRequest): Promise<DriverStructuredGenerationResult> {
		if (!this.active) throw new Error('Structured generation scope ended')
		if (this.pending) throw this.gateway.latch(new Error('Concurrent structured generation is not supported'))
		this.pending = true
		try {
			this.assertLive()
			if (!inspectJsonStructure(request, '').ok)
				throw new Error('Invalid structured generation request structure')
			const input = requestSchema.parse(request)
			const ajv = new Ajv({ strict: true, allErrors: true, ownProperties: true })
			addFormats(ajv)
			const validate = ajv.compile(input.schema)
			if ('$async' in validate && validate.$async) throw new Error('Async response schemas are not supported')
			this.assertLive()
			const response = await this.client.sendStructured(input, {
				step: this.step,
				signal: this.controller.signal,
			})
			if (!this.active) throw new Error('Structured generation scope ended')
			this.usage.record(response.usage)
			this.assertLive()
			const choice = response.choices?.[0]
			if (
				!choice ||
				choice.finish_reason !== 'stop' ||
				choice.message.refusal ||
				!choice.message.content ||
				choice.message.tool_calls?.length
			) {
				throw new Error('Provider did not return a complete structured response')
			}
			const value: unknown = JSON.parse(choice.message.content)
			if (!validate(value)) throw new Error('Provider structured response does not match its schema')
			const usage = response.usage
			return {
				value,
				...(usage
					? {
							usage: {
								inputTokens: usage.prompt_tokens,
								outputTokens: usage.completion_tokens,
								totalTokens: usage.total_tokens,
								...(usage.prompt_tokens_details?.cached_tokens === undefined
									? {}
									: { cachedInputTokens: usage.prompt_tokens_details.cached_tokens }),
							},
						}
					: {}),
			}
		} catch (error) {
			if (!this.active) throw error
			throw this.gateway.latch(error)
		} finally {
			this.pending = false
		}
	}
}
