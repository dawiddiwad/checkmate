import { expect, Page } from '@playwright/test'
import { MessageHistory } from './ai/message-history.js'
import { ResolvedConfig, resolveConfig } from './config/resolved-config.js'
import { runAiStep } from './playwright/ai-step.js'
import { checkmateOptions } from './playwright/options.js'
import { createRunner, CheckmateRunner } from './runtime/runner.js'
import { CheckmateExtension, defineExtension } from './runtime/extension.js'
import { ContextMessage, Step } from './runtime/types.js'
import { BrowserScreenshotService } from './tools/browser/screenshot-service.js'
import { BrowserTool, BrowserToolRuntime, createBrowserTools } from './tools/browser/tool.js'
import { SnapshotService } from './tools/browser/snapshot-service.js'

/**
 * Capability names published by the Playwright web extension.
 *
 * Use these in custom extensions that need access to the original Playwright
 * fixture page, current active page, browser context, or browser tool runtime.
 *
 * @example
 * ```ts
 * const extension = defineExtension({
 *   name: 'custom-web-policy',
 *   setup(api) {
 *     const activePage = api.getCapability<() => Page>(PlaywrightCapability.ACTIVE_PAGE)
 *     api.addInstruction(`Current page url is ${activePage().url()}`)
 *   },
 * })
 * ```
 */
export const PlaywrightCapability = {
	PAGE: 'checkmate.playwright.page',
	BROWSER_CONTEXT: 'checkmate.playwright.browser-context',
	ACTIVE_PAGE: 'checkmate.playwright.active-page',
	BROWSER_RUNTIME: 'checkmate.playwright.browser-runtime',
} as const

/**
 * The `ai` fixture contributed by the `checkmate` test object.
 *
 * `step()` is the only way to run a natural-language step. It always creates its own
 * `test.step`, always attaches a `checkmate-step.json`-shaped summary, and fails the test
 * when the reported outcome is `failed`.
 *
 * @example
 * ```ts
 * test('checkout flow', async ({ ai }) => {
 *   await ai.step({
 *     name: 'apply promo code',
 *     action: 'apply the seasonal promo code SPRING25 at checkout',
 *     expect: 'the order total drops and the discount is itemised',
 *   })
 * })
 * ```
 */
export type CheckmateAi = {
	/**
	 * Runs one natural-language step inside its own Playwright step.
	 */
	step: (step: Step) => Promise<void>

	/**
	 * Releases runner-owned resources.
	 */
	teardown: () => Promise<void>
}

/**
 * Fixture type contributed by `@xoxoai/checkmate/playwright`.
 *
 * @example
 * ```ts
 * import { mergeTests } from '@playwright/test'
 * import { checkmate } from '@xoxoai/checkmate/playwright'
 *
 * export const test = mergeTests(baseTest, checkmate)
 * ```
 */
export type CheckmateFixtures = {
	/**
	 * Step runner composed with the built-in web extension.
	 */
	ai: CheckmateAi
}

/**
 * Options for the built-in web extension.
 *
 * @example
 * ```ts
 * const extension = web({ page })
 * ```
 */
export type WebExtensionOptions = {
	/**
	 * Original Playwright fixture page used to create the browser runtime.
	 */
	page: Page
}

/**
 * Creates the built-in web extension.
 *
 * This extension adds browser tools, initial snapshots, and post-tool screenshot handling.
 *
 * @example
 * ```ts
 * import { createRunner } from '@xoxoai/checkmate/core'
 * import { web } from '@xoxoai/checkmate/playwright'
 *
 * const runner = createRunner({
 *   extensions: [web({ page })],
 * })
 * ```
 */
