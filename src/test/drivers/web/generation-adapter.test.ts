import { describe, expect, it, vi } from 'vitest'
import type { ClientLLM } from '@browserbasehq/stagehand'
import { GenerationAdapter } from '../../../drivers/web/tools/generation-adapter.js'
import type { DriverToolContext } from '../../../driver.js'

const request: Parameters<ClientLLM['generate']>[0] = {
	systemPrompt: 'Read facts',
	messages: [{ role: 'user', content: { type: 'text', text: 'Page fact' } }],
	responseFormat: {
		type: 'json_schema',
		name: 'Extraction',
		schema: {
			type: 'object',
			properties: { extraction: { type: 'string' } },
			required: ['extraction'],
			additionalProperties: false,
		},
	},
}
const context = (generateStructured: DriverToolContext['generateStructured']): DriverToolContext => ({
	step: { id: 'inspect', action: 'Read', expect: 'Fact' },
	turn: 1,
	signal: new AbortController().signal,
	generateStructured,
})

describe('Stagehand callback adapter', () => {
	it('maps structured messages and returns both SDK result fields with reported usage only', async () => {
		const adapter = new GenerationAdapter()
		const generate = vi.fn(async () => ({
			value: { extraction: 'Fact' },
			usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
		}))
		const response = await adapter.run(context(generate), () => adapter.generate(request))
		expect(response).toEqual({
			role: 'assistant',
			outputFormat: 'json_schema',
			content: { type: 'text', text: '{"extraction":"Fact"}' },
			structuredContent: { extraction: 'Fact' },
			usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
		})
		expect(generate).toHaveBeenCalledWith({
			messages: [
				{ role: 'system', content: [{ type: 'text', text: 'Read facts' }] },
				{ role: 'user', content: [{ type: 'text', text: 'Page fact' }] },
			],
			schemaName: 'Extraction',
			schema: request.responseFormat!.schema,
		})
		const noUsage = await adapter.run(
			context(async () => ({ value: {} })),
			() => adapter.generate(request)
		)
		expect(noUsage).not.toHaveProperty('usage')
	})

	it('keeps authoritative failures even when RPC callers swallow them or return success', async () => {
		const adapter = new GenerationAdapter()
		const failure = new Error('provider secret detail')
		const generate = vi.fn(async () => {
			throw failure
		})
		await expect(
			adapter.run(context(generate), async () => {
				await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
				await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
				return { success: true }
			})
		).rejects.toBe(failure)
		expect(generate).toHaveBeenCalledTimes(1)
	})

	it('rejects unsupported forms, inactive callbacks and overlapping operations', async () => {
		const adapter = new GenerationAdapter()
		const generate = vi.fn(async () => ({ value: {} }))
		await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
		for (const invalid of [
			{ ...request, temperature: 0 },
			{ ...request, responseFormat: { type: 'text' } },
			{
				...request,
				messages: [{ role: 'user', content: { type: 'tool_use', id: 'a', name: 'tool', input: {} } }],
			},
		]) {
			await expect(
				adapter.run(context(generate), () => adapter.generate(invalid as typeof request))
			).rejects.toThrow()
		}
		expect(generate).not.toHaveBeenCalled()
		await adapter.run(context(generate), async () => {
			await expect(adapter.run(context(generate), async (): Promise<null> => null)).rejects.toThrow('Concurrent')
		})
		adapter.close()
		await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
	})

	it.each([true, false])('preserves a later gateway failure even if action success is %s', async (success) => {
		const adapter = new GenerationAdapter()
		const failure = new Error('authoritative gateway failure')
		const generate = vi
			.fn()
			.mockResolvedValueOnce({
				value: { action: null, twoStep: false },
				usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
			})
			.mockRejectedValueOnce(failure)
		await expect(
			adapter.run(context(generate), async () => {
				await adapter.generate({ ...request, responseFormat: { ...request.responseFormat!, name: 'Act' } })
				await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
				await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
				return { data: { success } }
			})
		).rejects.toBe(failure)
		expect(generate).toHaveBeenCalledTimes(2)
		await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
		expect(generate).toHaveBeenCalledTimes(2)
	})

	it('allows sequential callbacks without adding SDK metadata usage or retaining the capability', async () => {
		const adapter = new GenerationAdapter()
		const generate = vi.fn(async () => ({ value: {}, usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } }))
		await adapter.run(context(generate), async () => {
			for (const name of ['Observation', 'Act', 'Metadata']) {
				const result = await adapter.generate({
					...request,
					responseFormat: { ...request.responseFormat!, name },
				})
				expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 1, totalTokens: 3 })
			}
			return { metadata: { usage: { inputTokens: 999 } } }
		})
		expect(generate).toHaveBeenCalledTimes(3)
		await expect(adapter.generate(request)).rejects.toThrow('Checkmate browser generation failed')
		expect(generate).toHaveBeenCalledTimes(3)
	})
})
