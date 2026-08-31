import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { ToolExecution } from '../tools/types.js'

/**
 * A single natural-language test step executed by Checkmate.
 *
 * `name` is an optional label used for the Playwright step and attachment names.
 * `action` should describe what the agent needs to do.
 * `expect` should describe the expected result after the action finishes.
 * `search` can bias snapshot filtering toward specific keywords.
 * `topPercent` controls how much of the scored page snapshot is kept.
 *
 * @example
 * ```ts
 * const step: Step = {
 *   name: 'open pricing',
 *   action: "Open the pricing page and click the Pro plan",
 *   expect: "The checkout page for the Pro plan is displayed",
 *   topPercent: 15,
 * }
 * ```
 */
export interface Step {
	/**
	 * Optional short label for the step.
	 */
	name?: string

	/**
	 * What the agent should do in the browser.
	 */
	action: string

	/**
	 * What should be true after the action is complete.
	 */
	expect: string

	/**
	 * Optional keyword hints for snapshot filtering.
	 *
	 * When provided, these terms are prioritized over semantic `action + expect` matching.
	 */
	search?: string[]

	/**
	 * Optional percentage of the highest-scoring snapshot elements to keep.
	 *
	 * This value is expressed as a real percent from `1` to `100`.
	 * For example, `10` keeps the top 10% of scored elements.
	 *
	 * @example
	 * ```ts
	 * topPercent: 20
	 * ```
	 */
	topPercent?: number
}

/**
 * What the model asserted about the step.
 *
 * Checkmate reports what was asserted; deciding whether a failed assertion is a bug
 * or a legitimate change is the reader's job.
 *
 * @example
 * ```ts
 * const assertion: StepAssertion = {
 *   passed: true,
 *   actual: 'Checkout page is visible',
 * }
 * ```
 */
export interface StepAssertion {
	/**
	 * Whether the expectation was met.
	 */
	passed: boolean

	/**
	 * The observed result reported by the model.
	 */
	actual: string
}

/**
 * The specific event that ended a step.
 *
 * @example
 * ```ts
 * const reason: TerminationReason = 'failed-expectation'
 * ```
 */
export type TerminationReason =
	'met-expectation' | 'failed-expectation' | 'loop-detected' | 'tool-error' | 'provider-error' | 'budget-exceeded'

/**
 * Which layer produced the step outcome.
 *
 * `app` points at the product under test, `model` at the agent driving it, and
 * `infra` at Checkmate, its provider, or a configured ceiling.
 *
 * @example
 * ```ts
 * const category: StepCategory = 'app'
 * ```
 */
export type StepCategory = 'app' | 'model' | 'infra'

/**
 * Token and cost totals for one step.
 *
 * @example
 * ```ts
 * const usage: StepUsage = {
 *   promptTokens: 8_200,
 *   cachedPromptTokens: 6_000,
 *   completionTokens: 410,
 *   costUsd: 0.004,
 * }
 * ```
 */
export type StepUsage = {
	/**
	 * Prompt tokens reported by the provider, cached tokens included.
	 */
	promptTokens: number

	/**
	 * Prompt tokens the provider served from its cache.
	 */
	cachedPromptTokens: number

	/**
	 * Completion tokens reported by the provider.
	 */
	completionTokens: number

	/**
	 * Estimated cost of the step in USD.
	 */
	costUsd: number
}

/**
 * One tool call recorded while the step ran.
 *
 * @example
 * ```ts
 * const toolCall: StepToolCall = {
 *   turn: 3,
 *   name: 'browser_click_or_hover',
 *   arguments: { ref: 'e17' },
 *   status: 'ok',
 * }
 * ```
 */
export type StepToolCall = {
	/**
	 * Model turn the call was made on, starting at `1`.
	 */
	turn: number

	/**
	 * Tool name requested by the model.
	 */
	name: string

	/**
	 * Parsed tool arguments.
	 */
	arguments: unknown

	/**
	 * Whether the tool reported success.
	 */
	status: 'ok' | 'error'
}

/**
 * One entry of the human-readable step transcript.
 *
 * @example
 * ```ts
 * const entry: TranscriptEntry = {
 *   turn: 2,
 *   role: 'tool',
 *   content: 'browser_navigate -> Navigated to https://example.com',
 * }
 * ```
 */
export type TranscriptEntry = {
	/**
	 * Model turn the entry belongs to, starting at `1`.
	 */
	turn: number

	/**
	 * Who produced the entry.
	 */
	role: 'assistant' | 'tool'

	/**
	 * Entry text.
	 */
	content: string
}

/**
 * The versioned evidence contract produced by every step.
 *
 * `CheckmateRunner.run()` resolves one of these, and `@xoxoai/checkmate/playwright`
 * attaches it to the enclosing `test.step` before asserting on it.
 *
 * @example
 * ```ts
 * const report = await runner.run({ action: 'Open the pricing page', expect: 'Pricing is visible' })
 * if (report.outcome === 'failed' && report.category === 'app') {
 *   console.log(report.actual)
 * }
 * ```
 */
export type StepReport = {
	/**
	 * Schema version of this report.
	 */
	schemaVersion: 1

	/**
	 * Optional step label supplied by the author.
	 */
	name?: string

	/**
	 * The executed step action.
	 */
	action: string

	/**
	 * The executed step expectation.
	 */
	expect: string

	/**
	 * Whether the step passed.
	 */
	outcome: 'passed' | 'failed'

	/**
	 * Which layer produced the outcome.
	 */
	category: StepCategory

	/**
	 * The specific event that ended the step.
	 */
	reason: TerminationReason

	/**
	 * What the model observed, or the error that ended the step.
	 */
	actual?: string

	/**
	 * Set when an earlier attempt of the same step asserted differently.
	 */
	assertionUnstable?: true

	/**
	 * Number of model turns the step used.
	 */
	turns: number

	/**
	 * Wall-clock duration of the step in milliseconds.
	 */
	durationMs: number

	/**
	 * Token and cost totals for the step.
	 */
	usage: StepUsage

	/**
	 * Every tool call the model made during the step.
	 */
	toolCalls: StepToolCall[]

	/**
	 * Human-readable transcript of the step.
	 */
	transcript: TranscriptEntry[]
}

/**
 * A message an extension contributes to the model context.
 *
 * Mark page state such as snapshots and screenshots as `ephemeral` so it is replaced
 * before the next turn instead of accumulating.
 *
 * @example
 * ```ts
 * const context: ContextMessage = {
 *   message: { role: 'user', content: 'this is a current page snapshot:\n...' },
 *   ephemeral: true,
 * }
 * ```
 */
export type ContextMessage = {
	/**
	 * The message sent to the model.
	 */
	message: ChatCompletionMessageParam

	/**
	 * Whether the message is replaced before the next turn.
	 */
	ephemeral?: boolean
}

/**
 * What one model turn resolved to.
 *
 * @example
 * ```ts
 * const outcome: TurnOutcome = { kind: 'assertion', passed: false, actual: 'The total did not change' }
 * ```
 */
export type TurnOutcome =
	| { kind: 'continue'; toolResults: ToolExecution[]; messages: ChatCompletionMessageParam[] }
	| { kind: 'assertion'; passed: boolean; actual: string }
	| { kind: 'stuck'; reason: 'loop-detected' }
