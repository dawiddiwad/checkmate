import { existsSync } from 'node:fs'
import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { allocateRunIdentity } from '../api/allocate-run-identity.js'
import { prepareRunSource, type PreparedRun, type PreparationOptions } from '../api/prepare-run.js'
import { boundDiagnostics, type JsonInputSource } from '../config/ingestion.js'
import { serializeJson } from '../contracts/serialize.js'
import type {
	ContainmentResultV1,
	Diagnostic,
	ExecutionResultV1,
	InvalidInvocationResultV1,
	PreExecutionOperationalResultV1,
	RunResultV1,
} from '../contracts/types.js'
import type { RunIdentity } from '../evidence/layout.js'
import { relayDiagnostic, type DiagnosticWriter } from './diagnostic-relay.js'
import {
	assertIpcFrameSize,
	digestMatches,
	parseWorkerMessage,
	sendIpcFrame,
	type ParentMessage,
	type TerminalDigest,
	type WorkerMessage,
} from './protocol.js'
import { readAllocatedResult, reconcileExecutionResult } from './reconcile-result.js'
import { ContainmentState, type ParentSignal } from './signals.js'
import { WorkerStreamGuard } from './worker-stream-guard.js'

export type RunParentInput = Readonly<{
	source: JsonInputSource
	cwd: string
	configPath?: string
	stdout: { write(value: string): unknown }
	stderr: DiagnosticWriter
}>

export type SignalSource = Readonly<{
	on(signal: ParentSignal, listener: () => void): unknown
	off(signal: ParentSignal, listener: () => void): unknown
}>

export type RunParentDependencies = Readonly<{
	prepare?: typeof prepareRunSource
	allocate?: typeof allocateRunIdentity
	forkWorker?: () => ChildProcess
	preparation?: Omit<PreparationOptions, 'cwd' | 'configPath'>
	now?: () => number
	wallNow?: () => Date
	setTimer?: typeof setTimeout
	clearTimer?: typeof clearTimeout
	signals?: SignalSource
	workerExitGraceMs?: number
	workerKillGraceMs?: number
	reconcile?: typeof reconcileExecutionResult
	readResult?: typeof readAllocatedResult
}>

const DEFAULT_EXIT_GRACE_MS = 1000
const DEFAULT_KILL_GRACE_MS = 1000

export async function runFromParent(input: RunParentInput, dependencies: RunParentDependencies = {}): Promise<number> {
	const prepare = dependencies.prepare ?? prepareRunSource
	let preparation: Awaited<ReturnType<typeof prepareRunSource>>
	try {
		preparation = await prepare(input.source, {
			cwd: input.cwd,
			configPath: input.configPath,
			...dependencies.preparation,
		})
	} catch {
		return writeResult(
			preExecutionOperationalResult({
				code: 'run.preparation-failed',
				path: '',
				message: 'Run preparation failed unexpectedly',
			}),
			input
		)
	}
	if (preparation.ok === false) {
		if (preparation.status === 'error') {
			return writeResult(preExecutionOperationalResult(...preparation.diagnostics), input)
		}
		const result: InvalidInvocationResultV1 = {
			kind: 'run-result',
			schemaVersion: 1,
			status: 'invalid',
			category: 'invalid',
			reason: 'invalid-invocation',
			targetMutation: 'not-attempted',
			diagnostics: preparation.diagnostics,
		}
		return writeResult(result, input)
	}

	const prepared = preparation.prepared
	const wallNow = dependencies.wallNow ?? (() => new Date())
	const placeholder = placeholderIdentity(prepared, wallNow())
	try {
		assertIpcFrameSize({ type: 'start', identity: placeholder, prepared } satisfies ParentMessage)
	} catch {
		return writeResult(
			containmentResult(
				prepared,
				undefined,
				placeholder.startedAt,
				0,
				'start',
				'start-frame-too-large',
				'not-attempted',
				{
					code: 'ipc-frame-too-large',
					path: '',
					message: 'The prepared worker start frame exceeds the IPC limit',
				}
			),
			input
		)
	}

	let identity: RunIdentity
	try {
		identity = await (dependencies.allocate ?? allocateRunIdentity)(prepared)
	} catch {
		return writeResult(
			preExecutionOperationalResult({
				code: 'run.identity-allocation-failed',
				path: '',
				message: 'The run identity could not be allocated',
			}),
			input
		)
	}

	const now = dependencies.now ?? monotonicNow
	const forkedAt = now()
	let child: ChildProcess
	try {
		child = (dependencies.forkWorker ?? defaultForkWorker)()
	} catch {
		return writeResult(
			containmentResult(
				prepared,
				identity,
				identity.startedAt,
				now() - forkedAt,
				'start',
				'worker-result-unavailable',
				'not-attempted',
				{
					code: 'worker.start-failed',
					path: '',
					message: 'The scenario worker could not be started',
				}
			),
			input
		)
	}

	return superviseWorker(child, prepared, identity, forkedAt, input, dependencies)
}

