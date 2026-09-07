import { Buffer } from 'node:buffer'
import { dirname } from 'node:path'
import type {
	Diagnostic,
	DriverDescriptorV1,
	EvidencePolicyV1,
	EvidenceReference,
	ExecutedStepResult,
	ExecutionResultV1,
	RunRequestV1,
} from '../contracts/types.js'
import { serializeJson } from '../contracts/serialize.js'
import { Redactor } from '../redaction/redactor.js'
import { parseDocument, stringify as stringifyYaml } from 'yaml'
import { AtomicWriteError, writeAtomicFile } from './atomic-file.js'
import {
	ensurePrivateDirectory,
	driverEvidenceDirectory,
	evidenceExtension,
	harnessEvidencePath,
	resolveInside,
	safeSlug,
	toInvocationRelative,
	type RunIdentity,
} from './layout.js'
import { retainsEvidence, type EvidenceContent, type StepOutcome } from './retention.js'

export const EVIDENCE_CAPTURE_LIMITS = Object.freeze({
	maxCandidateBytes: 10 * 1024 * 1024,
	maxInvocationBytes: 64 * 1024 * 1024,
})

type AtomicWriter = (path: string, content: string | Uint8Array) => Promise<void>

export type EvidenceStoreOptions = Readonly<{
	invocationRoot: string
	identity: RunIdentity
	policy: EvidencePolicyV1
	stepIds: readonly string[]
	driverDescriptor: DriverDescriptorV1
	exactSecrets?: Iterable<string>
	writeFile?: AtomicWriter
	now?: () => Date
}>

export type HarnessEvidenceCandidate = Readonly<{
	stepId: string
	kind: 'transcript' | 'turn-snapshot'
	mediaType: 'text/markdown' | 'application/yaml'
	content: string | Uint8Array
	turn?: number
}>

export type DriverEvidenceCandidate = Readonly<{
	stepId?: string
	kind: string
	mediaType: string
	content: string | Uint8Array
}>

export type FinalizedStepEvidence = Readonly<{
	references: readonly EvidenceReference[]
	diagnostics: readonly Diagnostic[]
}>

export type CheckpointState = Readonly<{
	completedSteps: readonly ExecutedStepResult[]
	diagnostics?: readonly Diagnostic[]
}>

export type PreparedTerminalResult = Readonly<{
	result: ExecutionResultV1
	bytes: string
}>

export type CommittedResult = Readonly<{
	result: ExecutionResultV1
	bytes: string
	path: string
}>

type BufferedCandidate = {
	stepId?: string
	kind: string
	mediaType: string
	producer: 'harness' | string
	contentType: EvidenceContent
	path: string
	bytes: Buffer
}

const harnessKinds = {
	transcript: { mediaType: 'text/markdown', content: 'text' },
	'turn-snapshot': { mediaType: 'application/yaml', content: 'text' },
} as const

export class EvidenceStore {
	private readonly invocationRoot: string
	private readonly identity: RunIdentity
	private readonly policy: EvidencePolicyV1
	private readonly driverDescriptor: DriverDescriptorV1
	private readonly stepOrdinals: ReadonlyMap<string, number>
	private readonly redactor: Redactor
	private readonly writeFile: AtomicWriter
	private readonly now: () => Date
	private readonly pending: BufferedCandidate[] = []
	private readonly references: EvidenceReference[] = []
	private readonly allocatedPaths = new Set<string>()
	private readonly finalizedSteps = new Set<string>()
	private readonly persistenceDiagnostics: Diagnostic[] = []
	private lifecycle: 'allocated' | 'active' | 'terminal' = 'allocated'
	private bufferedBytes = 0
	private evidencePartial = false
	private driverCandidateOrdinal = 0
	private scenarioId: string | undefined

	constructor({
		invocationRoot,
		identity,
		policy,
		stepIds,
		driverDescriptor,
		exactSecrets,
		writeFile = writeAtomicFile,
		now = () => new Date(),
	}: EvidenceStoreOptions) {
		if (new Set(stepIds).size !== stepIds.length) throw new Error('Evidence store step IDs must be unique')
		this.invocationRoot = invocationRoot
		this.identity = identity
		this.policy = { ...policy }
		this.driverDescriptor = structuredClone(driverDescriptor)
		this.stepOrdinals = new Map(stepIds.map((id, index) => [id, index + 1]))
		this.redactor = new Redactor({ mode: policy.redaction, exactSecrets })
		this.writeFile = writeFile
		this.now = now
		toInvocationRelative(invocationRoot, identity.runDirectory)
	}

	get runIdentity(): RunIdentity {
		return this.identity
	}

	get state(): 'complete' | 'partial' {
		return this.evidencePartial ? 'partial' : 'complete'
	}

