import type { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod/v4'
import { defineDriverTool, type DriverTool } from '../../../driver.js'
import { TELEMETRY_LIMITS, type TelemetryReceiver } from '../telemetry-receiver.js'

export function createBrowserTools(stagehand: Stagehand, receiver: TelemetryReceiver): DriverTool[] {
	return [
		defineDriverTool({
			name: 'browser_navigate',
			description: 'Navigate the active page to an absolute URL. Does not inspect page facts.',
			schema: z
				.object({
					url: z
						.string()
						.min(1)
						.refine((value) => URL.canParse(value), 'Must be an absolute URL'),
				})
				.strict(),
			handler: async ({ url }) => {
				const page = await activePage(stagehand)
				await page.goto(url)
				return JSON.stringify({ url: await page.url() })
			},
		}),
		defineDriverTool({
			name: 'browser_observe',
			strict: false,
			description: 'Discover possible actions on the active page when the next action is unclear.',
			schema: z.object({ instruction: z.string().trim().min(1).optional() }).strict(),
			handler: async ({ instruction }) => {
				const page = await activePage(stagehand)
				const result = await stagehand.observe(instruction, { page })
				return JSON.stringify(result.data)
			},
		}),
		defineDriverTool({
			name: 'browser_act',
			description: 'Perform one unambiguous browser action. Success is not verification of the expectation.',
			schema: z.object({ instruction: z.string().trim().min(1) }).strict(),
			handler: async ({ instruction }) => {
				const page = await activePage(stagehand)
				const result = await stagehand.act(instruction, { page })
				const response = JSON.stringify(result.data)
				return result.data.success ? response : { status: 'error' as const, response }
			},
		}),
		defineDriverTool({
			name: 'browser_extract',
			description:
				'Extract textual page facts needed to verify the expectation. No screenshots or custom schema.',
			schema: z.object({ instruction: z.string().trim().min(1) }).strict(),
			handler: async ({ instruction }) => {
				const page = await activePage(stagehand)
				const result = await stagehand.extract(instruction, { page, screenshot: false })
				return JSON.stringify({ extraction: result.data.extraction })
			},
		}),
		defineDriverTool({
			name: 'browser_diagnostics',
			strict: false,
			description:
				'Read sanitized diagnostics received so far. Partial and delayed; not proof of page state or absence of errors.',
			schema: z
				.object({
					after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
					limit: z.number().int().min(1).max(TELEMETRY_LIMITS.readEvents).optional(),
				})
				.strict(),
			handler: ({ after, limit }) => JSON.stringify(receiver.read(after, limit)),
		}),
	]
}

async function activePage(stagehand: Stagehand) {
	const page = await stagehand.browser.context.activePage()
	if (!page) throw new Error('Browser has no active page')
	return page
}