async function superviseWorker(
	child: ChildProcess,
	prepared: PreparedRun,
	identity: RunIdentity,
	forkedAt: number,
	input: RunParentInput,
	dependencies: RunParentDependencies
): Promise<number> {
	const now = dependencies.now ?? monotonicNow
	const setTimer = dependencies.setTimer ?? setTimeout
	const clearTimer = dependencies.clearTimer ?? clearTimeout
	const signals = dependencies.signals ?? process
	const machine = new ContainmentState()
	let timer: ReturnType<typeof setTimeout> | undefined
	let deadline: number | undefined
	let deadlineOwner: 'run' | 'cleanup' | undefined
	let settled = false
	let childExited = false
	let childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined
	let terminalChecks = 0
	let recoveryStarted = false
	let accepted: { result: ExecutionResultV1; bytes: string } | undefined
	let fileDigest: TerminalDigest | undefined
	let terminationDone: (() => void) | undefined
	let executableWorkMayHaveStarted = false
	let finish!: (exitCode: number) => void
	const completion = new Promise<number>((resolveCompletion) => (finish = resolveCompletion))

	const streamDiagnostic = (stream: 'stdout' | 'stderr', bytes: number, truncated: boolean): void => {
		relayDiagnostic(
			{
				code: truncated ? 'worker.stream-limit-reached' : 'worker.stream-output-discarded',
				path: '',
				message: `Worker ${stream} produced ${bytes} bytes; content was discarded`,
			},
			input.stderr
		)
	}
	const stdoutGuard = new WorkerStreamGuard('stdout', (summary) =>
		streamDiagnostic(summary.stream, summary.bytes, summary.truncated)
	)
	const stderrGuard = new WorkerStreamGuard('stderr', (summary) =>
		streamDiagnostic(summary.stream, summary.bytes, summary.truncated)
	)
	stdoutGuard.attach(child.stdout)
	stderrGuard.attach(child.stderr)

	const clearTimerOnly = (): void => {
		if (timer !== undefined) clearTimer(timer)
		timer = undefined
	}
	const armTimer = (milliseconds: number, callback: () => void): void => {
		clearTimerOnly()
		timer = setTimer(callback, Math.max(0, milliseconds))
	}
	const clearDeadline = (): void => {
		clearTimerOnly()
		deadline = undefined
		deadlineOwner = undefined
	}
	const armDeadline = (absolute: number, owner: 'run' | 'cleanup'): void => {
		deadline = absolute
		deadlineOwner = owner
		armTimer(absolute - now(), onDeadline)
	}
	const cleanupListeners = (): void => {
		clearDeadline()
		signals.off('SIGINT', onSigint)
		signals.off('SIGTERM', onSigterm)
		child.off('message', onMessage)
		child.off('error', onError)
		child.off('exit', onExit)
		stdoutGuard.dispose(child.stdout)
		stderrGuard.dispose(child.stderr)
	}
	const complete = (exitCode: number, resultBytes?: string): void => {
		if (settled) return
		settled = true
		cleanupListeners()
		machine.settled()
		if (resultBytes !== undefined) input.stdout.write(resultBytes)
		finish(exitCode)
	}
	const terminate = (done: () => void): void => {
		if (childExited) {
			done()
			return
		}
		if (terminationDone) return
		terminationDone = done
		child.kill('SIGTERM')
		armTimer(dependencies.workerKillGraceMs ?? DEFAULT_KILL_GRACE_MS, () => {
			if (childExited) return
			child.kill('SIGKILL')
			armTimer(dependencies.workerExitGraceMs ?? DEFAULT_EXIT_GRACE_MS, () => {
				const finalize = terminationDone
				terminationDone = undefined
				finalize?.()
			})
		})
	}
	const contain = (
		phase: ContainmentResultV1['containment']['phase'],
		trigger: ContainmentResultV1['containment']['trigger'],
		diagnostic: Diagnostic
	): void => {
		if (settled || accepted) return
		machine.contain()
		const result = containmentResult(
			prepared,
			identity,
			identity.startedAt,
			now() - forkedAt,
			phase,
			trigger,
			executableWorkMayHaveStarted ? 'possibly-mutated' : 'not-attempted',
			diagnostic
		)
		terminate(() => complete(3, serializeJson(result)))
	}
	const accept = (candidate: { result: ExecutionResultV1; bytes: string }): void => {
		if (settled || !machine.terminalAccepted(candidate.result.reason)) return
		accepted = candidate
		clearDeadline()
		const finalize = (): void => complete(exitCodeFor(candidate.result), candidate.bytes)
		if (childExited) finalize()
		else armTimer(dependencies.workerExitGraceMs ?? DEFAULT_EXIT_GRACE_MS, () => terminate(finalize))
	}
	const expireDeadline = (): boolean => {
		if (deadline === undefined || now() < deadline) return false
		const owner = deadlineOwner
		clearDeadline()
		if (owner === 'run') {
			const transition = machine.runDeadlineExpired()
			if (transition.action === 'abort') {
				sendAbort(child, transition.signal)
				armDeadline(now() + prepared.effectiveLimits.cleanupTimeoutMs, 'cleanup')
				return true
			}
			return false
		}
		const cutoff = machine.cutoff()
		if (!cutoff) return false
		contain(cutoff.phase, cutoff.trigger, {
			code: 'worker.contained',
			path: '',
			message: `The worker did not produce an acceptable result before the ${cutoff.phase} cutoff`,
		})
		return true
	}
	const terminalUnavailable = (diagnostic: Diagnostic): void => {
		if (settled || accepted || !machine.acceptsTerminal()) return
		const phase = machine.cause === 'run-deadline-expired' ? 'run' : machine.cause ? 'cleanup' : 'terminal'
		const trigger = machine.cause === 'run-deadline-expired' ? 'run-deadline-expired' : 'worker-result-unavailable'
		contain(phase, trigger, diagnostic)
	}
	const finishAfterTerminalChecks = (): void => {
		if (!childExited || terminalChecks > 0 || settled || accepted) return
		if (normalExitRecoveryEligible()) void recoverAfterExit()
		else {
			terminalUnavailable({
				code: 'worker.result-unavailable',
				path: '',
				message: 'The scenario worker stopped without an acceptable terminal result',
			})
		}
	}
	const beginTerminalCheck = (
		message: Extract<WorkerMessage, { type: 'terminal-inline' | 'terminal-file' }>
	): void => {
		if (settled || expireDeadline() || !machine.acceptsTerminal()) return
		terminalChecks++
		void terminalCandidate(
			message,
			identity,
			prepared,
			dependencies.readResult ?? readAllocatedResult,
			dependencies.reconcile ?? reconcileExecutionResult
		)
			.then((candidate) => {
				terminalChecks--
				if (!expireDeadline()) accept(candidate)
				finishAfterTerminalChecks()
			})
			.catch(() => {
				terminalChecks--
				if (!expireDeadline()) finishAfterTerminalChecks()
			})
	}
	const recoverAfterExit = async (): Promise<void> => {
		if (recoveryStarted || !normalExitRecoveryEligible()) return
		recoveryStarted = true
		try {
			const bytes = await (dependencies.readResult ?? readAllocatedResult)(identity)
			if (expireDeadline()) return
			if (fileDigest && !digestMatches(bytes, fileDigest)) throw new Error('terminal digest mismatch')
			const candidate = await (dependencies.reconcile ?? reconcileExecutionResult)(bytes, identity, prepared)
			if (!expireDeadline()) accept(candidate)
		} catch {
			if (!expireDeadline())
				terminalUnavailable({
					code: 'worker.result-unavailable',
					path: '',
					message: 'The worker exited without an acceptable terminal result',
				})
		}
	}
	const normalExitRecoveryEligible = (): boolean =>
		!recoveryStarted &&
		childExit?.code === 0 &&
		childExit.signal === null &&
		machine.acceptsTerminal() &&
		(deadline === undefined || now() < deadline)

	function onMessage(raw: unknown): void {
		if (settled || expireDeadline()) return
		let message: WorkerMessage
		try {
			message = parseWorkerMessage(raw)
		} catch {
			return
		}
		if (message.runId !== identity.runId) return
		if (message.type === 'diagnostic') {
			relayDiagnostic(message.diagnostic, input.stderr)
			return
		}
		if (message.type === 'fatal') {
			relayDiagnostic(message.diagnostic, input.stderr)
			terminalUnavailable(message.diagnostic)
			return
		}
		if (message.type === 'cleanup-started') {
			if (machine.cleanupStarted().action === 'arm-cleanup') {
				armDeadline(now() + prepared.effectiveLimits.cleanupTimeoutMs, 'cleanup')
			}
			return
		}
		if (message.type === 'terminal-file') fileDigest = message.digest
		beginTerminalCheck(message)
	}

	function onError(): void {
		if (!settled && !childExited && !expireDeadline()) {
			terminalUnavailable({
				code: 'worker.process-error',
				path: '',
				message: 'The scenario worker encountered a process error',
			})
		}
	}

	function onExit(code: number | null, signal: NodeJS.Signals | null): void {
		childExited = true
		childExit = { code, signal }
		if (settled) return
		if (terminationDone) {
			const finalize = terminationDone
			terminationDone = undefined
			finalize()
			return
		}
		if (accepted) {
			complete(exitCodeFor(accepted.result), accepted.bytes)
			return
		}
		if (!expireDeadline()) finishAfterTerminalChecks()
	}

	function onDeadline(): void {
		if (deadline !== undefined && deadlineOwner && now() < deadline) armDeadline(deadline, deadlineOwner)
		else expireDeadline()
	}

	function onSignal(signal: ParentSignal): void {
		if (expireDeadline()) return
		const transition = machine.signal(signal)
		if (transition.action === 'abort') {
			sendAbort(child, transition.signal)
			armDeadline(now() + prepared.effectiveLimits.cleanupTimeoutMs, 'cleanup')
		} else if (transition.action === 'force-exit') {
			terminate(() => complete(transition.exitCode))
		}
	}
	function onSigint(): void {
		onSignal('SIGINT')
	}
	function onSigterm(): void {
		onSignal('SIGTERM')
	}

	child.on('message', onMessage)
	child.once('error', onError)
	child.once('exit', onExit)
	signals.on('SIGINT', onSigint)
	signals.on('SIGTERM', onSigterm)
	machine.forked()
	armDeadline(forkedAt + prepared.effectiveLimits.scenarioTimeoutMs, 'run')

	try {
		executableWorkMayHaveStarted = true
		sendIpcFrame((message) => child.send(message), { type: 'start', identity, prepared })
	} catch {
		contain('start', 'worker-result-unavailable', {
			code: 'worker.start-failed',
			path: '',
			message: 'The prepared run could not be sent to the scenario worker',
		})
	}

	return completion
}

