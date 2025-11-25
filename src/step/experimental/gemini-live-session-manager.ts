import { GoogleGenAI, Modality, LiveConnectParameters, LiveCallbacks, Session, FunctionDeclaration, Tool, FunctionCall, FunctionResponseScheduling } from '@google/genai'
import { GeminiServerMCP, GeminiPlaywrightMCPServer } from './gemini-mcp'
import { GeminiTokenPricing } from './gemini-token-pricing'
import { GeminiSalesforceTool } from './gemini-salesforce-tool'
import { GeminiPlaywrightTool } from './gemini-playwright-tool'
import { GeminiStepTool } from './gemini-step-tool'
import sharp from 'sharp'
import { expect } from '@playwright/test'
import { Step, StepStatus, StepStatusCallback } from '../types'
import { RUN_STEP_PROMPT_LIVE_API } from '../openai/prompts'

export class GeminiLiveSessionManager {
    private ai: GoogleGenAI
    private session!: Session
    private model: string
    private inputTokensUsed: number = 0
    private playwrightMCP: GeminiServerMCP
    private stepStatus: StepStatus = { passed: false, actual: '' }
    private stepStatusCallback!: StepStatusCallback
    private stepFinishedCallback!: Promise<StepStatus>
    private salesforceTool: GeminiSalesforceTool
    private playwrightTool: GeminiPlaywrightTool
    private stepTool: GeminiStepTool
    private step!: Step
    private recentMessages: string[] = []

    constructor() {
        if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY environment variable is not set\nvisit https://aistudio.google.com/app/api-keys to get one')
        this.ai = new GoogleGenAI({
            apiKey: process.env.GOOGLE_API_KEY
        })
        this.model = 'gemini-live-2.5-flash-preview'
        this.playwrightMCP = GeminiPlaywrightMCPServer.create()
        this.stepTool = new GeminiStepTool()
        this.salesforceTool = new GeminiSalesforceTool()
        this.playwrightTool = new GeminiPlaywrightTool(this.playwrightMCP)
    }

