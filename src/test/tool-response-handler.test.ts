import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResponseHandler } from '../ai/tool-response-handler'
import { ToolResponse } from '../tools/registry'
import { ResolveStepResult } from '../runtime/types'
import { RuntimeConfig } from '../config/runtime-config'

describe('ToolResponseHandler', () => {
	let openaiClient: {
		addToolResponse: ReturnType<typeof vi.fn>
		addToolExecutionSummaryMessage: ReturnType<typeof vi.fn>
		addCurrentSnapshotMessage: ReturnType<typeof vi.fn>
		addCurrentScreenshotMessage: ReturnType<typeof vi.fn>
		sendToolResponseWithRetry: ReturnType<typeof vi.fn>
	}
	let historyManager: { removeEphemeralStateMessages: ReturnType<typeof vi.fn> }
	let screenshotProcessor: { getCompressedScreenshot: ReturnType<typeof vi.fn> }
	let responseProcessor: { handleResponse: ReturnType<typeof vi.fn> }
	let runtimeConfig: { includeScreenshotInSnapshot: ReturnType<typeof vi.fn> }
	let handler: ToolResponseHandler
	let callback: ResolveStepResult

	beforeEach(() => {
		openaiClient = {
			addToolResponse: vi.fn().mockResolvedValue(undefined),
			addToolExecutionSummaryMessage: vi.fn().mockResolvedValue(undefined),
			addCurrentSnapshotMessage: vi.fn().mockResolvedValue(undefined),
			addCurrentScreenshotMessage: vi.fn().mockResolvedValue(undefined),
			sendToolResponseWithRetry: vi.fn().mockResolvedValue({ choices: [] }),
		}
		runtimeConfig = {
			includeScreenshotInSnapshot: vi.fn().mockReturnValue(true),
		}
		historyManager = {
			removeEphemeralStateMessages: vi.fn(),
		}
		screenshotProcessor = {
			getCompressedScreenshot: vi.fn().mockResolvedValue({ data: 'YmFzZTY0', mimeType: 'image/png' }),
		}
		responseProcessor = {
			handleResponse: vi.fn().mockResolvedValue(undefined),
		}
		handler = new ToolResponseHandler(
			openaiClient as never,
			historyManager as never,
			screenshotProcessor as never,
			responseProcessor as never,
			runtimeConfig as unknown as RuntimeConfig
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
})
