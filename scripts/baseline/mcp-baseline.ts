/**
 * Vendored MCP-shaped tool surface for the benchmark's baseline arm.
 *
 * `@playwright/mcp` is deliberately not taken as a dependency here: pulling it in as a dev
 * dependency to run a script that only ever executes on release would put a moving target in
 * the middle of a number this repository publishes — the tool surface would drift under the
 * benchmark between runs, and the dependency tree grows for everyone who clones the repo.
 *
 * This file is instead a plain, readable transcription of that server's documented `browser_*`
 * tools (https://github.com/microsoft/playwright-mcp) at a pinned, commented version:
 *
 *   Transcribed from the tool surface documented at https://playwright.dev/mcp/introduction as
 *   of this benchmark's authoring (2026-08). Confirm the current `@playwright/mcp` tag against
 *   that page before publishing a new benchmark run, and update this comment to match.
 *
 * It drives the exact same browser runtime the `checkmate` arm uses (`BrowserToolRuntime` from
 * `src/tools/browser/tool.ts`) — only two things differ from `web()`:
 *
 * - The tool surface here mirrors MCP's broader, more granular action set (18 tools) instead of
 *   Checkmate's 12 consolidated browser tools.
 * - Every snapshot and screenshot is appended as ordinary, non-ephemeral context, so it
 *   accumulates for the rest of the step instead of being replaced each turn. That's the "full
 *   accumulated context" policy in `docs/BENCHMARK.md`, set by simply never marking a
 *   `ContextMessage` `ephemeral: true` — `StepExecution` only ever drops messages that were
 *   marked that way, so omitting the flag is the entire behavioral difference.
 *
 * A handful of MCP tools that don't bear on the benchmarked flows — `browser_console_messages`,
 * `browser_network_requests`, `browser_evaluate`, `browser_pdf_save`, `browser_install` — are
 * left out rather than stubbed. Their absence does not change the tool count comparison in a way
 * that favours either arm: none of them replace the actions the benchmark's flows require.
 */
import { z } from 'zod/v4'
import { CheckmateExtension, ContextMessage, Step, defineAgentTool, defineExtension } from '../../src/core.js'
import { MessageHistory } from '../../src/ai/message-history.js'
import { BrowserToolRuntime } from '../../src/tools/browser/tool.js'
import { BrowserScreenshotService } from '../../src/tools/browser/screenshot-service.js'
import type { Page } from '@playwright/test'

export type McpBaselineOptions = {
	/**
	 * Original Playwright page used to create the browser runtime.
	 */
	page: Page
}

const refDescription = 'Exact target element reference from the page snapshot'
const elementDescription = 'Human-readable target element description, used to obtain permission to interact'

/**
 * Creates the vendored MCP-shaped baseline extension for the benchmark's `mcp-baseline` arm.
 *
 * @example
 * ```ts
 * import { createRunner } from '@xoxoai/checkmate/core'
 * import { mcpBaseline } from './scripts/baseline/mcp-baseline.js'
 *
 * const runner = createRunner({ config, extensions: [mcpBaseline({ page })] })
 * ```
 */
export function mcpBaseline({ page }: McpBaselineOptions): CheckmateExtension {
	const messageHistory = new MessageHistory()

	return defineExtension({
		name: 'mcp-baseline',
		instructions: [
			`Browser tools operate on the active browser tab. Use the 'ref' from the most recent snapshot to target elements.`,
			`Call 'browser_snapshot' whenever you need the current accessibility tree of the page.`,
		],
		setup(api) {
			const runtime = new BrowserToolRuntime(page, api.config)

			const fullSnapshotMessage = async (step: Step): Promise<ContextMessage> => {
				const snapshot = await runtime.captureCurrentSnapshot(step, { skipFilter: true })
				return { message: messageHistory.createSnapshotMessage(snapshot).message }
			}

			api.addInitialMessages(async ({ step }) => [await fullSnapshotMessage(step)])

			api.addTool(createMcpBaselineTools(runtime))

			api.addToolResponsesHook(async ({ toolResponses }) => {
				const context: ContextMessage[] = []

				for (const { toolResponse } of toolResponses) {
					if (toolResponse.snapshot) {
						context.push({ message: messageHistory.createSnapshotMessage(toolResponse.snapshot).message })
					}
				}

				if (api.config.screenshots) {
					const screenshot = await new BrowserScreenshotService(
						await runtime.ensureActivePage()
					).getCompressedScreenshot()
					context.push({
						message: messageHistory.createScreenshotMessage(
							screenshot.data,
							screenshot.mimeType ?? 'image/png'
						).message,
					})
				}

				return context
			})
		},
	})
}

