import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import type { PreparedRun } from '../api/prepare-run.js'
import { serializeJson } from '../contracts/serialize.js'
import type {
	EvidenceReference,
	ExecutedStepResult,
	ExecutionResultV1,
	RunReason,
	StepReason,
	Usage,
} from '../contracts/types.js'
import { validateRunResult } from '../contracts/validator.js'
import {
	driverEvidenceDirectory,
	evidenceExtension,
	harnessEvidencePath,
	safeSlug,
	toInvocationRelative,
	type RunIdentity,
} from '../evidence/layout.js'

const CATEGORY_BY_STEP_REASON: Record<StepReason, ExecutedStepResult['category']> = {
	'met-expectation': 'app',
	'failed-expectation': 'app',
	'loop-detected': 'model',
	'turn-cap-exceeded': 'model',
	'step-timeout': 'model',
	'scenario-timeout': 'infra',
	'tool-error': 'infra',
	'provider-error': 'infra',
	'token-budget-exceeded': 'infra',
	interrupted: 'infra',
	'internal-error': 'infra',
}

const STARTUP_REASONS = new Set<RunReason>(['driver-load-failed', 'driver-start-failed', 'evidence-write-failed'])

const FLEXIBLE_LIFECYCLE_REASONS = new Set<RunReason>(['interrupted', 'scenario-timeout', 'internal-error'])

const OVERRIDE_REASONS = new Set<RunReason>(['driver-teardown-failed', 'result-write-failed'])

const NOT_ATTEMPTED_REASONS = new Set<RunReason>([
	'driver-start-failed',
	'evidence-write-failed',
	'result-write-failed',
	'interrupted',
	'scenario-timeout',
])

export type ReconciledExecutionResult = Readonly<{ result: ExecutionResultV1; bytes: string }>

export class ResultReconciliationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ResultReconciliationError'
	}
}

export async function reconcileExecutionResult(
	bytes: string,
	identity: RunIdentity,
	prepared: PreparedRun
): Promise<ReconciledExecutionResult> {
	const result = parseExecutionResult(bytes)
	if (serializeJson(result) !== bytes) fail('result bytes are not deterministic Checkmate JSON')
	assertPlanIdentity(result, identity, prepared)
	assertSteps(result, prepared)
	assertUsage(result)
	await assertEvidence(result, identity, prepared)
	return { result, bytes }
}

export async function readAllocatedResult(identity: RunIdentity): Promise<string> {
	const path = resolve(identity.runDirectory, 'result.json')
	const information = await stat(path)
	if (!information.isFile()) fail('allocated result path is not a regular file')
	return readFile(path, 'utf8')
}

function parseExecutionResult(bytes: string): ExecutionResultV1 {
	let input: unknown
	try {
		input = JSON.parse(bytes)
	} catch {
		return fail('result bytes are not valid JSON')
	}
	const validation = validateRunResult(input)
	if (validation.ok === false) {
		return fail(`result does not satisfy RunResultV1: ${validation.diagnostics[0]?.message ?? 'invalid result'}`)
	}
	if (!('runId' in validation.value) || 'source' in validation.value) {
		return fail('worker result must use the execution result arm')
	}
	return validation.value
}

function assertPlanIdentity(result: ExecutionResultV1, identity: RunIdentity, prepared: PreparedRun): void {
	if (result.runId !== identity.runId) fail('result runId does not match the allocated run')
	if (result.startedAt !== identity.startedAt) fail('result startedAt does not match the allocated run')
	if (result.scenarioId !== prepared.request.scenario.id) fail('result scenarioId does not match the request')
	if (
		result.driver.id !== prepared.driver.id ||
		result.driver.contractVersion !== prepared.driver.descriptor.driverContractVersion
	) {
		fail('result driver does not match the prepared driver')
	}
	if (result.policy.id !== prepared.policy.id) fail('result policy does not match the prepared policy')
	if (serializeJson(result.policy.effectiveLimits) !== serializeJson(prepared.effectiveLimits)) {
		fail('result effective limits do not match the prepared limits')
	}
	if (result.targetMutation === 'not-attempted' && !NOT_ATTEMPTED_REASONS.has(result.reason)) {
		fail('worker result has an inconsistent target mutation state')
	}
	if (result.reason === 'evidence-write-failed' && result.targetMutation !== 'not-attempted') {
		fail('invocation evidence failure cannot claim target mutation')
	}
}

