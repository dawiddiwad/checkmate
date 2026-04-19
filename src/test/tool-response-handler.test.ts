import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResponseHandler } from '../ai/tool-response-handler'
import { ToolResponse } from '../tools/registry'
import { ResolveStepResult } from '../runtime/types'
import { RuntimeConfig } from '../config/runtime-config'

describe('ToolResponseHandler', () => {
	let openaiClient: {
		addToolResponse: ReturnType<typeof vi.fn>
		addToolExecutionSummaryMessage: ReturnType<typeof vi.fn>
		addMessages: ReturnType<typeof vi.fn>
		getServices: ReturnType<typeof vi.fn>
		sendToolResponseWithRetry: ReturnType<typeof vi.fn>
	}
	let historyManager: {
		removeEphemeralStateMessages: ReturnType<typeof vi.fn>
		buildContextMessages: ReturnType<typeof vi.fn>
	}
	let responseProcessor: { handleResponse: ReturnType<typeof vi.fn> }
	let runtimeConfig: { includeScreenshotInSnapshot: ReturnType<typeof vi.fn> }
	let handler: ToolResponseHandler
	let callback: ResolveStepResult

	beforeEach(() => {
		openaiClient = {
			addToolResponse: vi.fn().mockResolvedValue(undefined),
			addToolExecutionSummaryMessage: vi.fn().mockResolvedValue(undefined),
			addMessages: vi.fn().mockResolvedValue(undefined),
			getServices: vi.fn().mockReturnValue({
				browser: {
					getScreenshotContextItem: vi.fn().mockResolvedValue({
						kind: 'image',
						name: 'browser.screenshot',
						mimeType: 'image/png',
						data: 'YmFzZTY0',
					}),
				},
			}),
			sendToolResponseWithRetry: vi.fn().mockResolvedValue({ choices: [] }),
		}
		runtimeConfig = {
			includeScreenshotInSnapshot: vi.fn().mockReturnValue(true),
		}
		historyManager = {
			removeEphemeralStateMessages: vi.fn(),
			buildContextMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'context' }]),
		}
		responseProcessor = {
			handleResponse: vi.fn().mockResolvedValue(undefined),
		}
		handler = new ToolResponseHandler(
			openaiClient as never,
			historyManager as never,
			responseProcessor as never,
			runtimeConfig as unknown as RuntimeConfig
		)
		callback = vi.fn()
	})

	it('removes previous floating state and appends summary and context', async () => {
		const step = { action: 'act', expect: 'done' }
		const toolResponse: ToolResponse = {
			name: 'browser_click_or_hover',
			response: 'Timeline of events after last function call:\n[123ms] Clicked submit',
			context: [{ kind: 'text', name: 'browser.snapshot', content: 'page snapshot:\n{button Submit}' }],
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
		expect(historyManager.buildContextMessages).toHaveBeenCalledWith([
			{ kind: 'text', name: 'browser.snapshot', content: 'page snapshot:\n{button Submit}' },
			{ kind: 'image', name: 'browser.screenshot', mimeType: 'image/png', data: 'YmFzZTY0' },
		])
		expect(openaiClient.addMessages).toHaveBeenCalledWith([{ role: 'user', content: 'context' }])
		expect(openaiClient.sendToolResponseWithRetry).toHaveBeenCalledTimes(1)
		expect(responseProcessor.handleResponse).toHaveBeenCalledWith({ choices: [] }, step, callback)
	})

	it('keeps append-only history even when no context is returned', async () => {
		const step = { action: 'act', expect: 'done' }
		const toolResponse: ToolResponse = {
			name: 'browser_click_or_hover',
			response: 'failed to click element',
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
		expect(historyManager.buildContextMessages).toHaveBeenCalledWith([
			{ kind: 'image', name: 'browser.screenshot', mimeType: 'image/png', data: 'YmFzZTY0' },
		])
		expect(openaiClient.addMessages).toHaveBeenCalledTimes(1)
	})
})
