import OpenAI from "openai"
import { ChatCompletionMessageParam, ChatCompletion } from "openai/resources/chat/completions"
import { ConfigurationManager } from "../configuration-manager"
import { ToolRegistry } from "../tool/tool-registry"

export type OpenAIClientDependencies = {
    configurationManager: ConfigurationManager
    toolRegistry: ToolRegistry
}

export class OpenAIClient {
    private client!: OpenAI
    private messages: ChatCompletionMessageParam[] = []
    private readonly configurationManager: ConfigurationManager
    private readonly toolRegistry: ToolRegistry

    constructor({ configurationManager, toolRegistry }: OpenAIClientDependencies) {
        this.configurationManager = configurationManager
        this.toolRegistry = toolRegistry
    }

    async initialize(): Promise<void> {
        this.client = new OpenAI({
            apiKey: this.configurationManager.getApiKey(),
            baseURL: this.configurationManager.getBaseURL(),
            timeout: this.configurationManager.getTimeout()
        })
        this.messages = []
    }

    getMessages(): ChatCompletionMessageParam[] {
        return this.messages
    }

    getToolRegistry(): ToolRegistry {
        return this.toolRegistry
    }

    getConfigurationManager(): ConfigurationManager {
        return this.configurationManager
    }

    async sendMessageWithRetry(userMessage: string | ChatCompletionMessageParam[]): Promise<ChatCompletion> {
        let attemptsLeft = this.configurationManager.getMaxRetries()
        
        if (typeof userMessage === 'string') {
            this.messages.push({ role: 'user', content: userMessage })
        } else {
            this.messages.push(...userMessage)
        }

        while (true) {
            try {
                const tools = await this.toolRegistry.getTools()
                const response = await this.client.chat.completions.create({
                    model: this.configurationManager.getModel(),
                    messages: this.messages,
                    tools,
                    tool_choice: this.configurationManager.getToolChoice(),
                    temperature: this.configurationManager.getTemperature()
                })

                if (response.choices[0]?.message) {
                    this.messages.push(response.choices[0].message)
                }

                return response
            } catch (error: any) {
                if (!this.isRetryableError(error) || attemptsLeft-- === 0) {
                    throw error
                }
                const delay = this.calculateBackoffDelay(attemptsLeft)
                console.error(`\nOpenAI API error (attempts left ${attemptsLeft}): ${error.message}`)
                console.log(`retrying in ${Math.round(delay / 1000)} seconds...`)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
    }

    async addToolResponse(toolCallId: string, content: string): Promise<void> {
        this.messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content
        })
    }

    async addScreenshotMessage(base64Data: string, mimeType: string = 'image/png'): Promise<void> {
        // Add screenshot as a user message with proper image_url format
        // Using 'low' detail for minimal token usage (85 tokens per image)
        this.messages.push({
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: 'Here is the current screenshot of the page:'
                },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64Data}`,
                        detail: 'low'
                    }
                }
            ]
        })
    }

    async sendToolResponseWithRetry(): Promise<ChatCompletion> {
        let attemptsLeft = this.configurationManager.getMaxRetries()

        while (true) {
            try {
                const tools = await this.toolRegistry.getTools()
                const response = await this.client.chat.completions.create({
                    model: this.configurationManager.getModel(),
                    messages: this.messages,
                    tools,
                    tool_choice: this.configurationManager.getToolChoice(),
                    temperature: this.configurationManager.getTemperature()
                })

                if (response.choices[0]?.message) {
                    this.messages.push(response.choices[0].message)
                }

                return response
            } catch (error: any) {
                if (!this.isRetryableError(error) || attemptsLeft-- === 0) {
                    throw error
                }
                const delay = this.calculateBackoffDelay(attemptsLeft)
                console.error(`\nOpenAI API error (attempts left ${attemptsLeft}): ${error.message}`)
                console.log(`retrying in ${Math.round(delay / 1000)} seconds...`)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
    }

    countHistoryTokens(): number {
        // OpenAI doesn't have a direct token counting API like Gemini
        // Estimate based on characters (~4 chars per token on average)
        const totalChars = this.messages.reduce((sum, msg) => {
            if (typeof msg.content === 'string') {
                return sum + msg.content.length
            }
            return sum
        }, 0)
        return Math.ceil(totalChars / 4)
    }

    replaceHistory(history: ChatCompletionMessageParam[]): void {
        this.messages = [...history]
    }

    private isRetryableError(error: any): boolean {
        const message = error?.message?.toLowerCase() || ""
        const status = error?.status || error?.code || ""
        return message.includes("timed out") ||
            message.includes("timeout") ||
            message.includes("rate") ||
            status === 504 ||
            status === 429 ||
            status === "504" ||
            status === "429" ||
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
