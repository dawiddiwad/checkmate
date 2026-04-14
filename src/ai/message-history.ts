import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { BrowserSnapshot } from '../tools/browser/snapshot-service'
import { AiClient } from './client'

type InitialMessageParameters = {
	systemPrompt: string
	userPrompt: string
	snapshotContent: BrowserSnapshot
}

export class MessageHistory {
	static readonly SNAPSHOT_IDENTIFIER = 'this is a current page snapshot'
	static readonly SCREENSHOT_IDENTIFIER = 'this is a current screenshot of the page'

	buildInitialMessages(config: InitialMessageParameters): ChatCompletionMessageParam[] {
		return [
			{
				role: 'system',
				content: [{ type: 'text', text: config.systemPrompt }],
			},
			{
				role: 'user',
				content: [{ type: 'text', text: config.userPrompt }],
			},
			{
				role: 'user',
				content: [{ type: 'text', text: `${MessageHistory.SNAPSHOT_IDENTIFIER}:\n${config.snapshotContent}` }],
			},
		]
	}

	removeEphemeralStateMessages(aiClient: AiClient): void {
		aiClient.replaceHistory(aiClient.getMessages().filter((message) => !this.isEphemeralStateMessage(message)))
	}

	private isEphemeralStateMessage(message: ChatCompletionMessageParam): boolean {
		if (message.role !== 'user' || !Array.isArray(message.content) || message.content.length === 0) {
			return false
		}

		const firstPart = message.content[0]
		if (!('text' in firstPart) || typeof firstPart.text !== 'string') {
			return false
		}

		return (
			firstPart.text.startsWith(`${MessageHistory.SNAPSHOT_IDENTIFIER}:`) ||
			firstPart.text === MessageHistory.SCREENSHOT_IDENTIFIER
		)
	}
}