    private getCallbacks(): LiveCallbacks {
        return {
            onopen: () => {
                console.log('connected to gemini livesession')
            },
            onclose: () => {
                console.log('disconnected from gemini livesession')
            },
            onerror: (event) => {
                throw new Error(`error in gemini livesession\n${JSON.stringify(event, null, 2)}`)
            },
            onmessage: (message) => {
                this.inputTokensUsed += message.usageMetadata?.totalTokenCount ?? 0
                if (message.toolCall) {
                    for (const toolCall of message.toolCall.functionCalls ?? []) {
                        if (toolCall.name && toolCall.name.includes('browser')) {
                            this.callPlawrightMcpTool(toolCall)
                        } else if (toolCall.name && toolCall.name.includes('test_step')) {
                            this.callTestCaseTool(toolCall)
                        } else if (toolCall.name && toolCall.name.includes('salesforce')) {
                            this.callSalesforceCliTool(toolCall)
                        } else {
                            throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(toolCall, null, 2)}`)
                        }
                    }
                } else if (message.serverContent?.modelTurn) {
                    message.serverContent.modelTurn.parts?.forEach(part => {
                        if (part.text) {
                            console.log(`\n >>> ${part.text}`)
                            this.checkForRepetitiveLoop(part.text)
                        }
                    })
                } else if (message.serverContent?.generationComplete) {
                    console.log(`\n| generation completed before the step was finished`)
                    this.recycleGemini().then(() => {
                        this.recentMessages = []
                        this.session.sendClientContent({
                            turns: [{
                                parts: [{ text: RUN_STEP_PROMPT_LIVE_API(this.step) }],
                                role: 'user'
                            }]
                        })
                    })
                }
            }
        } satisfies LiveCallbacks
    }

    private async recycleGemini() {
        try {
            this.session?.close()
            this.ai = new GoogleGenAI({
                apiKey: process.env.GOOGLE_API_KEY
            })
            this.session = await this.start()
        } catch (error) {
            throw new Error(`Failed to recycle gemini\n${error}`)
        }
    }

    private checkForRepetitiveLoop(messageText: string): void {
        if (this.recentMessages.length >= 30) {
            this.recentMessages.shift()
        }
        this.recentMessages.push(messageText.trim())

        if (this.recentMessages.length >= 12) {
            this.detectCycle()
        }
    }

    private detectCycle(): void {
        const messages = this.recentMessages
        this.detectSimilarPatterns(messages)
    }

    private detectSimilarPatterns(messages: string[]): void {
        if (messages.length < 20) return
        const recentMessages = messages.slice(-20)
        const startPatterns: { [key: string]: number } = {}
        for (const message of recentMessages) {
            const startPattern = message.trim().substring(0, 20).toLowerCase()
            startPatterns[startPattern] = (startPatterns[startPattern] || 0) + 1
        }
        const totalMessages = recentMessages.length
        for (const [pattern, count] of Object.entries(startPatterns)) {
            const percentage = (count / totalMessages) * 100
            if (percentage > 60 && count >= 8) {
                throw new Error(`Gemini detected repetitive patterns. Messages starting with "${pattern}..." appear ${count} times in last ${totalMessages} messages (${percentage.toFixed(1)}%)`)
            }
        }
        const commonWords: { [key: string]: number } = {}
        for (const message of recentMessages) {
            const words = message.toLowerCase().split(/\s+/).filter(word => word.length > 3)
            for (const word of words) {
                commonWords[word] = (commonWords[word] || 0) + 1
            }
        }
        const highlyFrequentWords = Object.entries(commonWords)
            .filter(([, count]) => count >= totalMessages * 0.5)
            .map(([word]) => word)

        if (highlyFrequentWords.length >= 2) {
            console.error(`\n| detected repetitive output from the model. Words "${highlyFrequentWords.slice(0, 5).join(', ')}" appear in 50%+ of recent messages`)
            this.recycleGemini().then(() => {
                this.recentMessages = []
                this.session.sendClientContent({
                    turns: [{
                        parts: [{ text: RUN_STEP_PROMPT_LIVE_API(this.step) }],
                        role: 'user'
                    }]
                })
            })
        }
    }

    private async start(): Promise<Session> {
        return this.ai.live.connect(await this.config())
    }

    public async teardown(): Promise<this> {
        this.session?.close()
        await this.playwrightMCP.disconnect()
        return this
    }

    private async getTools(): Promise<Tool[]> {
        return [{
            functionDeclarations: [
                ...await this.playwrightMCP.functionDeclarations(),
                ...this.salesforceTool.functionDeclarations,
                ...this.stepTool.functionDeclarations,
            ] satisfies FunctionDeclaration[]
        }]
    }

    private async config(): Promise<LiveConnectParameters> {
        return {
            model: this.model,
            callbacks: this.getCallbacks(),
            config: {
                temperature: parseFloat(process.env.GOOGLE_API_TEMPERATURE ?? '0.1'),
                responseModalities: [Modality.TEXT],
                contextWindowCompression: {
                    triggerTokens: '50000',
                    slidingWindow: {
                        targetTokens: '10000'
                    }
                },
                tools: await this.getTools()
            }
        } satisfies LiveConnectParameters
    }

    private async getCompressedScreenshot() {
        try {
            const screenshot = await this.playwrightMCP.callTool({ name: 'browser_take_screenshot' })
            const bufferImgCompressed = await sharp(Buffer.from(screenshot.content?.[1].data, 'base64'))
                .resize({ width: 768, height: 768, fit: 'inside' })
                .toBuffer()
                .then(data => { return data })
                .catch(err => { console.log(`Error on compress\n${err}`) })
            if (!bufferImgCompressed) {
                throw new Error(`Failed to compress screenshot`)
            }
            return {
                mimeType: screenshot.content?.[1].mimeType,
                data: bufferImgCompressed.toString('base64'),
            }
        } catch (error) {
            throw new Error(`Failed to get compressed screenshot:\n${error}`)
        }
    }

    private async callPlawrightMcpTool(toolCall: FunctionCall) {
        console.log(`\nusing playwright mcp tool ${toolCall.name}`)
        console.log(JSON.stringify(toolCall.args ?? {}, null, 2))
        await this.playwrightTool.call({ name: toolCall.name ?? '', arguments: toolCall.args ?? {} }).then(async result => {
            this.ai.models.countTokens({
                model: this.model,
                contents: [{ text: JSON.stringify(result, null, 2) }]
            }).then(tokens => {
                this.inputTokensUsed += tokens.totalTokens ?? 0
                console.log(`\n| input tokens usage`
                    + `\n| response: ${tokens.totalTokens}`
                    + `\n| total: ${this.inputTokensUsed} @ ${GeminiTokenPricing.inputPriceUSD(this.model, this.inputTokensUsed)}$`
                )
            })
            if (toolCall.name?.toLowerCase().includes('snapshot') && process.env.GOOGLE_API_INCLUDE_SCREENSHOT_IN_SNAPSHOT?.toLowerCase() === 'true') {
                const compressedScreenshot = await this.getCompressedScreenshot()
                this.session.sendToolResponse({
                    functionResponses: {
                        id: toolCall.id,
                        name: toolCall.name,
                        response: result,
                        parts: [{
                            inlineData: {
                                mimeType: compressedScreenshot.mimeType,
                                data: compressedScreenshot.data
                            }
                        }],
                        scheduling: FunctionResponseScheduling.WHEN_IDLE
                    }
                })
            } else {
                this.session.sendToolResponse({
                    functionResponses: {
                        id: toolCall.id,
                        name: toolCall.name,
                        response: result,
                        scheduling: FunctionResponseScheduling.WHEN_IDLE
                    }
                })
            }
        }).catch(error => {
            console.error(error)
        })
    }

    private async callSalesforceCliTool(toolCall: FunctionCall) {
        console.log(`\nusing salesforce cli tool ${toolCall.name}`)
        console.log(JSON.stringify(toolCall.args ?? {}, null, 2))
        await this.salesforceTool.call(toolCall).then(result => {
            this.session.sendToolResponse({
                functionResponses: {
                    id: toolCall.id,
                    name: toolCall.name,
                    response: { output: result },
                    scheduling: FunctionResponseScheduling.WHEN_IDLE
                }
            })
        }).catch(error => {
            console.error(error)
        })
    }

    private async callTestCaseTool(toolCall: FunctionCall) {
        console.log(`\nusing test case tool ${toolCall.name}`)
        console.log(JSON.stringify(toolCall.args ?? {}, null, 2))
        this.stepTool.call(toolCall, this.stepStatusCallback)
    }

    public async run(step: Step) {
        console.log(`\n>>> step starts <<<`)
        this.step = step
        this.stepStatus = { passed: false, actual: '' }
        this.recentMessages = []
        this.stepFinishedCallback = new Promise(async (finishStep) => {
            this.stepStatusCallback = finishStep
        })
        await this.recycleGemini()
        this.session.sendClientContent({
            turns: [{
                parts: [{ text: RUN_STEP_PROMPT_LIVE_API(step) }],
                role: 'user'
            }]
        })
        try {
            this.stepStatus = await this.stepFinishedCallback
            this.session.close()
            if (this.stepStatus.passed) {
                expect(this.stepStatus.actual, step.expect).toMatch(this.stepStatus.actual)
            } else {
                expect(this.stepStatus.actual, this.stepStatus.actual).toMatch(step.expect)
            }
        } catch (error) {
            throw new Error(`Failed to execute action:\n${step.action}\n\n${error}`)
        }
    }
}