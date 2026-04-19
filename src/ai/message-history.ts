import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { CheckmateContextItem } from '../runtime/module'
import { AiClient } from './client'

type InitialMessageParameters = {
	systemPrompt: string
	userPrompt: string
	contextItems: CheckmateContextItem[]
}

export class MessageHistory {
	static readonly CONTEXT_IDENTIFIER = 'checkmate context'
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
			...this.buildContextMessages(config.contextItems),
		]
	}

	buildContextMessages(contextItems: CheckmateContextItem[]): ChatCompletionMessageParam[] {
		return contextItems.map((contextItem) => {
			if (contextItem.kind === 'text') {
				return {
					role: 'user',
					content: [
						{
							type: 'text',
							text: `${MessageHistory.CONTEXT_IDENTIFIER}: ${contextItem.name}\n${contextItem.content}`,
						},
					],
				} satisfies ChatCompletionMessageParam
			}

			return {
				role: 'user',
				content: [
					{ type: 'text', text: `${MessageHistory.CONTEXT_IDENTIFIER}: ${contextItem.name}` },
					{
						type: 'image_url',
						image_url: { url: `data:${contextItem.mimeType};base64,${contextItem.data}`, detail: 'high' },
					},
				],
			} satisfies ChatCompletionMessageParam
		})
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

		return firstPart.text.startsWith(`${MessageHistory.CONTEXT_IDENTIFIER}:`)
	}
}
