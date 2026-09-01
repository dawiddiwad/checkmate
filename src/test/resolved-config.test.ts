import { describe, expect, it } from 'vitest'
import { CHECKMATE_DEFAULTS, CheckmateConfigError, readApiKey, resolveConfig } from '../config/resolved-config'

describe('resolveConfig', () => {
	describe('defaults', () => {
		it('resolves the package defaults when nothing is overridden', () => {
			expect(resolveConfig()).toEqual({
				model: 'gpt-5-mini',
				baseUrl: undefined,
				reasoningEffort: undefined,
				turnCap: 20,
				stepTimeout: 120_000,
				budgetUsd: undefined,
				budgetTokens: undefined,
				snapshotFilter: false,
				snapshotTopPercent: 10,
				evidence: 'retain-on-failure',
				redact: true,
				screenshots: false,
				toolChoice: 'required',
				allowedTools: [],
				maxRetries: 3,
				requestTimeout: 60_000,
				loopMaxRepetitions: 5,
				rateLimitDelay: 0,
				logLevel: 'off',
				temperature: 0,
			})
		})

		it('defaults temperature to 0, so a rerun differs as little as the model allows', () => {
			expect(resolveConfig().temperature).toBe(0)
			expect(CHECKMATE_DEFAULTS.checkmateTemperature).toBe(0)
		})
	})

	describe('override precedence', () => {
		it('takes each provided option over the package default', () => {
			const config = resolveConfig({
				checkmateModel: 'gpt-5',
				checkmateOpenaiBaseUrl: 'https://openrouter.ai/api/v1',
				checkmateTemperature: 0.7,
				checkmateTurnCap: 30,
				checkmateBudgetUsd: 2,
				checkmateSnapshotFilter: true,
				checkmateEvidence: 'on',
				checkmateReasoningEffort: 'high',
				checkmateAllowedTools: ['browser_navigate'],
			})

			expect(config.model).toBe('gpt-5')
			expect(config.baseUrl).toBe('https://openrouter.ai/api/v1')
			expect(config.temperature).toBe(0.7)
			expect(config.turnCap).toBe(30)
			expect(config.budgetUsd).toBe(2)
			expect(config.snapshotFilter).toBe(true)
			expect(config.evidence).toBe('on')
			expect(config.reasoningEffort).toBe('high')
			expect(config.allowedTools).toEqual(['browser_navigate'])
		})

		it('leaves unspecified options on their defaults, so a per-test override keeps the rest', () => {
			const project = { checkmateModel: 'gpt-5-mini', checkmateTurnCap: 15 } as const
			const perTest = { ...project, checkmateModel: 'gpt-5' }

			const config = resolveConfig(perTest)

			expect(config.model).toBe('gpt-5')
			expect(config.turnCap).toBe(15)
			expect(config.stepTimeout).toBe(CHECKMATE_DEFAULTS.checkmateStepTimeout)
		})

		it('treats an explicitly undefined option as unset', () => {
			expect(resolveConfig({ checkmateModel: undefined }).model).toBe(CHECKMATE_DEFAULTS.checkmateModel)
		})

		it('keeps false and zero rather than falling back to the default', () => {
			const config = resolveConfig({ checkmateRedact: false, checkmateRateLimitDelay: 0, checkmateMaxRetries: 0 })

			expect(config.redact).toBe(false)
			expect(config.rateLimitDelay).toBe(0)
			expect(config.maxRetries).toBe(0)
		})

		it('copies the allowed-tools array so a caller cannot mutate the resolved config', () => {
			const allowedTools = ['browser_navigate']
			const config = resolveConfig({ checkmateAllowedTools: allowedTools })

			allowedTools.push('browser_click_or_hover')

			expect(config.allowedTools).toEqual(['browser_navigate'])
		})
	})

	describe('validation', () => {
		it('rejects an empty model name', () => {
			expect(() => resolveConfig({ checkmateModel: '  ' })).toThrow(CheckmateConfigError)
		})

		it('rejects a turn cap below one', () => {
			expect(() => resolveConfig({ checkmateTurnCap: 0 })).toThrow(/checkmateTurnCap/)
		})

		it('rejects a fractional turn cap', () => {
			expect(() => resolveConfig({ checkmateTurnCap: 2.5 })).toThrow(/checkmateTurnCap/)
		})

		it('rejects a non-positive step timeout', () => {
			expect(() => resolveConfig({ checkmateStepTimeout: 0 })).toThrow(/checkmateStepTimeout/)
		})

		it('rejects a negative budget instead of silently ignoring it', () => {
			expect(() => resolveConfig({ checkmateBudgetUsd: -5 })).toThrow(/checkmateBudgetUsd/)
			expect(() => resolveConfig({ checkmateBudgetTokens: -1 })).toThrow(/checkmateBudgetTokens/)
		})

		it('rejects a snapshot percentage outside 1 to 100', () => {
			expect(() => resolveConfig({ checkmateSnapshotTopPercent: 0 })).toThrow(/checkmateSnapshotTopPercent/)
			expect(() => resolveConfig({ checkmateSnapshotTopPercent: 101 })).toThrow(/checkmateSnapshotTopPercent/)
		})

		it('rejects a negative temperature', () => {
			expect(() => resolveConfig({ checkmateTemperature: -1 })).toThrow(/checkmateTemperature/)
		})

		it('rejects a malformed base url, but leaves it unset alone', () => {
			expect(() => resolveConfig({ checkmateOpenaiBaseUrl: 'not-a-url' })).toThrow(/checkmateOpenaiBaseUrl/)
			expect(() => resolveConfig({ checkmateOpenaiBaseUrl: '  ' })).toThrow(/checkmateOpenaiBaseUrl/)
			expect(resolveConfig({ checkmateOpenaiBaseUrl: 'https://example.test/v1' }).baseUrl).toBe(
				'https://example.test/v1'
			)
		})

		it('rejects a value outside an enumerated option', () => {
			expect(() => resolveConfig({ checkmateEvidence: 'sometimes' as unknown as 'on' })).toThrow(
				/checkmateEvidence/
			)
			expect(() => resolveConfig({ checkmateToolChoice: 'maybe' as unknown as 'auto' })).toThrow(
				/checkmateToolChoice/
			)
			expect(() => resolveConfig({ checkmateReasoningEffort: 'extreme' as unknown as 'high' })).toThrow(
				/checkmateReasoningEffort/
			)
			expect(() => resolveConfig({ checkmateLogLevel: 'verbose' as unknown as 'debug' })).toThrow(
				/checkmateLogLevel/
			)
		})

		it('reports every problem at once', () => {
			try {
				resolveConfig({ checkmateTurnCap: 0, checkmateStepTimeout: -1 })
				expect.fail('expected resolveConfig to throw')
			} catch (error) {
				expect((error as Error).message).toContain('checkmateTurnCap')
				expect((error as Error).message).toContain('checkmateStepTimeout')
			}
		})
	})

	describe('secrets', () => {
		it('reads the api key from the environment rather than from an option', () => {
			const previous = process.env.CHECKMATE_OPENAI_API_KEY
			process.env.CHECKMATE_OPENAI_API_KEY = 'sk-from-env'
			try {
				expect(readApiKey()).toBe('sk-from-env')
				expect(Object.keys(resolveConfig())).not.toContain('apiKey')
			} finally {
				process.env.CHECKMATE_OPENAI_API_KEY = previous
			}
		})

		it('fails loudly when the api key is missing', () => {
			const previous = process.env.CHECKMATE_OPENAI_API_KEY
			delete process.env.CHECKMATE_OPENAI_API_KEY
			try {
				expect(() => readApiKey()).toThrow(/CHECKMATE_OPENAI_API_KEY/)
			} finally {
				process.env.CHECKMATE_OPENAI_API_KEY = previous
			}
		})
	})
})
