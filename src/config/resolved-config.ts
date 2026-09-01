import { LogLevel } from '../logging/logger.js'

/**
 * Provider reasoning effort, for models that support extended thinking.
 *
 * @example
 * ```ts
 * const effort: ReasoningEffort = 'low'
 * ```
 */
export type ReasoningEffort = 'low' | 'medium' | 'high'

/**
 * How the provider is told to pick tools.
 *
 * @example
 * ```ts
 * const toolChoice: ToolChoice = 'required'
 * ```
 */
export type ToolChoice = 'auto' | 'required' | 'none'

/**
 * How much evidence a step retains.
 *
 * `checkmate-step.json` attaches at every level, including `'off'`; this option decides
 * how much of the heavy material (transcript, per-turn snapshots, screenshots) joins it.
 *
 * @example
 * ```ts
 * const evidence: EvidenceLevel = 'retain-on-failure'
 * ```
 */
export type EvidenceLevel = 'on' | 'retain-on-failure' | 'off'

/**
 * The `checkmate*` Playwright options that configure a run.
 *
 * The keys are flat rather than one nested object because Playwright resolves options
 * one fixture key at a time and never deep-merges — a nested option would make a
 * per-test `test.use()` silently discard the project's other settings.
 *
 * @example
 * ```ts
 * // playwright.config.ts
 * export default defineConfig<CheckmateOptions>({
 *   projects: [
 *     { name: 'smoke', use: { checkmateModel: 'gpt-5-mini', checkmateTurnCap: 15 } },
 *     { name: 'unstable-areas', use: { checkmateModel: 'gpt-5', checkmateBudgetUsd: 2 } },
 *   ],
 * })
 * ```
 */