async function terminalCandidate(
	message: Extract<WorkerMessage, { type: 'terminal-inline' | 'terminal-file' }>,
	identity: RunIdentity,
	prepared: PreparedRun,
	readResult: typeof readAllocatedResult,
	reconcile: typeof reconcileExecutionResult
): Promise<{ result: ExecutionResultV1; bytes: string }> {
	if (message.type === 'terminal-file') {
		const bytes = await readResult(identity)
		if (!digestMatches(bytes, message.digest)) throw new Error('terminal file digest mismatch')
		return reconcile(bytes, identity, prepared)
	}
	if (message.committed === false) {
		const candidate = await reconcile(message.resultJson, identity, prepared)
		if (candidate.result.reason !== 'result-write-failed')
			throw new Error('uncommitted terminal has an invalid reason')
		return candidate
	}
	if (!digestMatches(message.resultJson, message.digest)) throw new Error('terminal inline digest mismatch')
	const disk = await readResult(identity)
	if (disk !== message.resultJson) throw new Error('terminal inline bytes differ from result.json')
	return reconcile(message.resultJson, identity, prepared)
}

function sendAbort(child: ChildProcess, signal: ParentSignal): void {
	try {
		sendIpcFrame((message) => child.send(message), { type: 'abort', signal })
	} catch {
		return
	}
}

