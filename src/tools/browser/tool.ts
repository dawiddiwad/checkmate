import { expect, Page } from '@playwright/test'
import { z } from 'zod/v4'
import { logger } from '../../logging/index.js'
import { Step } from '../../runtime/types.js'
import { defineAgentTool } from '../define-agent-tool.js'
import { AgentTool, AgentToolResponse } from '../types.js'
import { SnapshotService } from './snapshot-service.js'
import { TransientStateTracker } from './transient-state-tracker.js'

type BrowserInputElement = {
	ref: string
	text: string
	name: string
	clear: boolean
	select: boolean
}

export const BrowserTool = {
	TOOL_NAVIGATE: 'browser_navigate',
	TOOL_CLICK_OR_HOVER: 'browser_click_or_hover',
	TOOL_TYPE_OR_SELECT: 'browser_type_or_select',
	TOOL_PRESS_KEY: 'browser_press_key',
	TOOL_SNAPSHOT: 'browser_snapshot',
	TOOL_WAIT: 'browser_wait',
} as const

const browserInputElementSchema = z
	.object({
		ref: z.string().describe('ref value of the element from the snapshot, example: e123'),
		name: z.string().describe('name of the element to type into, example: Username Input'),
		text: z.string().describe('The text to type into the element, example: Hello World'),
		clear: z
			.boolean()
			.describe('If true, clears existing text before typing. Use false with dropdowns and selects'),
		select: z.boolean().describe('If true, selects the option matching "text" from a dropdown or select element'),
	})
	.strict()

export class BrowserToolRuntime {
	constructor(private readonly page: Page) {}

	async navigateToUrl(url: string, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async () => {
				if (!url) {
					throw new Error(`valid URL is required for ${BrowserTool.TOOL_NAVIGATE} but received: '${url}'`)
				}

				try {
					await this.page.goto(url)
				} catch (error) {
					throw new Error(`Failed to navigate to URL ${url}`, { cause: error })
				}
			},
			`Navigated to: ${url}`,
			step
		)
	}

	async clickElement(ref: string, hover: boolean, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async () => {
				try {
					if (hover) {
						await this.page.hover(`aria-ref=${ref}`)
					} else {
						await this.page.click(`aria-ref=${ref}`)
					}
				} catch (error) {
					logger.error(`error clicking element with ref '${ref}' due to:\n${error}`)
					return `failed to click element with ref '${ref}':\n${error} try with different element type or ref`
				}
			},
			hover ? `Hovered element with ref '${ref}'.` : `Clicked element with ref '${ref}'.`,
			step
		)
	}

	async typeOrSelectInElement(elements: BrowserInputElement[], step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async () => {
				for (const element of elements) {
					try {
						if (!element.ref || element.text === undefined || element.text === null) {
							throw new Error(
								`both 'ref' and 'text' are required for ${BrowserTool.TOOL_TYPE_OR_SELECT} but received ref='${element.ref}' and text='${element.text}'`
							)
						}

						if (!element.select && element.clear) {
							await this.page.locator(`aria-ref=${element.ref}`).clear()
						}

						if (element.select && element.text.length > 0) {
							await this.page.locator(`aria-ref=${element.ref}`).selectOption(element.text)
							continue
						}

						if (!element.select && element.text.length > 0) {
							await this.page
								.locator(`aria-ref=${element.ref}`)
								.pressSequentially(element.text, { delay: 50 })
						}
					} catch (error) {
						logger.error(
							`error ${element.select ? 'selecting' : 'typing'} '${element.text}' in element with ref '${element.ref}' due to:\n${error}`
						)
						return `failed to ${element.select ? 'select' : 'type'} '${element.text}' in element with ref '${element.ref}':\n${error}\n try with different element type or ref`
					}
				}
			},
			`Updated ${elements.length} page element${elements.length === 1 ? '' : 's'}.`,
			step
		)
	}

	async pressKey(key: string, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async () => {
				try {
					if (!key) {
						throw new Error(`'key' is required for ${BrowserTool.TOOL_PRESS_KEY} but received: '${key}'`)
					}

					await this.page.keyboard.press(key)
				} catch (error) {
					logger.error(`error pressing key '${key}' due to:\n${error}`)
					return `failed to press key '${key}':\n${error}`
				}
			},
			`Pressed key '${key}'.`,
			step
		)
	}

	async captureCurrentSnapshot(step: Step, options: { skipFilter?: boolean } = {}): Promise<string> {
		try {
			await expect
				.poll(
					async () => {
						const readHtml = async () => this.page.locator('html').innerHTML()
						const first = await readHtml()
						await this.page.waitForTimeout(500)
						const second = await readHtml()
						return first !== second ? 'not stable' : 'stable'
					},
					{ timeout: 30_000, message: 'page snapshots should be stable' }
				)
				.toEqual('stable')

			return new SnapshotService(this.page, step, { skipFilter: options.skipFilter }).get()
		} catch (error) {
			throw new Error(`Failed to capture page snapshot:\n${error}`, { cause: error })
		}
	}

	async wait(seconds: number, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async () => {
				try {
					if (!Number.isFinite(seconds) || seconds <= 0) {
						throw new Error(`invalid seconds value received: ${seconds}. It should be a positive number.`)
					}

					await this.page.waitForTimeout(seconds * 1000)
				} catch (error) {
					logger.error(`error waiting for ${seconds} seconds due to:\n${error}`)
					return `failed to wait for ${seconds} seconds:\n${error}`
				}
			},
			`Waited ${seconds} seconds.`,
			step
		)
	}

	private async wrapWithTracker(
		action: () => Promise<unknown>,
		fallbackResponse: string,
		step: Step
	): Promise<AgentToolResponse | string> {
		const tracker = new TransientStateTracker(this.page)
		await tracker.start()

		try {
			const actionResult = await action()
			if (typeof actionResult === 'string') {
				await tracker.stop()
				return actionResult
			}

			const snapshot = await this.captureCurrentSnapshot(step)
			await tracker.stop()
			const formattedTimeline = tracker.formatTimeline()
			return { response: formattedTimeline || fallbackResponse, snapshot }
		} catch (error) {
			await tracker.stop()
			throw error
		}
	}
}