function assertSteps(result: ExecutionResultV1, prepared: PreparedRun): void {
	const declared = prepared.request.scenario.steps
	if (result.steps.length !== declared.length) fail('result must contain every declared step exactly once')

	let failedStep: ExecutedStepResult | undefined
	let notStarted = false
	let executedSteps = 0
	for (const [index, step] of result.steps.entries()) {
		if (step.id !== declared[index].id) fail('result step order does not match the request')
		if (step.status === 'not-run') {
			if (!failedStep) {
				if (step.reason !== 'scenario-not-started') fail('not-run step has no valid blocker')
				notStarted = true
			} else if (step.reason !== 'prior-step-failed' || step.blockedBy !== failedStep.id) {
				fail('not-run step does not identify the first failed step')
			}
			continue
		}

		if (notStarted || failedStep) fail('executed steps must form one contiguous prefix')
		executedSteps++
		assertStep(step, prepared)
		if (step.status === 'failed') failedStep = step
	}
	if (executedSteps > 0 && result.targetMutation !== 'possibly-mutated') {
		fail('an executed step requires possible target mutation')
	}

	if (result.status === 'passed') {
		if (result.category !== 'passed' || result.reason !== 'scenario-complete')
			fail('passed result route is inconsistent')
		if (failedStep || notStarted || result.steps.some((step) => step.status !== 'passed')) {
			fail('passed result must contain only passed steps')
		}
		return
	}

	if (result.reason === 'interrupted') {
		if (result.status !== 'interrupted' || result.category !== 'infra')
			fail('interrupted result route is inconsistent')
		assertLifecycleShape(result.reason, failedStep, executedSteps, notStarted)
		return
	}
	if (result.status !== 'failed' || result.category === 'passed' || result.reason === 'scenario-complete') {
		fail('failed result route is inconsistent')
	}
	if (STARTUP_REASONS.has(result.reason)) {
		if (result.category !== 'infra' || executedSteps !== 0 || failedStep || !notStarted) {
			fail('startup lifecycle result has executed semantic state')
		}
		return
	}
	if (OVERRIDE_REASONS.has(result.reason)) {
		if (result.category !== 'infra') fail('lifecycle override must use the infrastructure category')
		return
	}
	if (FLEXIBLE_LIFECYCLE_REASONS.has(result.reason)) {
		if (result.category !== 'infra') fail('lifecycle result must use the infrastructure category')
		assertLifecycleShape(result.reason, failedStep, executedSteps, notStarted)
		return
	}
	if (!failedStep || failedStep.reason !== result.reason || failedStep.category !== result.category) {
		fail('top-level result route does not match the failed step')
	}
}

function assertLifecycleShape(
	reason: RunReason,
	failedStep: ExecutedStepResult | undefined,
	executedSteps: number,
	notStarted: boolean
): void {
	if (failedStep && failedStep.reason !== reason && reason !== 'interrupted') {
		fail('lifecycle result conflicts with the failed step')
	}
	if (!failedStep && !notStarted && executedSteps === 0) fail('lifecycle result has no terminal step state')
}

function assertStep(step: ExecutedStepResult, prepared: PreparedRun): void {
	if (step.category !== CATEGORY_BY_STEP_REASON[step.reason])
		fail(`step '${step.id}' has an invalid category/reason pair`)
	if (step.status === 'passed' && step.reason !== 'met-expectation')
		fail(`passed step '${step.id}' has a failure reason`)
	if (step.status === 'failed' && step.reason === 'met-expectation')
		fail(`failed step '${step.id}' met its expectation`)
	if (step.turns > prepared.effectiveLimits.turnsPerStep) fail(`step '${step.id}' exceeds the prepared turn limit`)
	assertUsageShape(step.usage, `step '${step.id}'`)
	for (const call of step.toolCalls) {
		if (call.turn > step.turns) fail(`step '${step.id}' contains a tool call after its final turn`)
		if (call.driverId !== prepared.driver.id && call.driverId !== 'harness') {
			fail(`step '${step.id}' contains a tool call from another driver`)
		}
		if (call.driverId === 'harness' && !['pass_test_step', 'fail_test_step'].includes(call.name)) {
			fail(`step '${step.id}' contains an unknown harness tool`)
		}
		if (
			call.driverId === prepared.driver.id &&
			!prepared.driver.descriptor.tools.some((tool) => tool.name === call.name)
		) {
			fail(`step '${step.id}' contains an undeclared driver tool`)
		}
	}
}

function assertUsage(result: ExecutionResultV1): void {
	assertUsageShape(result.usage, 'scenario')
	const total: Usage = { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0 }
	for (const step of result.steps) {
		if (step.status === 'not-run') continue
		total.promptTokens += step.usage.promptTokens
		total.cachedPromptTokens += step.usage.cachedPromptTokens
		total.completionTokens += step.usage.completionTokens
		total.totalTokens += step.usage.totalTokens
	}
	for (const key of Object.keys(total) as Array<keyof Usage>) {
		if (result.usage[key] !== total[key]) fail('scenario usage does not equal executed step usage')
	}
	if (result.usage.state === 'unavailable' && result.usage.totalTokens !== 0) {
		fail('unavailable scenario usage must be empty')
	}
}

