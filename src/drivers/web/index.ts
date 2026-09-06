import { chromium } from 'playwright'
import type { CheckmateDriverV1 } from '../../driver.js'
import { createWebDriverSession, rollbackWebResources, webSettings, webTarget } from './session.js'

export const checkmateDriver: CheckmateDriverV1 = {
	id: 'web',
	driverContractVersion: 1,
	start: async (input) => {
		const target = webTarget(input.target)
		const settings = webSettings(input.settings)
		const resources: {
			browser?: Awaited<ReturnType<typeof chromium.launch>>
			context?: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>>
		} = {}
		try {
			input.signal.throwIfAborted()
			resources.browser = await chromium.launch({ headless: settings.headless })
			input.signal.throwIfAborted()
			resources.context = await resources.browser.newContext()
			const page = await resources.context.newPage()
			await page.goto(target.baseUrl)
			input.signal.throwIfAborted()
			return createWebDriverSession(
				{ browser: resources.browser, context: resources.context, page },
				settings,
				input.evidence,
				input.logger
			)
		} catch (error) {
			await rollbackWebResources(resources)
			throw new Error(`Web driver failed to start for '${target.baseUrl}'`, { cause: error })
		}
	},
}

export { createWebDriverSession, webSettings, webTarget }
export type { WebDriverSettings, WebDriverTarget } from './session.js'
