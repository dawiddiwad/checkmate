import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HistoryManager } from '../step/openai/history-manager'
import { OpenAIClient } from '../step/openai/openai-client'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { MockOpenAIClient } from './test-types'

interface TextContentPart {
	type: 'text'
	text: string
}

vi.mock('../../src/step/openai/openai-test-manager', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe('HistoryManager', () => {
	let historyManager: HistoryManager
	let mockOpenAIClient: MockOpenAIClient

	beforeEach(() => {
		historyManager = new HistoryManager()

		mockOpenAIClient = {
			getMessages: vi.fn(),
			replaceHistory: vi.fn(),
		}
	})

	describe('buildInitialMessages', () => {
		it('should build initial messages with system prompt, step prompt, and snapshot', () => {
			const initialMessages = historyManager.buildInitialMessages({
				systemPrompt: 'system prompt',
				userPrompt: 'step prompt',
				snapshotContent: 'Page Title: Test Page\nButton: Click Me',
			})

			expect(initialMessages).toHaveLength(3)
			expect(initialMessages[0].role).toBe('system')
			expect(initialMessages[1].role).toBe('user')
			expect(initialMessages[2].role).toBe('user')
			expect((initialMessages[0].content as TextContentPart[])[0].text).toBe('system prompt')
			expect((initialMessages[1].content as TextContentPart[])[0].text).toBe('step prompt')
			expect((initialMessages[2].content as TextContentPart[])[0].text).toContain(
				HistoryManager.SNAPSHOT_IDENTIFIER
			)
		})

		it('should handle empty snapshot content', () => {
			const initialMessages = historyManager.buildInitialMessages({
				systemPrompt: 'system prompt',
				userPrompt: 'step prompt',
				snapshotContent: '',
			})

			expect((initialMessages[2].content as TextContentPart[])[0].text).toContain(
				HistoryManager.SNAPSHOT_IDENTIFIER
			)
		})
	})

	describe('compactSnapshotHistory', () => {
		it('should replace snapshots with placeholder except for latest tool snapshot', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\nInitial snapshot content`,
						},
					],
				},
				{
					role: 'assistant',
					content: 'I will take an action',
				},
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content:
						"Timeline of events after last function call:\n[120ms] Clicked button\n\npage snapshot:\nurl: 'https://example.com'\npage snapshot:\n{old:true}",
				},
				{
					role: 'assistant',
					content: 'Taking another action',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: "page snapshot:\nurl: 'https://example.com/latest'\npage snapshot:\n{latest:true}",
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledTimes(1)
			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			const firstUserMsg = filteredHistory[0] as { content: TextContentPart[] }
			expect(firstUserMsg.content[0].text).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
			expect(firstUserMsg.content[0].text).not.toContain('Initial snapshot content')

			const firstToolMsg = filteredHistory[2] as { content: string }
			expect(firstToolMsg.content).toContain('Timeline of events after last function call')
			expect(firstToolMsg.content).toContain(`page snapshot: '${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}'`)
			expect(firstToolMsg.content).not.toContain('{old:true}')

			const lastToolMsg = filteredHistory[4] as { content: string }
			expect(lastToolMsg.content).toContain("url: 'https://example.com/latest'")
			expect(lastToolMsg.content).not.toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
		})

		it('should keep explicitly selected tool snapshot raw', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: "page snapshot:\nurl: 'https://example.com/1'\npage snapshot:\n{first:true}",
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: "page snapshot:\nurl: 'https://example.com/2'\npage snapshot:\n{second:true}",
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient, 'call_1')

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect(filteredHistory[0].content).toContain('{first:true}')
			expect(filteredHistory[1].content).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
		})

		it('should compact initial snapshot when there are no tool messages', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\nSnapshot content`,
						},
					],
				},
				{
					role: 'assistant',
					content: 'Response without tool calls',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			const userMsg = filteredHistory[0] as { content: TextContentPart[] }
			expect(userMsg.content[0].text).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
		})

		it('should compact all but latest tool snapshot when only tool messages are present', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: "page snapshot:\nurl: 'https://example.com/1'\npage snapshot:\n{first:true}",
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: "page snapshot:\nurl: 'https://example.com/2'\npage snapshot:\n{second:true}",
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect(filteredHistory[0].content).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
			expect(filteredHistory[1].content).toContain('{second:true}')
		})

		it('should preserve tool messages that do not include a page snapshot section', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: 'Regular content mentioning snapshot expectations without an actual payload',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'Just some data here',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect(filteredHistory[0].content).toBe(
				'Regular content mentioning snapshot expectations without an actual payload'
			)
			expect(filteredHistory[1].content).toBe('Just some data here')
		})

		it('should handle messages with non-string content in tool responses', () => {
			const complexContent = [{ type: 'text', text: 'Complex content structure' }]
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: complexContent as unknown as string,
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: "page snapshot:\nurl: 'https://example.com'\npage snapshot:\n{latest:true}",
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect(filteredHistory[0].content).toEqual(complexContent)
			expect(filteredHistory[1].content).toContain('{latest:true}')
		})

		it('should leave user messages without snapshot identifier unchanged', () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Regular user message without snapshot',
						},
					],
				},
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\nWith snapshot`,
						},
					],
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect((filteredHistory[0].content as TextContentPart[])[0].text).toBe(
				'Regular user message without snapshot'
			)
			expect((filteredHistory[1].content as TextContentPart[])[0].text).toContain(
				HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER
			)
		})

		it('should handle empty history', () => {
			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue([])

			historyManager.compactSnapshotHistory(mockOpenAIClient as unknown as OpenAIClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledWith([])
		})
	})

	describe('constants', () => {
		it('should have correct snapshot identifier constant', () => {
			expect(HistoryManager.SNAPSHOT_IDENTIFIER).toBe('this is a current page snapshot')
		})

		it('should have correct removed snapshot placeholder constant', () => {
			expect(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER).toBe('[Snapshot removed from history to save tokens]')
		})
	})
})
