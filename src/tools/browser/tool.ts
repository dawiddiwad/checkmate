import { BrowserContext, Page, test } from '@playwright/test'
import { z } from 'zod/v4'
import { ResolvedConfig } from '../../config/resolved-config.js'
import { logger } from '../../logging/index.js'
import { Step } from '../../runtime/types.js'
import { defineAgentTool } from '../define-agent-tool.js'
import { AgentTool, AgentToolContext, AgentToolResponse, AgentToolResult } from '../types.js'
import { NetworkRequestRecorder } from './network-request-recorder.js'
import { SnapshotService } from './snapshot-service.js'
import { DialogHandlingIntent, TransientStateTracker } from './transient-state-tracker.js'

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
	TOOL_SET_DIALOG_RESPONSE: 'browser_set_dialog_response',
	TOOL_DRAG: 'browser_drag',
	TOOL_UPLOAD: 'browser_upload',
	TOOL_TYPE_OR_SELECT: 'browser_type_or_select',
	TOOL_PRESS_KEY: 'browser_press_key',
	TOOL_SNAPSHOT: 'browser_snapshot',
	TOOL_WAIT: 'browser_wait',
	TOOL_LIST_TABS: 'browser_list_tabs',
	TOOL_SELECT_TAB: 'browser_select_tab',
	TOOL_CLOSE_TAB: 'browser_close_tab',
	TOOL_NETWORK_REQUESTS: 'browser_network_requests',
	TOOL_NETWORK_REQUEST: 'browser_network_request',
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

const dialogResponseSchema = z
	.object({
		action: z.enum(['accept', 'dismiss']).describe('How to answer the next JavaScript alert, confirm, or prompt'),
		promptText: z.string().nullable().describe('Text to submit when accepting a prompt() dialog'),
		goal: z.string().describe('The goal or purpose of handling the next dialog'),
	})
	.strict()

export class BrowserToolRuntime {
	private readonly browserContext: BrowserContext
	private activePage: Page
	private nextPageNumber = 1
	private readonly pageIds = new Map<Page, string>()
	private readonly pagesById = new Map<string, Page>()
	private pendingDialogHandlingIntent: DialogHandlingIntent | null = null
	private readonly networkRecorder: NetworkRequestRecorder

	constructor(
		page: Page,
		private readonly config: ResolvedConfig
	) {
		this.browserContext = page.context()
		this.activePage = page
		this.networkRecorder = new NetworkRequestRecorder(this.browserContext)
		this.networkRecorder.attach()
		this.registerExistingPages()
		this.setActivePage(page)
		this.browserContext.on('page', (newPage) => {
			this.registerPage(newPage)
			this.setActivePage(newPage)
		})
	}

	getActivePage(): Page {
		if (this.isPageClosed(this.activePage)) {
			this.selectNewestFallbackActivePage()
		}

		if (this.isPageClosed(this.activePage)) {
			throw new Error('No open browser pages remain in this context.')
		}

		return this.activePage
	}

	getBrowserContext(): BrowserContext {
		return this.browserContext
	}

	listNetworkRequests(includeStatic: boolean): string {
		return this.networkRecorder.format({ includeStatic }) || 'No API calls were made since the last browser action.'
	}

	async inspectNetworkRequest(sequence: number, part: 'detail' | 'request-body' | 'response-body'): Promise<string> {
		if (part === 'detail') {
			return this.networkRecorder.detail(sequence)
		}

		return this.networkRecorder.body(sequence, part === 'request-body' ? 'request' : 'response')
	}

	dispose(): void {
		this.networkRecorder.detach()
	}

	async listPages(): Promise<string> {
		await this.ensureActivePage()
		const pages = await this.openPages()
		if (pages.length === 0) {
			return 'No open browser tabs.'
		}

		const lines = await Promise.all(
			pages.map(async (page) => {
				const id = this.registerPage(page)
				const marker = page === this.getActivePage() ? ' (active)' : ''
				return `${id}${marker}: ${page.url()} - ${await this.safeTitle(page)}`
			})
		)

		return [`Open browser tabs:`, ...lines].join('\n')
	}

