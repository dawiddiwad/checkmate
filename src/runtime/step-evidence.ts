import { ChatCompletion } from 'openai/resources/chat/completions'
import { TokenPricing } from '../ai/token-pricing.js'
import { scrub, scrubValue } from '../redaction/scrub.js'
import { ToolCall, ToolResponse } from '../tools/types.js'
import { dedent } from './text.js'
import {
	Step,
	StepCategory,
	StepReport,
	StepSnapshot,
	StepToolCall,
	TerminationReason,
	TranscriptEntry,
} from './types.js'

const TRANSCRIPT_CONTENT_LIMIT = 2_000

const CATEGORY_BY_REASON: Record<TerminationReason, StepCategory> = {
	'met-expectation': 'app',
	'failed-expectation': 'app',
	'loop-detected': 'model',
	'turn-cap-exceeded': 'model',
	'step-timeout': 'model',
	'test-budget-exhausted': 'infra',
	'tool-error': 'infra',
	'provider-error': 'infra',
	'budget-exceeded': 'infra',
}

export type StepTermination = {
	outcome: 'passed' | 'failed'
	reason: TerminationReason
	actual?: string
	turns: number
}

export type StepEvidenceDependencies = {
	step: Step
	model: string
	/**
	 * Whether captured evidence is scrubbed before it is retained.
	 *
	 * Defaults to `true`. Scrubbing happens here, at the point the loop records evidence, so a
	 * secret the model typed into the page never reaches `StepReport` at all.
	 */
	redact?: boolean
	now?: () => number
}

export class StepEvidence {
	private readonly step: Step
	private readonly model: string
	private readonly redact: boolean
	private readonly now: () => number
	private readonly startedAt: number
	private readonly toolCalls: StepToolCall[] = []
	private readonly transcript: TranscriptEntry[] = []
	private readonly snapshots: StepSnapshot[] = []
	private promptTokens = 0
	private cachedPromptTokens = 0
	private completionTokens = 0

	constructor({ step, model, redact = true, now = Date.now }: StepEvidenceDependencies) {
		this.step = step
		this.model = model
		this.redact = redact
		this.now = now
		this.startedAt = now()
	}

	recordUsage(usage: ChatCompletion['usage']): void {
		if (!usage) {
			return
		}

		const promptTokens = usage.prompt_tokens ?? 0
		this.promptTokens += promptTokens
		this.cachedPromptTokens += Math.min(usage.prompt_tokens_details?.cached_tokens ?? 0, promptTokens)
		this.completionTokens += usage.completion_tokens ?? 0
	}

	recordAssistantMessage(turn: number, content: string): void {
		this.transcript.push({ turn, role: 'assistant', content: truncate(this.sanitize(content)) })
	}

	recordToolCall(turn: number, toolCall: ToolCall, toolResponse: ToolResponse): void {
		const status = toolResponse.status === 'error' ? 'error' : 'ok'
		this.toolCalls.push({
			turn,
			name: toolCall.name,
			arguments: this.sanitizeArguments(toolCall.arguments ?? {}),
			status,
		})
		this.transcript.push({
			turn,
			role: 'tool',
			content: truncate(this.sanitize(`${toolCall.name} -> ${toolResponse.response}`)),
		})

		if (toolResponse.snapshot) {
			this.snapshots.push({ turn, content: this.sanitize(toolResponse.snapshot) })
		}
	}

	buildReport(termination: StepTermination): StepReport {
		return {
			schemaVersion: 1,
			...(this.step.name ? { name: this.step.name } : {}),
			action: dedent(this.step.action),
			expect: dedent(this.step.expect),
			outcome: termination.outcome,
			category: CATEGORY_BY_REASON[termination.reason],
			reason: termination.reason,
			...(termination.actual === undefined ? {} : { actual: this.sanitize(termination.actual) }),
			turns: termination.turns,
			durationMs: this.now() - this.startedAt,
			usage: {
				promptTokens: this.promptTokens,
				cachedPromptTokens: this.cachedPromptTokens,
				completionTokens: this.completionTokens,
				costUsd: TokenPricing.totalPriceUSD(
					this.model,
					this.promptTokens,
					this.completionTokens,
					this.cachedPromptTokens
				),
			},
			toolCalls: [...this.toolCalls],
			transcript: [...this.transcript],
			...(this.snapshots.length > 0 ? { snapshots: [...this.snapshots] } : {}),
		}
	}

	private sanitize(value: string): string {
		return this.redact ? scrub(value) : value
	}

	private sanitizeArguments(value: unknown): unknown {
		return this.redact ? scrubValue(value) : value
	}
}

function truncate(value: string): string {
	if (value.length <= TRANSCRIPT_CONTENT_LIMIT) {
		return value
	}

	return `${value.slice(0, TRANSCRIPT_CONTENT_LIMIT - 3)}...`
}