export function createBrowserTools(runtime: BrowserToolRuntime): AgentTool[] {
	return [
		defineAgentTool({
			name: BrowserTool.TOOL_NAVIGATE,
			description: 'Navigate to a specified URL in the browser, example: https://www.example.com',
			schema: z
				.object({
					url: z.string().describe('The URL to navigate to'),
					goal: z.string().describe('The goal or purpose of navigating to this URL'),
				})
				.strict(),
			handler: ({ url }, context) => runtime.navigateToUrl(url, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_CLICK_OR_HOVER,
			description: 'Click or hover a specified element reference in the browser',
			schema: z
				.object({
					ref: z.string().describe('ref value of the element from the snapshot, example: e123'),
					name: z.string().describe('name of the element to click or hover, example: Submit Button'),
					hover: z.boolean().describe('If true: hover the element, if false: click element'),
					goal: z.string().describe('The goal or purpose of clicking this element'),
				})
				.strict(),
			handler: ({ ref, hover }, context) => runtime.clickElement(ref, hover, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_TYPE_OR_SELECT,
			description:
				'Type text into a specified element reference in the browser or select an option from a dropdown.',
			schema: z
				.object({
					elements: z.array(browserInputElementSchema).min(1).describe('array of elements to type into'),
					goal: z.string().describe('The goal or purpose of typing this text into the element'),
				})
				.strict(),
			handler: ({ elements }, context) => runtime.typeOrSelectInElement(elements, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_PRESS_KEY,
			description: 'Press a specified key in the browser',
			schema: z
				.object({
					key: z.string().describe('The key to press, example: Enter, Escape, ArrowDown'),
					goal: z.string().describe('The goal or purpose of pressing this key'),
				})
				.strict(),
			handler: ({ key }, context) => runtime.pressKey(key, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_SNAPSHOT,
			description:
				'Capture the ARIA snapshot of the current page - use only if you miss information from previous snapshot.',
			schema: z
				.object({
					goal: z.string().describe('The goal or purpose of capturing the snapshot'),
				})
				.strict(),
			handler: async (_args, context) => ({
				response: 'Captured latest page snapshot.',
				snapshot: await runtime.captureCurrentSnapshot(context.step, { skipFilter: true }),
			}),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_WAIT,
			description: 'Wait for a timeout in seconds',
			schema: z
				.object({
					seconds: z.number().describe('Number of seconds to wait, example: 5'),
					goal: z.string().describe('The goal or purpose of waiting'),
				})
				.strict(),
			handler: ({ seconds }, context) => runtime.wait(seconds, context.step),
		}),
	]
}