function containmentResult(
	prepared: PreparedRun,
	identity: RunIdentity | undefined,
	startedAt: string,
	durationMs: number,
	phase: ContainmentResultV1['containment']['phase'],
	trigger: ContainmentResultV1['containment']['trigger'],
	targetMutation: ContainmentResultV1['targetMutation'],
	diagnostic: Diagnostic
): ContainmentResultV1 {
	return {
		kind: 'run-result',
		schemaVersion: 1,
		source: 'parent',
		status: 'contained',
		category: 'infra',
		reason: 'parent-containment',
		executionState: 'unavailable',
		durability: 'uncommitted',
		...(identity ? { runId: identity.runId } : {}),
		scenarioId: prepared.request.scenario.id,
		declaredStepIds: prepared.request.scenario.steps.map((step) => step.id),
		targetMutation,
		startedAt,
		durationMs: Math.max(0, durationMs),
		containment: { phase, trigger },
		diagnostics: boundDiagnostics([diagnostic]),
	}
}

function preExecutionOperationalResult(...diagnostics: [Diagnostic, ...Diagnostic[]]): PreExecutionOperationalResultV1 {
	return {
		kind: 'run-result',
		schemaVersion: 1,
		source: 'parent',
		status: 'error',
		category: 'infra',
		reason: 'pre-execution-error',
		targetMutation: 'not-attempted',
		diagnostics: boundDiagnostics(diagnostics) as [Diagnostic, ...Diagnostic[]],
	}
}

