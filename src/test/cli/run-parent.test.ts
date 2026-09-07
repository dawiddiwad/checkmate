import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PreparedRun } from '../../api/prepare-run.js'
import { runFromParent, type RunParentDependencies } from '../../cli/run-parent.js'
import { terminalDigest, type WorkerMessage } from '../../cli/protocol.js'
import { serializeJson } from '../../contracts/serialize.js'
import type { Diagnostic, ExecutionResultV1, RunReason } from '../../contracts/types.js'
import type { RunIdentity } from '../../evidence/layout.js'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('CLI parent supervision', () => {
	it('checks the absolute run deadline again after asynchronous reconciliation', async () => {
		const fixture = await parentFixture()
		const pending = deferred<{ result: ExecutionResultV1; bytes: string }>()
		const execution = fixture.start({ reconcile: () => pending.promise })
		await settle()

		fixture.clock.advanceTo(9)
		fixture.child.message(inline(fixture.result))
		await settle()
		fixture.clock.jumpTo(10)
		pending.resolve({ result: fixture.result, bytes: serializeJson(fixture.result) })
		await settle()
		fixture.clock.advanceTo(15)

		expect(await execution).toBe(3)
		expect(JSON.parse(fixture.stdout.value)).toMatchObject({
			status: 'contained',
			containment: { phase: 'run', trigger: 'run-deadline-expired' },
		})
		expect(fixture.child.sent).toContainEqual({ type: 'abort', signal: 'SIGTERM' })
	})

	it('checks the absolute cleanup deadline before accepting a reconciled result', async () => {
		const fixture = await parentFixture()
		const pending = deferred<{ result: ExecutionResultV1; bytes: string }>()
		const execution = fixture.start({ reconcile: () => pending.promise })
		await settle()

		fixture.clock.advanceTo(5)
		fixture.child.message({ type: 'cleanup-started', runId: fixture.identity.runId })
		fixture.clock.advanceTo(9)
		fixture.child.message(inline(fixture.result))
		await settle()
		fixture.clock.jumpTo(10)
		pending.resolve({ result: fixture.result, bytes: serializeJson(fixture.result) })
		await settle()

		expect(await execution).toBe(3)
		expect(JSON.parse(fixture.stdout.value)).toMatchObject({
			status: 'contained',
			containment: { phase: 'cleanup', trigger: 'cleanup-deadline-expired' },
		})
	})

	it('observes process exit without waiting for descendant-held pipes and destroys its streams', async () => {
		const fixture = await parentFixture()
		const execution = fixture.start()
		await settle()

		fixture.child.exit(0, null)

		expect(await execution).toBe(0)
		expect(fixture.child.stdout.destroyed).toBe(true)
		expect(fixture.child.stderr.destroyed).toBe(true)
		expect(JSON.parse(fixture.stdout.value).status).toBe('passed')
	})

	it('accepts terminal-file and uncommitted result-write-failed transports', async () => {
		const fileFixture = await parentFixture()
		const fileExecution = fileFixture.start()
		await settle()
		const bytes = serializeJson(fileFixture.result)
		fileFixture.child.message({
			type: 'terminal-file',
			runId: fileFixture.identity.runId,
			committed: true,
			digest: terminalDigest(bytes),
		})
		await settle()
		fileFixture.child.exit(0, null)
		expect(await fileExecution).toBe(0)

		const uncommittedFixture = await parentFixture()
		const result = executionResult(uncommittedFixture.identity, uncommittedFixture.prepared, 'result-write-failed')
		const readResult = vi.fn(async () => {
			throw new Error('uncommitted transport must not read result.json')
		})
		const uncommittedExecution = uncommittedFixture.start({ readResult })
		await settle()
		uncommittedFixture.child.message({
			type: 'terminal-inline',
			runId: uncommittedFixture.identity.runId,
			committed: false,
			resultJson: serializeJson(result),
		})
		await settle()
		uncommittedFixture.child.exit(0, null)
		expect(await uncommittedExecution).toBe(3)
		expect(readResult).not.toHaveBeenCalled()
		expect(JSON.parse(uncommittedFixture.stdout.value).reason).toBe('result-write-failed')
	})

	it('centralizes normal-exit recovery and rejects non-normal fallback', async () => {
		const normal = await parentFixture()
		const readNormal = vi.fn(async () => serializeJson(normal.result))
		const normalExecution = normal.start({ readResult: readNormal })
		await settle()
		normal.child.exit(0, null)
		expect(await normalExecution).toBe(0)
		expect(readNormal).toHaveBeenCalledOnce()

		const abnormal = await parentFixture()
		const readAbnormal = vi.fn(async () => serializeJson(abnormal.result))
		const abnormalExecution = abnormal.start({ readResult: readAbnormal })
		await settle()
		abnormal.child.exit(1, null)
		expect(await abnormalExecution).toBe(3)
		expect(readAbnormal).not.toHaveBeenCalled()
	})

	it('waits for an in-flight terminal check before deciding normal-exit recovery', async () => {
		const fixture = await parentFixture()
		const pending = deferred<{ result: ExecutionResultV1; bytes: string }>()
		const readResult = vi.fn(async () => serializeJson(fixture.result))
		const execution = fixture.start({ readResult, reconcile: () => pending.promise })
		await settle()

		fixture.child.message(inline(fixture.result))
		fixture.child.exit(0, null)
		await settle()
		expect(readResult).toHaveBeenCalledOnce()

		pending.resolve({ result: fixture.result, bytes: serializeJson(fixture.result) })
		expect(await execution).toBe(0)
		expect(readResult).toHaveBeenCalledOnce()
	})

	it('rejects unrelated results after a stop latch and accepts an eligible override', async () => {
		const fixture = await parentFixture()
		let disk = serializeJson(fixture.result)
		const execution = fixture.start({ readResult: async () => disk })
		await settle()

		fixture.child.signals.emit('SIGINT')
		fixture.child.message(inline(fixture.result))
		await settle()
		expect(fixture.stdout.value).toBe('')

		const override = executionResult(fixture.identity, fixture.prepared, 'result-write-failed')
		disk = serializeJson(override)
		fixture.child.message({
			type: 'terminal-inline',
			runId: fixture.identity.runId,
			committed: false,
			resultJson: disk,
		})
		await settle()
		fixture.child.exit(0, null)

		expect(await execution).toBe(3)
		expect(JSON.parse(fixture.stdout.value).reason).toBe('result-write-failed')
	})

	it('treats fatal as prompt unavailability but never overrides accepted terminal bytes', async () => {
		const fatal = await parentFixture()
		const fatalExecution = fatal.start()
		await settle()
		fatal.child.message({
			type: 'fatal',
			runId: fatal.identity.runId,
			diagnostic: { code: 'worker.fatal', path: '', message: 'fatal worker failure' },
		})
		expect(await fatalExecution).toBe(3)
		expect(JSON.parse(fatal.stdout.value).status).toBe('contained')

		const accepted = await parentFixture()
		const acceptedExecution = accepted.start()
		await settle()
		accepted.child.message(inline(accepted.result))
		await settle()
		accepted.child.message({
			type: 'fatal',
			runId: accepted.identity.runId,
			diagnostic: { code: 'worker.fatal', path: '', message: 'late fatal' },
		})
		accepted.child.exit(0, null)
		expect(await acceptedExecution).toBe(0)
		expect(JSON.parse(accepted.stdout.value).status).toBe('passed')
	})

	it('uses the pre-execution operational arm and keeps synchronous fork failure not-attempted', async () => {
		const fixture = await parentFixture()
		for (const prepare of [
			async () => ({
				ok: false as const,
				status: 'error' as const,
				diagnostics: [diagnostic('manifest.read-failed')] as [Diagnostic, ...Diagnostic[]],
			}),
			async (): Promise<never> => {
				throw new Error('unexpected preparation failure')
			},
		]) {
			const output = outputCapture()
			expect(await runFromParent(input(output), { prepare })).toBe(3)
			expect(JSON.parse(output.stdout.value)).toMatchObject({
				status: 'error',
				reason: 'pre-execution-error',
				targetMutation: 'not-attempted',
			})
			expect(JSON.parse(output.stdout.value)).not.toHaveProperty('scenarioId')
		}

		const allocation = outputCapture()
		expect(
			await runFromParent(input(allocation), {
				prepare: async () => ({ ok: true, prepared: fixture.prepared }),
				allocate: async () => {
					throw new Error('allocation failed')
				},
			})
		).toBe(3)
		expect(JSON.parse(allocation.stdout.value).reason).toBe('pre-execution-error')

		const fork = outputCapture()
		expect(
			await runFromParent(input(fork), {
				prepare: async () => ({ ok: true, prepared: fixture.prepared }),
				allocate: async () => fixture.identity,
				forkWorker: () => {
					throw new Error('fork failed')
				},
				now: () => 0,
			})
		).toBe(3)
		expect(JSON.parse(fork.stdout.value)).toMatchObject({ status: 'contained', targetMutation: 'not-attempted' })
	})

	it('rejects an oversized start frame before allocation or worker creation', async () => {
		const fixture = await parentFixture()
		const prepared = structuredClone(fixture.prepared) as PreparedRun
		Object.assign(prepared.request.scenario.steps[0], { action: 'x'.repeat(1024 * 1024) })
		const allocate = vi.fn(async () => fixture.identity)
		const forkWorker = vi.fn(() => fixture.child.process)
		const output = outputCapture()

		expect(
			await runFromParent(input(output), {
				prepare: async () => ({ ok: true, prepared }),
				allocate,
				forkWorker,
			})
		).toBe(3)
		expect(allocate).not.toHaveBeenCalled()
		expect(forkWorker).not.toHaveBeenCalled()
		expect(JSON.parse(output.stdout.value)).toMatchObject({
			status: 'contained',
			targetMutation: 'not-attempted',
			containment: { phase: 'start', trigger: 'start-frame-too-large' },
		})
	})
})

