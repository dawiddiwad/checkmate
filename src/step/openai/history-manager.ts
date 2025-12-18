import { OpenAIClient } from "./openai-client"
import { AriaPageSnapshot } from "../tool/page-snapshot"
import { logger } from "./openai-test-manager"
import { ResponseInputItem } from "openai/resources/responses/responses.mjs"

export class HistoryManager {
    static readonly SNAPSHOT_IDENTIFIER = 'this is a current page snapshot'
    static readonly REMOVED_SNAPSHOT_PLACEHOLDER = '[Snapshot removed from history to save tokens]'

    addInitialSnapshot(openaiClient: OpenAIClient, snapshotContent: AriaPageSnapshot) {
        const historyWithInitialSnapshot: ResponseInputItem[] = [{
            role: 'user',
            type: 'message',
            status: 'completed',
            content: [{
                type: 'input_text',
                text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n${snapshotContent}`
            }]
        }]
        openaiClient.replaceHistory(historyWithInitialSnapshot)
    }

    async removeSnapshotEntries(openaiClient: OpenAIClient): Promise<void> {
        // return
        const lastToolCall = openaiClient.getMessages().filter(message => message.type === 'function_call_output').pop()
        const filteredHistory = openaiClient.getMessages().map(message => {
            if (message.type === 'function_call_output' && message.call_id !== lastToolCall?.call_id) {
                message.output = typeof message.output === 'string'
                    ? message.output.replace(/snapshot[\s\S]*/i, `snapshot: '${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}'`)
                    : message.output
            } else if (message.type === 'message' && typeof message.content === 'string' && message.content.includes(HistoryManager.SNAPSHOT_IDENTIFIER)) {
                message.content = [{
                    type: 'input_text',
                    text: `${HistoryManager.SNAPSHOT_IDENTIFIER}:\n'${HistoryManager.REMOVED_SNAPSHOT_PLACEHOLDER}' `
                }]
            }
            return message
        })
        openaiClient.replaceHistory(filteredHistory)
        logger.debug(`Removed snapshot entries from history to save tokens, current history:\n${JSON.stringify(filteredHistory, null, 2)}`)
    }
}