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
        const toolCalls = openaiClient.getMessages().filter(message => message.role === 'tool')
        const filteredHistory = openaiClient.getMessages().filter((message) => {
            if (message.role === 'tool' || ((message.content?.[0] as any)?.text as string)?.includes(HistoryManager.SNAPSHOT_IDENTIFIER)) {
                return false
            } else {
                return true
            }
        })
        const lastToolResponse = toolCalls.pop()
        if (lastToolResponse) filteredHistory.push(lastToolResponse)
        openaiClient.replaceHistory(filteredHistory)
    }
}