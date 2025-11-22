import { Chat, Content, GenerateContentConfig, GenerateContentResponse, GoogleGenAI, PartUnion } from "@google/genai"
import { ConfigurationManager } from "../configuration-manager"
import { ToolRegistry } from "../tool/tool-registry"

export class GeminiClient {
    private ai!: GoogleGenAI
    private chat!: Chat

    constructor(
        private readonly configurationManager: ConfigurationManager,
        private readonly toolRegistry: ToolRegistry
    ) { }

    async initialize(): Promise<void> {
        this.ai = new GoogleGenAI({
            apiKey: this.configurationManager.getApiKey()
        })
        const config = await this.buildConfig()
        this.chat = this.ai.chats.create({
            model: this.configurationManager.getModel(),
            config
        })
    }

    getChat(): Chat {
        return this.chat
    }

    async sendMessageWithRetry(message: PartUnion[]): Promise<GenerateContentResponse> {
        let attemptsLeft = this.configurationManager.getMaxRetries()
        while (true) {
            try {
                return await this.chat.sendMessage({
                    config: await this.buildConfig(),
                    message
                })
            } catch (error) {
                if (!this.isRetryableError(error) || attemptsLeft-- === 0) {
                    throw error
                }
                const delay = this.calculateBackoffDelay(attemptsLeft)
                console.error(`\ngemini API error (attempts left ${attemptsLeft}): ${error.message}`)
                console.log(`retrying in ${Math.round(delay / 1000)} seconds...`)
                await new Promise(resolve => setTimeout(resolve, delay))
                const keepHistory = this.chat.getHistory()
                await this.initialize()
                await this.replaceHistory(keepHistory)
            }
        }
    }

    async countHistoryTokens(): Promise<number> {
        const result = await this.ai.models.countTokens({
            model: this.configurationManager.getModel(),
            contents: this.chat.getHistory()
        })
        return result.totalTokens ?? 0
    }

    async replaceHistory(history: Content[]): Promise<void> {
        const config = await this.buildConfig()
        this.chat = this.ai.chats.create({
            model: this.configurationManager.getModel(),
            history,
            config
        })
    }

    private async buildConfig(): Promise<GenerateContentConfig> {
        const tools = await this.toolRegistry.getTools()
        return this.configurationManager.getGeminiConfig(tools)
    }

    private isRetryableError(error: any): boolean {
        const message = error?.message?.toLowerCase() || ""
        const code = error?.code || ""
        return message.includes("timed out") ||
            message.includes("deadline_exceeded") ||
            message.includes("rate") ||
            code === "504" ||
            code === "429" ||
            (error?.status && error.status >= 500)
    }

    private calculateBackoffDelay(attemptsLeft: number): number {
        switch (attemptsLeft) {
            case 2: return 1_000
            case 1: return 10_000
            default: return 60_000
        }
    }
}