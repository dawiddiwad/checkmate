import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiClient } from '../../ai/client'
import { StructuredGenerationGateway } from '../../runtime/structured-generation'
import { ScenarioControl } from '../../runtime/scenario-control'
import { ScenarioUsageTracker } from '../../runtime/usage-tracker'
import { generationRequest, structuredResponse } from '../fixtures/structured-generation'

const controls: ScenarioControl[] = []
afterEach(() => {
	controls.splice(0).forEach((control) => control.dispose())
	vi.useRealTimers()
})

function fixture(budget?: number) {
	const scenario = new ScenarioControl({ timeoutMs: 5000 })
	controls.push(scenario)
	const control = scenario.createStepControl(1000)
	const sendStructured = vi.fn().mockResolvedValue(structuredResponse())
	const usage = new ScenarioUsageTracker(budget)
	const gateway = new StructuredGenerationGateway(
		{ sendStructured } as unknown as AiClient,
		usage,
		{ id: 'step', action: 'act', expect: 'done' },
		control
	)
	return { gateway, scope: gateway.openScope(), sendStructured, usage, control }
}

describe('scoped structured generation', () => {
	it('counts sequential requests once including cached input and returns provider-neutral usage', async () => {
		const { scope, usage } = fixture()
		for (let index = 0; index < 2; index++) {
			await expect(scope.generateStructured(generationRequest)).resolves.toEqual({
				value: { fact: 'ready' },
				usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cachedInputTokens: 3 },
			})
		}
		expect(usage.usage()).toEqual({
			promptTokens: 10,
			completionTokens: 4,
			cachedPromptTokens: 6,
			totalTokens: 14,
			state: 'complete',
		})
		scope.assertComplete()
		scope.close()
	})

	it('counts a budget crossing and latches it before a later request', async () => {
		const { scope, usage, sendStructured } = fixture(6)
		await expect(scope.generateStructured(generationRequest)).rejects.toMatchObject({
			reason: 'token-budget-exceeded',
		})
		await expect(scope.generateStructured(generationRequest)).rejects.toMatchObject({
			reason: 'token-budget-exceeded',
		})
		expect(() => scope.assertComplete()).toThrow('structured generation failed')
		expect(sendStructured).toHaveBeenCalledOnce()
		expect(usage.usage().totalTokens).toBe(7)
		scope.close()
	})

	it.each([undefined, 100])(
		'handles wholly missing usage with budget %s without inventing callback usage',
		async (budget) => {
			const { scope, usage, sendStructured } = fixture(budget)
			const response = structuredResponse()
			delete response.usage
			sendStructured.mockResolvedValue(response)
			if (budget)
				await expect(scope.generateStructured(generationRequest)).rejects.toMatchObject({
					reason: 'provider-error',
				})
			else
				await expect(scope.generateStructured(generationRequest)).resolves.toEqual({ value: { fact: 'ready' } })
			expect(usage.usage().state).toBe('unavailable')
			scope.close()
		}
	)

	it.each([
		{ prompt_tokens: 5, completion_tokens: -1, total_tokens: 4 },
		{ prompt_tokens: 5, total_tokens: 5 },
		{ prompt_tokens: 5, completion_tokens: 2, total_tokens: 8 },
		{ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 6 } },
	])('rejects malformed usage before returning output', async (invalid) => {
		const { scope, sendStructured, usage } = fixture()
		sendStructured.mockResolvedValue(structuredResponse('{"fact":"ready"}', invalid as never))
		await expect(scope.generateStructured(generationRequest)).rejects.toMatchObject({ reason: 'provider-error' })
		expect(usage.usage().totalTokens).toBe(0)
		scope.close()
	})

	it.each(['malformed', '{"fact":false}', '', 'refusal', 'truncated'])(
		'counts valid usage before rejecting %s output',
		async (mode) => {
			const { scope, sendStructured, usage } = fixture()
			const response = structuredResponse(mode)
			if (mode === 'refusal') response.choices[0].message.refusal = 'no'
			if (mode === 'truncated') response.choices[0].finish_reason = 'length'
			sendStructured.mockResolvedValue(response)
			await expect(scope.generateStructured(generationRequest)).rejects.toMatchObject({
				reason: 'provider-error',
			})
			expect(usage.usage().totalTokens).toBe(7)
			scope.close()
		}
	)

	it.each([
		{ ...generationRequest, model: 'override' },
		{ ...generationRequest, temperature: 1 },
		{ ...generationRequest, stop: ['stop'] },
		{ ...generationRequest, tools: [] },
		{ ...generationRequest, schema: { $ref: 'https://example.test/schema' } },
		{ ...generationRequest, schema: { type: 'unknown' } },
		{ ...generationRequest, schema: { $async: true, type: 'string' } },
		{ ...generationRequest, messages: [{ role: 'tool', content: [] }] },
	])('rejects unsupported request forms without contacting the provider', async (request) => {
		const { scope, sendStructured } = fixture()
		await expect(scope.generateStructured(request as never)).rejects.toMatchObject({ reason: 'provider-error' })
		expect(sendStructured).not.toHaveBeenCalled()
		scope.close()
	})

	it('refuses concurrency while counting the first response if it arrives before scope closure', async () => {
		const { scope, usage, sendStructured } = fixture()
		let resolve!: (value: ReturnType<typeof structuredResponse>) => void
		sendStructured.mockImplementation(
			() =>
				new Promise((accept) => {
					resolve = accept
				})
		)
		const first = scope.generateStructured(generationRequest)
		await expect(scope.generateStructured(generationRequest)).rejects.toMatchObject({ reason: 'provider-error' })
		resolve(structuredResponse())
		await expect(first).rejects.toMatchObject({ reason: 'provider-error' })
		expect(sendStructured).toHaveBeenCalledOnce()
		expect(usage.usage().totalTokens).toBe(7)
		scope.close()
	})

	it('revokes retained callbacks and ignores late settlements after close', async () => {
		const { scope, usage, sendStructured } = fixture()
		let resolve!: (value: ReturnType<typeof structuredResponse>) => void
		sendStructured.mockImplementation(
			() =>
				new Promise((accept) => {
					resolve = accept
				})
		)
		const pending = scope.generateStructured(generationRequest)
		expect(() => scope.assertComplete()).toThrow()
		scope.close()
		expect(sendStructured.mock.calls[0][1].signal.aborted).toBe(true)
		resolve(structuredResponse())
		await expect(pending).rejects.toThrow('scope ended')
		await expect(scope.generateStructured(generationRequest)).rejects.toThrow('scope ended')
		expect(usage.usage().totalTokens).toBe(0)
		expect(sendStructured).toHaveBeenCalledOnce()
	})
})
