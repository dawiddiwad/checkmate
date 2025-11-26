import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { OpenAIClient } from "./openai-client"

export class HistoryManager {
    async removeSnapshotEntries(openaiClient: OpenAIClient, excludeToolCallId?: string): Promise<void> {
        const history = openaiClient.getMessages()
        
        const toolCallIdsToRemove = new Set<string>()
        
        for (const message of history) {
            if (message.role === 'assistant' && 'tool_calls' in message && message.tool_calls) {
                for (const tc of message.tool_calls) {
                    if ((tc as any).type === 'function' && (tc as any).function?.name?.includes('snapshot')) {
                        const toolCallId = (tc as any).id
                        if (toolCallId !== excludeToolCallId) {
                            toolCallIdsToRemove.add(toolCallId)
                        }
                    }
                }
            }
        }
        
        let lastScreenshotMessageIndex = -1
        for (let i = history.length - 1; i >= 0; i--) {
            if (this.isScreenshotMessage(history[i])) {
                lastScreenshotMessageIndex = i
                break
            }
        }
        
        const filteredHistory = history.filter((message: ChatCompletionMessageParam, index: number) => {
            if (this.isScreenshotMessage(message) && index !== lastScreenshotMessageIndex) {
                return false
            }
            
            if (message.role === 'tool') {
                const toolMessage = message as { role: 'tool'; content: string; tool_call_id: string }
                if (toolCallIdsToRemove.has(toolMessage.tool_call_id)) {
                    return false
                }
            }
            
            if (message.role === 'assistant' && 'tool_calls' in message && message.tool_calls) {
                const nonSnapshotToolCalls = message.tool_calls.filter(
                    (tc: any) => {
                        if (tc.type !== 'function') return true
                        if (!tc.function?.name?.includes('snapshot')) return true
                        if (tc.id === excludeToolCallId) return true
                        return false
                    }
                )
                if (nonSnapshotToolCalls.length === 0 && !message.content) {
                    return false
                }
                if (nonSnapshotToolCalls.length < message.tool_calls.length) {
                    (message as any).tool_calls = nonSnapshotToolCalls
                }
            }
            return true
        }) as ChatCompletionMessageParam[]
        
        openaiClient.replaceHistory(filteredHistory)
    }
    
    private isScreenshotMessage(message: ChatCompletionMessageParam): boolean {
        if (message.role === 'user' && Array.isArray(message.content)) {
            return message.content.some((part: any) => part.type === 'image_url')
        }
        return false
    }
}
