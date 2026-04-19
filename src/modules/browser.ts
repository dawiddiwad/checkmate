import { BrowserTool, BrowserToolRuntime, createBrowserTools } from '../tools/browser/tool'
import { CheckmateBrowserService, CheckmateExtension, CheckmateProfile, CheckmateServices } from '../runtime/module'

/**
 * Create the built-in browser extension.
 *
 * The browser extension provides Playwright-backed browser tools, browser prompt
 * guidance, and the initial page context for each step.
 *
 * @returns Browser extension definition.
 *
 * @example
 * ```ts
 * const runner = new CheckmateRunner({
 *   page,
 *   extensions: [extensions.browser()],
 * })
 * ```
 */
export function createBrowserExtension<
	TServices extends CheckmateServices = CheckmateServices,
>(): CheckmateExtension<TServices> {
	return {
		name: 'browser',
		setup: ({ page, services }) => {
			const browser = getBrowserService(services) ?? (page ? new BrowserToolRuntime(page) : undefined)
			if (!browser) {
				throw new Error(
					'The browser extension requires either a Playwright page or a preconfigured browser service'
				)
			}

			return {
				services: { browser },
				tools: createBrowserTools<TServices>(browser),
				prompt: [
					`If you cannot find elements, call '${BrowserTool.TOOL_SNAPSHOT}' to fetch the latest full context.`,
				],
				initialContext: [(step, context) => getBrowserService(context.services)?.getInitialContext(step)],
			}
		},
	}
}

function getBrowserService(services: Partial<CheckmateServices>): CheckmateBrowserService | undefined {
	return services.browser as CheckmateBrowserService | undefined
}

/**
 * Create the built-in web profile.
 *
 * @returns Profile containing the browser extension.
 */
export function createWebProfile<
	TServices extends CheckmateServices = CheckmateServices,
>(): CheckmateProfile<TServices> {
	return {
		name: 'web',
		extensions: [createBrowserExtension<TServices>()],
	}
}
