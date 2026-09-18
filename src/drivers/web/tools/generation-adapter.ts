import type { ClientLLM } from '@browserbasehq/stagehand'
import { z } from 'zod/v4'
import type { DriverGenerationMessage, DriverToolContext } from '../../../driver.js'

const block = z.union([
	z.object({ type: z.literal('text'), text: z.string() }).strict(),
	z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }).strict(),
])
const requestSchema = z
	.object({
		messages: z.array(
			z.object({ role: z.enum(['user', 'assistant']), content: z.union([block, z.array(block)]) }).strict()
		),
		systemPrompt: z.string().optional(),
		responseFormat: z
			.object({ type: z.literal('json_schema'), name: z.string(), schema: z.record(z.string(), z.json()) })
			.strict(),
	})
	.strict()

type Operation = { context: DriverToolContext; failure?: unknown; failed: boolean; pending: boolean }

export class GenerationAdapter {
	private operation?: Operation
	private closed = false

	readonly generate: ClientLLM['generate'] = async (request) => {
		const operation = this.operation
		try {
			if (this.closed || !operation) throw new Error('No active browser operation')
			operation.context.signal.throwIfAborted()
			if (operation.failed) throw operation.failure
			if (operation.pending) throw new Error('Concurrent browser generation is not supported')
			operation.pending = true
			const input = requestSchema.parse(request)
			const messages: DriverGenerationMessage[] =
				input.systemPrompt === undefined
					? []
					: [{ role: 'system', content: [{ type: 'text', text: input.systemPrompt }] }]
			for (const message of input.messages) {
				const blocks = Array.isArray(message.content) ? message.content : [message.content]
				messages.push({
					role: message.role,
					content: blocks.map((item) =>
						item.type === 'text'
							? { type: 'text', text: item.text }
							: { type: 'image', data: item.data, mediaType: item.mimeType }
					),
				})
			}
			const result = await operation.context.generateStructured({
				messages,
				schemaName: input.responseFormat.name,
				schema: input.responseFormat.schema,
			})
			operation.context.signal.throwIfAborted()
			if (this.closed || this.operation !== operation) throw new Error('Browser operation ended')
			return {
				role: 'assistant',
				outputFormat: 'json_schema',
				content: { type: 'text', text: JSON.stringify(result.value) },
				structuredContent: z.json().parse(result.value),
				...(result.usage ? { usage: result.usage } : {}),
			}
		} catch (error) {
			if (operation && !operation.failed) {
				operation.failure = error
				operation.failed = true
			}
		} finally {
			if (operation) operation.pending = false
		}
		throw new Error('Checkmate browser generation failed')
	}

	async run<T>(context: DriverToolContext, call: () => Promise<T>): Promise<T> {
		if (this.closed) throw new Error('Browser session closed')
		if (this.operation) throw new Error('Concurrent browser operations are not supported')
		context.signal.throwIfAborted()
		const operation: Operation = { context, failed: false, pending: false }
		this.operation = operation
		try {
			const value = await call()
			if (operation.failed) throw operation.failure
			if (operation.pending) throw new Error('Browser returned with generation still pending')
			context.signal.throwIfAborted()
			if (this.closed) throw new Error('Browser session closed')
			return value
		} catch (error) {
			if (operation.failed) throw operation.failure
			throw error
		} finally {
			this.operation = undefined
		}
	}

	close(): void {
		this.closed = true
		this.operation = undefined
	}
}
