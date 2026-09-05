import { describe, expect, it } from 'vitest'
import { validateRequest } from '../../contracts/validator.js'

describe('schema diagnostics', () => {
	it('reports independent defects in stable RFC 6901 path order', () => {
		const result = validateRequest({
			schemaVersion: '1',
			unknown: true,
			scenario: {
				id: 42,
				driver: { id: 'web', target: {}, unknown: true },
				limits: { timeoutMs: 0, budgetUsd: 1 },
				steps: [{ id: '', action: 123 }],
			},
		})

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'schema.additionalProperties',
					path: '/scenario/driver/unknown',
					message: 'must NOT have additional properties',
				},
				{ code: 'schema.type', path: '/scenario/id', message: 'must be string' },
				{
					code: 'schema.additionalProperties',
					path: '/scenario/limits/budgetUsd',
					message: 'must NOT have additional properties',
				},
				{ code: 'schema.minimum', path: '/scenario/limits/timeoutMs', message: 'must be >= 1' },
				{ code: 'schema.type', path: '/scenario/steps/0/action', message: 'must be string' },
				{
					code: 'schema.required',
					path: '/scenario/steps/0/expect',
					message: "must have required property 'expect'",
				},
				{
					code: 'schema.minLength',
					path: '/scenario/steps/0/id',
					message: 'must NOT have fewer than 1 characters',
				},
				{ code: 'schema.const', path: '/schemaVersion', message: 'must be equal to constant' },
				{
					code: 'schema.additionalProperties',
					path: '/unknown',
					message: 'must NOT have additional properties',
				},
			],
		})
	})

	it('escapes required and unknown member names as JSON pointers', () => {
		const result = validateRequest({
			schemaVersion: 1,
			scenario: {
				id: 'example',
				driver: { id: 'web', target: {} },
				steps: [{ id: 'step', action: 'act', expect: 'observe', 'bad/name~': true }],
			},
		})

		expect(result.ok).toBe(false)
		if ('diagnostics' in result) {
			expect(result.diagnostics[0].path).toBe('/scenario/steps/0/bad~1name~0')
		}
	})
})
