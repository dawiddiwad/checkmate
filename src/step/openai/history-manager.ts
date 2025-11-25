import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { OpenAIClient } from "./openai-client"

export class HistoryManager {
    async removeSnapshotEntries(openaiClient: OpenAIClient, excludeToolCallId?: string): Promise<void> {
        const history = openaiClient.getMessages()
        
        // First pass: collect tool_call_ids that should be removed (snapshot-related)
        // Exclude the current tool call ID to prevent removing messages we just added
        const toolCallIdsToRemove = new Set<string>()
        
        for (const message of history) {
            if (message.role === 'assistant' && 'tool_calls' in message && message.tool_calls) {
                for (const tc of message.tool_calls) {
                    if ((tc as any).type === 'function' && (tc as any).function?.name?.includes('snapshot')) {
                        const toolCallId = (tc as any).id
                        // Don't remove the current tool call we're processing
                        if (toolCallId !== excludeToolCallId) {
                            toolCallIdsToRemove.add(toolCallId)
                        }
                    }
                }
            }
        }
        
        // If nothing to remove, skip the filtering
        if (toolCallIdsToRemove.size === 0) {
            return
        }
        
        // Second pass: filter messages
        const filteredHistory = history.filter((message: ChatCompletionMessageParam) => {
            // Remove tool responses for snapshot-related tool calls
            if (message.role === 'tool') {
                const toolMessage = message as { role: 'tool'; content: string; tool_call_id: string }
                if (toolCallIdsToRemove.has(toolMessage.tool_call_id)) {
                    return false
                }
            }
            
            // For assistant messages with tool_calls, filter out snapshot-related calls
            if (message.role === 'assistant' && 'tool_calls' in message && message.tool_calls) {
                const nonSnapshotToolCalls = message.tool_calls.filter(
                    (tc: any) => {
                        // Keep if not a function type
                        if (tc.type !== 'function') return true
                        // Keep if not a snapshot call
                        if (!tc.function?.name?.includes('snapshot')) return true
                        // Keep if it's the excluded tool call (current one being processed)
                        if (tc.id === excludeToolCallId) return true
                        return false
                    }
                )
                if (nonSnapshotToolCalls.length === 0 && !message.content) {
                    // All tool_calls were snapshot-related and no text content, remove entire message
                    return false
                }
                // If there are remaining non-snapshot tool_calls, keep message but modify it
                if (nonSnapshotToolCalls.length < message.tool_calls.length) {
                    // Replace tool_calls with filtered version (mutating is safe here as we're rebuilding anyway)
                    (message as any).tool_calls = nonSnapshotToolCalls
                }
            }
            return true
        }) as ChatCompletionMessageParam[]
        
        openaiClient.replaceHistory(filteredHistory)
    }
}