export type CheckmateOptions = {
	/**
	 * Which model runs the step.
	 *
	 * Defaults to `'gpt-5-mini'`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * // playwright.config.ts
	 * use: { checkmateModel: 'gpt-5-mini' }
	 * ```
	 *
	 * **Details**
	 *
	 * Any model your endpoint serves, named exactly as the provider names it. Set per project
	 * to run a cheap model over smoke flows and a stronger one where steps are hard. Cost in
	 * `checkmate-step.json` is priced from this name, so an unrecognised model reports `0`.
	 *
	 * @see {@link https://github.com/dawiddiwad/checkmate/blob/main/docs/GUIDE.md#configuration}
	 */
	checkmateModel: string

	/**
	 * Base URL of the OpenAI-compatible endpoint the model runs on.
	 *
	 * Defaults to `undefined`, which uses the provider's own default endpoint.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateOpenaiBaseUrl: 'https://openrouter.ai/api/v1' }
	 * ```
	 *
	 * **Details**
	 *
	 * Set this to point `checkmateModel` at a local runtime, a gateway, or any other endpoint
	 * that speaks the OpenAI Chat Completions API. The key still comes from
	 * `CHECKMATE_OPENAI_API_KEY` in the environment, because a config file is checked in and a
	 * key is not.
	 */
	checkmateOpenaiBaseUrl: string | undefined

	/**
	 * Provider reasoning effort, when the model supports it.
	 *
	 * Defaults to `undefined`, which leaves the provider's own default in place.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateReasoningEffort: 'low' }
	 * ```
	 *
	 * **Details**
	 *
	 * Sent only when set. Models that do not accept the parameter reject the request, so leave
	 * it unset unless the model documents support for it.
	 */
	checkmateReasoningEffort: ReasoningEffort | undefined

	/**
	 * Sampling temperature sent with every request.
	 *
	 * Defaults to `0`, so a rerun differs as little as the model allows.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateTemperature: 0.7 }
	 * ```
	 *
	 * **Details**
	 *
	 * Some models — OpenAI's `gpt-5` family and its reasoning models among them — accept only
	 * their own default and answer any other value with a 400. `AiClient` detects that response,
	 * drops the parameter, and continues on the provider default for the rest of the run, so
	 * setting this has no effect against those models.
	 */
	checkmateTemperature: number

	/**
	 * Model turns before the step is terminated.
	 *
	 * Defaults to `20`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateTurnCap: 15 }
	 * ```
	 *
	 * **Details**
	 *
	 * One turn is one provider request and the tool calls it asks for. Hitting the cap ends the
	 * step as `model` / `turn-cap-exceeded` with its evidence attached — unlike Playwright's own
	 * timeout, which aborts the worker before anything can be written.
	 */
	checkmateTurnCap: number

	/**
	 * Wall-clock budget for one step, in milliseconds.
	 *
	 * Defaults to `120_000`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateStepTimeout: 90_000 }
	 * ```
	 *
	 * **Details**
	 *
	 * Clamped to the time the test itself has left, so Checkmate stops first and the step ends
	 * as `model` / `step-timeout` — or `infra` / `test-budget-exhausted` when the enclosing test
	 * is what ran out — rather than as an opaque Playwright timeout that attaches nothing.
	 */
	checkmateStepTimeout: number

	/**
	 * USD ceiling for one test.
	 *
	 * Defaults to `undefined`, which is no ceiling.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateBudgetUsd: 2 }
	 * ```
	 *
	 * **Details**
	 *
	 * Checked as usage accrues, so the ceiling is crossed rather than pre-empted: the turn that
	 * passes it is the last one, and the step ends as `infra` / `budget-exceeded`.
	 */
	checkmateBudgetUsd: number | undefined

	/**
	 * Token ceiling for one test.
	 *
	 * Defaults to `undefined`, which is no ceiling.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateBudgetTokens: 300_000 }
	 * ```
	 *
	 * **Details**
	 *
	 * The same guard as `checkmateBudgetUsd`, for endpoints that meter tokens rather than money.
	 * Both may be set; whichever is reached first ends the step.
	 */
	checkmateBudgetTokens: number | undefined

	/**
	 * Whether semantic ARIA snapshot filtering is applied.
	 *
	 * Defaults to `false`, which sends the whole snapshot.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateSnapshotFilter: true, checkmateSnapshotTopPercent: 10 }
	 * ```
	 *
	 * **Details**
	 *
	 * Scores snapshot nodes against the step's text and keeps the highest-ranked fraction, which
	 * cuts prompt cost on large pages at the risk of pruning the element the step needed.
	 */
	checkmateSnapshotFilter: boolean

	/**
	 * How much of the scored snapshot is kept when filtering, as a percent from `1` to `100`.
	 *
	 * Defaults to `10`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateSnapshotTopPercent: 25 }
	 * ```
	 *
	 * **Details**
	 *
	 * Ignored unless `checkmateSnapshotFilter` is on. Raise it when a step fails because the
	 * element it needed was pruned.
	 */
	checkmateSnapshotTopPercent: number

	/**
	 * How much evidence attaches per step.
	 *
	 * Defaults to `'retain-on-failure'`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateEvidence: 'on' }
	 * ```
	 *
	 * **Details**
	 *
	 * `'on'` keeps the transcript and per-turn snapshots for every step, `'retain-on-failure'`
	 * only for failures, `'off'` neither. `checkmate-step.json` attaches at every level: with a
	 * model-owned assertion the dangerous failure is a false pass, and the summary is what makes
	 * one detectable afterwards.
	 */
	checkmateEvidence: EvidenceLevel

	/**
	 * Whether captured evidence is scrubbed.
	 *
	 * Defaults to `true`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateRedact: false }
	 * ```
	 *
	 * **Details**
	 *
	 * Scrubbing happens where the loop records evidence, so a secret the model typed into the
	 * page never reaches the report object at all. Turning it off makes a transcript easier to
	 * read and is a local-only escape hatch — CI publishes the report directory.
	 */
	checkmateRedact: boolean

	/**
	 * Whether a compressed screenshot of the active page joins each snapshot.
	 *
	 * Defaults to `false`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateScreenshots: true }
	 * ```
	 *
	 * **Details**
	 *
	 * Needs a vision-capable model, and raises prompt cost on every turn. The ARIA snapshot is
	 * usually enough; reach for this when a step depends on something only rendering shows.
	 */
	checkmateScreenshots: boolean

	/**
	 * How the provider is told to pick tools.
	 *
	 * Defaults to `'required'`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateToolChoice: 'auto' }
	 * ```
	 *
	 * **Details**
	 *
	 * `'required'` keeps the model acting rather than narrating, which is what a step needs.
	 * `'auto'` lets it answer in prose and is mostly useful when debugging a model that will not
	 * call the tool you expect.
	 */
	checkmateToolChoice: ToolChoice

	/**
	 * Tool names the model may call.
	 *
	 * Defaults to `[]`, which allows every registered tool.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateAllowedTools: ['browser_snapshot', 'browser_click', 'step_passed', 'step_failed'] }
	 * ```
	 *
	 * **Details**
	 *
	 * An allow-list, so a tool absent from a non-empty list is never offered. Omitting the result
	 * tools leaves the model no way to end a step, which the turn cap will then stop.
	 */
	checkmateAllowedTools: string[]

	/**
	 * Provider retries after the initial request, for rate limits and server errors.
	 *
	 * Defaults to `3`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateMaxRetries: 5 }
	 * ```
	 *
	 * **Details**
	 *
	 * Applies to `408`, `409`, `429` and `5xx`, with exponential backoff that honours
	 * `retry-after`. A `4xx` that is not retryable fails the step as `infra` / `provider-error`.
	 */
	checkmateMaxRetries: number

	/**
	 * Timeout for one provider request, in milliseconds.
	 *
	 * Defaults to `60_000`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateRequestTimeout: 30_000 }
	 * ```
	 *
	 * **Details**
	 *
	 * Per request, not per step — a step is bounded by `checkmateStepTimeout` and
	 * `checkmateTurnCap`. Reasoning models on a hard page can legitimately exceed 30 seconds.
	 */
	checkmateRequestTimeout: number

	/**
	 * Repeated tool-call patterns tolerated before the step is reported as stuck.
	 *
	 * Defaults to `5`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateLoopMaxRepetitions: 3 }
	 * ```
	 *
	 * **Details**
	 *
	 * Counts identical call-and-argument patterns within one step; the history does not carry
	 * across steps. Tripping it ends the step as `model` / `loop-detected`.
	 */
	checkmateLoopMaxRepetitions: number

	/**
	 * Fixed delay before each provider request, in milliseconds.
	 *
	 * Defaults to `0`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateRateLimitDelay: 500 }
	 * ```
	 *
	 * **Details**
	 *
	 * A blunt throttle for endpoints with a low requests-per-minute allowance. It slows every
	 * turn, so prefer raising `checkmateMaxRetries` unless the provider rate-limits hard.
	 */
	checkmateRateLimitDelay: number

	/**
	 * Console logging verbosity.
	 *
	 * Defaults to `'off'`.
	 *
	 * **Usage**
	 *
	 * ```ts
	 * use: { checkmateLogLevel: 'debug' }
	 * ```
	 *
	 * **Details**
	 *
	 * Console output only — what a run retains is governed by `checkmateEvidence`. `'debug'`
	 * prints prompts and tool responses, scrubbed the same way attachments are.
	 */
	checkmateLogLevel: LogLevel
}

