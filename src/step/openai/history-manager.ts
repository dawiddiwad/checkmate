import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { OpenAIClient } from "./openai-client"
import { AriaPageSnapshot } from "../tool/page-snapshot"
import { SnapshotProcessor } from "../tool/snapshot-processor"
import { ConfigurationManager } from "../configuration-manager"

export class HistoryManager {
    static readonly SNAPSHOT_IDENTIFIER = 'this is a current page snapshot'

    addInitialSnapshot(openaiClient: OpenAIClient, snapshotContent: AriaPageSnapshot) {
        const getProcessedSnapshot = () => {
            if (new ConfigurationManager().enableSnapshotCompression()) {
                const compressedSnapshot = new SnapshotProcessor().getCompressed({ response: snapshotContent }).response
                return JSON.stringify(compressedSnapshot)
            } else {
                return snapshotContent
            }
        }
        const historyWithInitialSnapshot: ChatCompletionMessageParam[] = [{
            role: 'user',
            content: [{
                type: 'text',
                text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n${getProcessedSnapshot()}`
            }]
        }]
        openaiClient.replaceHistory(historyWithInitialSnapshot)
    }

    async removeSnapshotEntries(openaiClient: OpenAIClient): Promise<void> {
        const lastToolCall = openaiClient.getMessages().filter(message => message.role === 'tool').pop()
        const filteredHistory = openaiClient.getMessages().map(message => {
            if (message.role === 'tool' && message.tool_call_id !== lastToolCall?.tool_call_id) {
                message.content = '[Snapshot removed from history to save tokens]'
            } else if (((message.content?.[0] as any)?.text as string)?.includes(HistoryManager.SNAPSHOT_IDENTIFIER)) {
                message.content = [{
                    type: 'text',
                    text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n'[Snapshot removed from history to save tokens]' `
                }]
            }
            return message
        })
        openaiClient.replaceHistory(filteredHistory)
    }
}