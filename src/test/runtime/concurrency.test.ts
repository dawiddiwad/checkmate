import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { run } from '../../api/index.js'
import { fixtureRequest, writeStaticEnvironment } from '../fixtures/static-environment.js'
import { fixtureDriver, outcomeRunner, readFixtureEnvironment } from '../api/run-fixture.js'

describe('concurrent in-process scenarios', () => {
	it('isolates identities, sessions, usage, and evidence directories', async () => {
		const root = await mkdtemp(resolve(tmpdir(), 'checkmate-concurrency-'))
		try {
			await writeStaticEnvironment(root)
			const close = [vi.fn(async () => undefined), vi.fn(async () => undefined)]
			let session = 0
			const dependencies = {
				preparation: { readEnvironment: readFixtureEnvironment },
				execution: {
					importDriver: async () => ({ checkmateDriver: fixtureDriver(close[session++]) }),
					createRunner: outcomeRunner(['met-expectation']),
				},
			}

			const [first, second] = await Promise.all([
				run(fixtureRequest, { cwd: root }, dependencies),
				run(fixtureRequest, { cwd: root }, dependencies),
			])

			expect(first.status).toBe('passed')
			expect(second.status).toBe('passed')
			if (first.status === 'invalid' || second.status === 'invalid') return
			expect(first.runId).not.toBe(second.runId)
			expect(first.usage.totalTokens).toBe(3)
			expect(second.usage.totalTokens).toBe(3)
			expect(close[0]).toHaveBeenCalledOnce()
			expect(close[1]).toHaveBeenCalledOnce()
			expect(await readdir(resolve(root, '.checkmate/runs'))).toHaveLength(2)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	it('does not leak cancellation into a concurrent invocation', async () => {
		const root = await mkdtemp(resolve(tmpdir(), 'checkmate-cancellation-'))
		try {
			await writeStaticEnvironment(root)
			const cancelled = new AbortController()
			cancelled.abort('cancel only this run')
			const close = vi.fn(async () => undefined)
			const execution = {
				importDriver: async () => ({ checkmateDriver: fixtureDriver(close) }),
				createRunner: outcomeRunner(['met-expectation']),
			}

			const [first, second] = await Promise.all([
				run(
					fixtureRequest,
					{ cwd: root, signal: cancelled.signal },
					{ preparation: { readEnvironment: readFixtureEnvironment }, execution }
				),
				run(
					fixtureRequest,
					{ cwd: root },
					{ preparation: { readEnvironment: readFixtureEnvironment }, execution }
				),
			])

			expect(first).toMatchObject({ status: 'interrupted', category: 'infra', reason: 'interrupted' })
			expect(second).toMatchObject({ status: 'passed', category: 'passed', reason: 'scenario-complete' })
			if (first.status === 'invalid' || second.status === 'invalid') return
			expect(first.runId).not.toBe(second.runId)
			expect(first.usage.totalTokens).toBe(0)
			expect(second.usage.totalTokens).toBe(3)
			expect(close).toHaveBeenCalledOnce()
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
