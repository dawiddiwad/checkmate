import { describe, it, expect, beforeEach } from 'vitest'
import { MessageHistory } from '../ai/message-history'

interface TextContentPart {
	type: 'text'
	text: string
}

describe('MessageHistory', () => {
	let messageHistory: MessageHistory

	beforeEach(() => {
		messageHistory = new MessageHistory()
	})

	describe('buildInitialMessages', () => {
		it('should build the system and step prompts', () => {
			const initialMessages = messageHistory.buildInitialMessages({
				systemPrompt: 'system prompt',
				userPrompt: 'step prompt',
			})

			expect(initialMessages).toHaveLength(2)
			expect(initialMessages[0].role).toBe('system')
			expect(initialMessages[1].role).toBe('user')
			expect((initialMessages[0].content as TextContentPart[])[0].text).toBe('system prompt')
			expect((initialMessages[1].content as TextContentPart[])[0].text).toBe('step prompt')
		})
	})

	describe('context messages', () => {
		it('marks snapshots as ephemeral page state', () => {
			const snapshot = messageHistory.createSnapshotMessage('Page Title: Test Page\nButton: Click Me')

			expect(snapshot.ephemeral).toBe(true)
			expect(snapshot.message.role).toBe('user')
			expect((snapshot.message.content as TextContentPart[])[0].text).toContain(
				MessageHistory.SNAPSHOT_IDENTIFIER
			)
		})

		it('marks screenshots as ephemeral page state', () => {
			const screenshot = messageHistory.createScreenshotMessage('YmFzZTY0', 'image/png')

			expect(screenshot.ephemeral).toBe(true)
			const content = screenshot.message.content as unknown as Array<Record<string, unknown>>
			expect(content[0]).toEqual({ type: 'text', text: MessageHistory.SCREENSHOT_IDENTIFIER })
			expect(content[1]).toEqual({
				type: 'image_url',
				image_url: { url: 'data:image/png;base64,YmFzZTY0', detail: 'high' },
			})
		})

		it('keeps tool execution summaries in the durable history', () => {
			const summary = messageHistory.createToolExecutionSummaryMessage('- successfully executed: browser_wait {}')

			expect(summary).toEqual({
				role: 'user',
				content: `${MessageHistory.TOOL_EXECUTION_SUMMARY_IDENTIFIER}:\n- successfully executed: browser_wait {}`,
			})
		})
	})

	describe('constants', () => {
		it('should have correct snapshot identifier constant', () => {
			expect(MessageHistory.SNAPSHOT_IDENTIFIER).toBe('this is a current page snapshot')
		})

		it('should have correct screenshot identifier constant', () => {
			expect(MessageHistory.SCREENSHOT_IDENTIFIER).toBe('this is a current screenshot of the page')
		})

		it('should have correct tool execution summary identifier constant', () => {
			expect(MessageHistory.TOOL_EXECUTION_SUMMARY_IDENTIFIER).toBe('tool execution summary')
		})
	})
})
