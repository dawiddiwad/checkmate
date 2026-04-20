/**
 * A single natural-language test step executed by Checkmate.
 *
 * `action` should describe what the agent needs to do.
 * `expect` should describe the expected result after the action finishes.
 * `search` can bias snapshot filtering toward specific keywords.
 * `topPercent` controls how much of the scored page snapshot is kept.
 *
 * @example
 * ```ts
 * const step: Step = {
 *   action: "Open the pricing page and click the Pro plan",
 *   expect: "The checkout page for the Pro plan is displayed",
 *   topPercent: 15,
 * }
 * ```
 */
export interface Step {
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
 * Final result returned by a step execution.
 *
 * @example
 * ```ts
 * const result: StepResult = {
 *   passed: true,
 *   actual: 'Checkout page is visible',
 * }
 * ```
 */
export interface StepResult {
	/**
	 * Whether the step passed.
	 */
	passed: boolean

	/**
	 * The observed result collected during execution.
	 */
	actual: string
}

export type StepResultPromise = Promise<StepResult>

/**
 * Callback used internally to resolve a running step result.
 *
 * @example
 * ```ts
 * const resolve: ResolveStepResult = (result) => {
 *   console.log(result.actual)
 * }
 * ```
 */
export type ResolveStepResult = (result: StepResult) => void
