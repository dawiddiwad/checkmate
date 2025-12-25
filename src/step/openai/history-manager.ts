import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { OpenAIClient } from './openai-client'
import { AriaPageSnapshot } from '../tool/page-snapshot'
import { logger } from './openai-test-manager'

export class HistoryManager {
	static readonly SNAPSHOT_IDENTIFIER = 'this is a current page snapshot'
	static readonly REMOVED_SNAPSHOT_PLACEHOLDER = '[Snapshot removed from history to save tokens]'

	addInitialSnapshot(openaiClient: OpenAIClient, snapshotContent: AriaPageSnapshot) {
		const historyWithInitialSnapshot: ChatCompletionMessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n${snapshotContent}`,
					},
				],
			},
		]
		openaiClient.replaceHistory(historyWithInitialSnapshot)
	}

	async removeSnapshotEntries(openaiClient: OpenAIClient): Promise<void> {
		const lastToolCall = openaiClient
			.getMessages()
			.filter((message) => message.role === 'tool')
			.pop()
		const filteredHistory = openaiClient.getMessages().map((message) => {
			if (message.role === 'tool' && message.tool_call_id !== lastToolCall?.tool_call_id) {
				message.content =
					typeof message.content === 'string'
						? message.content.replace(
								/snapshot[\s\S]*/i,
								`snapshot: '${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}'`
							)
						: message.content
			} else if (((message.content?.[0] as any)?.text as string)?.includes(HistoryManager.SNAPSHOT_IDENTIFIER)) {
				message.content = [
					{
						type: 'text',
						text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n'${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}' `,
					},
				]
			}
			return message
		})
		openaiClient.replaceHistory(filteredHistory)
		logger.debug(
			`Removed snapshot entries from history to save tokens, current history:\n${JSON.stringify(filteredHistory, null, 2)}`
		)
	}
}