	async selectPage(pageId: string, step: Step): Promise<AgentToolResponse | string> {
		const page = await this.findOpenPage(pageId)
		if (!page) {
			return `Browser tab '${pageId}' was not found or is closed.`
		}

		await this.setActivePage(page)
		return {
			response: `Selected browser tab ${pageId}: ${page.url()}`,
			snapshot: await this.captureCurrentSnapshot(step),
		}
	}

	async closePage(pageId: string | null | undefined, step: Step): Promise<AgentToolResponse | string> {
		const pages = await this.openPages()
		if (pages.length <= 1) {
			return 'Cannot close the last open browser tab.'
		}

		const page = pageId ? await this.findOpenPage(pageId) : await this.ensureActivePage()
		if (!page || this.isPageClosed(page)) {
			return `Browser tab '${pageId}' was not found or is closed.`
		}

		const closedId = this.registerPage(page)
		await page.close()
		await this.selectFallbackActivePage(page)
		const activePage = this.getActivePage()
		const activeId = this.registerPage(activePage)

		return {
			response: `Closed browser tab ${closedId}. Active tab is now ${activeId}: ${activePage.url()}`,
			snapshot: await this.captureCurrentSnapshot(step),
		}
	}

	setDialogResponse(action: 'accept' | 'dismiss', promptText?: string): string {
		if (action === 'dismiss') {
			this.pendingDialogHandlingIntent = { action }
			return 'Will dismiss the next JavaScript dialog.'
		}

		this.pendingDialogHandlingIntent = promptText === undefined ? { action } : { action, promptText }
		return promptText === undefined
			? 'Will accept the next JavaScript dialog.'
			: 'Will accept the next JavaScript dialog with prompt text.'
	}

