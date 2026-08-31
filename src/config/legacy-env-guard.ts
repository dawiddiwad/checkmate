/**
 * The escape hatch that suppresses the removed-variable check.
 *
 * @example
 * ```bash
 * CHECKMATE_ALLOW_LEGACY_ENV=1 npx playwright test
 * ```
 */
export const ALLOW_LEGACY_ENV = 'CHECKMATE_ALLOW_LEGACY_ENV'

/**
 * The release that removed environment-variable configuration.
 */
const REMOVED_IN = '0.5.0'

type LegacyVariable = {
	name: string
	replacement: (value: string) => string
}

/**
 * Every environment variable removed in 0.5.0, and what replaced it.
 *
 * `CHECKMATE_OPENAI_API_KEY` is absent on purpose: it is a secret, and stays in the
 * environment because a config file is checked in and a key is not.
 *
 * @example
 * ```ts
 * LEGACY_ENV_VARIABLES.map((variable) => variable.name)
 * ```
 */
export const LEGACY_ENV_VARIABLES: readonly LegacyVariable[] = [
	{ name: 'OPENAI_MODEL', replacement: (value) => option('checkmateModel', quote(value)) },
	{ name: 'OPENAI_BASE_URL', replacement: (value) => option('checkmateOpenaiBaseUrl', quote(value)) },
	{ name: 'OPENAI_TEMPERATURE', replacement: (value) => option('checkmateTemperature', value) },
	{ name: 'OPENAI_REASONING_EFFORT', replacement: (value) => option('checkmateReasoningEffort', quote(value)) },
	{ name: 'OPENAI_TOOL_CHOICE', replacement: (value) => option('checkmateToolChoice', quote(value)) },
	{ name: 'CHECKMATE_LOG_LEVEL', replacement: (value) => option('checkmateLogLevel', quote(value)) },
	{ name: 'OPENAI_RETRY_MAX_ATTEMPTS', replacement: (value) => option('checkmateMaxRetries', value) },
	{ name: 'OPENAI_LOOP_MAX_REPETITIONS', replacement: (value) => option('checkmateLoopMaxRepetitions', value) },
	{ name: 'OPENAI_API_TOKEN_BUDGET_USD', replacement: (value) => option('checkmateBudgetUsd', value) },
	{ name: 'OPENAI_API_TOKEN_BUDGET_COUNT', replacement: (value) => option('checkmateBudgetTokens', value) },
	{
		name: 'OPENAI_TIMEOUT_SECONDS',
		replacement: (value) => option('checkmateRequestTimeout', milliseconds(value)),
	},
	{
		name: 'OPENAI_API_RATE_LIMIT_DELAY_SECONDS',
		replacement: (value) => option('checkmateRateLimitDelay', milliseconds(value)),
	},
	{
		name: 'OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT',
		replacement: (value) => option('checkmateScreenshots', boolean(value)),
	},
	{
		name: 'CHECKMATE_SNAPSHOT_FILTERING',
		replacement: (value) => option('checkmateSnapshotFilter', boolean(value)),
	},
	{
		name: 'OPENAI_ALLOWED_TOOLS',
		replacement: (value) => option('checkmateAllowedTools', toolList(value)),
	},
	{
		name: 'OPENAI_API_KEY',
		replacement: () => renamedEnv('CHECKMATE_OPENAI_API_KEY'),
	},
]

/**
 * A removed environment variable is still set in the current process.
 *
 * @example
 * ```ts
 * try {
 *   assertNoLegacyEnv()
 * } catch (error) {
 *   console.log(error instanceof LegacyEnvironmentError)
 * }
 * ```
 */
export class LegacyEnvironmentError extends Error {
	/**
	 * Names of the removed variables that were set.
	 */
	readonly variables: string[]

	constructor(variables: string[], message: string) {
		super(message)
		this.name = 'LegacyEnvironmentError'
		this.variables = variables
	}
}

/**
 * Fails when a variable removed in 0.5.0 is still set.
 *
 * The hazard this exists for is the quiet break: a team's `OPENAI_MODEL=gpt-4.1-mini`
 * stops applying and the first they hear of it is the invoice. So a stale variable is an
 * error at startup rather than something silently ignored.
 *
 * @param env - Environment to inspect. Defaults to `process.env`.
 *
 * @example
 * ```ts
 * assertNoLegacyEnv({ OPENAI_MODEL: 'gpt-4.1-mini' })
 * // ✗ OPENAI_MODEL is set but no longer read (removed in 0.5.0).
 * //   Move it to playwright.config.ts:  use: { checkmateModel: 'gpt-4.1-mini' }
 * //   Set CHECKMATE_ALLOW_LEGACY_ENV=1 to suppress this check.
 * ```
 */
export function assertNoLegacyEnv(env: NodeJS.ProcessEnv = process.env): void {
	if (env[ALLOW_LEGACY_ENV]) {
		return
	}

	const stale = LEGACY_ENV_VARIABLES.filter((variable) => isSet(env[variable.name]))
	if (stale.length === 0) {
		return
	}

	const lines = stale.flatMap((variable) => [
		`✗ ${variable.name} is set but no longer read (removed in ${REMOVED_IN}).`,
		variable.replacement(String(env[variable.name])),
	])

	throw new LegacyEnvironmentError(
		stale.map((variable) => variable.name),
		[...lines, `  Set ${ALLOW_LEGACY_ENV}=1 to suppress this check.`].join('\n')
	)
}

function isSet(value: string | undefined): boolean {
	return value !== undefined && value.trim().length > 0
}

function option(name: string, value: string): string {
	return `  Move it to playwright.config.ts:  use: { ${name}: ${value} }`
}

function renamedEnv(newName: string): string {
	return `  Rename it to ${newName}. The value carries over unchanged; it stays in the environment.`
}

function quote(value: string): string {
	return `'${value.trim().replace(/'/g, "\\'")}'`
}

function boolean(value: string): string {
	return String(value.trim().toLowerCase() === 'true')
}

function milliseconds(value: string): string {
	const seconds = Number.parseFloat(value)
	return Number.isFinite(seconds) ? String(Math.round(seconds * 1_000)) : value.trim()
}

function toolList(value: string): string {
	const names = value
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name.length > 0)
	return `[${names.map((name) => `'${name}'`).join(', ')}]`
}
