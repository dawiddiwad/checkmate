import { expect, Page, test as base } from '@playwright/test'
import { MessageHistory } from './ai/message-history.js'
import { createRunner, CheckmateRunner } from './runtime/runner.js'
import { CheckmateExtension, defineExtension } from './runtime/extension.js'
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
 * Fixture type exported by `@xoxoai/checkmate/playwright`.
 *
 * @example
 * ```ts
 * test('checkout flow', async ({ ai }) => {
 *   await ai.run({ action: 'Open checkout', expect: 'Checkout page is visible' })
 * })
 * ```
 */
export type CheckmateFixtures = {
	/**
	 * Runner composed with the built-in web extension.
	 */
	ai: CheckmateRunner
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
 * const ai = createRunner({
 *   extensions: [web({ page })],
 * })
 * ```
 */
export function web({ page }: WebExtensionOptions): CheckmateExtension {
	const browserRuntime = new BrowserToolRuntime(page)

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
			api.setCapability(PlaywrightCapability.PAGE, page)
			api.setCapability(PlaywrightCapability.BROWSER_CONTEXT, browserRuntime.getBrowserContext())
			api.setCapability(PlaywrightCapability.ACTIVE_PAGE, () => browserRuntime.getActivePage())
			api.setCapability(PlaywrightCapability.BROWSER_RUNTIME, browserRuntime)
			api.addTool(createBrowserTools(browserRuntime))
			api.onTeardown(() => browserRuntime.dispose())
		},
		buildInitialMessages: async ({ step }) => {
			const snapshot = await new SnapshotService(await browserRuntime.ensureActivePage(), step).get()
			return [new MessageHistory().createSnapshotMessage(snapshot)]
		},
		handleToolResponses: async ({ aiClient, toolResponses }) => {
			let latestSnapshot: string | null = null

			for (const { toolResponse } of toolResponses) {
				if (toolResponse.snapshot) {
					latestSnapshot = toolResponse.snapshot
				}
			}

			if (latestSnapshot) {
				await aiClient.addCurrentSnapshotMessage(latestSnapshot)
			}

			if (aiClient.getRuntimeConfig().includeScreenshotInSnapshot()) {
				const screenshot = await new BrowserScreenshotService(
					await browserRuntime.ensureActivePage()
				).getCompressedScreenshot()
				await aiClient.addCurrentScreenshotMessage(screenshot.data, screenshot.mimeType ?? 'image/png')
			}
		},
	})
}

/**
 * Creates a runner composed with the built-in web extension.
 *
 * @example
 * ```ts
 * import { createPlaywrightRunner } from '@xoxoai/checkmate/playwright'
 *
 * const ai = createPlaywrightRunner(page)
 * ```
 */
export function createPlaywrightRunner(page: Page): CheckmateRunner {
	return createRunner({ extensions: [web({ page })] })
}

/**
 * Playwright Test fixture with the `ai` runner.
 *
 * @example
 * ```ts
 * import { test } from '@xoxoai/checkmate/playwright'
 *
 * test('search flow', async ({ ai }) => {
 *   await ai.run({
 *     action: 'Search for playwright docs',
 *     expect: 'Search results are displayed',
 *   })
 * })
 * ```
 */
export const test = base.extend<CheckmateFixtures>({
	ai: async ({ page }, use) => {
		const ai = createPlaywrightRunner(page)
		await use(ai)
		await ai.teardown()
	},
})

/**
 * Re-export of Playwright's `expect` for convenience.
 */
export { expect }
