import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAtomicFile } from '../../evidence/atomic-file.js'
import { TerminalFinalizer } from '../../evidence/terminal-finalizer.js'
import { createStore, executedStep, executionResult, request, temporaryRoot } from './helpers.js'

describe('evidence checkpoints', () => {
	it('contains only completed state and already committed references', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
				now: () => new Date('2026-09-05T12:00:01.000Z'),
			})
			await store.writeInvocation(request)
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'transcript',
				mediaType: 'text/markdown',
				content: 'pending',
			})
			await store.replaceCheckpoint({ completedSteps: [] })
			let checkpoint = JSON.parse(
				await readFile(resolve(store.runIdentity.runDirectory, 'checkpoint.json'), 'utf8')
			) as Record<string, unknown>
			expect(checkpoint).toMatchObject({ state: 'partial', completedSteps: [], evidenceReferences: [] })

			await store.finalizeStep('open-cart', 'passed')
			await store.replaceCheckpoint({ completedSteps: [executedStep()] })
			checkpoint = JSON.parse(
				await readFile(resolve(store.runIdentity.runDirectory, 'checkpoint.json'), 'utf8')
			) as Record<string, unknown>
			expect(checkpoint).toMatchObject({
				layoutVersion: 1,
				runId: store.runIdentity.runId,
				updatedAt: '2026-09-05T12:00:01.000Z',
				state: 'partial',
				completedSteps: [{ id: 'open-cart', status: 'passed' }],
				evidenceReferences: [{ kind: 'transcript', stepId: 'open-cart' }],
			})
			expect(checkpoint).not.toHaveProperty('status')
			expect(checkpoint).not.toHaveProperty('reason')
		} finally {
			await temporary.cleanup()
		}
	})

	it('returns a diagnostic for checkpoint failure without replacing the terminal verdict', async () => {
		const temporary = await temporaryRoot()
		try {
			let checkpointAttempts = 0
			const store = await createStore(temporary.root, {
				writeFile: async (path, content) => {
					if (basename(path) === 'checkpoint.json' && checkpointAttempts++ === 0) {
						throw new Error('checkpoint device unavailable')
					}
					await writeAtomicFile(path, content)
				},
			})
			await store.writeInvocation(request)
			const diagnostic = await store.replaceCheckpoint({ completedSteps: [] })
			expect(diagnostic).toMatchObject({ code: 'checkpoint.write-failed', path: '/evidence' })
			await store.replaceCheckpoint({ completedSteps: [] })
			const checkpoint = JSON.parse(
				await readFile(resolve(store.runIdentity.runDirectory, 'checkpoint.json'), 'utf8')
			) as Record<string, unknown>
			expect(checkpoint.diagnostics).toEqual([expect.objectContaining({ code: 'checkpoint.write-failed' })])

			const candidate = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
				diagnostics: [],
			})
			const terminal = await new TerminalFinalizer(store).finalize(candidate)
			expect(terminal).toMatchObject({
				committed: true,
				result: {
					category: 'passed',
					reason: 'scenario-complete',
					diagnostics: [{ code: 'checkpoint.write-failed' }],
				},
			})
		} finally {
			await temporary.cleanup()
		}
	})
})