async function parentFixture() {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-parent-'))
	directories.push(root)
	const runDirectory = resolve(root, '.checkmate/runs/run')
	await mkdir(runDirectory, { recursive: true })
	const identity: RunIdentity = {
		runId: '0123456789abcdef',
		startedAt: '2026-01-01T00:00:00.000Z',
		runDirectory,
		relativeRunDirectory: '.checkmate/runs/run',
	}
	const prepared = preparedRun(root)
	const result = executionResult(identity, prepared)
	const child = new FakeChild()
	const clock = new FakeClock()
	const output = outputCapture()
	return {
		identity,
		prepared,
		result,
		child,
		clock,
		stdout: output.stdout,
		start(overrides: RunParentDependencies = {}) {
			return runFromParent(input(output), {
				prepare: async () => ({ ok: true, prepared }),
				allocate: async () => identity,
				forkWorker: () => child.process,
				now: () => clock.now,
				wallNow: () => new Date(identity.startedAt),
				setTimer: clock.setTimer,
				clearTimer: clock.clearTimer,
				signals: child.signals,
				workerExitGraceMs: 2,
				workerKillGraceMs: 2,
				readResult: async () => serializeJson(result),
				reconcile: async (bytes) => ({ result: JSON.parse(bytes) as ExecutionResultV1, bytes }),
				...overrides,
			})
		},
	}
}

