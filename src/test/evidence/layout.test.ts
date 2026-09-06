import { mkdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAtomicFile } from '../../evidence/atomic-file.js'
import { allocateRunIdentity, resolveInside, toInvocationRelative } from '../../evidence/layout.js'
import { TerminalFinalizer } from '../../evidence/terminal-finalizer.js'
import { createStore, executedStep, executionResult, request, temporaryRoot } from './helpers.js'

describe('evidence layout', () => {
	it('creates one private run tree and publishes only committed invocation-relative references', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: true },
			})
			await store.writeInvocation(request)
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'transcript',
				mediaType: 'text/markdown',
				content: '# transcript',
			})
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'turn-snapshot',
				mediaType: 'application/yaml',
				turn: 1,
				content: 'page: cart',
			})
			store.captureDriver({
				stepId: 'open-cart',
				kind: 'screenshot',
				mediaType: 'image/png',
				content: new Uint8Array([137, 80, 78, 71]),
			})
			const finalized = await store.finalizeStep('open-cart', 'passed')
			await store.replaceCheckpoint({ completedSteps: [executedStep()] })
			const result = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
				evidence: { state: store.state, references: [...store.committedReferences] },
			})
			const terminal = await new TerminalFinalizer(store).finalize(result)

			expect(terminal.committed).toBe(true)
			expect(finalized.references.map((reference) => reference.path)).toEqual([
				expect.stringMatching(/evidence\/harness\/steps\/001-open-cart\/transcript\.md$/),
				expect.stringMatching(/evidence\/harness\/steps\/001-open-cart\/turns\/001\.yml$/),
				expect.stringMatching(/evidence\/driver\/fixture\/steps\/001-open-cart\/001-screenshot\.png$/),
			])

			const runMode = (await stat(store.runIdentity.runDirectory)).mode & 0o777
			expect(runMode).toBe(0o700)
			for (const reference of store.committedReferences) {
				const absolute = resolve(temporary.root, reference.path)
				expect(toInvocationRelative(temporary.root, absolute)).toBe(reference.path)
				expect(absolute.startsWith(`${store.runIdentity.runDirectory}/`)).toBe(true)
				expect((await stat(absolute)).mode & 0o777).toBe(0o600)
				expect((await stat(dirname(absolute))).mode & 0o777).toBe(0o700)
			}

			for (const fileName of ['invocation.json', 'checkpoint.json', 'result.json']) {
				const path = resolve(store.runIdentity.runDirectory, fileName)
				expect((await stat(path)).mode & 0o777).toBe(0o600)
				expect((await readFile(path)).byteLength).toBeGreaterThan(0)
			}
		} finally {
			await temporary.cleanup()
		}
	})

	it('retries an exclusive directory collision with a fresh random identity', async () => {
		const temporary = await temporaryRoot()
		try {
			const output = resolve(temporary.root, '.checkmate/runs')
			const now = () => new Date('2026-09-05T12:34:56.789Z')
			const first = Buffer.alloc(8, 1)
			const second = Buffer.alloc(8, 2)
			await mkdir(resolve(output, '20260905T123456789Z-scenario-0101010101010101'), { recursive: true })
			const values = [first, second]

			const identity = await allocateRunIdentity({
				invocationRoot: temporary.root,
				outputDirectory: output,
				scenarioId: 'scenario',
				now,
				random: () => values.shift()!,
			})

			expect(identity.runId).toBe('0202020202020202')
			expect(identity.relativeRunDirectory).toMatch(/0202020202020202$/)
		} finally {
			await temporary.cleanup()
		}
	})

	it('synchronizes each parent after creating output and run directory entries', async () => {
		const temporary = await temporaryRoot()
		try {
			const synchronized: string[] = []
			const output = resolve(temporary.root, '.checkmate/runs')
			await allocateRunIdentity({
				invocationRoot: temporary.root,
				outputDirectory: output,
				scenarioId: 'scenario',
				random: () => Buffer.alloc(8, 3),
				directoryOperations: { syncDirectory: async (path) => void synchronized.push(path) },
			})

			expect(synchronized).toEqual([temporary.root, resolve(temporary.root, '.checkmate'), output])
		} finally {
			await temporary.cleanup()
		}
	})

	it('recovers deterministically when a reusable-directory sync failed after creation', async () => {
		const temporary = await temporaryRoot()
		try {
			const output = resolve(temporary.root, '.checkmate/runs')
			let failed = false
			const operations = {
				syncDirectory: async (path: string) => {
					if (!failed && path === temporary.root) {
						failed = true
						throw new Error('parent sync failed')
					}
				},
			}

			await expect(
				allocateRunIdentity({
					invocationRoot: temporary.root,
					outputDirectory: output,
					scenarioId: 'scenario',
					directoryOperations: operations,
				})
			).rejects.toThrow('parent sync failed')
			await expect(
				allocateRunIdentity({
					invocationRoot: temporary.root,
					outputDirectory: output,
					scenarioId: 'scenario',
					random: () => Buffer.alloc(8, 4),
					directoryOperations: operations,
				})
			).resolves.toMatchObject({ runId: '0404040404040404' })
		} finally {
			await temporary.cleanup()
		}
	})

	it('supports concurrent reusable-directory creation without skipping parent sync', async () => {
		const temporary = await temporaryRoot()
		try {
			const output = resolve(temporary.root, '.checkmate/runs')
			const synchronized: string[] = []
			const first = allocateRunIdentity({
				invocationRoot: temporary.root,
				outputDirectory: output,
				scenarioId: 'scenario',
				random: () => Buffer.alloc(8, 5),
				directoryOperations: { syncDirectory: async (path) => void synchronized.push(path) },
			})
			const second = allocateRunIdentity({
				invocationRoot: temporary.root,
				outputDirectory: output,
				scenarioId: 'scenario',
				random: () => Buffer.alloc(8, 6),
				directoryOperations: { syncDirectory: async (path) => void synchronized.push(path) },
			})

			await expect(Promise.all([first, second])).resolves.toEqual([
				expect.objectContaining({ runId: '0505050505050505' }),
				expect.objectContaining({ runId: '0606060606060606' }),
			])
			expect(synchronized.filter((path) => path === temporary.root)).toHaveLength(2)
			expect(synchronized.filter((path) => path === resolve(temporary.root, '.checkmate'))).toHaveLength(2)
			expect(synchronized.filter((path) => path === output)).toHaveLength(2)
		} finally {
			await temporary.cleanup()
		}
	})

	it('rejects traversal and references outside the invocation root', async () => {
		const temporary = await temporaryRoot()
		try {
			expect(() => resolveInside(temporary.root, '..')).toThrow('Unsafe evidence path segment')
			expect(() => resolveInside(temporary.root, 'safe/../../escape')).toThrow('Unsafe evidence path segment')
			expect(() => toInvocationRelative(temporary.root, resolve(temporary.root, '../escape'))).toThrow('escapes')
			await expect(
				allocateRunIdentity({
					invocationRoot: temporary.root,
					outputDirectory: resolve(temporary.root, '../outside'),
					scenarioId: 'scenario',
				})
			).rejects.toThrow('escapes')
		} finally {
			await temporary.cleanup()
		}
	})

	it('never publishes a reference for failed or caller-invented evidence', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
				writeFile: async (path, content) => {
					if (basename(path) === 'transcript.md') throw new Error('evidence disk unavailable')
					await writeAtomicFile(path, content)
				},
			})
			await store.writeInvocation(request)
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'transcript',
				mediaType: 'text/markdown',
				content: 'captured',
			})
			const finalized = await store.finalizeStep('open-cart', 'failed')
			expect(finalized.references).toEqual([])
			expect(finalized.diagnostics).toEqual([expect.objectContaining({ code: 'evidence.write-failed' })])
			expect(store.state).toBe('partial')

			const candidate = executionResult({
				runId: store.runIdentity.runId,
				startedAt: store.runIdentity.startedAt,
				evidence: {
					state: 'complete',
					references: [
						{ kind: 'invented', mediaType: 'text/plain', path: '../outside', producer: 'harness' },
					],
				},
			})
			const terminal = await new TerminalFinalizer(store).finalize(candidate)
			expect(terminal.result.evidence).toEqual({ state: 'partial', references: [] })
		} finally {
			await temporary.cleanup()
		}
	})

	it('does not publish post-rename evidence when directory durability is uncertain', async () => {
		const temporary = await temporaryRoot()
		try {
			const store = await createStore(temporary.root, {
				policy: { retention: 'on', redaction: 'on', allowOpaque: false },
				writeFile: async (path, content) => {
					if (basename(path) !== 'transcript.md') return writeAtomicFile(path, content)
					return writeAtomicFile(path, content, {
						operations: {
							openDirectory: async () => ({
								sync: async () => {
									throw Object.assign(new Error('directory sync failed'), { code: 'EIO' })
								},
								close: async () => undefined,
							}),
						},
					})
				},
			})
			await store.writeInvocation(request)
			store.captureHarnessStep({
				stepId: 'open-cart',
				kind: 'transcript',
				mediaType: 'text/markdown',
				content: 'renamed but not confirmed',
			})

			const finalized = await store.finalizeStep('open-cart', 'failed')
			expect(finalized.references).toEqual([])
			expect(store.committedReferences).toEqual([])
			expect(finalized.diagnostics[0].message).toContain('durability was not confirmed')
			const expected = resolve(
				store.runIdentity.runDirectory,
				'evidence/harness/steps/001-open-cart/transcript.md'
			)
			expect(await readFile(expected, 'utf8')).toBe('renamed but not confirmed')

			const terminal = await new TerminalFinalizer(store).finalize(
				executionResult({ runId: store.runIdentity.runId, startedAt: store.runIdentity.startedAt })
			)
			expect(terminal.result.evidence).toEqual({ state: 'partial', references: [] })
			expect(terminal.result.diagnostics).toEqual([expect.objectContaining({ code: 'evidence.write-failed' })])
		} finally {
			await temporary.cleanup()
		}
	})
})
