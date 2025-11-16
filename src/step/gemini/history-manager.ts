import { GeminiClient } from "./gemini-client"

export class HistoryManager {
    async removeSnapshotEntries(geminiClient: GeminiClient): Promise<void> {
        const history = geminiClient.getChat().getHistory()
        const filteredHistory = history.map((content: any) => {
            if (!content.parts || content.parts.length === 0) {
                return content
            }
            const filteredParts = content.parts.filter((part: any) => !part.functionResponse?.name?.includes("snapshot"))
            if (filteredParts.length === 0) {
                return null
            }
            return {
                ...content,
                parts: filteredParts.length > 0 ? filteredParts : content.parts
            }
        }).filter(Boolean)
        await geminiClient.replaceHistory(filteredHistory)
    }
}