/**
 * The package defaults every option falls back to.
 *
 * @example
 * ```ts
 * CHECKMATE_DEFAULTS.checkmateModel // 'gpt-5-mini'
 * ```
 */
export const CHECKMATE_DEFAULTS: CheckmateOptions = {
	checkmateModel: 'gpt-5-mini',
	checkmateOpenaiBaseUrl: undefined,
	checkmateReasoningEffort: undefined,
	checkmateTemperature: 0,
	checkmateTurnCap: 20,
	checkmateStepTimeout: 120_000,
	checkmateBudgetUsd: undefined,
	checkmateBudgetTokens: undefined,
	checkmateSnapshotFilter: false,
	checkmateSnapshotTopPercent: 10,
	checkmateEvidence: 'retain-on-failure',
	checkmateRedact: true,
	checkmateScreenshots: false,
	checkmateToolChoice: 'required',
	checkmateAllowedTools: [],
	checkmateMaxRetries: 3,
	checkmateRequestTimeout: 60_000,
	checkmateLoopMaxRepetitions: 5,
	checkmateRateLimitDelay: 0,
	checkmateLogLevel: 'off',
}

/**
 * The validated runtime values a runner and its collaborators read.
 *
 * This is what `checkmate*` options collapse into. It holds no secrets: the API key stays
 * in the environment, because a config file is checked in and a key is not.
 *
 * @example
 * ```ts
 * const config = resolveConfig({ checkmateModel: 'gpt-5', checkmateTurnCap: 30 })
 * console.log(config.model, config.turnCap)
 * ```
 */
