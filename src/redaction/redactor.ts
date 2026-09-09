import type {
	Diagnostic,
	EvidenceReference,
	ExecutedStepResult,
	ExecutionResultV1,
	JsonObject,
	JsonValue,
	NotRunStepResult,
	RunRequestV1,
} from '../contracts/types.js'
import { compareUtf16 } from '../config/record.js'
import { scrub } from './scrub.js'

export const REDACTED_VALUE = '[secret omitted]'

const MAX_SENSITIVE_KEY_LENGTH = 128
const SENSITIVE_KEYS = new Set([
	'accesstoken',
	'apikey',
	'authorization',
	'checkmateopenaiapikey',
	'clientsecret',
	'cookie',
	'databasepassword',
	'openaiapikey',
	'password',
	'refreshtoken',
	'secret',
])

export type RedactorOptions = Readonly<{
	mode: 'on' | 'off'
	exactSecrets?: Iterable<string>
}>

export type InvocationDocumentV1 = Readonly<{
	layoutVersion: 1
	runId: string
	startedAt: string
	request: RunRequestV1
}>

export type CheckpointDocumentV1 = Readonly<{
	layoutVersion: 1
	runId: string
	updatedAt: string
	state: 'partial'
	completedSteps: readonly ExecutedStepResult[]
	evidenceReferences: readonly EvidenceReference[]
	diagnostics: readonly Diagnostic[]
}>

export class Redactor {
	private readonly enabled: boolean
	private readonly exactSecrets: readonly string[]

	constructor({ mode, exactSecrets = [] }: RedactorOptions) {
		this.enabled = mode === 'on'
		this.exactSecrets = [...new Set(exactSecrets)]
			.filter((value) => value.length > 0)
			.sort((left, right) => right.length - left.length || compareUtf16(left, right))
	}

	redactText(value: string): string {
		return this.enabled ? this.sanitizeText(value) : value
	}

	redactContent(value: JsonValue): JsonValue {
		return this.enabled ? this.transformContent(value) : structuredClone(value)
	}

	redactInvocation(document: InvocationDocumentV1): InvocationDocumentV1 {
		return {
			layoutVersion: document.layoutVersion,
			runId: document.runId,
			startedAt: document.startedAt,
			request: this.redactRequest(document.request),
		}
	}

	redactCheckpoint(document: CheckpointDocumentV1): CheckpointDocumentV1 {
		return {
			layoutVersion: document.layoutVersion,
			runId: document.runId,
			updatedAt: document.updatedAt,
			state: document.state,
			completedSteps: document.completedSteps.map((step) => this.redactExecutedStep(step)),
			evidenceReferences: document.evidenceReferences.map(copyEvidenceReference),
			diagnostics: document.diagnostics.map((diagnostic) => this.redactDiagnostic(diagnostic)),
		}
	}

	redactExecutionResult(result: ExecutionResultV1): ExecutionResultV1 {
		return {
			kind: result.kind,
			schemaVersion: result.schemaVersion,
			runId: result.runId,
			scenarioId: result.scenarioId,
			status: result.status,
			category: result.category,
			reason: result.reason,
			targetMutation: result.targetMutation,
			startedAt: result.startedAt,
			durationMs: result.durationMs,
			driver: { ...result.driver },
			policy: { id: result.policy.id, effectiveLimits: { ...result.policy.effectiveLimits } },
			usage: { ...result.usage },
			steps: result.steps.map((step) =>
				step.status === 'not-run' ? this.copyNotRunStep(step) : this.redactExecutedStep(step)
			),
			evidence: {
				state: result.evidence.state,
				references: result.evidence.references.map(copyEvidenceReference),
			},
			diagnostics: result.diagnostics.map((diagnostic) => this.redactDiagnostic(diagnostic)),
		}
	}

	redactDiagnosticText(value: string): string {
		return this.sanitizeText(value)
	}

	private redactRequest(request: RunRequestV1): RunRequestV1 {
		return {
			schemaVersion: request.schemaVersion,
			scenario: {
				id: request.scenario.id,
				...(request.scenario.name === undefined ? {} : { name: this.redactText(request.scenario.name) }),
				driver: {
					id: request.scenario.driver.id,
					target: this.redactContent(request.scenario.driver.target) as JsonObject,
				},
				...(request.scenario.policy === undefined ? {} : { policy: request.scenario.policy }),
				...(request.scenario.limits === undefined ? {} : { limits: { ...request.scenario.limits } }),
				steps: request.scenario.steps.map((step) => ({
					id: step.id,
					action: this.redactText(step.action),
					expect: this.redactText(step.expect),
				})),
			},
		}
	}

	private redactExecutedStep(step: ExecutedStepResult): ExecutedStepResult {
		return {
			id: step.id,
			status: step.status,
			category: step.category,
			reason: step.reason,
			...(step.actual === undefined ? {} : { actual: this.redactText(step.actual) }),
			turns: step.turns,
			durationMs: step.durationMs,
			usage: { ...step.usage },
			toolCalls: step.toolCalls.map((call) => ({
				turn: call.turn,
				driverId: call.driverId,
				name: call.name,
				arguments: this.redactContent(call.arguments),
				status: call.status,
			})),
		}
	}

	private copyNotRunStep(step: NotRunStepResult): NotRunStepResult {
		return step.reason === 'prior-step-failed'
			? { id: step.id, status: step.status, reason: step.reason, blockedBy: step.blockedBy }
			: { id: step.id, status: step.status, reason: step.reason }
	}

	private redactDiagnostic(diagnostic: Diagnostic): Diagnostic {
		return {
			code: diagnostic.code,
			path: diagnostic.path,
			message: this.redactText(diagnostic.message),
		}
	}

	private transformContent(value: JsonValue): JsonValue {
		if (typeof value === 'string') return this.sanitizeText(value)
		if (Array.isArray(value)) return value.map((entry) => this.transformContent(entry))
		if (value === null || typeof value !== 'object') return value

		const transformed = Object.create(null) as Record<string, JsonValue>
		const used = new Set<string>()
		for (const key of Object.keys(value).sort(compareUtf16)) {
			const redactedKey = uniqueContentKey(this.sanitizeText(key), used)
			used.add(redactedKey)
			transformed[redactedKey] = isSensitiveKey(key) ? REDACTED_VALUE : this.transformContent(value[key])
		}
		return transformed
	}

	private sanitizeText(value: string): string {
		let sanitized = value
		for (const secret of this.exactSecrets) sanitized = sanitized.replaceAll(secret, REDACTED_VALUE)
		return scrub(sanitized)
	}
}

export function isSensitiveKey(key: string): boolean {
	if (key.length > MAX_SENSITIVE_KEY_LENGTH) return false
	return SENSITIVE_KEYS.has(key.replaceAll(/[-_\s]/g, '').toLowerCase())
}

function uniqueContentKey(base: string, used: ReadonlySet<string>): string {
	if (!used.has(base)) return base
	for (let suffix = 2; suffix <= Number.MAX_SAFE_INTEGER; suffix++) {
		const candidate = `${base} [collision ${suffix}]`
		if (!used.has(candidate)) return candidate
	}
	throw new Error('Unable to allocate a collision-safe redacted key')
}

function copyEvidenceReference(reference: EvidenceReference): EvidenceReference {
	return {
		kind: reference.kind,
		mediaType: reference.mediaType,
		path: reference.path,
		producer: reference.producer,
		...(reference.stepId === undefined ? {} : { stepId: reference.stepId }),
	}
}
