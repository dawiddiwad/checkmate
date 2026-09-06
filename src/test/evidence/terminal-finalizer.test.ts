import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { validateRunResult } from '../../contracts/validator.js'
import { writeAtomicFile } from '../../evidence/atomic-file.js'
import { TerminalFinalizer } from '../../evidence/terminal-finalizer.js'
import { createStore, executionResult, request, temporaryRoot } from './helpers.js'

describe('terminal result finalization', () => {
	it('returns the exact deterministic bytes committed to result.json', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const candidate = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
			})

			const terminal = await new TerminalFinalizer(store).finalize(candidate)

			expect(terminal.committed).toBe(true)
			if (!terminal.committed) return
			expect(terminal.bytes.endsWith('\n')).toBe(true)
			expect(await readFile(resolve(temporary.root, terminal.path), 'utf8')).toBe(terminal.bytes)
			expect(validateRunResult(terminal.result).ok).toBe(true)
		} finally {
			await temporary.cleanup()
		}
	})

	it('returns a redacted uncommitted result-write-failed envelope when commitment fails', async () => {
		const temporary = await temporaryRoot()
		const secret = 'synthetic-finalizer-secret'
		try {
			const store = await createStore(temporary.root, {
				exactSecrets: [secret],
				writeFile: async (path, content) => {
					if (basename(path) === 'result.json') throw new Error(`disk rejected ${secret}`)
					await writeAtomicFile(path, content)
				},
			})
			await store.writeInvocation(request)
			const candidate = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
				steps: [
					{
						id: 'open-cart',
						status: 'failed',
						category: 'app',
						reason: 'failed-expectation',
						actual: secret,
						turns: 1,
						durationMs: 10,
						usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2 },
						toolCalls: [],
					},
					{ id: 'apply-promo', status: 'not-run', reason: 'prior-step-failed', blockedBy: 'open-cart' },
				],
			})

			const terminal = await new TerminalFinalizer(store).finalize(candidate)

			expect(terminal.committed).toBe(false)
			expect(terminal.result).toMatchObject({
				status: 'failed',
				category: 'infra',
				reason: 'result-write-failed',
			})
			expect(terminal.result.steps[0]).toMatchObject({ category: 'app', reason: 'failed-expectation' })
			expect(terminal.result.diagnostics).toEqual([expect.objectContaining({ code: 'result.write-failed' })])
			expect(terminal.bytes).not.toContain(secret)
			expect(terminal.bytes).toContain('[secret omitted]')
			expect(validateRunResult(terminal.result).ok).toBe(true)
			await expect(readFile(resolve(store.runIdentity.runDirectory, 'result.json'))).rejects.toThrow()
		} finally {
			await temporary.cleanup()
		}
	})

	it('prepares once and does not retry result persistence after post-rename sync failure', async () => {
		const temporary = await temporaryRoot()
		try {
			let resultWrites = 0
			const store = await createStore(temporary.root, {
				writeFile: async (path, content) => {
					if (basename(path) !== 'result.json') return writeAtomicFile(path, content)
					resultWrites++
					return writeAtomicFile(path, content, {
						operations: {
							openDirectory: async () => ({
								sync: async () => {
									throw Object.assign(new Error('terminal directory sync failed'), { code: 'EIO' })
								},
								close: async () => undefined,
							}),
						},
					})
				},
			})
			await store.writeInvocation(request)
			const prepare = vi.spyOn(store, 'prepareResult')
			const candidate = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
			})

			const terminal = await new TerminalFinalizer(store).finalize(candidate)

			expect(prepare).toHaveBeenCalledTimes(1)
			expect(resultWrites).toBe(1)
			expect(terminal).toMatchObject({
				committed: false,
				result: { category: 'infra', reason: 'result-write-failed' },
			})
			expect(terminal.result.diagnostics[0].message).toContain('directory-sync')
			expect(terminal.result.diagnostics[0].message).toContain('durability was not confirmed')
			const renamedBytes = await readFile(resolve(store.runIdentity.runDirectory, 'result.json'), 'utf8')
			expect(JSON.parse(renamedBytes)).toMatchObject({ category: 'passed', reason: 'scenario-complete' })
			expect(renamedBytes).not.toBe(terminal.bytes)
		} finally {
			await temporary.cleanup()
		}
	})

	it('rejects an invalid semantic result before attempting a write', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root)
			await store.writeInvocation(request)
			const invalid = executionResult({ runId: 'invalid' })
			await expect(new TerminalFinalizer(store).finalize(invalid)).rejects.toThrow('Invalid execution result')
		} finally {
			await temporary.cleanup()
		}
	})
})