export type ResolvedConfig = {
	/**
	 * Which model runs the step.
	 */
	readonly model: string

	/**
	 * Base URL of the OpenAI-compatible endpoint the model runs on. Unset uses the provider's
	 * own default endpoint.
	 */
	readonly baseUrl?: string

	/**
	 * Provider reasoning effort, when the model supports it.
	 */
	readonly reasoningEffort?: ReasoningEffort

	/**
	 * Model turns before the step is terminated.
	 */
	readonly turnCap: number

	/**
	 * Wall-clock budget for one step, in milliseconds.
	 */
	readonly stepTimeout: number

	/**
	 * USD ceiling for one test.
	 */
	readonly budgetUsd?: number

	/**
	 * Token ceiling for one test.
	 */
	readonly budgetTokens?: number

	/**
	 * Whether semantic ARIA snapshot filtering is applied.
	 */
	readonly snapshotFilter: boolean

	/**
	 * How much of the scored snapshot is kept when filtering.
	 */
	readonly snapshotTopPercent: number

	/**
	 * How much evidence attaches per step.
	 */
	readonly evidence: EvidenceLevel

	/**
	 * Whether captured evidence is scrubbed.
	 */
	readonly redact: boolean

	/**
	 * Whether a compressed screenshot joins each snapshot.
	 */
	readonly screenshots: boolean

	/**
	 * How the provider is told to pick tools.
	 */
	readonly toolChoice: ToolChoice

	/**
	 * Tool names the model may call. Empty means every registered tool.
	 */
	readonly allowedTools: readonly string[]

	/**
	 * Provider retries after the initial request.
	 */
	readonly maxRetries: number

	/**
	 * Timeout for one provider request, in milliseconds.
	 */
	readonly requestTimeout: number

	/**
	 * Repeated tool-call patterns tolerated before the step is reported as stuck.
	 */
	readonly loopMaxRepetitions: number

	/**
	 * Fixed delay before each provider request, in milliseconds.
	 */
	readonly rateLimitDelay: number

	/**
	 * Console logging verbosity.
	 */
	readonly logLevel: LogLevel

	/**
	 * Sampling temperature sent with every request.
	 *
	 * Sent on every request, except against a model that rejects it: `AiClient` drops the
	 * parameter after a 400 naming `temperature` and continues on the provider default.
	 */
	readonly temperature: number
}

/**
 * A `checkmate*` option that could not be used as written.
 *
 * @example
 * ```ts
 * try {
 *   resolveConfig({ checkmateTurnCap: 0 })
 * } catch (error) {
 *   console.log(error instanceof CheckmateConfigError)
 * }
 * ```
 */
export class CheckmateConfigError extends Error {
	constructor(problems: string[]) {
		super(['Invalid Checkmate configuration:', ...problems.map((problem) => `  ✗ ${problem}`)].join('\n'))
		this.name = 'CheckmateConfigError'
	}
}

/**
 * Collapses `checkmate*` options onto the package defaults and validates the result.
 *
 * @param overrides - Option values from `playwright.config.ts`, `test.use()`, or a script.
 *
 * @example
 * ```ts
 * const config = resolveConfig({ checkmateModel: 'gpt-4.1-mini', checkmateBudgetUsd: 0.5 })
 * ```
 */
export function resolveConfig(overrides: Partial<CheckmateOptions> = {}): ResolvedConfig {
	const options = pick(overrides)
	const problems = validate(options)
	if (problems.length > 0) {
		throw new CheckmateConfigError(problems)
	}

	return {
		model: options.checkmateModel,
		baseUrl: options.checkmateOpenaiBaseUrl,
		reasoningEffort: options.checkmateReasoningEffort,
		turnCap: options.checkmateTurnCap,
		stepTimeout: options.checkmateStepTimeout,
		budgetUsd: options.checkmateBudgetUsd,
		budgetTokens: options.checkmateBudgetTokens,
		snapshotFilter: options.checkmateSnapshotFilter,
		snapshotTopPercent: options.checkmateSnapshotTopPercent,
		evidence: options.checkmateEvidence,
		redact: options.checkmateRedact,
		screenshots: options.checkmateScreenshots,
		toolChoice: options.checkmateToolChoice,
		allowedTools: [...options.checkmateAllowedTools],
		maxRetries: options.checkmateMaxRetries,
		requestTimeout: options.checkmateRequestTimeout,
		loopMaxRepetitions: options.checkmateLoopMaxRepetitions,
		rateLimitDelay: options.checkmateRateLimitDelay,
		logLevel: options.checkmateLogLevel,
		temperature: options.checkmateTemperature,
	}
}

/**
 * Reads the provider API key from the environment.
 *
 * The key stays in the environment rather than becoming an option, because a config file is
 * checked in and an API key is not.
 *
 * @example
 * ```ts
 * const apiKey = readApiKey()
 * ```
 */
