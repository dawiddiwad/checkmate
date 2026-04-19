import { expect, test as base } from '@playwright/test'
import { profiles } from './modules'
import { CheckmateRunner } from './runtime/runner'
import { CheckmateRunnerOptions, CheckmateServices } from './runtime/module'

/**
 * Playwright fixture exposed by Checkmate.
 */
export type CheckmateFixtures<TServices extends CheckmateServices = CheckmateServices> = {
	/** Composed Checkmate runner bound to the current Playwright page. */
	ai: CheckmateRunner<TServices>
}

/**
 * Options accepted by `createCheckmateTest`.
 */
export type CreateCheckmateTestOptions<TServices extends CheckmateServices = CheckmateServices> = Omit<
	CheckmateRunnerOptions<TServices>,
	'page'
>

/**
 * Create a Playwright fixture with a Checkmate runner bound to each test page.
 *
 * When `profile` is omitted, the built-in web profile is used.
 *
 * @param options - Optional runner composition overrides.
 * @returns Extended Playwright `test` object with the `ai` fixture.
 *
 * @example
 * ```ts
 * const test = createCheckmateTest()
 * ```
 */
export function createCheckmateTest<TServices extends CheckmateServices = CheckmateServices>(
	options: CreateCheckmateTestOptions<TServices> = {}
) {
	return base.extend<CheckmateFixtures<TServices>>({
		ai: async ({ page }, use) => {
			const ai = new CheckmateRunner<TServices>({
				page,
				profile: options.profile ?? profiles.web<TServices>(),
				...options,
			})
			await use(ai)
			await ai.teardown()
		},
	})
}

/**
 * Default Playwright fixture using the built-in web profile.
 */
export const test = createCheckmateTest()

export { expect }
