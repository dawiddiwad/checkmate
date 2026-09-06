import type { Diagnostic, Usage } from '../contracts/types.js'
import type { StepIntent } from '../driver.js'
import { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'
import { scrub, scrubValue } from '../redaction/scrub.js'
import type { ToolCall, ToolResponse } from '../tools/types.js'
import type {
	InternalStepReport,
	InternalStepToolCall,
	InternalTerminationReason,
	StepCategory,
	TranscriptEntry,
} from './types.js'

const TRANSCRIPT_CONTENT_LIMIT = 2_000

const CATEGORY_BY_REASON: Record<InternalTerminationReason, StepCategory> = {
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

export type InternalStepTermination = Readonly<{
	outcome: 'passed' | 'failed'
	reason: InternalTerminationReason
	actual?: string
	turns: number
}>

export class InternalStepEvidence {
	private readonly startedAt: number
	private readonly toolCalls: InternalStepToolCall[] = []
	private readonly transcript: TranscriptEntry[] = []
	private readonly diagnostics: Diagnostic[] = []

	constructor(
		private readonly step: StepIntent,
		private readonly driverId: string,
		private readonly redact: boolean,
		private readonly diagnosticSanitizer: DiagnosticSanitizer,
		private readonly now: () => number = Date.now
	) {
		this.startedAt = now()
	}

	recordAssistantMessage(turn: number, content: string): void {
		this.transcript.push({ turn, role: 'assistant', content: truncate(this.sanitize(content)) })
	}

	recordToolCall(turn: number, toolCall: ToolCall, toolResponse: ToolResponse): void {
		this.toolCalls.push({
			turn,
			driverId: isHarnessTool(toolCall.name) ? 'harness' : this.driverId,
			name: toolCall.name,
			arguments: this.sanitizeArguments(toolCall.arguments ?? {}),
			status: toolResponse.status === 'error' ? 'error' : 'ok',
		})
		this.transcript.push({
			turn,
			role: 'tool',
			content: truncate(this.sanitize(`${toolCall.name} -> ${toolResponse.response}`)),
		})
	}

	recordDiagnostic(diagnostic: Diagnostic): void {
		this.diagnostics.push({ ...diagnostic, message: this.diagnosticSanitizer.text(diagnostic.message) })
	}

	buildReport(termination: InternalStepTermination, usage: Usage): InternalStepReport {
		return {
			step: { ...this.step },
			outcome: termination.outcome,
			category: CATEGORY_BY_REASON[termination.reason],
			reason: termination.reason,
			...(termination.actual === undefined ? {} : { actual: this.sanitize(termination.actual) }),
			turns: termination.turns,
			durationMs: this.now() - this.startedAt,
			usage: { ...usage },
			toolCalls: this.toolCalls.map((call) => ({ ...call })),
			transcript: this.transcript.map((entry) => ({ ...entry })),
			diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		}
	}

	private sanitize(value: string): string {
		return this.redact ? scrub(value) : value
	}

	private sanitizeArguments(value: unknown): unknown {
		return this.redact ? scrubValue(value) : structuredClone(value)
	}
}

function isHarnessTool(name: string): boolean {
	return name === 'pass_test_step' || name === 'fail_test_step'
}

function truncate(value: string): string {
	return value.length <= TRANSCRIPT_CONTENT_LIMIT ? value : `${value.slice(0, TRANSCRIPT_CONTENT_LIMIT - 3)}...`
}