	get committedReferences(): readonly EvidenceReference[] {
		return this.references.map((reference) => ({ ...reference }))
	}

	get acceptedBufferBytes(): number {
		return this.bufferedBytes
	}

	markPartial(): void {
		this.evidencePartial = true
	}

	async writeInvocation(request: RunRequestV1): Promise<void> {
		if (this.lifecycle !== 'allocated') throw new Error('Invocation metadata has already been written')
		const requestStepIds = request.scenario.steps.map((step) => step.id)
		if (
			requestStepIds.length !== this.stepOrdinals.size ||
			requestStepIds.some((stepId, index) => this.stepOrdinals.get(stepId) !== index + 1)
		) {
			throw new Error('Invocation steps do not match the evidence store')
		}
		this.scenarioId = request.scenario.id
		this.lifecycle = 'active'
		const path = resolveInside(this.identity.runDirectory, 'invocation.json')
		const payload = this.redactor.redactInvocation({
			layoutVersion: 1,
			runId: this.identity.runId,
			startedAt: this.identity.startedAt,
			request,
		})
		await this.writeFile(path, serializeJson(payload))
	}

	captureHarnessStep(candidate: HarnessEvidenceCandidate): void {
		this.assertActive()
		const declaration = harnessKinds[candidate.kind]
		if (!declaration) {
			throw new EvidenceCaptureError(
				'evidence.undeclared-kind',
				`Harness evidence kind '${candidate.kind}' is not declared`
			)
		}
		if (candidate.mediaType !== declaration.mediaType) {
			throw new EvidenceCaptureError(
				'evidence.media-type-mismatch',
				`Harness evidence '${candidate.kind}' has an invalid media type`
			)
		}
		const ordinal = this.stepOrdinal(candidate.stepId)
		let path: string
		try {
			path = harnessEvidencePath(this.identity, ordinal, candidate.stepId, candidate.kind, candidate.turn)
		} catch (error) {
			throw new EvidenceCaptureError(
				'evidence.invalid-turn',
				error instanceof Error ? error.message : String(error)
			)
		}
		this.capture({ ...candidate, producer: 'harness', contentType: declaration.content, path })
	}

	captureDriver(candidate: DriverEvidenceCandidate): void {
		this.assertActive()
		const declaration = this.driverDescriptor.evidenceKinds.find((entry) => entry.kind === candidate.kind)
		if (!declaration) {
			throw new EvidenceCaptureError(
				'evidence.undeclared-kind',
				`Driver '${this.driverDescriptor.id}' does not declare evidence kind '${candidate.kind}'`
			)
		}
		if (declaration.mediaType !== candidate.mediaType) {
			throw new EvidenceCaptureError(
				'evidence.media-type-mismatch',
				`Driver evidence '${candidate.kind}' has an invalid media type`
			)
		}
		const fileOrdinal = ++this.driverCandidateOrdinal
		const filename = `${String(fileOrdinal).padStart(3, '0')}-${safeSlug(candidate.kind)}.${evidenceExtension(candidate.mediaType)}`
		const directory = candidate.stepId
			? driverEvidenceDirectory(
					this.identity,
					this.driverDescriptor.id,
					this.stepOrdinal(candidate.stepId),
					candidate.stepId
				)
			: driverEvidenceDirectory(this.identity, this.driverDescriptor.id)
		const path = resolveInside(directory, filename)
		this.capture({ ...candidate, producer: this.driverDescriptor.id, contentType: declaration.content, path })
	}

	async finalizeStep(stepId: string, outcome: StepOutcome): Promise<FinalizedStepEvidence> {
		this.assertActive()
		this.stepOrdinal(stepId)
		if (this.finalizedSteps.has(stepId)) throw new Error(`Evidence for step '${stepId}' has already been finalized`)
		this.finalizedSteps.add(stepId)
		const candidates = this.pending.filter((candidate) => candidate.stepId === stepId)
		return this.finalizeCandidates(candidates, outcome)
	}

	async finalizeScenario(outcome: StepOutcome): Promise<FinalizedStepEvidence> {
		this.assertActive()
		return this.finalizeCandidates([...this.pending], outcome)
	}

	recordCaptureFailure(artifact: string, error: unknown): Diagnostic {
		this.assertActive()
		this.evidencePartial = true
		const diagnostic = this.writeDiagnostic('evidence.capture-failed', artifact, error)
		this.recordPersistenceDiagnostic(diagnostic)
		return diagnostic
	}

