import { localBrowser, Stagehand } from '@browserbasehq/stagehand'
import type { CheckmateDriverV1 } from '../../driver.js'
import { createWebDriverSession, WebResources, webSettings, webTarget } from './session.js'
import { TelemetryReceiver } from './telemetry-receiver.js'

export const checkmateDriver: CheckmateDriverV1 = {
	id: 'web',
	driverContractVersion: 1,
	start: async (input) => {
		const target = webTarget(input.target)
		const settings = webSettings(input.settings)
		const resources = new WebResources(input.signal)
		try {
			resources.assertLive()
			const receiver = await resources.acquire(
				TelemetryReceiver.start(
					input.allowlistedTools.includes('browser_diagnostics'),
					input.diagnostics.sanitizeText
				),
				(value) => {
					resources.receiver = value
				}
			)
			receiver.onUnexpectedFailure(() => {
				void resources.close(AbortSignal.abort()).catch(() => {})
			})
			resources.assertLive()
			const browser = await resources.acquire(localBrowser.launch({ headless: settings.headless }), (value) => {
				resources.browser = value
			})
			resources.assertLive()
			await resources.acquire(
				Stagehand.create({
					browser,
					model: { generate: resources.generation.generate },
					logging: { level: 'off' },
					cache: false,
					selfHeal: false,
					telemetry: { traces: { endpoint: receiver.endpoint, headers: receiver.headers } },
				}),
				(value) => {
					resources.stagehand = value
				}
			)
			resources.assertLive()
			const page = (await browser.context.activePage()) ?? (await browser.context.newPage())
			resources.assertLive()
			await page.goto(target.baseUrl)
			resources.assertLive()
			return createWebDriverSession(resources)
		} catch (error) {
			await resources.close(AbortSignal.abort()).catch(() => {})
			throw new Error('Web driver failed to start', { cause: error })
		}
	},
}

export { createWebDriverSession, webSettings, webTarget }
export type { WebDriverSettings, WebDriverTarget } from './session.js'
