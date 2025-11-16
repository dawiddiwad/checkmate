import { Chat, GenerateContentConfig, GenerateContentResponse, GoogleGenAI, PartUnion } from "@google/genai"
import { ConfigurationManager } from "../configuration-manager"
import { ToolRegistry } from "../tool/tool-registry"

export class GeminiClient {
    private ai!: GoogleGenAI
    private chat!: Chat

    constructor(
        private readonly configurationManager: ConfigurationManager,
        private readonly toolRegistry: ToolRegistry
    ) {}

    async initialize(): Promise<void> {
        await this.reinitialize()
    }

    getChat(): Chat {
        return this.chat
    }

    async sendMessageWithRetry(message: PartUnion[]): Promise<GenerateContentResponse> {
        const maxAttempts = parseInt(process.env.GEMINI_RETRY_MAX_ATTEMPTS ?? "3")
        let lastError: Error | null = null
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await this.chat.sendMessage({
                    config: await this.buildConfig(),
                    message
                })
                return response
            } catch (error) {
                lastError = error as Error
                const isRetryable = this.isRetryableError(error)
                if (!isRetryable || attempt === maxAttempts) {
                    throw lastError
                }
                const delay = this.calculateBackoffDelay(attempt)
                console.log(`\ngemini API error (attempt ${attempt}/${maxAttempts}): ${lastError.message}`)
                console.log(`retrying in ${Math.round(delay / 1000)} seconds...`)
                await new Promise(resolve => setTimeout(resolve, delay))
                await this.reinitialize()
            }
        }
        throw lastError
    }

    async countHistoryTokens(): Promise<number> {
        const result = await this.ai.models.countTokens({
            model: this.configurationManager.getModel(),
            contents: this.chat.getHistory()
        })
        return result.totalTokens ?? 0
    }

    async replaceHistory(history: any[]): Promise<void> {
        const config = await this.buildConfig()
        this.chat = this.ai.chats.create({
            model: this.configurationManager.getModel(),
            history,
            config
        })
    }

    private async reinitialize(): Promise<void> {
        this.ai = new GoogleGenAI({
            apiKey: this.configurationManager.getApiKey()
        })
        const config = await this.buildConfig()
        this.chat = this.ai.chats.create({
            model: this.configurationManager.getModel(),
            config
        })
    }

    private async buildConfig(): Promise<GenerateContentConfig> {
        const tools = await this.toolRegistry.getTools()
        return this.configurationManager.buildConfig(tools)
    }

    private isRetryableError(error: any): boolean {
        const message = error?.message?.toLowerCase() || ""
        const code = error?.code || ""
        return message.includes("timed out") ||
            message.includes("deadline_exceeded") ||
            code === "504" ||
            (error?.status && error.status >= 500)
    }

    private calculateBackoffDelay(attempt: number): number {
        const baseDelay = 1000
        const delay = baseDelay * Math.pow(2, attempt - 1)
        const jitter = delay * 0.25 * (Math.random() * 2 - 1)
        return Math.min(delay + jitter, 30000)
    }
}