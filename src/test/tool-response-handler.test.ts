import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResponseHandler } from '../ai/tool-response-handler'
import { ToolResponse } from '../tools/registry'
import { ResolveStepResult } from '../runtime/types'
import { logger } from '../logging'

vi.mock('../../src/logging', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe('ToolResponseHandler', () => {
	let openaiClient: {
		addToolResponse: ReturnType<typeof vi.fn>
		addToolExecutionSummaryMessage: ReturnType<typeof vi.fn>
		addCurrentSnapshotMessage: ReturnType<typeof vi.fn>
		addCurrentScreenshotMessage: ReturnType<typeof vi.fn>
		sendToolResponseWithRetry: ReturnType<typeof vi.fn>
	}
	let historyManager: { removeEphemeralStateMessages: ReturnType<typeof vi.fn> }
	let responseProcessor: { handleResponse: ReturnType<typeof vi.fn> }
	let extensionHost: { handleToolResponses: ReturnType<typeof vi.fn> }
	let handler: ToolResponseHandler
	let callback: ResolveStepResult

	beforeEach(() => {
		vi.clearAllMocks()
		openaiClient = {
			addToolResponse: vi.fn().mockResolvedValue(undefined),
			addToolExecutionSummaryMessage: vi.fn().mockResolvedValue(undefined),
			addCurrentSnapshotMessage: vi.fn().mockResolvedValue(undefined),
			addCurrentScreenshotMessage: vi.fn().mockResolvedValue(undefined),
			sendToolResponseWithRetry: vi.fn().mockResolvedValue({ choices: [] }),
		}
		historyManager = {
			removeEphemeralStateMessages: vi.fn(),
		}
		responseProcessor = {
			handleResponse: vi.fn().mockResolvedValue(undefined),
		}
		extensionHost = {
			handleToolResponses: vi.fn().mockImplementation(async ({ aiClient, toolResponses }) => {
				const latestSnapshot = toolResponses.at(-1)?.toolResponse.snapshot
				if (latestSnapshot) {
					await aiClient.addCurrentSnapshotMessage(latestSnapshot)
				}

				await aiClient.addCurrentScreenshotMessage('YmFzZTY0', 'image/png')
			}),
		}
		handler = new ToolResponseHandler(
			openaiClient as never,
			historyManager as never,
			responseProcessor as never,
			extensionHost as never
		)
		callback = vi.fn()
	})

	it('removes previous floating state and appends summary, snapshot, and screenshot', async () => {
		const step = { action: 'act', expect: 'done' }
		const toolResponse: ToolResponse = {
			name: 'browser_click_or_hover',
			response: 'Timeline of events after last function call:\n[123ms] Clicked submit',
			snapshot: 'page snapshot:\n{button Submit}',
			status: 'success',
		}

		await handler.handleMultiple(
			[
				{
					toolCallId: 'call_1',
					toolCall: { name: 'browser_click_or_hover', arguments: { ref: 'e123', goal: 'submit form' } },
					toolResponse,
				},
			],
			step,
			callback
		)

		expect(historyManager.removeEphemeralStateMessages).toHaveBeenCalledWith(openaiClient)
		expect(openaiClient.addToolResponse).toHaveBeenCalledWith('call_1', toolResponse.response)
		expect(openaiClient.addToolExecutionSummaryMessage).toHaveBeenCalledWith(
			'- successfully executed: browser_click_or_hover {"ref":"e123","goal":"submit form"}'
		)
		expect(openaiClient.addCurrentSnapshotMessage).toHaveBeenCalledWith(toolResponse.snapshot)
		expect(openaiClient.addCurrentScreenshotMessage).toHaveBeenCalledWith('YmFzZTY0', 'image/png')
		expect(openaiClient.sendToolResponseWithRetry).toHaveBeenCalledTimes(1)
		expect(responseProcessor.handleResponse).toHaveBeenCalledWith({ choices: [] }, step, callback)
	})

	it('keeps append-only history even when no snapshot is returned', async () => {
		const step = { action: 'act', expect: 'done' }
		const toolResponse: ToolResponse = {
			name: 'browser_click_or_hover',
			response: 'failed to click element',
			snapshot: null,
			status: 'error',
		}

		await handler.handleMultiple(
			[
				{
					toolCallId: 'call_1',
					toolCall: {
						name: 'browser_click_or_hover',
						arguments: { ref: 'e999', goal: 'click missing button' },
					},
					toolResponse,
				},
			],
			step,
			callback
		)

		expect(historyManager.removeEphemeralStateMessages).toHaveBeenCalledWith(openaiClient)
		expect(openaiClient.addToolResponse).toHaveBeenCalledWith('call_1', toolResponse.response)
		expect(openaiClient.addToolExecutionSummaryMessage).toHaveBeenCalledWith(
			'- tool call error: browser_click_or_hover {"ref":"e999","goal":"click missing button"} -> failed to click element'
		)
		expect(openaiClient.addCurrentSnapshotMessage).not.toHaveBeenCalled()
		expect(openaiClient.addCurrentScreenshotMessage).toHaveBeenCalledTimes(1)
	})

	it('redacts secrets and image data from error diagnostics', async () => {
		const step = { action: 'act', expect: 'done' }
		const base64 = 'A'.repeat(220)
		const toolResponse: ToolResponse = {
			name: 'browser_upload',
			response: `failed with Authorization: Bearer sk-response and data:image/png;base64,${base64}`,
			snapshot: null,
			status: 'error',
		}

		await handler.handleMultiple(
			[
				{
					toolCallId: 'call_secret',
					toolCall: {
						name: 'browser_upload',
						arguments: {
							apiKey: 'sk-argument',
							cookie: 'Cookie: session=secret',
							image: `data:image/png;base64,${base64}`,
						},
					},
					toolResponse,
				},
			],
			step,
			callback
		)

		const warnings = vi
			.mocked(logger.warn)
			.mock.calls.map((call) => String(call[0]))
			.join('\n')
		expect(warnings).toContain('call_secret')
		expect(warnings).toContain('[secret omitted]')
		expect(warnings).toContain('[image omitted]')
		expect(warnings).not.toContain('sk-argument')
		expect(warnings).not.toContain('sk-response')
		expect(warnings).not.toContain(base64)
		expect(warnings).not.toContain('session=secret')
	})
})
