import { expect, Page, test as base } from '@playwright/test'
import { MessageHistory } from './ai/message-history'
import { createRunner, CheckmateRunner } from './runtime/runner'
import { CheckmateExtension, defineExtension } from './runtime/extension'
import { BrowserScreenshotService } from './tools/browser/screenshot-service'
import { BrowserTool, BrowserToolRuntime, createBrowserTools } from './tools/browser/tool'
import { SnapshotService } from './tools/browser/snapshot-service'

/**
 * Capability names published by the Playwright web extension.
 *
 * Use these in custom extensions that need access to the active Playwright page
 * or the browser tool runtime.
 *
 * @example
 * ```ts
 * const extension = defineExtension({
 *   name: 'custom-web-policy',
 *   setup(api) {
 *     const page = api.getCapability<Page>(PlaywrightCapability.PAGE)
 *     api.addInstruction(`Current page url is ${page.url()}`)
 *   },
 * })
 * ```
 */
export const PlaywrightCapability = {
	PAGE: 'checkmate.playwright.page',
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
	 * Active Playwright page used for browser automation.
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
	return defineExtension({
		name: 'web',
		instructions: [
			`If you cannot find elements, call '${BrowserTool.TOOL_SNAPSHOT}' to fetch the latest full snapshot of the page.`,
		],
		setup(api) {
			const browserRuntime = new BrowserToolRuntime(page)
			api.setCapability(PlaywrightCapability.PAGE, page)
			api.setCapability(PlaywrightCapability.BROWSER_RUNTIME, browserRuntime)
			api.addTool(createBrowserTools(browserRuntime))
		},
		buildInitialMessages: async ({ step }) => {
			const snapshot = await new SnapshotService(page, step).get()
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
				const screenshot = await new BrowserScreenshotService(page).getCompressedScreenshot()
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