class FakeChild extends EventEmitter {
	readonly stdout = new PassThrough()
	readonly stderr = new PassThrough()
	readonly sent: unknown[] = []
	readonly kills: NodeJS.Signals[] = []
	readonly signals = new EventEmitter()
	readonly process = this as unknown as ChildProcess

	send(message: unknown): boolean {
		this.sent.push(message)
		return true
	}

	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		this.kills.push(signal)
		queueMicrotask(() => this.exit(null, signal))
		return true
	}

	message(message: WorkerMessage): void {
		this.emit('message', message)
	}

	exit(code: number | null, signal: NodeJS.Signals | null): void {
		this.emit('exit', code, signal)
	}
}

class FakeClock {
	now = 0
	private nextId = 0
	private readonly timers = new Map<number, { at: number; callback: () => void }>()

	readonly setTimer = ((callback: () => void, delay = 0) => {
		const id = ++this.nextId
		this.timers.set(id, { at: this.now + delay, callback })
		return id
	}) as unknown as typeof setTimeout

	readonly clearTimer = ((id: number) => {
		this.timers.delete(id)
	}) as unknown as typeof clearTimeout

	advanceTo(time: number): void {
		this.now = time
		for (;;) {
			const due = [...this.timers.entries()]
				.filter(([, timer]) => timer.at <= time)
				.sort((a, b) => a[1].at - b[1].at)
			if (due.length === 0) return
			const [id, timer] = due[0]
			this.timers.delete(id)
			timer.callback()
		}
	}

