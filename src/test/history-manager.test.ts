import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MessageHistory } from '../ai/message-history'
import { AiClient } from '../ai/client'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { MockOpenAIClient } from './test-types'

interface TextContentPart {
	type: 'text'
	text: string
}

describe('MessageHistory', () => {
	let historyManager: MessageHistory
	let mockOpenAIClient: MockOpenAIClient

	beforeEach(() => {
		historyManager = new MessageHistory()
		mockOpenAIClient = {
			getMessages: vi.fn(),
			replaceHistory: vi.fn(),
		}
	})

	describe('buildInitialMessages', () => {
		it('should build initial messages with system prompt, step prompt, and context', () => {
			const initialMessages = historyManager.buildInitialMessages({
				systemPrompt: 'system prompt',
				userPrompt: 'step prompt',
				contextItems: [
					{ kind: 'text', name: 'browser.snapshot', content: 'Page Title: Test Page\nButton: Click Me' },
				],
			})

			expect(initialMessages).toHaveLength(3)
			expect(initialMessages[0].role).toBe('system')
			expect(initialMessages[1].role).toBe('user')
			expect(initialMessages[2].role).toBe('user')
			expect((initialMessages[0].content as TextContentPart[])[0].text).toBe('system prompt')
			expect((initialMessages[1].content as TextContentPart[])[0].text).toBe('step prompt')
			expect((initialMessages[2].content as TextContentPart[])[0].text).toContain(
				MessageHistory.CONTEXT_IDENTIFIER
			)
		})
	})

	describe('removeEphemeralStateMessages', () => {
		it('should remove floating context messages while keeping append-only history', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{ role: 'system', content: 'system prompt' },
				{ role: 'user', content: 'step prompt' },
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${MessageHistory.CONTEXT_IDENTIFIER}: browser.snapshot\ninitial snapshot`,
						},
					],
				},
				{
					role: 'assistant',
					content: null,
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'browser_navigate', arguments: '{}' },
						},
					],
				},
				{ role: 'tool', tool_call_id: 'call_1', content: 'Timeline: navigated to example.com' },
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${MessageHistory.CONTEXT_IDENTIFIER}: browser.snapshot\nupdated snapshot`,
						},
					],
				},
				{
					role: 'user',
					content: [
						{ type: 'text', text: `${MessageHistory.CONTEXT_IDENTIFIER}: browser.screenshot` },
						{
							type: 'image_url',
							image_url: { url: 'data:image/png;base64,abc', detail: 'high' },
						},
					],
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.removeEphemeralStateMessages(mockOpenAIClient as unknown as AiClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledWith([
				{ role: 'system', content: 'system prompt' },
				{ role: 'user', content: 'step prompt' },
				mockHistory[3],
				mockHistory[4],
			])
		})

		it('should leave regular user messages untouched', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{ role: 'user', content: 'regular user message' },
				{
					role: 'user',
					content: `${MessageHistory.TOOL_EXECUTION_SUMMARY_IDENTIFIER}:\n- successfully executed: browser_click_or_hover {"ref":"e123"}`,
				},
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${MessageHistory.CONTEXT_IDENTIFIER}: browser.snapshot\ncurrent snapshot`,
						},
					],
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.removeEphemeralStateMessages(mockOpenAIClient as unknown as AiClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledWith([
				{ role: 'user', content: 'regular user message' },
				{
					role: 'user',
					content: `${MessageHistory.TOOL_EXECUTION_SUMMARY_IDENTIFIER}:\n- successfully executed: browser_click_or_hover {"ref":"e123"}`,
				},
			])
		})

		it('should handle empty history', () => {
			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue([])

			historyManager.removeEphemeralStateMessages(mockOpenAIClient as unknown as AiClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledWith([])
		})
	})

	describe('constants', () => {
		it('should have correct context identifier constant', () => {
			expect(MessageHistory.CONTEXT_IDENTIFIER).toBe('checkmate context')
		})

		it('should have correct tool execution summary identifier constant', () => {
			expect(MessageHistory.TOOL_EXECUTION_SUMMARY_IDENTIFIER).toBe('tool execution summary')
		})
	})
})