function assertUsageShape(usage: Usage, owner: string): void {
	if (usage.totalTokens !== usage.promptTokens + usage.completionTokens) {
		fail(`${owner} token total is inconsistent`)
	}
	if (usage.cachedPromptTokens > usage.promptTokens) fail(`${owner} cached tokens exceed prompt tokens`)
}

async function assertEvidence(result: ExecutionResultV1, identity: RunIdentity, prepared: PreparedRun): Promise<void> {
	const declaredSteps = new Set(prepared.request.scenario.steps.map((step) => step.id))
	const seen = new Set<string>()
	for (const reference of result.evidence.references) {
		assertEvidenceDeclaration(reference, identity, prepared, declaredSteps)
		if (seen.has(reference.path)) fail('result contains a duplicate evidence path')
		seen.add(reference.path)

		const absolute = resolve(prepared.invocationRoot, reference.path)
		assertInside(identity.runDirectory, absolute)
		if (
			reference.path !== toInvocationRelative(prepared.invocationRoot, absolute) ||
			reference.path.includes('\\')
		) {
			fail('evidence path is not invocation-root-relative to the allocated run')
		}
		let information
		try {
			information = await stat(absolute)
		} catch {
			fail('evidence reference does not point at a committed artifact')
		}
		if (!information.isFile()) fail('evidence reference does not point at a regular file')
	}
}

function assertEvidenceDeclaration(
	reference: EvidenceReference,
	identity: RunIdentity,
	prepared: PreparedRun,
	declaredSteps: ReadonlySet<string>
): void {
	if (reference.stepId !== undefined && !declaredSteps.has(reference.stepId)) {
		fail('evidence reference names an unknown step')
	}
	if (reference.producer === 'harness') {
		if (!reference.stepId) fail('harness evidence must name its producing step')
		const valid =
			(reference.kind === 'transcript' && reference.mediaType === 'text/markdown') ||
			(reference.kind === 'turn-snapshot' && reference.mediaType === 'application/yaml')
		if (!valid) fail('harness evidence reference has an undeclared kind or media type')
		const ordinal = prepared.request.scenario.steps.findIndex((step) => step.id === reference.stepId) + 1
		const absolute = resolve(prepared.invocationRoot, reference.path)
		if (reference.kind === 'transcript') {
			if (absolute !== harnessEvidencePath(identity, ordinal, reference.stepId, 'transcript')) {
				fail('harness transcript does not use its canonical evidence path')
			}
		} else {
			const match = /^(\d{3,})\.yml$/.exec(basename(absolute))
			const turn = match ? Number(match[1]) : 0
			if (!turn || absolute !== harnessEvidencePath(identity, ordinal, reference.stepId, 'turn-snapshot', turn)) {
				fail('harness turn snapshot does not use its canonical evidence path')
			}
		}
		return
	}
	if (reference.producer !== prepared.driver.id) fail('evidence producer does not match the selected driver')
	const declaration = prepared.driver.descriptor.evidenceKinds.find((entry) => entry.kind === reference.kind)
	if (!declaration || declaration.mediaType !== reference.mediaType) {
		fail('driver evidence reference has an undeclared kind or media type')
	}
	const ordinal = reference.stepId
		? prepared.request.scenario.steps.findIndex((step) => step.id === reference.stepId) + 1
		: undefined
	const expectedDirectory = driverEvidenceDirectory(identity, prepared.driver.id, ordinal, reference.stepId)
	const filename = basename(resolve(prepared.invocationRoot, reference.path))
	const match = /^(\d{3,})-(.+)\.([^.]+)$/.exec(filename)
	if (
		dirname(resolve(prepared.invocationRoot, reference.path)) !== expectedDirectory ||
		!match ||
		Number(match[1]) < 1 ||
		match[1] !== String(Number(match[1])).padStart(3, '0') ||
		match[2] !== safeSlug(reference.kind) ||
		match[3] !== evidenceExtension(reference.mediaType)
	) {
		fail('driver evidence does not use its canonical attributed path')
	}
}

function assertInside(root: string, candidate: string): void {
	const child = relative(resolve(root), resolve(candidate))
	if (!child || child === '..' || child.startsWith(`..${sep}`)) fail('artifact path escapes the allocated run')
}

function fail(message: string): never {
	throw new ResultReconciliationError(message)
}