	private async finalizeCandidates(
		candidates: readonly BufferedCandidate[],
		outcome: StepOutcome
	): Promise<FinalizedStepEvidence> {
		const newReferences: EvidenceReference[] = []
		const diagnostics: Diagnostic[] = []

		for (const candidate of candidates) {
			try {
				if (!retainsEvidence(this.policy, outcome, candidate.contentType)) continue
				await ensurePrivateDirectory(this.identity.runDirectory, dirname(candidate.path))
				await this.writeFile(candidate.path, candidate.bytes)
				const reference: EvidenceReference = {
					kind: candidate.kind,
					mediaType: candidate.mediaType,
					path: toInvocationRelative(this.invocationRoot, candidate.path),
					producer: candidate.producer,
					...(candidate.stepId === undefined ? {} : { stepId: candidate.stepId }),
				}
				this.references.push(reference)
				newReferences.push({ ...reference })
			} catch (error) {
				this.evidencePartial = true
				const diagnostic = this.writeDiagnostic('evidence.write-failed', candidate.kind, error)
				this.recordPersistenceDiagnostic(diagnostic)
				diagnostics.push(diagnostic)
			} finally {
				this.release(candidate)
			}
		}
		this.removeCandidates(candidates)
		return { references: newReferences, diagnostics }
	}

	async replaceCheckpoint(state: CheckpointState): Promise<Diagnostic | undefined> {
		this.assertActive()
		const path = resolveInside(this.identity.runDirectory, 'checkpoint.json')
		try {
			const payload = this.redactor.redactCheckpoint({
				layoutVersion: 1,
				runId: this.identity.runId,
				updatedAt: this.now().toISOString(),
				state: 'partial',
				completedSteps: state.completedSteps,
				evidenceReferences: this.references,
				diagnostics: mergeDiagnostics(state.diagnostics ?? [], this.persistenceDiagnostics),
			})
			await this.writeFile(path, serializeJson(payload))
			return undefined
		} catch (error) {
			const diagnostic = this.writeDiagnostic('checkpoint.write-failed', 'checkpoint', error)
			this.recordPersistenceDiagnostic(diagnostic)
			return diagnostic
		}
	}

	async writeResult(prepared: PreparedTerminalResult): Promise<CommittedResult> {
		this.assertActive()
		const absolutePath = resolveInside(this.identity.runDirectory, 'result.json')
		await this.writeFile(absolutePath, prepared.bytes)
		this.lifecycle = 'terminal'
		return {
			result: prepared.result,
			bytes: prepared.bytes,
			path: toInvocationRelative(this.invocationRoot, absolutePath),
		}
	}

	prepareResult(candidate: ExecutionResultV1): PreparedTerminalResult {
		this.assertActive()
		if (this.pending.length > 0) throw new Error('Cannot commit a result while evidence candidates are pending')
		if (candidate.runId !== this.identity.runId || candidate.startedAt !== this.identity.startedAt) {
			throw new Error('Execution result identity does not match the evidence store')
		}
		if (candidate.scenarioId !== this.scenarioId) {
			throw new Error('Execution result scenario does not match the evidence store')
		}
		const result = this.redactor.redactExecutionResult({
			...candidate,
			evidence: { state: this.state, references: [...this.committedReferences] },
			diagnostics: mergeDiagnostics(candidate.diagnostics, this.persistenceDiagnostics),
		})
		return { result, bytes: serializeJson(result) }
	}

	sanitizeDiagnosticText(value: string): string {
		return this.redactor.redactDiagnosticText(value)
	}

	dispose(): void {
		for (const candidate of this.pending) this.release(candidate)
		this.pending.length = 0
		this.lifecycle = 'terminal'
	}

	private capture(input: {
		stepId?: string
		kind: string
		mediaType: string
		content: string | Uint8Array
		producer: 'harness' | string
		contentType: EvidenceContent
		path: string
	}): void {
		if (input.stepId !== undefined && this.finalizedSteps.has(input.stepId)) {
			throw new EvidenceCaptureError(
				'evidence.step-finalized',
				`Evidence for step '${input.stepId}' is already finalized`
			)
		}
		if (this.allocatedPaths.has(input.path)) {
			throw new EvidenceCaptureError(
				'evidence.duplicate-destination',
				'Evidence destination is already allocated'
			)
		}
		const inputBytes = candidateByteLength(input.content)
		this.assertCandidateSize(inputBytes)
		const raw = ownBytes(input.content)
		const bytes = input.contentType === 'text' ? this.redactTextBytes(raw, input.mediaType) : raw
		this.assertCandidateSize(bytes.byteLength)
		if (this.bufferedBytes + bytes.byteLength > EVIDENCE_CAPTURE_LIMITS.maxInvocationBytes) {
			throw new EvidenceCaptureError(
				'evidence.invocation-buffer-too-large',
				`Accepted evidence buffers must not exceed ${EVIDENCE_CAPTURE_LIMITS.maxInvocationBytes} bytes per invocation`
			)
		}

		this.pending.push({
			stepId: input.stepId,
			kind: input.kind,
			mediaType: input.mediaType,
			producer: input.producer,
			contentType: input.contentType,
			path: input.path,
			bytes,
		})
		this.allocatedPaths.add(input.path)
		this.bufferedBytes += bytes.byteLength
	}

