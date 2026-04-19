import { expect } from '@playwright/test'
import { profiles } from './modules'
import { CheckmateRunnerOptions, CheckmateServices } from './runtime/module'
import { createCheckmateTest } from './playwright'

/**
 * Options accepted by `createSalesforceTest`.
 */
export type CreateSalesforceTestOptions<TServices extends CheckmateServices = CheckmateServices> = Omit<
	CheckmateRunnerOptions<TServices>,
	'page' | 'profile'
>

/**
 * Create a Playwright fixture using the built-in Salesforce profile.
 *
 * @param options - Optional extension and service overrides appended to the Salesforce profile.
 * @returns Extended Playwright `test` object with the `ai` fixture.
 *
 * @example
 * ```ts
 * const test = createSalesforceTest()
 * ```
 */
export function createSalesforceTest<TServices extends CheckmateServices = CheckmateServices>(
	options: CreateSalesforceTestOptions<TServices> = {}
) {
	return createCheckmateTest<TServices>({ ...options, profile: profiles.salesforce<TServices>() })
}

/**
 * Default Playwright fixture using the built-in Salesforce profile.
 */
export const test = createSalesforceTest()

export { expect }
