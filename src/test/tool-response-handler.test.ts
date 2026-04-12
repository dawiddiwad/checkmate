import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResponseHandler } from '../step/tool/tool-response-handler'
import { ToolResponse } from '../step/tool/tool-registry'
import { StepStatusCallback } from '../step/types'

describe('ToolResponseHandler', () => {
	let openaiClient: {
		getConfigurationManager: ReturnType<typeof vi.fn>
		addToolResponse: ReturnType<typeof vi.fn>
		addCurrentSnapshotMessage: ReturnType<typeof vi.fn>
		addCurrentScreenshotMessage: ReturnType<typeof vi.fn>
		sendToolResponseWithRetry: ReturnType<typeof vi.fn>
	}
	let historyManager: { removeEphemeralStateMessages: ReturnType<typeof vi.fn> }
	let screenshotProcessor: { getCompressedScreenshot: ReturnType<typeof vi.fn> }
	let responseProcessor: { handleResponse: ReturnType<typeof vi.fn> }
	let handler: ToolResponseHandler
	let callback: StepStatusCallback

	beforeEach(() => {
		openaiClient = {
			getConfigurationManager: vi
				.fn()
				.mockReturnValue({ includeScreenshotInSnapshot: vi.fn().mockReturnValue(true) }),
			addToolResponse: vi.fn().mockResolvedValue(undefined),
			addCurrentSnapshotMessage: vi.fn().mockResolvedValue(undefined),
			addCurrentScreenshotMessage: vi.fn().mockResolvedValue(undefined),
			sendToolResponseWithRetry: vi.fn().mockResolvedValue({ choices: [] }),
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
			responseProcessor as never
		)
		callback = vi.fn()
	})

	it('removes previous floating state and appends summary, snapshot, and screenshot', async () => {
		const step = { action: 'act', expect: 'done' }
		const toolResponse: ToolResponse = {
			name: 'browser_click_or_hover',
			response: 'Timeline of events after last function call:\n[123ms] Clicked submit',
			snapshot: 'page snapshot:\n{button Submit}',
		}

		await handler.handleMultiple([{ toolCallId: 'call_1', toolResponse }], step, callback)

		expect(historyManager.removeEphemeralStateMessages).toHaveBeenCalledWith(openaiClient)
		expect(openaiClient.addToolResponse).toHaveBeenCalledWith('call_1', toolResponse.response)
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
		}

		await handler.handleMultiple([{ toolCallId: 'call_1', toolResponse }], step, callback)

		expect(historyManager.removeEphemeralStateMessages).toHaveBeenCalledWith(openaiClient)
		expect(openaiClient.addToolResponse).toHaveBeenCalledWith('call_1', toolResponse.response)
		expect(openaiClient.addCurrentSnapshotMessage).not.toHaveBeenCalled()
		expect(openaiClient.addCurrentScreenshotMessage).toHaveBeenCalledTimes(1)
	})
})
