import { describe, expect, it } from 'vitest'
import type { ExecutedStepResult } from '../../contracts/types.js'
import type { RunIdentity } from '../../evidence/layout.js'
import { ScenarioState } from '../../runtime/scenario-state.js'
import { request } from '../evidence/helpers.js'

const identity: RunIdentity = {
	runId: '0123456789abcdef',
	startedAt: '2026-09-06T10:00:00.000Z',
	runDirectory: '/tmp/checkmate/run',
	relativeRunDirectory: '.checkmate/runs/run',
}

describe('scenario state', () => {
	it('records each step once and blocks every step after the first failure', () => {
		const state = createState()
		state.recordStep(step({ status: 'failed', reason: 'failed-expectation' }))
		state.blockRemaining('open-cart')

		const result = candidate(state)
		expect(result).toMatchObject({ status: 'failed', category: 'app', reason: 'failed-expectation' })
		expect(result.steps).toEqual([
			expect.objectContaining({ id: 'open-cart', status: 'failed' }),
			{ id: 'apply-promo', status: 'not-run', reason: 'prior-step-failed', blockedBy: 'open-cart' },
		])
	})

	it.each([
		['driver-load-failed', 'driver-load-failed'],
		['driver-start-failed', 'driver-start-failed'],
		['internal-error', 'internal-error'],
	] as const)('marks all steps not run for %s', (failure, reason) => {
		const state = createState()
		state.recordLifecycleFailure(failure)
		state.markNotStarted()
		const result = candidate(state)
		expect(result.reason).toBe(reason)
		expect(result.steps.every((item) => item.status === 'not-run' && item.reason === 'scenario-not-started')).toBe(
			true
		)
	})

	it('applies cleanup, interruption, evidence, lifecycle, step, and success precedence', () => {
		const state = createState()
		state.recordStep(step({ status: 'failed', reason: 'failed-expectation' }))
		state.blockRemaining('open-cart')
		state.recordLifecycleFailure('driver-load-failed')
		state.recordLifecycleFailure('evidence-write-failed')
		state.recordLifecycleFailure('interrupted')
		state.recordCleanupFailure({ code: 'driver.teardown-failed', path: '/driver', message: 'close failed' })

		const result = candidate(state)
		expect(result).toMatchObject({
			status: 'failed',
			category: 'infra',
			reason: 'driver-teardown-failed',
		})
		expect(result.steps[0]).toMatchObject({ category: 'app', reason: 'failed-expectation' })
	})

	it.each([
		['cleanup over interruption', ['interrupted'], true, 'driver-teardown-failed'],
		['interruption over evidence', ['evidence-write-failed', 'interrupted'], false, 'interrupted'],
		['evidence over lifecycle', ['driver-load-failed', 'evidence-write-failed'], false, 'evidence-write-failed'],
		['lifecycle over failed step', ['driver-start-failed'], false, 'driver-start-failed'],
	] as const)('enforces pairwise precedence: %s', (_name, failures, cleanupFailure, expected) => {
		const state = createState()
		state.recordStep(step({ status: 'failed', reason: 'failed-expectation' }))
		state.blockRemaining('open-cart')
		for (const failure of failures) state.recordLifecycleFailure(failure)
		if (cleanupFailure) {
			state.recordCleanupFailure({ code: 'driver.teardown-failed', path: '/driver', message: 'close failed' })
		}
		expect(candidate(state).reason).toBe(expected)
	})

	it('returns scenario-complete only after every step passes', () => {
		const state = createState()
		state.recordStep(step())
		state.recordStep(step({ id: 'apply-promo' }))
		expect(candidate(state)).toMatchObject({ status: 'passed', category: 'passed', reason: 'scenario-complete' })
	})
})

function createState(): ScenarioState {
	return new ScenarioState({
		request,
		identity,
		driver: { id: 'fixture', contractVersion: 1 },
		policy: {
			id: 'ci',
			effectiveLimits: {
				scenarioTimeoutMs: 1_000,
				stepTimeoutMs: 500,
				turnsPerStep: 3,
				requestTimeoutMs: 100,
				maxRetries: 0,
				loopMaxRepetitions: 2,
				cleanupTimeoutMs: 100,
			},
		},
		now: () => 100,
	})
}

function step(overrides: Partial<ExecutedStepResult> = {}): ExecutedStepResult {
	return {
		id: 'open-cart',
		status: 'passed',
		category: 'app',
		reason: 'met-expectation',
		turns: 1,
		durationMs: 10,
		usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2 },
		toolCalls: [],
		...overrides,
	}
}

function candidate(state: ScenarioState) {
	return state.buildCandidateResult({
		usage: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0, state: 'unavailable' },
		evidence: { state: 'complete', references: [] },
	})
}
