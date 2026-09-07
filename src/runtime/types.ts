import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Diagnostic, Usage } from '../contracts/types.js'
import type { StepIntent } from '../driver.js'
import type { ToolExecution } from '../tools/types.js'

export type Step = Pick<StepIntent, 'action' | 'expect'>

export type StepAssertion = { passed: boolean; actual: string }

export type InternalTerminationReason =
	| 'met-expectation'
	| 'failed-expectation'
	| 'loop-detected'
	| 'turn-cap-exceeded'
	| 'step-timeout'
	| 'scenario-timeout'
	| 'tool-error'
	| 'provider-error'
	| 'token-budget-exceeded'
	| 'interrupted'
	| 'internal-error'

export type InternalStepToolCall = {
	turn: number
	driverId: string
	name: string
	arguments: unknown
	status: 'ok' | 'error'
}

export type InternalStepReport = {
	step: StepIntent
	outcome: 'passed' | 'failed'
	category: StepCategory
	reason: InternalTerminationReason
	actual?: string
	turns: number
	durationMs: number
	usage: Usage
	toolCalls: InternalStepToolCall[]
	transcript: TranscriptEntry[]
	diagnostics: Diagnostic[]
}

export type StepCategory = 'app' | 'model' | 'infra'

export type TranscriptEntry = { turn: number; role: 'assistant' | 'tool'; content: string }

export type ContextMessage = { message: ChatCompletionMessageParam; ephemeral?: boolean }

export type TurnOutcome =
	| { kind: 'continue'; toolResults: ToolExecution[]; messages: ChatCompletionMessageParam[] }
	| { kind: 'assertion'; passed: boolean; actual: string }
	| { kind: 'stuck'; reason: 'loop-detected' }