	async navigateToUrl(url: string, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async (page) => {
				if (!url) {
					throw new Error(`valid URL is required for ${BrowserTool.TOOL_NAVIGATE} but received: '${url}'`)
				}

				try {
					await page.goto(url)
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
			async (page) => {
				try {
					if (hover) {
						await page.hover(`aria-ref=${ref}`)
					} else {
						await page.click(`aria-ref=${ref}`)
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

	async dragElement(sourceRef: string, targetRef: string, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async (page) => {
				try {
					if (!sourceRef || !targetRef) {
						throw new Error(
							`both 'sourceRef' and 'targetRef' are required for ${BrowserTool.TOOL_DRAG} but received sourceRef='${sourceRef}' and targetRef='${targetRef}'`
						)
					}

					const source = page.locator(`aria-ref=${sourceRef}`)
					const target = page.locator(`aria-ref=${targetRef}`)
					await source.dragTo(target)
				} catch (error) {
					logger.error(
						`error dragging element with ref '${sourceRef}' to element with ref '${targetRef}' due to:\n${error}`
					)
					return `failed to drag element with ref '${sourceRef}' to element with ref '${targetRef}':\n${error}\n try with different element type or ref`
				}
			},
			`Dragged element with ref '${sourceRef}' to element with ref '${targetRef}'.`,
			step
		)
	}

	async uploadFiles(ref: string, filePaths: string[], step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async (page) => {
				try {
					if (!ref || filePaths.length === 0 || filePaths.some((filePath) => !filePath)) {
						throw new Error(
							`'ref' and at least one file path are required for ${BrowserTool.TOOL_UPLOAD} but received ref='${ref}' and filePaths='${filePaths.join(', ')}'`
						)
					}

					await page.locator(`aria-ref=${ref}`).setInputFiles(filePaths)
				} catch (error) {
					logger.error(`error uploading files to element with ref '${ref}' due to:\n${error}`)
					return `failed to upload files to element with ref '${ref}':\n${error}\n try with different element type, ref, or file path`
				}
			},
			`Uploaded ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} to element with ref '${ref}'.`,
			step
		)
	}

	async typeOrSelectInElement(elements: BrowserInputElement[], step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async (page) => {
				for (const element of elements) {
					try {
						if (!element.ref || element.text === undefined || element.text === null) {
							throw new Error(
								`both 'ref' and 'text' are required for ${BrowserTool.TOOL_TYPE_OR_SELECT} but received ref='${element.ref}' and text='${element.text}'`
							)
						}

						if (!element.select && element.clear) {
							await page.locator(`aria-ref=${element.ref}`).clear()
						}

						if (element.select && element.text.length > 0) {
							await page.locator(`aria-ref=${element.ref}`).selectOption(element.text)
							continue
						}

						if (!element.select && element.text.length > 0) {
							await page.locator(`aria-ref=${element.ref}`).pressSequentially(element.text, { delay: 50 })
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
			async (page) => {
				try {
					if (!key) {
						throw new Error(`'key' is required for ${BrowserTool.TOOL_PRESS_KEY} but received: '${key}'`)
					}

					await page.keyboard.press(key)
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
		const page = await this.ensureActivePage()
		return new SnapshotService(page, this.config, step, { skipFilter: options.skipFilter }).get()
	}

	async wait(seconds: number, step: Step): Promise<AgentToolResponse | string> {
		return this.wrapWithTracker(
			async (page) => {
				try {
					if (!Number.isFinite(seconds) || seconds <= 0) {
						throw new Error(`invalid seconds value received: ${seconds}. It should be a positive number.`)
					}

					await page.waitForTimeout(seconds * 1000)
				} catch (error) {
					logger.error(`error waiting for ${seconds} seconds due to:\n${error}`)
					return `failed to wait for ${seconds} seconds:\n${error}`
				}
			},
			`Waited ${seconds} seconds.`,
			step
		)
	}

	private consumePendingDialogHandlingIntent(): DialogHandlingIntent | null {
		const intent = this.pendingDialogHandlingIntent
		this.pendingDialogHandlingIntent = null
		return intent
	}

	private registerExistingPages(): void {
		for (const page of this.browserContext.pages()) {
			this.registerPage(page)
		}
	}

	private registerPage(page: Page): string {
		const existingId = this.pageIds.get(page)
		if (existingId) {
			return existingId
		}

		const id = `p${this.nextPageNumber++}`
		this.pageIds.set(page, id)
		this.pagesById.set(id, page)
		return id
	}

	async ensureActivePage(): Promise<Page> {
		if (this.isPageClosed(this.activePage)) {
			await this.selectFallbackActivePage(this.activePage)
		}

		return this.getActivePage()
	}

	private async openPages(): Promise<Page[]> {
		this.registerExistingPages()
		const pages = this.browserContext.pages().filter((page) => !this.isPageClosed(page))
		for (const page of pages) {
			this.registerPage(page)
		}
		if (pages.length > 0 && this.isPageClosed(this.activePage)) {
			await this.selectFallbackActivePage(this.activePage)
		}
		return pages
	}

	private async findOpenPage(pageId: string): Promise<Page | null> {
		await this.openPages()
		const page = this.pagesById.get(pageId)
		return page && !this.isPageClosed(page) ? page : null
	}

	private async setActivePage(page: Page): Promise<void> {
		this.registerPage(page)
		this.activePage = page
		await page.bringToFront().catch((): undefined => undefined)
	}

	private async selectFallbackActivePage(closedPage: Page): Promise<void> {
		const opener = await closedPage.opener().catch((): null => null)
		if (opener && !this.isPageClosed(opener)) {
			await this.setActivePage(opener)
			return
		}

		await this.setNewestFallbackActivePage()
	}

	private selectNewestFallbackActivePage(): void {
		const page = this.browserContext
			.pages()
			.filter((candidate) => !this.isPageClosed(candidate))
			.at(-1)
		if (page) {
			this.registerPage(page)
			this.activePage = page
		}
	}

	private async setNewestFallbackActivePage(): Promise<void> {
		this.selectNewestFallbackActivePage()
		if (!this.isPageClosed(this.activePage)) {
			await this.setActivePage(this.activePage)
		}
	}

	private async selectNewPageOpenedAfter(knownPages: Set<Page>): Promise<string> {
		await this.waitForPageEventLoop()
		this.registerExistingPages()
		const activePage = this.getActivePage()
		const newPage = !knownPages.has(activePage)
			? activePage
			: this.browserContext
					.pages()
					.filter((page) => !knownPages.has(page) && !this.isPageClosed(page))
					.at(-1)

		if (!newPage) {
			return ''
		}

		await this.setActivePage(newPage)
		await newPage.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch((): undefined => undefined)
		const id = this.registerPage(newPage)
		return `Opened new tab ${id}: ${newPage.url()}. Active tab is now ${id}.`
	}

	private isPageClosed(page: Page): boolean {
		return page.isClosed()
	}

	private async safeTitle(page: Page): Promise<string> {
		return page.title().catch(() => '')
	}

	private async waitForPageEventLoop(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	private async wrapWithTracker(
		action: (page: Page) => Promise<unknown>,
		fallbackResponse: string,
		step: Step
	): Promise<AgentToolResponse | string> {
		const page = await this.ensureActivePage()
		const knownPages = new Set(this.browserContext.pages())
		this.networkRecorder.reset()
		const tracker = new TransientStateTracker(page, {
			consumeDialogHandlingIntent: () => this.consumePendingDialogHandlingIntent(),
		})
		await tracker.start()

		try {
			const actionResult = await action(page)
			const tabChangeResponse = await this.selectNewPageOpenedAfter(knownPages)
			if (typeof actionResult === 'string') {
				await tracker.stop()
				return tabChangeResponse ? `${tabChangeResponse}\n${actionResult}` : actionResult
			}

			const snapshot = await this.captureCurrentSnapshot(step)
			await tracker.stop()
			const formattedTimeline = tracker.formatTimeline()
			const response = formattedTimeline || fallbackResponse
			return { response: tabChangeResponse ? `${tabChangeResponse}\n${response}` : response, snapshot }
		} catch (error) {
			await tracker.stop()
			throw error
		} finally {
			this.pendingDialogHandlingIntent = null
		}
	}
}

/**
 * Wraps a tool's execution in its own named `test.step`, so Playwright's own instrumentation for
 * the underlying `page.*` calls nests one level under it instead of appearing as its siblings.
 *
 * The turn number comes from the dispatch context rather than a counter kept here, so the tree
 * and the `toolCalls` array in the report agree on what turn it was.
 *
 * `test.step()` throws when there is no active Playwright Test worker (`test.step() can only be
 * called from a test`), which happens whenever `web()` is driven directly from a plain script
 * rather than through `npx playwright test`. The wrapper is skipped there instead of failing
 * every tool call; inside a real test it behaves exactly as before.
 */
function withTurnStep(tool: AgentTool): AgentTool {
	return {
		...tool,
		execute: (args: unknown, context: AgentToolContext): Promise<AgentToolResult> =>
			isInsideTestWorker()
				? test.step(turnStepTitle(context.turn, tool.definition.name), () => tool.execute(args, context))
				: Promise.resolve(tool.execute(args, context)),
	}
}

function turnStepTitle(turn: number | undefined, toolName: string): string {
	return turn === undefined ? toolName : `turn ${turn} · ${toolName}`
}

function isInsideTestWorker(): boolean {
	try {
		test.info()
		return true
	} catch {
		return false
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
			name: BrowserTool.TOOL_SET_DIALOG_RESPONSE,
			description:
				'Set how to answer the next JavaScript alert, confirm, or prompt. Call this immediately before the browser action expected to open the dialog. Unarmed dialogs are dismissed automatically.',
			schema: dialogResponseSchema,
			handler: ({ action, promptText }) => runtime.setDialogResponse(action, promptText),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_DRAG,
			description: 'Drag a source element onto a target or drop element in the browser',
			schema: z
				.object({
					sourceRef: z.string().describe('ref value of the element to drag from the snapshot, example: e123'),
					sourceName: z.string().describe('name of the element to drag, example: File card'),
					targetRef: z.string().describe('ref value of the drop target from the snapshot, example: e456'),
					targetName: z.string().describe('name of the element to drop onto, example: Done column'),
					goal: z.string().describe('The goal or purpose of dragging this element'),
				})
				.strict(),
			handler: ({ sourceRef, targetRef }, context) => runtime.dragElement(sourceRef, targetRef, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_UPLOAD,
			description: 'Upload one or more local files to a file input element in the browser',
			schema: z
				.object({
					ref: z.string().describe('ref value of the file input element from the snapshot, example: e123'),
					name: z.string().describe('name of the file input element, example: Resume Upload'),
					filePaths: z
						.array(z.string())
						.min(1)
						.describe('local file paths to upload, example: ["fixtures/resume.pdf"]'),
					goal: z.string().describe('The goal or purpose of uploading these files'),
				})
				.strict(),
			handler: ({ ref, filePaths }, context) => runtime.uploadFiles(ref, filePaths, context.step),
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
		defineAgentTool({
			name: BrowserTool.TOOL_LIST_TABS,
			description: 'List open browser tabs and show which tab is active',
			schema: z
				.object({
					goal: z.string().describe('The goal or purpose of listing browser tabs'),
				})
				.strict(),
			handler: () => runtime.listPages(),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_SELECT_TAB,
			description: 'Select an open browser tab by pageId and make it active',
			schema: z
				.object({
					pageId: z.string().describe('Browser tab id from browser_list_tabs, example: p2'),
					goal: z.string().describe('The goal or purpose of selecting this browser tab'),
				})
				.strict(),
			handler: ({ pageId }, context) => runtime.selectPage(pageId, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_CLOSE_TAB,
			description: 'Close a browser tab by pageId, or close the active tab when pageId is null',
			schema: z
				.object({
					pageId: z
						.string()
						.nullable()
						.describe('Browser tab id from browser_list_tabs, or null for active tab'),
					goal: z.string().describe('The goal or purpose of closing this browser tab'),
				})
				.strict(),
			handler: ({ pageId }, context) => runtime.closePage(pageId, context.step),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_NETWORK_REQUESTS,
			description:
				"List the API calls (fetch/XHR) the browser made during the last browser action only - call this again after each new action to see its calls. Set 'static' to true to also include images, fonts, and other non-API resources.",
			schema: z
				.object({
					static: z
						.boolean()
						.describe('If true, also include non-API resource types like images, fonts, and stylesheets'),
					goal: z.string().describe('The goal or purpose of listing network requests'),
				})
				.strict(),
			handler: ({ static: includeStatic }) => runtime.listNetworkRequests(includeStatic),
		}),
		defineAgentTool({
			name: BrowserTool.TOOL_NETWORK_REQUEST,
			description:
				'Inspect one network request from the most recent browser_network_requests result, using its number. Only valid until the next browser action resets the list.',
			schema: z
				.object({
					sequence: z
						.number()
						.describe('The number of the request from browser_network_requests, example: 1'),
					part: z
						.enum(['detail', 'request-body', 'response-body'])
						.describe("What to return: 'detail' for headers and timing, or the request/response body"),
					goal: z.string().describe('The goal or purpose of inspecting this network request'),
				})
				.strict(),
			handler: ({ sequence, part }) => runtime.inspectNetworkRequest(sequence, part),
		}),
	].map(withTurnStep)
}
