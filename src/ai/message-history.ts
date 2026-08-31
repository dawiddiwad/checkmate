import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { ContextMessage } from '../runtime/types.js'

type InitialMessageParameters = {
	systemPrompt: string
	userPrompt: string
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
		]
	}

	createSnapshotMessage(snapshotContent: string | null): ContextMessage {
		return {
			message: {
				role: 'user',
				content: [{ type: 'text', text: `${MessageHistory.SNAPSHOT_IDENTIFIER}:\n${snapshotContent}` }],
			},
			ephemeral: true,
		}
	}

	createScreenshotMessage(base64Data: string, mimeType: string = 'image/png'): ContextMessage {
		return {
			message: {
				role: 'user',
				content: [
					{ type: 'text', text: MessageHistory.SCREENSHOT_IDENTIFIER },
					{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'high' } },
				],
			},
			ephemeral: true,
		}
	}

	createToolExecutionSummaryMessage(summary: string): ChatCompletionMessageParam {
		return {
			role: 'user',
			content: `${MessageHistory.TOOL_EXECUTION_SUMMARY_IDENTIFIER}:\n${summary}`,
		}
	}
}
