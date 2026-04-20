import { expect, Page, test as base } from '@playwright/test'
import { createRunner, CheckmateRunner } from './runtime/runner'
import { CheckmateExtension, defineExtension } from './runtime/extension'
import { PlaywrightCapability, web } from './playwright'
import { BrowserToolRuntime } from './tools/browser/tool'
import { createSalesforceTools, SalesforceLoginTool } from './tools/salesforce/login-tool'

/**
 * Fixture type exported by `@xoxoai/checkmate/salesforce`.
 *
 * @example
 * ```ts
 * test('salesforce flow', async ({ ai }) => {
 *   await ai.run({
 *     action: 'Login to Salesforce org',
 *     expect: 'The Salesforce home page is displayed',
 *   })
 * })
 * ```
 */
export type SalesforceFixtures = {
	/**
	 * Runner composed with the built-in web and Salesforce extensions.
	 */
	ai: CheckmateRunner
}

/**
 * Creates the built-in Salesforce extension.
 *
 * This extension adds Salesforce-specific tools on top of the web extension.
 *
 * @example
 * ```ts
 * import { createRunner } from '@xoxoai/checkmate/core'
 * import { web } from '@xoxoai/checkmate/playwright'
 * import { salesforce } from '@xoxoai/checkmate/salesforce'
 *
 * const ai = createRunner({
 *   extensions: [web({ page }), salesforce()],
 * })
 * ```
 */
export function salesforce(): CheckmateExtension {
	return defineExtension({
		name: 'salesforce',
		instructions: [
			`Use '${SalesforceLoginTool.TOOL_LOGIN_TO_SALESFORCE_ORG}' when the step requires logging into a Salesforce org.`,
		],
		setup(api) {
			const browserRuntime = api.getCapability<BrowserToolRuntime>(PlaywrightCapability.BROWSER_RUNTIME)
			api.addTool(createSalesforceTools(browserRuntime))
		},
	})
}

/**
 * Creates a runner composed with the built-in web and Salesforce extensions.
 *
 * @example
 * ```ts
 * import { createSalesforceRunner } from '@xoxoai/checkmate/salesforce'
 *
 * const ai = createSalesforceRunner(page)
 * ```
 */
export function createSalesforceRunner(page: Page): CheckmateRunner {
	return createRunner({ extensions: [web({ page }), salesforce()] })
}

/**
 * Playwright Test fixture with the `ai` runner.
 *
 * @example
 * ```ts
 * import { test } from '@xoxoai/checkmate/salesforce'
 *
 * test('salesforce account creation', async ({ ai }) => {
 *   await ai.run({
 *     action: 'Login to Salesforce org',
 *     expect: 'The Salesforce home page is displayed',
 *   })
 * })
 * ```
 */
export const test = base.extend<SalesforceFixtures>({
	ai: async ({ page }, use) => {
		const ai = createSalesforceRunner(page)
		await use(ai)
		await ai.teardown()
	},
})

/**
 * Re-export of Playwright's `expect` for convenience.
 */
export { expect }
