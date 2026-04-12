import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { OpenAIClient } from './openai-client'
import { AriaPageSnapshot } from '../tool/page-snapshot'
import { logger } from './openai-test-manager'

type InitialMessageParameters = {
	systemPrompt: string
	userPrompt: string
	snapshotContent: AriaPageSnapshot
}

export class HistoryManager {
	static readonly SNAPSHOT_IDENTIFIER = 'this is a current page snapshot'
	static readonly REMOVED_SNAPSHOT_PLACEHOLDER = '[Snapshot removed from history to save tokens]'
	private static readonly TOOL_SNAPSHOT_IDENTIFIER = 'page snapshot:'

	buildInitialMessages(config: InitialMessageParameters): ChatCompletionMessageParam[] {
		const historyWithInitialSnapshot: ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: [
					{
						type: 'text',
						text: config.systemPrompt,
					},
				],
			},
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: config.userPrompt,
					},
				],
			},
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n${config.snapshotContent}`,
					},
				],
			},
		]
		return historyWithInitialSnapshot
	}

	compactSnapshotHistory(openaiClient: OpenAIClient, keepToolCallId?: string): void {
		const filteredHistory = this.compactMessages(openaiClient.getMessages(), keepToolCallId)
		openaiClient.replaceHistory(filteredHistory)
		logger.debug(
			`Compacted snapshot history to keep only the latest raw snapshot, current history:\n${JSON.stringify(filteredHistory, null, 2)}`
		)
	}

	private compactMessages(
		messages: ChatCompletionMessageParam[],
		keepToolCallId?: string
	): ChatCompletionMessageParam[] {
		const latestToolCallId = keepToolCallId ?? this.findLatestToolCallId(messages)

		return messages.map((message) => {
			if (message.role === 'tool') {
				return this.compactToolMessage(message, latestToolCallId)
			}

			if (message.role === 'user') {
				return this.compactInitialSnapshotMessage(message)
			}

			return message
		})
	}

	private findLatestToolCallId(messages: ChatCompletionMessageParam[]): string | undefined {
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index]
			if (message.role === 'tool') {
				return message.tool_call_id
			}
		}

		return undefined
	}

	private compactToolMessage(
		message: Extract<ChatCompletionMessageParam, { role: 'tool' }>,
		latestToolCallId?: string
	): ChatCompletionMessageParam {
		if (message.tool_call_id === latestToolCallId || typeof message.content !== 'string') {
			return message
		}

		const compactedContent = this.compactToolSnapshotContent(message.content)
		if (compactedContent === message.content) {
			return message
		}

		return {
			...message,
			content: compactedContent,
		}
	}

	private compactInitialSnapshotMessage(
		message: Extract<ChatCompletionMessageParam, { role: 'user' }>
	): ChatCompletionMessageParam {
		if (
			!Array.isArray(message.content) ||
			message.content.length === 0 ||
			!(message.content[0] && 'text' in message.content[0]) ||
			typeof message.content[0].text !== 'string' ||
			!message.content[0].text.includes(HistoryManager.SNAPSHOT_IDENTIFIER)
		) {
			return message
		}

		return {
			...message,
			content: [
				{
					type: 'text',
					text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n'${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}'`,
				},
			],
		}
	}

	private compactToolSnapshotContent(content: string): string {
		const snapshotStartIndex = content.toLowerCase().indexOf(HistoryManager.TOOL_SNAPSHOT_IDENTIFIER)
		if (snapshotStartIndex === -1) {
			return content
		}

		const prefix = content.slice(0, snapshotStartIndex).trimEnd()
		const compactedSnapshot = `${HistoryManager.TOOL_SNAPSHOT_IDENTIFIER} '${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}'`

		return prefix.length > 0 ? `${prefix}\n\n${compactedSnapshot}` : compactedSnapshot
	}
}
