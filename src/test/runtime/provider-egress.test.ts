import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { AiClient } from '../../ai/client'
import { ModelEgressError, prepareModelRequest } from '../../config/model-egress'
import { testConfig } from '../test-types'
import type { ModelEgressPolicyV1 } from '../../contracts/types'
import { ToolRegistry } from '../../tools/registry'
import { silentLogger } from '../../logging/types'
import { generationRequest } from '../fixtures/structured-generation'

const createCompletion = vi.fn()

vi.mock('openai', () => ({
	default: class FakeOpenAI {
		chat = { completions: { create: createCompletion } }
	},
}))

const policy: ModelEgressPolicyV1 = {
	provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider-key' },
	textRedaction: 'on',
	allowOpaque: false,
	maxMessageBytes: 1_024,
	maxStepBytes: 2_048,
}

describe('provider egress', () => {
	beforeEach(() => vi.clearAllMocks())

	function structuredClient(overrides: Partial<ModelEgressPolicyV1> = {}) {
		return new AiClient({
			config: testConfig({ model: 'policy-model', maxRetries: 0 }),
			toolRegistry: new ToolRegistry({ allowedTools: '*' }),
			apiKey: 'exact-secret',
			exactSecrets: ['exact-secret'],
			modelEgress: { ...policy, ...overrides },
			logger: silentLogger,
		})
	}

	it('redacts nested messages and schema annotations in the actual forced-schema request', async () => {
		createCompletion.mockResolvedValue({ choices: [] })
		const request = {
			...generationRequest,
			messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'exact-secret' }] }],
			schema: {
				...generationRequest.schema,
				description: 'exact-secret',
				properties: { fact: { type: 'string', title: 'exact-secret', examples: ['exact-secret'] } },
			},
		}
		await structuredClient().sendStructured(request)
		const sent = createCompletion.mock.calls[0][0]
		expect(sent).toMatchObject({
			model: 'policy-model',
			response_format: { type: 'json_schema', json_schema: { strict: true, name: 'fixture_fact' } },
		})
		expect(JSON.stringify(sent)).not.toContain('exact-secret')
		expect(JSON.stringify(sent)).toContain('[secret omitted]')
		expect(sent).not.toHaveProperty('tools')
		expect(sent).not.toHaveProperty('tool_choice')
		expect(request.schema.description).toBe('exact-secret')
	})

	it.each([
		{ type: 'string', enum: ['exact-secret'] },
		{ type: 'object', properties: { 'exact-secret': { type: 'string' } } },
		{ type: 'object', required: ['exact-secret'] },
		{ type: 'string', pattern: 'exact-secret' },
		{ const: { description: 'exact-secret' } },
	])('rejects redaction conflicts in schema constraints or keys', async (schema) => {
		await expect(structuredClient().sendStructured({ ...generationRequest, schema })).rejects.toThrow(
			'schema semantics'
		)
		expect(createCompletion).not.toHaveBeenCalled()
	})

	it('includes schema-only bytes in the complete request limit', async () => {
		await expect(
			structuredClient().sendStructured({
				...generationRequest,
				schema: { type: 'string', description: 'large schema annotation '.repeat(200) },
			})
		).rejects.toThrow('JSON request')
		expect(createCompletion).not.toHaveBeenCalled()
	})

	it('gates nested image input and explicitly rejects unsupported non-user images', async () => {
		const messages = [
			{ role: 'user' as const, content: [{ type: 'image' as const, mediaType: 'image/png', data: 'YWJj' }] },
		]
		await expect(structuredClient().sendStructured({ ...generationRequest, messages })).rejects.toThrow(
			'Opaque image'
		)
		expect(createCompletion).not.toHaveBeenCalled()
		createCompletion.mockResolvedValue({ choices: [] })
		await structuredClient({ allowOpaque: true }).sendStructured({ ...generationRequest, messages })
		expect(createCompletion.mock.calls[0][0].messages[0].content[0]).toEqual({
			type: 'image_url',
			image_url: { url: 'data:image/png;base64,YWJj' },
		})
		await expect(
			structuredClient({ allowOpaque: true }).sendStructured({
				...generationRequest,
				messages: [{ ...messages[0], role: 'assistant' }],
			})
		).rejects.toThrow('only in user')
	})

	it('applies controls to the exact fake-provider input', async () => {
		createCompletion.mockResolvedValueOnce({
			id: 'response',
			object: 'chat.completion',
			created: 0,
			model: 'fixture',
			choices: [],
		})
		const registry = new ToolRegistry({ allowedTools: '*' })
		const client = new AiClient({
			config: testConfig({ model: 'fixture', maxRetries: 0 }),
			toolRegistry: registry,
			apiKey: 'exact-secret',
			modelEgress: policy,
			exactSecrets: ['exact-secret'],
			logger: silentLogger,
		})

		await client.send([{ role: 'user', content: 'token is exact-secret' }])

		expect(createCompletion.mock.calls[0][0].messages).toEqual([
			{ role: 'user', content: 'token is [secret omitted]' },
		])
	})

	it('redacts the actual provider-bound text without mutating history', () => {
		const request = providerRequest([{ role: 'user', content: 'token is exact-secret' }])
		const prepared = prepareModelRequest(request, policy, ['exact-secret'])

		expect(prepared.messages[0].content).toBe('token is [secret omitted]')
		expect(request.messages[0].content).toBe('token is exact-secret')
	})

	it('rejects images unless opaque model context is operator-enabled', () => {
		const messages: ChatCompletionMessageParam[] = [
			{
				role: 'user',
				content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
			},
		]
		expect(() => prepareModelRequest(providerRequest(messages), policy)).toThrow(ModelEgressError)
		expect(() => prepareModelRequest(providerRequest(messages), { ...policy, allowOpaque: true })).not.toThrow()
	})

	it('enforces per-message and complete JSON request byte limits', () => {
		expect(() =>
			prepareModelRequest(providerRequest([{ role: 'user', content: '123456' }]), {
				...policy,
				maxMessageBytes: 4,
			})
		).toThrow(/message 0/)

		const request = providerRequest([{ role: 'user', content: 'ok' }], 'tool definition framing')
		const messagesOnlyBytes = Buffer.byteLength(JSON.stringify(request.messages), 'utf8')
		const completeRequestBytes = Buffer.byteLength(JSON.stringify(request), 'utf8')
		expect(completeRequestBytes).toBeGreaterThan(messagesOnlyBytes)
		expect(() =>
			prepareModelRequest(request, {
				...policy,
				maxMessageBytes: 100,
				maxStepBytes: completeRequestBytes - 1,
			})
		).toThrow(/JSON request/)
		expect(() =>
			prepareModelRequest(request, {
				...policy,
				maxMessageBytes: 100,
				maxStepBytes: completeRequestBytes,
			})
		).not.toThrow()
	})

	it('rejects oversized tool definitions before calling the provider', async () => {
		const registry = new ToolRegistry({ allowedTools: '*' })
		registry.register({
			definition: {
				name: 'large_tool',
				description: 'x'.repeat(500),
				parameters: { type: 'object', additionalProperties: false },
				strict: true,
			},
			execute: () => 'ok',
		})
		const client = new AiClient({
			config: testConfig({ model: 'fixture', maxRetries: 0 }),
			toolRegistry: registry,
			apiKey: 'fixture-key',
			modelEgress: { ...policy, maxMessageBytes: 1_024, maxStepBytes: 300 },
			logger: silentLogger,
		})

		await expect(client.send([{ role: 'user', content: 'small message' }])).rejects.toThrow(/JSON request/)
		expect(createCompletion).not.toHaveBeenCalled()
	})

	it('keeps provider, model, and egress policy outside the request contract', async () => {
		const { validateRequest } = await import('../../contracts/validator')
		const validation = validateRequest({
			schemaVersion: 1,
			scenario: {
				id: 'egress-override',
				driver: { id: 'web', target: { baseUrl: 'https://example.test' } },
				provider: 'other',
				steps: [{ id: 'step', action: 'act', expect: 'observe' }],
			},
		})
		expect(validation.ok).toBe(false)
	})
})

function providerRequest(
	messages: ChatCompletionCreateParamsNonStreaming['messages'],
	description = 'fixture tool'
): ChatCompletionCreateParamsNonStreaming {
	return {
		model: 'fixture',
		messages,
		tools: [
			{
				type: 'function',
				function: {
					name: 'fixture_tool',
					description,
					parameters: { type: 'object', additionalProperties: false },
					strict: true,
				},
			},
		],
		tool_choice: 'required',
		parallel_tool_calls: false,
		temperature: 0,
		n: 1,
	}
}
