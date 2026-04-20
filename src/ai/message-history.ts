import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { AiClient } from './client.js'

type InitialMessageParameters = {
	systemPrompt: string
	userPrompt: string
	contextMessages?: ChatCompletionMessageParam[]
}

export class MessageHistory {
	static readonly SNAPSHOT_IDENTIFIER = 'this is a current page snapshot'
	static readonly SCREENSHOT_IDENTIFIER = 'this is a current screenshot of the page'
	static readonly TOOL_EXECUTION_SUMMARY_IDENTIFIER = 'tool execution summary'

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
			...(config.contextMessages ?? []),
		]
	}

	createSnapshotMessage(snapshotContent: string | null): ChatCompletionMessageParam {
		return {
			role: 'user',
			content: [{ type: 'text', text: `${MessageHistory.SNAPSHOT_IDENTIFIER}:\n${snapshotContent}` }],
		}
	}

	createScreenshotMessage(base64Data: string, mimeType: string = 'image/png'): ChatCompletionMessageParam {
		return {
			role: 'user',
			content: [
				{ type: 'text', text: MessageHistory.SCREENSHOT_IDENTIFIER },
				{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'high' } },
			],
		}
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
