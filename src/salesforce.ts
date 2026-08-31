import { expect, Page } from '@playwright/test'
import { ResolvedConfig, resolveConfig } from './config/resolved-config.js'
import { runAiStep } from './playwright/ai-step.js'
import { checkmateOptions } from './playwright/options.js'
import { createRunner, CheckmateRunner } from './runtime/runner.js'
import { CheckmateExtension, defineExtension } from './runtime/extension.js'
import { Step } from './runtime/types.js'
import { CheckmateAi, PlaywrightCapability, web } from './playwright.js'
import { BrowserToolRuntime } from './tools/browser/tool.js'
import { createSalesforceTools, SalesforceLoginTool } from './tools/salesforce/login-tool.js'

/**
 * Fixture type contributed by `@xoxoai/checkmate/salesforce`.
 *
 * @example
 * ```ts
 * import { mergeTests } from '@playwright/test'
 * import { checkmate } from '@xoxoai/checkmate/salesforce'
 *
 * export const test = mergeTests(baseTest, checkmate)
 * ```
 */
export type SalesforceFixtures = {
	/**
	 * Step runner composed with the built-in web and Salesforce extensions.
	 */
	ai: CheckmateAi
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
 * const runner = createRunner({
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
 * const runner = createSalesforceRunner(page)
 * const report = await runner.run({ action: 'Login to Salesforce org', expect: 'Home page is displayed' })
 * ```
 */
export function createSalesforceRunner(page: Page, config: ResolvedConfig = resolveConfig()): CheckmateRunner {
	return createRunner({ config, extensions: [web({ page }), salesforce()] })
}

/**
 * Creates the Salesforce `ai` step runner outside a fixture.
 *
 * @example
 * ```ts
 * import { createSalesforceAi } from '@xoxoai/checkmate/salesforce'
 *
 * const ai = createSalesforceAi(page)
 * await ai.step({ action: 'Login to Salesforce org', expect: 'Home page is displayed' })
 * await ai.teardown()
 * ```
 */
export function createSalesforceAi(page: Page, config: ResolvedConfig = resolveConfig()): CheckmateAi {
	const runner = createSalesforceRunner(page, config)

	return {
		step: (step: Step) => runAiStep(runner, step),
		teardown: () => runner.teardown(),
	}
}

/**
 * Checkmate's Salesforce test object, contributing the `ai` fixture.
 *
 * @example
 * ```ts
 * import { mergeTests } from '@playwright/test'
 * import { checkmate } from '@xoxoai/checkmate/salesforce'
 * import { test as baseTest } from './fixtures'
 *
 * export const test = mergeTests(baseTest, checkmate)
 * ```
 */
export const checkmate = checkmateOptions.extend<SalesforceFixtures>({
	ai: async ({ page, checkmateConfig }, use) => {
		const ai = createSalesforceAi(page, checkmateConfig)
		await use(ai)
		await ai.teardown()
	},
})

/**
 * Bundled test object for greenfield Salesforce suites.
 *
 * @example
 * ```ts
 * import { test } from '@xoxoai/checkmate/salesforce'
 *
 * test('salesforce flow', async ({ ai }) => {
 *   await ai.step({
 *     action: 'Login to Salesforce org',
 *     expect: 'The Salesforce home page is displayed',
 *   })
 * })
 * ```
 */
export const test = checkmate

/**
 * Re-export of Playwright's `expect` for convenience.
 */
export { expect }
