/**
 * Browser-specific step hints.
 */
export interface BrowserStepHints {
	/**
	 * Optional keyword override used by browser snapshot filtering.
	 */
	search?: string[]

	/**
	 * Optional percentage of the highest-scoring browser snapshot elements to keep.
	 */
	topPercent?: number
}

/**
 * Optional step hints grouped by service.
 */
export interface StepHints {
	/** Hints for the built-in browser service. */
	browser?: BrowserStepHints
}

/**
 * A single natural-language test step executed by Checkmate.
 *
 * `action` should describe what the agent needs to do.
 * `expect` should describe the expected result after the action finishes.
 * `hints.browser.search` can bias snapshot filtering toward specific keywords.
 * `hints.browser.topPercent` controls how much of the scored page snapshot is kept.
 *
 * @example
 * ```ts
 * const step: Step = {
 *   action: "Open the pricing page and click the Pro plan",
 *   expect: "The checkout page for the Pro plan is displayed",
 *   hints: {
 *     browser: {
 *       topPercent: 15,
 *     },
 *   },
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
	 * Optional service-specific hints.
	 */
	hints?: StepHints

	/**
	 * Optional keyword hints for browser snapshot filtering.
	 *
	 * @deprecated Use `hints.browser.search`.
	 * When provided, these terms are prioritized over semantic `action + expect` matching.
	 */
	search?: string[]

	/**
	 * Optional percentage of the highest-scoring browser snapshot elements to keep.
	 *
	 * @deprecated Use `hints.browser.topPercent`.
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
 */
export type ResolveStepResult = (result: StepResult) => void

/**
 * Resolve normalized browser hints for a step.
 *
 * This helper keeps backward compatibility with legacy top-level `search`
 * and `topPercent` fields while the public API moves to `hints.browser`.
 *
 * @param step - Step definition to inspect.
 * @returns Resolved browser step hints.
 */
export function getBrowserStepHints(step: Step): BrowserStepHints {
	return {
		search: step.hints?.browser?.search ?? step.search,
		topPercent: step.hints?.browser?.topPercent ?? step.topPercent,
	}
}
