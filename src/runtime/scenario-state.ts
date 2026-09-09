import type {
	Diagnostic,
	EffectiveLimits,
	EvidenceReference,
	ExecutedStepResult,
	ExecutionResultV1,
	NotRunStepResult,
	RunReason,
	RunRequestV1,
	Usage,
} from '../contracts/types.js'
import type { RunIdentity } from '../evidence/layout.js'

type Failure = Readonly<{
	reason: Exclude<RunReason, 'scenario-complete'>
	diagnostic?: Diagnostic
}>

export type ScenarioStateOptions = Readonly<{
	request: RunRequestV1
	identity: RunIdentity
	driver: { id: string; contractVersion: 1 }
	policy: { id: string; effectiveLimits: EffectiveLimits }
	now?: () => number
}>

export class ScenarioState {
	private readonly request: RunRequestV1
	private readonly identity: RunIdentity
	private readonly driver: { id: string; contractVersion: 1 }
	private readonly policy: { id: string; effectiveLimits: EffectiveLimits }
	private readonly now: () => number
	private readonly startedAtMs: number
	private readonly results: Array<ExecutedStepResult | NotRunStepResult> = []
	private readonly diagnostics: Diagnostic[] = []
	private readonly lifecycleFailures: Failure[] = []
	private cleanupFailure: Failure | undefined
	private mutation: ExecutionResultV1['targetMutation'] = 'not-attempted'

	constructor(options: ScenarioStateOptions) {
		this.request = options.request
		this.identity = options.identity
		this.driver = { ...options.driver }
		this.policy = { id: options.policy.id, effectiveLimits: { ...options.policy.effectiveLimits } }
		this.now = options.now ?? Date.now
		this.startedAtMs = this.now()
	}

	get completedSteps(): readonly ExecutedStepResult[] {
		return this.results.filter((step): step is ExecutedStepResult => step.status !== 'not-run')
	}

	get hasFailure(): boolean {
		return this.selectFailure() !== undefined
	}

	markMutationPossible(): void {
		this.mutation = 'possibly-mutated'
	}

	recordStep(result: ExecutedStepResult, diagnostics: readonly Diagnostic[] = []): void {
		const expected = this.request.scenario.steps[this.results.length]
		if (!expected || expected.id !== result.id) throw new Error(`Step '${result.id}' is out of scenario order`)
		if (this.results.some((step) => step.id === result.id))
			throw new Error(`Step '${result.id}' was already recorded`)
		this.results.push(structuredClone(result))
		this.recordDiagnostics(diagnostics)
	}

	blockRemaining(blockedBy: string): void {
		const blocker = this.results.find((step) => step.id === blockedBy)
		if (!blocker || blocker.status !== 'failed')
			throw new Error(`Blocking step '${blockedBy}' is not a failed step`)
		for (const step of this.request.scenario.steps.slice(this.results.length)) {
			this.results.push({ id: step.id, status: 'not-run', reason: 'prior-step-failed', blockedBy })
		}
	}

	markNotStarted(): void {
		for (const step of this.request.scenario.steps.slice(this.results.length)) {
			this.results.push({ id: step.id, status: 'not-run', reason: 'scenario-not-started' })
		}
	}

	recordLifecycleFailure(reason: Failure['reason'], diagnostic?: Diagnostic): void {
		if (reason === 'interrupted' && this.lifecycleFailures.some((failure) => failure.reason === reason)) return
		const failure = { reason, ...(diagnostic === undefined ? {} : { diagnostic }) }
		this.lifecycleFailures.push(failure)
		if (diagnostic) this.recordDiagnostics([diagnostic])
	}

	latchInterruption(diagnostic?: Diagnostic): void {
		this.recordLifecycleFailure('interrupted', diagnostic)
	}

	recordCleanupFailure(diagnostic: Diagnostic): void {
		this.cleanupFailure = { reason: 'driver-teardown-failed', diagnostic }
		this.recordDiagnostics([diagnostic])
	}

	recordDiagnostics(diagnostics: readonly Diagnostic[]): void {
		for (const diagnostic of diagnostics) this.diagnostics.push({ ...diagnostic })
	}

	buildCandidateResult(input: {
		usage: Usage & { state: 'complete' | 'partial' | 'unavailable' }
		evidence: { state: 'complete' | 'partial'; references: readonly EvidenceReference[] }
	}): ExecutionResultV1 {
		if (this.results.length !== this.request.scenario.steps.length) {
			throw new Error('Every declared step must have one terminal scenario state')
		}
		const failure = this.selectFailure()
		const route = failure ? routeForFailure(failure.reason, this.results) : passedRoute()
		return {
			kind: 'run-result',
			schemaVersion: 1,
			runId: this.identity.runId,
			scenarioId: this.request.scenario.id,
			...route,
			targetMutation: this.mutation,
			startedAt: this.identity.startedAt,
			durationMs: Math.max(0, this.now() - this.startedAtMs),
			driver: { ...this.driver },
			policy: { id: this.policy.id, effectiveLimits: { ...this.policy.effectiveLimits } },
			usage: { ...input.usage },
			steps: structuredClone(this.results),
			evidence: {
				state: input.evidence.state,
				references: input.evidence.references.map((item) => ({ ...item })),
			},
			diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		}
	}

	private selectFailure(): Failure | undefined {
		if (this.cleanupFailure) return this.cleanupFailure
		const interrupted = this.lifecycleFailures.find((failure) => failure.reason === 'interrupted')
		if (interrupted) return interrupted
		const interruptedStep = this.results.find(
			(step): step is ExecutedStepResult => step.status === 'failed' && step.reason === 'interrupted'
		)
		if (interruptedStep) return { reason: 'interrupted' }
		const evidence = this.lifecycleFailures.find((failure) => failure.reason === 'evidence-write-failed')
		if (evidence) return evidence
		if (this.lifecycleFailures.length > 0) return this.lifecycleFailures[0]
		const failedStep = this.results.find((step): step is ExecutedStepResult => step.status === 'failed')
		if (!failedStep) return undefined
		if (failedStep.reason === 'met-expectation') throw new Error('A failed step cannot have met its expectation')
		return { reason: failedStep.reason }
	}
}

function passedRoute(): Pick<ExecutionResultV1, 'status' | 'category' | 'reason'> {
	return { status: 'passed', category: 'passed', reason: 'scenario-complete' }
}

function routeForFailure(
	reason: Exclude<RunReason, 'scenario-complete'>,
	steps: readonly (ExecutedStepResult | NotRunStepResult)[]
): Pick<ExecutionResultV1, 'status' | 'category' | 'reason'> {
	if (reason === 'interrupted') return { status: 'interrupted', category: 'infra', reason }
	const step = steps.find(
		(candidate): candidate is ExecutedStepResult => candidate.status === 'failed' && candidate.reason === reason
	)
	return { status: 'failed', category: step?.category ?? 'infra', reason }
}