export function web({ page }: WebExtensionOptions): CheckmateExtension {
	const messageHistory = new MessageHistory()

	return defineExtension({
		name: 'web',
		instructions: [
			`Browser tools operate on the active browser tab/page. Tabs and popups opened by browser actions become active automatically.`,
			`Use '${BrowserTool.TOOL_LIST_TABS}', '${BrowserTool.TOOL_SELECT_TAB}', and '${BrowserTool.TOOL_CLOSE_TAB}' to inspect, switch, or close browser tabs and popups.`,
			`If you cannot find elements, call '${BrowserTool.TOOL_SNAPSHOT}' to fetch the latest full snapshot of the active page.`,
			`For JavaScript alert, confirm, or prompt dialogs, call '${BrowserTool.TOOL_SET_DIALOG_RESPONSE}' immediately before the browser action that opens the dialog when the step needs OK, Cancel, or prompt text. Unarmed dialogs are dismissed automatically.`,
			`To verify backend behavior, call '${BrowserTool.TOOL_NETWORK_REQUESTS}' after a browser action to see the API calls that action triggered. Each call only covers the browser action immediately before it. Use '${BrowserTool.TOOL_NETWORK_REQUEST}' with a request's number to inspect its headers or read its request/response body.`,
		],
		setup(api) {
			const browserRuntime = new BrowserToolRuntime(page, api.config)

			api.setCapability(PlaywrightCapability.PAGE, page)
			api.setCapability(PlaywrightCapability.BROWSER_CONTEXT, browserRuntime.getBrowserContext())
			api.setCapability(PlaywrightCapability.ACTIVE_PAGE, () => browserRuntime.getActivePage())
			api.setCapability(PlaywrightCapability.BROWSER_RUNTIME, browserRuntime)
			api.addTool(createBrowserTools(browserRuntime))
			api.onTeardown(() => browserRuntime.dispose())

			api.addInitialMessages(async ({ step }) => {
				const snapshot = await new SnapshotService(
					await browserRuntime.ensureActivePage(),
					api.config,
					step
				).get()
				return [messageHistory.createSnapshotMessage(snapshot)]
			})

			api.addToolResponsesHook(async ({ toolResponses }) => {
				const context: ContextMessage[] = []

				let latestSnapshot: string | null = null
				for (const { toolResponse } of toolResponses) {
					if (toolResponse.snapshot) {
						latestSnapshot = toolResponse.snapshot
					}
				}

				if (latestSnapshot) {
					context.push(messageHistory.createSnapshotMessage(latestSnapshot))
				}

				if (api.config.screenshots) {
					const screenshot = await new BrowserScreenshotService(
						await browserRuntime.ensureActivePage()
					).getCompressedScreenshot()
					context.push(
						messageHistory.createScreenshotMessage(screenshot.data, screenshot.mimeType ?? 'image/png')
					)
				}

				return context
			})
		},
	})
}

/**
 * Creates a runner composed with the built-in web extension.
 *
 * The runner resolves a `StepReport` and does not touch Playwright Test. Use it when
 * driving Checkmate from a script; inside a test, prefer the `ai` fixture.
 *
 * @example
 * ```ts
 * import { createPlaywrightRunner } from '@xoxoai/checkmate/playwright'
 *
 * const runner = createPlaywrightRunner(page)
 * const report = await runner.run({ action: 'Open the pricing page', expect: 'Pricing is visible' })
 * ```
 */
export function createPlaywrightRunner(page: Page, config: ResolvedConfig = resolveConfig()): CheckmateRunner {
	return createRunner({ config, extensions: [web({ page })] })
}

/**
 * Creates the `ai` step runner outside a fixture.
 *
 * This is the escape hatch for helpers and page objects. The caller owns `teardown()`.
 *
 * @example
 * ```ts
 * import { createAi } from '@xoxoai/checkmate/playwright'
 *
 * const ai = createAi(page)
 * await ai.step({ action: 'Open the pricing page', expect: 'Pricing is visible' })
 * await ai.teardown()
 * ```
 */
export function createAi(page: Page, config: ResolvedConfig = resolveConfig()): CheckmateAi {
	const runner = createPlaywrightRunner(page, config)
	let ordinal = 0

	return {
		step: (step: Step) => runAiStep(runner, step, { ordinal: ++ordinal, evidence: config.evidence }),
		teardown: () => runner.teardown(),
	}
}

/**
 * Checkmate's Playwright test object, contributing the `ai` fixture.
 *
 * Merge it into a suite's own test object so existing fixtures keep working.
 *
 * @example
 * ```ts
 * import { mergeTests } from '@playwright/test'
 * import { checkmate } from '@xoxoai/checkmate/playwright'
 * import { test as baseTest } from './fixtures'
 *
 * export const test = mergeTests(baseTest, checkmate)
 * ```
 */
export const checkmate = checkmateOptions.extend<CheckmateFixtures>({
	ai: async ({ page, checkmateConfig }, use) => {
		const ai = createAi(page, checkmateConfig)
		await use(ai)
		await ai.teardown()
	},
})

/**
 * Bundled test object for greenfield suites with no fixtures of their own.
 *
 * @example
 * ```ts
 * import { test } from '@xoxoai/checkmate/playwright'
 *
 * test('search flow', async ({ ai }) => {
 *   await ai.step({
 *     action: 'Search for playwright docs',
 *     expect: 'Search results are displayed',
 *   })
 * })
 * ```
 */
export const test = checkmate

/**
 * Re-export of Playwright's `expect` for convenience.
 */
export { expect }

export { checkmateOptions } from './playwright/options.js'
export type { CheckmateOptionFixtures } from './playwright/options.js'
export { CHECKMATE_DEFAULTS, resolveConfig } from './config/resolved-config.js'
export type {
	CheckmateOptions,
	EvidenceLevel,
	ReasoningEffort,
	ResolvedConfig,
	ToolChoice,
} from './config/resolved-config.js'