	private redactTextBytes(raw: Buffer, mediaType: string): Buffer {
		if (this.policy.redaction === 'off') return raw
		let value: string
		try {
			value = new TextDecoder('utf-8', { fatal: true }).decode(raw)
		} catch {
			throw new EvidenceCaptureError('evidence.invalid-text', 'Text evidence must contain valid UTF-8')
		}
		try {
			const format = structuredFormat(mediaType)
			if (format === 'json') {
				const parsed = JSON.parse(value) as unknown
				assertJsonValue(parsed)
				return Buffer.from(serializeJson(this.redactor.redactContent(parsed)), 'utf8')
			}
			if (format === 'yaml') {
				const document = parseDocument(value, { uniqueKeys: true })
				if (document.errors.length > 0) throw document.errors[0]
				const parsed = document.toJS({ maxAliasCount: 100 }) as unknown
				assertJsonValue(parsed)
				const redacted = this.redactor.redactContent(parsed)
				return Buffer.from(stringifyYaml(redacted, { sortMapEntries: true }), 'utf8')
			}
			return Buffer.from(this.redactor.redactText(value), 'utf8')
		} catch (error) {
			if (error instanceof EvidenceCaptureError) throw error
			throw new EvidenceCaptureError(
				'evidence.invalid-structured-content',
				`Structured ${mediaType} evidence could not be safely redacted`
			)
		}
	}

	private assertCandidateSize(bytes: number): void {
		if (bytes > EVIDENCE_CAPTURE_LIMITS.maxCandidateBytes) {
			throw new EvidenceCaptureError(
				'evidence.candidate-too-large',
				`An evidence candidate must not exceed ${EVIDENCE_CAPTURE_LIMITS.maxCandidateBytes} bytes`
			)
		}
	}

	private stepOrdinal(stepId: string): number {
		const ordinal = this.stepOrdinals.get(stepId)
		if (ordinal === undefined) {
			throw new EvidenceCaptureError('evidence.unknown-step', `Evidence references unknown step '${stepId}'`)
		}
		return ordinal
	}

	private release(candidate: BufferedCandidate): void {
		this.bufferedBytes -= candidate.bytes.byteLength
		candidate.bytes = Buffer.alloc(0)
	}

	private removeCandidates(candidates: readonly BufferedCandidate[]): void {
		const removed = new Set(candidates)
		for (let index = this.pending.length - 1; index >= 0; index--) {
			if (removed.has(this.pending[index])) this.pending.splice(index, 1)
		}
	}

	private assertActive(): void {
		if (this.lifecycle !== 'active') throw new Error('Evidence store is not accepting evidence')
	}

	private writeDiagnostic(code: string, artifact: string, error: unknown): Diagnostic {
		const detail = error instanceof Error ? error.message : String(error)
		const durability =
			error instanceof AtomicWriteError && error.durability === 'uncertain'
				? ' The destination was renamed, but durability was not confirmed; no reference was published.'
				: ''
		return {
			code,
			path: '/evidence',
			message: this.redactor.redactDiagnosticText(
				`Could not commit ${artifact} evidence: ${detail}.${durability}`.trim()
			),
		}
	}

	private recordPersistenceDiagnostic(diagnostic: Diagnostic): void {
		this.persistenceDiagnostics.push(diagnostic)
	}
}

export class EvidenceCaptureError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message)
		this.name = 'EvidenceCaptureError'
	}
}

function ownBytes(content: string | Uint8Array): Buffer {
	return typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
}

function candidateByteLength(content: string | Uint8Array): number {
	return typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength
}

function structuredFormat(mediaType: string): 'json' | 'yaml' | undefined {
	const normalized = mediaType.split(';', 1)[0].trim().toLowerCase()
	if (normalized === 'application/json' || normalized.endsWith('+json')) return 'json'
	if (['application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml'].includes(normalized)) return 'yaml'
	return undefined
}

function assertJsonValue(value: unknown): asserts value is import('../contracts/types.js').JsonValue {
	try {
		serializeJson(value)
	} catch {
		throw new EvidenceCaptureError(
			'evidence.invalid-structured-content',
			'Structured evidence must contain only JSON-compatible values'
		)
	}
}

function mergeDiagnostics(left: readonly Diagnostic[], right: readonly Diagnostic[]): Diagnostic[] {
	const merged: Diagnostic[] = []
	const seen = new Set<string>()
	for (const diagnostic of [...left, ...right]) {
		const key = `${diagnostic.code}\0${diagnostic.path}\0${diagnostic.message}`
		if (seen.has(key)) continue
		seen.add(key)
		merged.push({ ...diagnostic })
	}
	return merged
}