function createMcpBaselineTools(runtime: BrowserToolRuntime) {
	return [
		defineAgentTool({
			name: 'browser_navigate',
			description: 'Navigate to a URL',
			schema: z.object({ url: z.string().describe('URL to navigate to') }).strict(),
			handler: ({ url }, { step }) => runtime.navigateToUrl(url, step),
		}),
		defineAgentTool({
			name: 'browser_navigate_back',
			description: 'Go back to the previous page',
			schema: z.object({}).strict(),
			handler: async (_args, { step }) => {
				const page = await runtime.ensureActivePage()
				await page.goBack()
				return {
					response: 'Navigated back.',
					snapshot: await runtime.captureCurrentSnapshot(step, { skipFilter: true }),
				}
			},
		}),
		defineAgentTool({
			name: 'browser_click',
			description: 'Click on an element on the page',
			schema: z
				.object({ ref: z.string().describe(refDescription), element: z.string().describe(elementDescription) })
				.strict(),
			handler: ({ ref }, { step }) => runtime.clickElement(ref, false, step),
		}),
		defineAgentTool({
			name: 'browser_hover',
			description: 'Hover over an element on the page',
			schema: z
				.object({ ref: z.string().describe(refDescription), element: z.string().describe(elementDescription) })
				.strict(),
			handler: ({ ref }, { step }) => runtime.clickElement(ref, true, step),
		}),
		defineAgentTool({
			name: 'browser_type',
			description: 'Type text into an editable element',
			schema: z
				.object({
					ref: z.string().describe(refDescription),
					element: z.string().describe(elementDescription),
					text: z.string().describe('Text to type'),
					submit: z.boolean().describe('Whether to press Enter after typing'),
				})
				.strict(),
			handler: async ({ ref, text, submit }, { step }) => {
				const result = await runtime.typeOrSelectInElement(
					[{ ref, text, name: '', clear: true, select: false }],
					step
				)
				if (!submit) {
					return result
				}
				return runtime.pressKey('Enter', step)
			},
		}),
		defineAgentTool({
			name: 'browser_select_option',
			description: 'Select an option in a dropdown',
			schema: z
				.object({
					ref: z.string().describe(refDescription),
					element: z.string().describe(elementDescription),
					values: z.array(z.string()).describe('Option value(s) to select'),
				})
				.strict(),
			handler: ({ ref, values }, { step }) =>
				runtime.typeOrSelectInElement(
					[{ ref, text: values[0] ?? '', name: '', clear: false, select: true }],
					step
				),
		}),
		defineAgentTool({
			name: 'browser_drag',
			description: 'Drag one element onto another',
			schema: z
				.object({
					startRef: z.string().describe('Ref of the element to drag'),
					startElement: z.string().describe('Human-readable description of the source element'),
					endRef: z.string().describe('Ref of the element to drop onto'),
					endElement: z.string().describe('Human-readable description of the target element'),
				})
				.strict(),
			handler: ({ startRef, endRef }, { step }) => runtime.dragElement(startRef, endRef, step),
		}),
		defineAgentTool({
			name: 'browser_press_key',
			description: 'Press a keyboard key',
			schema: z.object({ key: z.string().describe("Key name, e.g. 'Enter' or 'ArrowLeft'") }).strict(),
			handler: ({ key }, { step }) => runtime.pressKey(key, step),
		}),
		defineAgentTool({
			name: 'browser_file_upload',
			description: 'Upload one or more files to a file input element',
			schema: z
				.object({
					ref: z.string().describe(refDescription),
					element: z.string().describe(elementDescription),
					paths: z.array(z.string()).describe('Absolute file paths to upload'),
				})
				.strict(),
			handler: ({ ref, paths }, { step }) => runtime.uploadFiles(ref, paths, step),
		}),
		defineAgentTool({
			name: 'browser_handle_dialog',
			description: 'Arm a response for the next JavaScript dialog (alert, confirm, or prompt)',
			schema: z
				.object({
					accept: z.boolean().describe('Whether to accept the dialog'),
					promptText: z.string().nullable().describe('Text to submit for a prompt() dialog, otherwise null'),
				})
				.strict(),
			handler: ({ accept, promptText }) =>
				runtime.setDialogResponse(accept ? 'accept' : 'dismiss', promptText ?? undefined),
		}),
		defineAgentTool({
			name: 'browser_wait_for',
			description: 'Wait for a number of seconds',
			schema: z.object({ time: z.number().describe('Seconds to wait') }).strict(),
			handler: ({ time }, { step }) => runtime.wait(time, step),
		}),
		defineAgentTool({
			name: 'browser_snapshot',
			description: 'Capture the current accessibility snapshot of the page, better than a screenshot',
			schema: z.object({}).strict(),
			handler: async (_args, { step }) => ({
				response: 'Captured accessibility snapshot.',
				snapshot: await runtime.captureCurrentSnapshot(step, { skipFilter: true }),
			}),
		}),
		defineAgentTool({
			name: 'browser_take_screenshot',
			description: 'Take a screenshot of the current page',
			schema: z.object({}).strict(),
			handler: () => 'Screenshot captured; attached to context when screenshots are enabled.',
		}),
		defineAgentTool({
			name: 'browser_tab_list',
			description: 'List open browser tabs',
			schema: z.object({}).strict(),
			handler: () => runtime.listPages(),
		}),
		defineAgentTool({
			name: 'browser_tab_new',
			description: 'Open a new browser tab, optionally navigating it to a URL',
			schema: z
				.object({ url: z.string().nullable().describe('URL to open in the new tab, or null for a blank tab') })
				.strict(),
			handler: async ({ url }, { step }) => {
				const newPage = await runtime.getBrowserContext().newPage()
				if (url) {
					await newPage.goto(url)
				}
				return {
					response: `Opened new tab${url ? ` at ${url}` : ''}.`,
					snapshot: await runtime.captureCurrentSnapshot(step, { skipFilter: true }),
				}
			},
		}),
		defineAgentTool({
			name: 'browser_tab_select',
			description: 'Select a browser tab by id, as listed by browser_tab_list',
			schema: z.object({ tabId: z.string().describe("Tab id from 'browser_tab_list', example: p2") }).strict(),
			handler: ({ tabId }, { step }) => runtime.selectPage(tabId, step),
		}),
		defineAgentTool({
			name: 'browser_tab_close',
			description: 'Close a browser tab by id, as listed by browser_tab_list',
			schema: z
				.object({ tabId: z.string().nullable().describe('Tab id to close, or null for the active tab') })
				.strict(),
			handler: ({ tabId }, { step }) => runtime.closePage(tabId, step),
		}),
		defineAgentTool({
			name: 'browser_resize',
			description: 'Resize the browser viewport',
			schema: z.object({ width: z.number(), height: z.number() }).strict(),
			handler: async ({ width, height }) => {
				const page = await runtime.ensureActivePage()
				await page.setViewportSize({ width, height })
				return `Resized viewport to ${width}x${height}.`
			},
		}),
	]
}