export function readApiKey(): string {
	const apiKey = process.env.CHECKMATE_OPENAI_API_KEY
	if (!apiKey) {
		throw new Error('CHECKMATE_OPENAI_API_KEY environment variable is not set')
	}

	return apiKey
}

function pick(overrides: Partial<CheckmateOptions>): CheckmateOptions {
	const options = { ...CHECKMATE_DEFAULTS }

	for (const key of Object.keys(CHECKMATE_DEFAULTS) as (keyof CheckmateOptions)[]) {
		const override = overrides[key]
		if (override !== undefined) {
			Object.assign(options, { [key]: override })
		}
	}

	return options
}

function validate(options: CheckmateOptions): string[] {
	const problems: string[] = []

	if (options.checkmateModel.trim().length === 0) {
		problems.push('checkmateModel must be a non-empty model name')
	}

	if (options.checkmateOpenaiBaseUrl !== undefined) {
		if (options.checkmateOpenaiBaseUrl.trim().length === 0) {
			problems.push('checkmateOpenaiBaseUrl must be a non-empty URL, or unset to use the provider default')
		} else if (!isValidUrl(options.checkmateOpenaiBaseUrl)) {
			problems.push(
				`checkmateOpenaiBaseUrl must be a valid URL, received ${JSON.stringify(options.checkmateOpenaiBaseUrl)}`
			)
		}
	}

	requireNumber(problems, 'checkmateTemperature', options.checkmateTemperature, 0)

	requireEnum(problems, 'checkmateReasoningEffort', options.checkmateReasoningEffort, [
		'low',
		'medium',
		'high',
		undefined,
	])
	requireEnum(problems, 'checkmateToolChoice', options.checkmateToolChoice, ['auto', 'required', 'none'])
	requireEnum(problems, 'checkmateEvidence', options.checkmateEvidence, ['on', 'retain-on-failure', 'off'])
	requireEnum(problems, 'checkmateLogLevel', options.checkmateLogLevel, ['debug', 'info', 'warn', 'error', 'off'])

	requireInteger(problems, 'checkmateTurnCap', options.checkmateTurnCap, 1)
	requireInteger(problems, 'checkmateLoopMaxRepetitions', options.checkmateLoopMaxRepetitions, 1)
	requireInteger(problems, 'checkmateMaxRetries', options.checkmateMaxRetries, 0)
	requireNumber(problems, 'checkmateStepTimeout', options.checkmateStepTimeout, 1)
	requireNumber(problems, 'checkmateRequestTimeout', options.checkmateRequestTimeout, 1)
	requireNumber(problems, 'checkmateRateLimitDelay', options.checkmateRateLimitDelay, 0)

	const budgetUsd = options.checkmateBudgetUsd
	if (budgetUsd !== undefined && (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0)) {
		problems.push(`checkmateBudgetUsd must be a positive amount of USD, received ${JSON.stringify(budgetUsd)}`)
	}

	if (options.checkmateBudgetTokens !== undefined) {
		requireInteger(problems, 'checkmateBudgetTokens', options.checkmateBudgetTokens, 1)
	}

	const topPercent = options.checkmateSnapshotTopPercent
	if (!Number.isFinite(topPercent) || topPercent <= 0 || topPercent > 100) {
		problems.push(`checkmateSnapshotTopPercent must be a percent between 1 and 100, received ${topPercent}`)
	}

	if (!Array.isArray(options.checkmateAllowedTools)) {
		problems.push('checkmateAllowedTools must be an array of tool names')
	}

	return problems
}

function requireEnum(problems: string[], name: string, value: unknown, allowed: unknown[]): void {
	if (!allowed.includes(value)) {
		const rendered = allowed.map((option) => (option === undefined ? 'unset' : `'${String(option)}'`)).join(', ')
		problems.push(`${name} must be one of ${rendered}, received ${JSON.stringify(value)}`)
	}
}

function requireNumber(problems: string[], name: string, value: number, minimum: number): void {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
		problems.push(`${name} must be a number of at least ${minimum}, received ${JSON.stringify(value)}`)
	}
}

function requireInteger(problems: string[], name: string, value: number, minimum: number): void {
	if (!Number.isInteger(value) || value < minimum) {
		problems.push(`${name} must be an integer of at least ${minimum}, received ${JSON.stringify(value)}`)
	}
}

function isValidUrl(value: string): boolean {
	try {
		new URL(value)
		return true
	} catch {
		return false
	}
}
