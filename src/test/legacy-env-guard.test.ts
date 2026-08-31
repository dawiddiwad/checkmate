import { describe, expect, it } from 'vitest'
import {
	ALLOW_LEGACY_ENV,
	assertNoLegacyEnv,
	LEGACY_ENV_VARIABLES,
	LegacyEnvironmentError,
} from '../config/legacy-env-guard'
import { CHECKMATE_DEFAULTS, resolveConfig } from '../config/resolved-config'

function guard(env: Record<string, string>): () => void {
	return () => assertNoLegacyEnv(env)
}

function messageFor(env: Record<string, string>): string {
	try {
		assertNoLegacyEnv(env)
		expect.fail('expected assertNoLegacyEnv to throw')
	} catch (error) {
		return (error as Error).message
	}
}

describe('assertNoLegacyEnv', () => {
	it('passes when no removed variable is set', () => {
		expect(guard({})).not.toThrow()
	})

	it('rejects every removed variable', () => {
		for (const variable of LEGACY_ENV_VARIABLES) {
			expect(guard({ [variable.name]: 'something' }), variable.name).toThrow(LegacyEnvironmentError)
		}
	})

	it('names the variable, the release that removed it, and the escape hatch', () => {
		const message = messageFor({ OPENAI_MODEL: 'gpt-4.1-mini' })

		expect(message).toContain('✗ OPENAI_MODEL is set but no longer read (removed in 0.5.0).')
		expect(message).toContain("Move it to playwright.config.ts:  use: { checkmateModel: 'gpt-4.1-mini' }")
		expect(message).toContain('Set CHECKMATE_ALLOW_LEGACY_ENV=1 to suppress this check.')
	})

	it('prints a paste-ready replacement that carries the value across', () => {
		expect(messageFor({ OPENAI_API_TOKEN_BUDGET_USD: '10.50' })).toContain('use: { checkmateBudgetUsd: 10.50 }')
		expect(messageFor({ CHECKMATE_SNAPSHOT_FILTERING: 'true' })).toContain('use: { checkmateSnapshotFilter: true }')
		expect(messageFor({ OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT: 'false' })).toContain(
			'use: { checkmateScreenshots: false }'
		)
		expect(messageFor({ OPENAI_ALLOWED_TOOLS: 'browser_navigate, pass_test_step' })).toContain(
			"use: { checkmateAllowedTools: ['browser_navigate', 'pass_test_step'] }"
		)
	})

	it('converts the seconds-based variables into their millisecond options', () => {
		expect(messageFor({ OPENAI_TIMEOUT_SECONDS: '30' })).toContain('use: { checkmateRequestTimeout: 30000 }')
		expect(messageFor({ OPENAI_API_RATE_LIMIT_DELAY_SECONDS: '1' })).toContain(
			'use: { checkmateRateLimitDelay: 1000 }'
		)
	})

	it('points OPENAI_TEMPERATURE at the checkmateTemperature option', () => {
		const message = messageFor({ OPENAI_TEMPERATURE: '0.5' })

		expect(message).toContain('✗ OPENAI_TEMPERATURE is set but no longer read (removed in 0.5.0).')
		expect(message).toContain('use: { checkmateTemperature: 0.5 }')
	})

	it('points OPENAI_BASE_URL at the checkmateOpenaiBaseUrl option', () => {
		expect(messageFor({ OPENAI_BASE_URL: 'https://example.test/v1' })).toContain(
			"use: { checkmateOpenaiBaseUrl: 'https://example.test/v1' }"
		)
	})

	it('tells a stale OPENAI_API_KEY to rename rather than to move to config', () => {
		const message = messageFor({ OPENAI_API_KEY: 'sk-should-not-appear' })

		expect(message).toContain('✗ OPENAI_API_KEY is set but no longer read (removed in 0.5.0).')
		expect(message).toContain('Rename it to CHECKMATE_OPENAI_API_KEY.')
		expect(message).not.toContain('sk-should-not-appear')
		expect(message).not.toContain('playwright.config.ts')
	})

	it('reports every stale variable in one failure', () => {
		const error = messageFor({ OPENAI_MODEL: 'gpt-4.1-mini', CHECKMATE_LOG_LEVEL: 'debug' })

		expect(error).toContain('OPENAI_MODEL')
		expect(error).toContain('CHECKMATE_LOG_LEVEL')
	})

	it('carries the stale names on the error for programmatic callers', () => {
		try {
			assertNoLegacyEnv({ OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_TEMPERATURE: '0' })
			expect.fail('expected assertNoLegacyEnv to throw')
		} catch (error) {
			expect(error).toBeInstanceOf(LegacyEnvironmentError)
			expect((error as LegacyEnvironmentError).variables).toEqual(['OPENAI_MODEL', 'OPENAI_TEMPERATURE'])
		}
	})

	it('ignores a variable that is set to an empty value', () => {
		expect(guard({ OPENAI_MODEL: '' })).not.toThrow()
		expect(guard({ OPENAI_MODEL: '   ' })).not.toThrow()
	})

	it('keeps the secret in the environment', () => {
		expect(guard({ CHECKMATE_OPENAI_API_KEY: 'sk-test' })).not.toThrow()
		expect(LEGACY_ENV_VARIABLES.map((variable) => variable.name)).not.toContain('CHECKMATE_OPENAI_API_KEY')
	})

	it('is suppressed by the escape hatch', () => {
		expect(guard({ OPENAI_MODEL: 'gpt-4.1-mini', [ALLOW_LEGACY_ENV]: '1' })).not.toThrow()
	})

	it('runs whenever configuration is resolved', () => {
		const previous = process.env[ALLOW_LEGACY_ENV]
		delete process.env[ALLOW_LEGACY_ENV]
		process.env.OPENAI_MODEL = 'gpt-4.1-mini'
		try {
			expect(() => resolveConfig()).toThrow(LegacyEnvironmentError)
		} finally {
			delete process.env.OPENAI_MODEL
			if (previous !== undefined) {
				process.env[ALLOW_LEGACY_ENV] = previous
			}
		}

		expect(resolveConfig().model).toBe(CHECKMATE_DEFAULTS.checkmateModel)
	})
})
