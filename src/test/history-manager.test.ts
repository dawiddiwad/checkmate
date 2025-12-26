import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HistoryManager } from '../step/openai/history-manager'
import { OpenAIClient } from '../step/openai/openai-client'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

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
	let mockOpenAIClient: OpenAIClient

	beforeEach(() => {
		historyManager = new HistoryManager()

		mockOpenAIClient = {
			getMessages: vi.fn(),
			replaceHistory: vi.fn(),
		} as any
	})

	describe('addInitialSnapshot', () => {
		it('should add initial snapshot to history', () => {
			const snapshotContent = 'Page Title: Test Page\nButton: Click Me'

			historyManager.addInitialSnapshot(mockOpenAIClient, snapshotContent)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledTimes(1)
			const calledWith = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect(calledWith).toHaveLength(1)
			expect(calledWith[0].role).toBe('user')
			expect((calledWith[0].content as any)[0].type).toBe('text')
			expect((calledWith[0].content as any)[0].text).toContain(HistoryManager.SNAPSHOT_IDENTIFIER)
			expect((calledWith[0].content as any)[0].text).toContain(snapshotContent)
		})

		it('should include snapshot identifier in the message', () => {
			const snapshotContent = 'Some ARIA tree content'

			historyManager.addInitialSnapshot(mockOpenAIClient, snapshotContent)

			const calledWith = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			const textContent = (calledWith[0].content as any)[0].text

			expect(textContent).toContain('this is a current page snapshot')
		})

		it('should handle empty snapshot content', () => {
			historyManager.addInitialSnapshot(mockOpenAIClient, '')

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledTimes(1)
			const calledWith = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect((calledWith[0].content as any)[0].text).toContain(HistoryManager.SNAPSHOT_IDENTIFIER)
		})
	})

	describe('removeSnapshotEntries', () => {
		it('should replace snapshots with placeholder except for last tool call', async () => {
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
					content: 'snapshot: old snapshot data here',
				},
				{
					role: 'assistant',
					content: 'Taking another action',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'snapshot: latest snapshot data',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledTimes(1)
			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			const firstUserMsg = filteredHistory[0] as any
			expect(firstUserMsg.content[0].text).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
			expect(firstUserMsg.content[0].text).not.toContain('Initial snapshot content')

			const firstToolMsg = filteredHistory[2] as any
			expect(firstToolMsg.content).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
			expect(firstToolMsg.content).not.toContain('old snapshot data here')

			const lastToolMsg = filteredHistory[4] as any
			expect(lastToolMsg.content).toBe('snapshot: latest snapshot data')
			expect(lastToolMsg.content).not.toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
		})

		it('should handle history with no tool messages', async () => {
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

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledTimes(1)
			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			const userMsg = filteredHistory[0] as any
			expect(userMsg.content[0].text).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
		})

		it('should handle history with only tool messages', async () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: 'snapshot: first snapshot',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'snapshot: second snapshot',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect(filteredHistory[0].content).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)

			expect(filteredHistory[1].content).toBe('snapshot: second snapshot')
		})

		it('should handle empty history', async () => {
			const mockHistory: ChatCompletionMessageParam[] = []

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			expect(mockOpenAIClient.replaceHistory).toHaveBeenCalledTimes(1)
			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]
			expect(filteredHistory).toEqual([])
		})

		it('should handle snapshot with case-insensitive matching', async () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: 'SNAPSHOT: uppercase snapshot data',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'Snapshot: mixed case snapshot data',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect(filteredHistory[0].content).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
			expect(filteredHistory[1].content).toBe('Snapshot: mixed case snapshot data')
		})

		it('should replace any text containing "snapshot" keyword', async () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: 'No snapshot here, just regular content',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'Also no snapshot',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect(filteredHistory[0].content).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)

			expect(filteredHistory[1].content).toBe('Also no snapshot')
		})

		it('should preserve tool messages that do not contain snapshot keyword', async () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: 'Regular content without the s-word',
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'Just some data here',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect(filteredHistory[0].content).toBe('Regular content without the s-word')
			expect(filteredHistory[1].content).toBe('Just some data here')
		})

		it('should handle messages with non-string content in tool responses', async () => {
			const mockHistory: ChatCompletionMessageParam[] = [
				{
					role: 'tool',
					tool_call_id: 'call_1',
					content: [{ type: 'text', text: 'Complex content structure' }] as any,
				},
				{
					role: 'tool',
					tool_call_id: 'call_2',
					content: 'snapshot: last snapshot',
				},
			]

			vi.mocked(mockOpenAIClient.getMessages).mockReturnValue(mockHistory)

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect(filteredHistory[0].content).toEqual([{ type: 'text', text: 'Complex content structure' }])

			expect(filteredHistory[1].content).toBe('snapshot: last snapshot')
		})

		it('should handle user messages without snapshot identifier', async () => {
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

			await historyManager.removeSnapshotEntries(mockOpenAIClient)

			const filteredHistory = vi.mocked(mockOpenAIClient.replaceHistory).mock.calls[0][0]

			expect((filteredHistory[0].content as any)[0].text).toBe('Regular user message without snapshot')

			expect((filteredHistory[1].content as any)[0].text).toContain(HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER)
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