function placeholderIdentity(prepared: PreparedRun, now: Date): RunIdentity {
	const runId = '0000000000000000'
	const runDirectory = resolve(prepared.outputDirectory, `${'x'.repeat(96)}-${runId}`)
	return {
		runId,
		startedAt: now.toISOString(),
		runDirectory,
		relativeRunDirectory: relativeFromRoot(prepared.invocationRoot, runDirectory),
	}
}

function relativeFromRoot(root: string, path: string): string {
	return path
		.slice(resolve(root).length + 1)
		.split('\\')
		.join('/')
}

function writeResult(result: RunResultV1, input: Pick<RunParentInput, 'stdout' | 'stderr'>): number {
	input.stdout.write(serializeJson(result))
	for (const diagnostic of result.diagnostics) relayDiagnostic(diagnostic, input.stderr)
	return exitCodeFor(result)
}

function exitCodeFor(result: RunResultV1): number {
	if (result.category === 'passed') return 0
	if (result.category === 'app') return 1
	if (result.category === 'model') return 2
	if (result.category === 'invalid') return 4
	return 3
}

function defaultForkWorker(): ChildProcess {
	const javascript = fileURLToPath(new URL('./worker.js', import.meta.url))
	const source = fileURLToPath(new URL('./worker.ts', import.meta.url))
	const modulePath = existsSync(javascript) ? javascript : source
	return fork(modulePath, [], {
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		...(modulePath.endsWith('.ts') ? { execArgv: ['--import', import.meta.resolve('tsx')] } : {}),
	})
}

function monotonicNow(): number {
	return Number(process.hrtime.bigint() / 1_000_000n)
}
