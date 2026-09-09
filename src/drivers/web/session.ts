import type { Browser, BrowserContext, Page } from 'playwright'
import type {
	DriverContextMessage,
	DriverEvidenceSink,
	DriverLogger,
	DriverSession,
	DriverTool,
	DriverToolResult,
	StepIntent,
} from '../../driver.js'
import { BrowserScreenshotService } from './tools/screenshot-service.js'
import { BrowserToolRuntime, createBrowserTools } from './tools/tool.js'
import { SnapshotService } from './tools/snapshot-service.js'
import type { AgentToolResult } from '../../tools/types.js'

export type WebDriverTarget = { baseUrl: string }

export type WebDriverSettings = {
	headless: boolean
	snapshotFilter: boolean
	snapshotTopPercent: number
	screenshotsInModelContext: boolean
}

type WebResources = {
	browser: Browser
	context: BrowserContext
	page: Page
}

const WEB_INSTRUCTIONS = [
	'Browser tools operate on the active browser tab/page. Tabs and popups opened by browser actions become active automatically.',
	"Use 'browser_list_tabs', 'browser_select_tab', and 'browser_close_tab' to inspect, switch, or close browser tabs and popups.",
	"If you cannot find elements, call 'browser_snapshot' to fetch the latest full snapshot of the active page.",
	"For JavaScript alert, confirm, or prompt dialogs, call 'browser_set_dialog_response' immediately before the browser action that opens the dialog when the step needs OK, Cancel, or prompt text. Unarmed dialogs are dismissed automatically.",
	"To verify backend behavior, call 'browser_network_requests' after a browser action to see the API calls that action triggered. Each call only covers the browser action immediately before it. Use 'browser_network_request' with a request's number to inspect its headers or read its request/response body.",
]

export async function createWebDriverSession(
	resources: WebResources,
	settings: WebDriverSettings,
	evidence: DriverEvidenceSink | undefined,
	logger: DriverLogger
): Promise<DriverSession> {
	const toolSettings = {
		snapshotFilter: settings.snapshotFilter,
		snapshotTopPercent: settings.snapshotTopPercent,
	}
	const runtime = new BrowserToolRuntime(resources.page, toolSettings, logger)
	let stagedSnapshot: string | null = null
	let closed = false
	const tools = createBrowserTools(runtime).map<DriverTool>((tool) => ({
		definition: { ...tool.definition, parameters: structuredClone(tool.definition.parameters) },
		execute: async (args, context) => {
			const result = await tool.execute(args, {
				step: context.step,
				turn: context.turn,
				signal: context.signal,
			})
			return adaptToolResult(result, (snapshot) => {
				stagedSnapshot = snapshot
			})
		},
	}))

	return {
		tools,
		instructions: WEB_INSTRUCTIONS,
		buildInitialContext: async ({ step, signal }) => {
			signal.throwIfAborted()
			const snapshot = await snapshotFor(runtime, toolSettings, step, logger)
			if (snapshot && evidence) {
				await evidence.capture({
					kind: 'aria-snapshot',
					mediaType: 'application/yaml',
					content: snapshot,
					stepId: step.id,
				})
			}
			return snapshot ? [snapshotMessage(snapshot)] : []
		},
		handleToolResponses: async ({ step, signal }) => {
			signal.throwIfAborted()
			const messages: DriverContextMessage[] = []
			if (stagedSnapshot) {
				if (evidence) {
					await evidence.capture({
						kind: 'aria-snapshot',
						mediaType: 'application/yaml',
						content: stagedSnapshot,
						stepId: step.id,
					})
				}
				messages.push(snapshotMessage(stagedSnapshot))
				stagedSnapshot = null
			}
			if (settings.screenshotsInModelContext) {
				const screenshot = await new BrowserScreenshotService(
					await runtime.ensureActivePage()
				).getCompressedScreenshot()
				messages.push({
					content: [
						{ type: 'text', text: 'this is a current screenshot of the page' },
						{ type: 'image', mediaType: screenshot.mimeType ?? 'image/png', data: screenshot.data },
					],
					ephemeral: true,
				})
			}
			return messages
		},
		close: async () => {
			if (closed) return
			closed = true
			const failures: unknown[] = []
			try {
				runtime.dispose()
			} catch (error) {
				failures.push(error)
			}
			for (const close of [() => resources.context.close(), () => resources.browser.close()]) {
				try {
					await close()
				} catch (error) {
					failures.push(error)
				}
			}
			if (failures.length > 0) throw new AggregateError(failures, 'Web driver cleanup failed')
		},
	}
}

export function webTarget(input: unknown): WebDriverTarget {
	if (!input || typeof input !== 'object' || typeof (input as { baseUrl?: unknown }).baseUrl !== 'string') {
		throw new Error('Web driver target requires baseUrl')
	}
	return { baseUrl: (input as { baseUrl: string }).baseUrl }
}

export function webSettings(input: unknown): WebDriverSettings {
	const value = input && typeof input === 'object' ? (input as Partial<WebDriverSettings>) : {}
	return {
		headless: value.headless ?? true,
		snapshotFilter: value.snapshotFilter ?? false,
		snapshotTopPercent: value.snapshotTopPercent ?? 10,
		screenshotsInModelContext: value.screenshotsInModelContext ?? false,
	}
}

export async function rollbackWebResources(resources: Partial<WebResources>): Promise<void> {
	await Promise.allSettled([resources.context?.close(), resources.browser?.close()])
}

function adaptToolResult(result: AgentToolResult, stage: (snapshot: string) => void): DriverToolResult {
	if (!result || typeof result === 'string') return result
	if (result.snapshot) stage(result.snapshot)
	return { response: result.response, status: result.status ?? 'success' }
}

async function snapshotFor(
	runtime: BrowserToolRuntime,
	settings: Pick<WebDriverSettings, 'snapshotFilter' | 'snapshotTopPercent'>,
	step: StepIntent,
	logger: DriverLogger
): Promise<string | null> {
	return new SnapshotService(await runtime.ensureActivePage(), settings, logger, step).get()
}

function snapshotMessage(snapshot: string): DriverContextMessage {
	return { content: `this is a current page snapshot:\n${snapshot}`, ephemeral: true }
}