	jumpTo(time: number): void {
		this.now = time
	}
}

function preparedRun(root: string): PreparedRun {
	const effectiveLimits = {
		scenarioTimeoutMs: 10,
		stepTimeoutMs: 5,
		turnsPerStep: 2,
		requestTimeoutMs: 5,
		maxRetries: 0,
		loopMaxRepetitions: 2,
		cleanupTimeoutMs: 5,
		budgetTokens: 100,
	}
	return {
		invocationRoot: root,
		outputDirectory: resolve(root, '.checkmate/runs'),
		request: {
			schemaVersion: 1,
			scenario: {
				id: 'scenario',
				driver: { id: 'fixture', target: {} },
				policy: 'ci',
				steps: [{ id: 'step', action: 'act', expect: 'observe' }],
			},
		},
		policy: {
			id: 'ci',
			effectiveLimits,
			evidence: { retention: 'off', redaction: 'on', allowOpaque: false },
			driver: { id: 'fixture', settings: {}, allowedTools: ['*'] },
			modelEgress: {
				provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider' },
				textRedaction: 'on',
				allowOpaque: false,
				maxStepBytes: 1000,
				maxMessageBytes: 1000,
			},
		},
		modelEgress: {
			provider: { id: 'openai', model: 'fixture', apiKeyBinding: 'provider' },
			textRedaction: 'on',
			allowOpaque: false,
			maxStepBytes: 1000,
			maxMessageBytes: 1000,
		},
		effectiveLimits,
		secretBindings: { provider: { source: 'environment', name: 'KEY' } },
		driver: {
			id: 'fixture',
			packageName: '@test/fixture',
			descriptor: {
				schemaVersion: 1,
				id: 'fixture',
				driverContractVersion: 1,
				targetSchema: {},
				settingsSchema: {},
				requiredSecretSlots: [],
				tools: [],
				evidenceKinds: [],
			},
			settings: {},
			target: {},
			allowedTools: ['*'],
			secretBindings: {},
		},
	} as unknown as PreparedRun
}

function executionResult(identity: RunIdentity, prepared: PreparedRun, reason: RunReason = 'scenario-complete') {
	const passed = reason === 'scenario-complete'
	return {
		kind: 'run-result',
		schemaVersion: 1,
		runId: identity.runId,
		scenarioId: prepared.request.scenario.id,
		status: passed ? 'passed' : 'failed',
		category: passed ? 'passed' : 'infra',
		reason,
		targetMutation: 'possibly-mutated',
		startedAt: identity.startedAt,
		durationMs: 1,
		driver: { id: prepared.driver.id, contractVersion: 1 },
		policy: { id: prepared.policy.id, effectiveLimits: { ...prepared.effectiveLimits } },
		usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2, state: 'complete' },
		steps: [
			{
				id: 'step',
				status: 'passed',
				category: 'app',
				reason: 'met-expectation',
				turns: 1,
				durationMs: 1,
				usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, totalTokens: 2 },
				toolCalls: [],
			},
		],
		evidence: { state: 'complete', references: [] },
		diagnostics: [],
	} as ExecutionResultV1
}

function inline(result: ExecutionResultV1): WorkerMessage {
	const resultJson = serializeJson(result)
	return {
		type: 'terminal-inline',
		runId: result.runId,
		committed: true,
		resultJson,
		digest: terminalDigest(resultJson),
	}
}

function outputCapture() {
	const stdout = {
		value: '',
		write(value: string) {
			this.value += value
		},
	}
	const stderr = {
		value: '',
		write(value: string) {
			this.value += value
		},
	}
	return { stdout, stderr }
}

function input(output: ReturnType<typeof outputCapture>) {
	return { source: { kind: 'value' as const, value: {} }, cwd: '/', stdout: output.stdout, stderr: output.stderr }
}

function diagnostic(code: string): Diagnostic {
	return { code, path: '', message: code }
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((accept) => (resolve = accept))
	return { promise, resolve }
}

async function settle(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}
