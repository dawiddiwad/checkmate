import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateRunResult } from '../../contracts/validator.js'

describe('run result contract', () => {
	it('accepts a complete execution result', () => {
		expect(validateRunResult(readExecutionFixture()).ok).toBe(true)
	})

	it('accepts an executed infrastructure step for an unexpected internal error', () => {
		const result = readExecutionFixture()
		result.status = 'failed'
		result.category = 'infra'
		result.reason = 'internal-error'
		const step = (result.steps as Array<Record<string, unknown>>)[0]
		step.status = 'failed'
		step.category = 'infra'
		step.reason = 'internal-error'

		expect(validateRunResult(result).ok).toBe(true)
	})

	it('accepts an invalid invocation without execution claims', () => {
		expect(
			validateRunResult({
				kind: 'run-result',
				schemaVersion: 1,
				status: 'invalid',
				category: 'invalid',
				reason: 'invalid-invocation',
				targetMutation: 'not-attempted',
				diagnostics: [{ code: 'schema.required', path: '/scenario', message: 'scenario is required' }],
			}).ok
		).toBe(true)
	})

	it('accepts a strict parent pre-execution operational failure without execution claims', () => {
		const result = preExecutionOperationalResult()
		expect(validateRunResult(result).ok).toBe(true)
		for (const field of ['runId', 'scenarioId', 'steps', 'usage', 'evidence']) {
			expect(validateRunResult({ ...result, [field]: field === 'steps' ? [] : 'unexpected' }).ok).toBe(false)
		}
	})

	it('accepts parent containment without semantic execution state', () => {
		expect(validateRunResult(containmentResult()).ok).toBe(true)
	})

	it.each(['steps', 'usage', 'evidence'])('rejects parent-authored %s', (field) => {
		const result: Record<string, unknown> = { ...containmentResult(), [field]: field === 'steps' ? [] : {} }
		expect(validateRunResult(result).ok).toBe(false)
	})

	it('rejects containment as a durable worker result', () => {
		expect(validateRunResult({ ...containmentResult(), source: 'worker', durability: 'committed' }).ok).toBe(false)
	})

	it('rejects non-JSON in-memory tool arguments before AJV validation', () => {
		const result = readExecutionFixture()
		const steps = result.steps as Array<Record<string, unknown>>
		const toolCalls = steps[0].toolCalls as Array<Record<string, unknown>>
		toolCalls[0].arguments = undefined

		expect(validateRunResult(result)).toEqual({
			ok: false,
			diagnostics: [{ code: 'input.non-json', path: '', message: 'must contain only JSON values' }],
		})
	})
})

function readExecutionFixture(): Record<string, unknown> {
	const url = new URL('../fixtures/contracts/run-result.valid.json', import.meta.url)
	return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}

function containmentResult(): Record<string, unknown> {
	return {
		kind: 'run-result',
		schemaVersion: 1,
		source: 'parent',
		status: 'contained',
		category: 'infra',
		reason: 'parent-containment',
		executionState: 'unavailable',
		durability: 'uncommitted',
		runId: '0123456789abcdef',
		scenarioId: 'checkout-promo',
		declaredStepIds: ['open-cart', 'apply-promo'],
		targetMutation: 'possibly-mutated',
		startedAt: '2026-09-04T12:00:00.000Z',
		durationMs: 180000,
		containment: { phase: 'run', trigger: 'run-deadline-expired' },
		diagnostics: [{ code: 'parent.timeout', path: '', message: 'The worker exceeded its run deadline' }],
	}
}

function preExecutionOperationalResult(): Record<string, unknown> {
	return {
		kind: 'run-result',
		schemaVersion: 1,
		source: 'parent',
		status: 'error',
		category: 'infra',
		reason: 'pre-execution-error',
		targetMutation: 'not-attempted',
		diagnostics: [{ code: 'run.preparation-failed', path: '', message: 'Preparation failed' }],
	}
}
