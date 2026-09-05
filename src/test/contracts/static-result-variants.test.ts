import { describe, expect, it } from 'vitest'
import { validateDescribeResult, validateRunResult, validateValidationResult } from '../../contracts/validator.js'

const diagnostic = { code: 'config.invalid', path: '/policies/ci', message: 'The policy is invalid' }

describe('static result variants', () => {
	it.each(['invalid', 'error'] as const)('accepts validation %s and requires diagnostics', (status) => {
		const result = { kind: 'validation-result', schemaVersion: 1, status, diagnostics: [diagnostic] }
		expect(validateValidationResult(result).ok).toBe(true)
		expect(validateValidationResult({ ...result, diagnostics: [] }).ok).toBe(false)
	})

	it.each(['invalid', 'error'] as const)('accepts describe %s and requires diagnostics', (status) => {
		const result = { kind: 'describe-result', schemaVersion: 1, status, diagnostics: [diagnostic] }
		expect(validateDescribeResult(result).ok).toBe(true)
		expect(validateDescribeResult({ ...result, diagnostics: [] }).ok).toBe(false)
	})

	it.each(['not/a/pointer', '/bad~escape', '/bad~2escape', '/trailing~'])(
		'rejects invalid diagnostic path %s',
		(path) => {
			const validation = {
				kind: 'validation-result',
				schemaVersion: 1,
				status: 'invalid',
				diagnostics: [{ ...diagnostic, path }],
			}
			const description = {
				kind: 'describe-result',
				schemaVersion: 1,
				status: 'error',
				diagnostics: [{ ...diagnostic, path }],
			}
			const run = {
				kind: 'run-result',
				schemaVersion: 1,
				status: 'invalid',
				category: 'invalid',
				reason: 'invalid-invocation',
				targetMutation: 'not-attempted',
				diagnostics: [{ ...diagnostic, path }],
			}

			expect(validateValidationResult(validation).ok).toBe(false)
			expect(validateDescribeResult(description).ok).toBe(false)
			expect(validateRunResult(run).ok).toBe(false)
		}
	)

	it.each(['', '/scenario/id', '/escaped~0tilde~1slash'])('accepts RFC 6901 diagnostic path %s', (path) => {
		const result = {
			kind: 'validation-result',
			schemaVersion: 1,
			status: 'invalid',
			diagnostics: [{ ...diagnostic, path }],
		}
		expect(validateValidationResult(result).ok).toBe(true)
	})
})
