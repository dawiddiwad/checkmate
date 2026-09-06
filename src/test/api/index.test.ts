import { describe, expect, it, vi } from 'vitest'
import { CheckmateOperationalError, run } from '../../api/index.js'
import type { PreparedRun } from '../../api/prepare-run.js'

describe('in-process run API failure ownership', () => {
	it('returns invalid preparation as InvalidInvocationResultV1', async () => {
		const result = await run(
			{},
			{},
			{
				prepare: async () => ({
					ok: false,
					status: 'invalid',
					diagnostics: [{ code: 'request.invalid', path: '/scenario', message: 'scenario is invalid' }],
				}),
			}
		)

		expect(result).toEqual({
			kind: 'run-result',
			schemaVersion: 1,
			status: 'invalid',
			category: 'invalid',
			reason: 'invalid-invocation',
			targetMutation: 'not-attempted',
			diagnostics: [{ code: 'request.invalid', path: '/scenario', message: 'scenario is invalid' }],
		})
	})

	it('rejects operational preparation failures with bounded diagnostics', async () => {
		const diagnostics = [{ code: 'input.read-failed', path: '', message: 'manifest storage failed' }] as const
		const promise = run(
			{},
			{},
			{
				prepare: async () => ({ ok: false, status: 'error', diagnostics: [...diagnostics] }),
			}
		)

		await expect(promise).rejects.toBeInstanceOf(CheckmateOperationalError)
		await expect(promise).rejects.toMatchObject({ name: 'CheckmateOperationalError', diagnostics })
	})

	it('rejects identity allocation errors without executing or fabricating containment', async () => {
		const execute = vi.fn()
		const allocationError = new Error('identity source failed')
		const promise = run(
			{},
			{},
			{
				prepare: async () => ({ ok: true, prepared: {} as PreparedRun }),
				allocate: async () => {
					throw allocationError
				},
				execute,
			}
		)

		await expect(promise).rejects.toBe(allocationError)
		expect(execute).not.toHaveBeenCalled()
	})
})
