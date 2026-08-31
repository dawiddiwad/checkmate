import {
	Fixtures,
	PlaywrightTestArgs,
	PlaywrightTestOptions,
	PlaywrightWorkerArgs,
	PlaywrightWorkerOptions,
	test as base,
} from '@playwright/test'
import { CHECKMATE_DEFAULTS, CheckmateOptions, ResolvedConfig, resolveConfig } from '../config/resolved-config.js'

/**
 * The option fixtures plus the single value they collapse into.
 *
 * @example
 * ```ts
 * test.use({ checkmateModel: 'gpt-5' })
 * ```
 */
export type CheckmateOptionFixtures = CheckmateOptions & {
	/**
	 * The `checkmate*` options resolved and validated for the current test.
	 */
	checkmateConfig: ResolvedConfig
}

/**
 * The fixture table `checkmate` declares.
 *
 * Each option is its own key with its own default, so Playwright can resolve it
 * independently: package default, then `projects[].use`, then `test.use()`.
 */
export const checkmateOptionFixtures: Fixtures<
	CheckmateOptionFixtures,
	object,
	PlaywrightTestArgs & PlaywrightTestOptions,
	PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = {
	checkmateModel: [CHECKMATE_DEFAULTS.checkmateModel, { option: true }],
	checkmateOpenaiBaseUrl: [CHECKMATE_DEFAULTS.checkmateOpenaiBaseUrl, { option: true }],
	checkmateReasoningEffort: [CHECKMATE_DEFAULTS.checkmateReasoningEffort, { option: true }],
	checkmateTemperature: [CHECKMATE_DEFAULTS.checkmateTemperature, { option: true }],
	checkmateTurnCap: [CHECKMATE_DEFAULTS.checkmateTurnCap, { option: true }],
	checkmateStepTimeout: [CHECKMATE_DEFAULTS.checkmateStepTimeout, { option: true }],
	checkmateBudgetUsd: [CHECKMATE_DEFAULTS.checkmateBudgetUsd, { option: true }],
	checkmateBudgetTokens: [CHECKMATE_DEFAULTS.checkmateBudgetTokens, { option: true }],
	checkmateSnapshotFilter: [CHECKMATE_DEFAULTS.checkmateSnapshotFilter, { option: true }],
	checkmateSnapshotTopPercent: [CHECKMATE_DEFAULTS.checkmateSnapshotTopPercent, { option: true }],
	checkmateEvidence: [CHECKMATE_DEFAULTS.checkmateEvidence, { option: true }],
	checkmateRedact: [CHECKMATE_DEFAULTS.checkmateRedact, { option: true }],
	checkmateScreenshots: [CHECKMATE_DEFAULTS.checkmateScreenshots, { option: true }],
	checkmateToolChoice: [CHECKMATE_DEFAULTS.checkmateToolChoice, { option: true }],
	checkmateAllowedTools: [CHECKMATE_DEFAULTS.checkmateAllowedTools, { option: true }],
	checkmateMaxRetries: [CHECKMATE_DEFAULTS.checkmateMaxRetries, { option: true }],
	checkmateRequestTimeout: [CHECKMATE_DEFAULTS.checkmateRequestTimeout, { option: true }],
	checkmateLoopMaxRepetitions: [CHECKMATE_DEFAULTS.checkmateLoopMaxRepetitions, { option: true }],
	checkmateRateLimitDelay: [CHECKMATE_DEFAULTS.checkmateRateLimitDelay, { option: true }],
	checkmateLogLevel: [CHECKMATE_DEFAULTS.checkmateLogLevel, { option: true }],

	checkmateConfig: async (
		{
			checkmateModel,
			checkmateOpenaiBaseUrl,
			checkmateReasoningEffort,
			checkmateTemperature,
			checkmateTurnCap,
			checkmateStepTimeout,
			checkmateBudgetUsd,
			checkmateBudgetTokens,
			checkmateSnapshotFilter,
			checkmateSnapshotTopPercent,
			checkmateEvidence,
			checkmateRedact,
			checkmateScreenshots,
			checkmateToolChoice,
			checkmateAllowedTools,
			checkmateMaxRetries,
			checkmateRequestTimeout,
			checkmateLoopMaxRepetitions,
			checkmateRateLimitDelay,
			checkmateLogLevel,
		},
		use
	) => {
		await use(
			resolveConfig({
				checkmateModel,
				checkmateOpenaiBaseUrl,
				checkmateReasoningEffort,
				checkmateTemperature,
				checkmateTurnCap,
				checkmateStepTimeout,
				checkmateBudgetUsd,
				checkmateBudgetTokens,
				checkmateSnapshotFilter,
				checkmateSnapshotTopPercent,
				checkmateEvidence,
				checkmateRedact,
				checkmateScreenshots,
				checkmateToolChoice,
				checkmateAllowedTools,
				checkmateMaxRetries,
				checkmateRequestTimeout,
				checkmateLoopMaxRepetitions,
				checkmateRateLimitDelay,
				checkmateLogLevel,
			})
		)
	},
}

/**
 * A Playwright test object that declares the `checkmate*` options.
 *
 * `checkmate` builds on this, so merging `checkmate` into a suite's own test object brings
 * the options with it.
 *
 * @example
 * ```ts
 * import { checkmateOptions } from '@xoxoai/checkmate/playwright'
 *
 * const test = checkmateOptions.extend({})
 * test.use({ checkmateModel: 'gpt-5' })
 * ```
 */
export const checkmateOptions = base.extend<CheckmateOptionFixtures>(checkmateOptionFixtures)
