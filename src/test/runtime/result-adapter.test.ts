import { describe, expect, it } from 'vitest'
import type { InternalTerminationReason } from '../../runtime/types.js'
import { adaptStepResult } from '../../runtime/result-adapter.js'

const cases: Array<[InternalTerminationReason, 'app' | 'model' | 'infra']> = [
	['met-expectation', 'app'],
	['failed-expectation', 'app'],
	['loop-detected', 'model'],
	['turn-cap-exceeded', 'model'],
	['step-timeout', 'model'],
	['scenario-timeout', 'infra'],
	['tool-error', 'infra'],
	['provider-error', 'infra'],
	['token-budget-exceeded', 'infra'],
	['interrupted', 'infra'],
	['internal-error', 'infra'],
]

describe('scenario result adapter', () => {
	it.each(cases)('maps %s exhaustively to %s', (reason, category) => {
		const outcome = reason === 'met-expectation' ? 'passed' : 'failed'
		const adapted = adaptStepResult({
			step: { id: 'inspect', action: 'Inspect', expect: 'Visible' },
			outcome,
			category: reason === 'met-expectation' || reason === 'failed-expectation' ? 'app' : category,
			reason,
			actual: 'observed',
			turns: 1,
			durationMs: 10,
			usage: { promptTokens: 2, cachedPromptTokens: 1, completionTokens: 1, totalTokens: 3 },
			toolCalls: [
				{ turn: 1, driverId: 'fixture', name: 'fixture_read', arguments: { key: 'value' }, status: 'ok' },
			],
			transcript: [{ turn: 1, role: 'assistant', content: 'checking' }],
			diagnostics: [],
		})

		expect(adapted.result).toMatchObject({ status: outcome, category, reason })
		expect(adapted.result.toolCalls[0]).toEqual({
			turn: 1,
			driverId: 'fixture',
			name: 'fixture_read',
			arguments: { key: 'value' },
			status: 'ok',
		})
		expect(adapted.evidence).toEqual([
			expect.objectContaining({ stepId: 'inspect', kind: 'transcript', mediaType: 'text/markdown' }),
		])
	})

	it('rejects an inconsistent internal outcome', () => {
		expect(() =>
			adaptStepResult({
				step: { id: 'broken', action: 'Act', expect: 'Done' },
				outcome: 'passed',
				category: 'app',
				reason: 'failed-expectation',
				turns: 1,
				durationMs: 1,
				usage: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0 },
				toolCalls: [],
				transcript: [],
				diagnostics: [],
			})
		).toThrow('inconsistent outcome and reason')
	})
})
