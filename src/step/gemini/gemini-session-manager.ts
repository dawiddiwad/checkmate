import { PlaywrightMCPServer } from "../../mcp/server/playwright-mcp"
import { StepTool } from "../tool/step-tool"
import { SalesforceTool } from "../../salesforce/salesforce-tool"
import { PlaywrightTool } from "../../mcp/tool/playwright-tool"
import { Step, StepFinishedCallback, StepStatus, StepStatusCallback } from "../types"
import { expect } from "@playwright/test"
import { RUN_STEP_PROMPT } from "./prompts"
import { ConfigurationManager } from "../configuration-manager"
import { ToolRegistry } from "../tool/tool-registry"
import { ScreenshotProcessor } from "../tool/screenshot-processor"
import { TokenTracker } from "./token-tracker"
import { HistoryManager } from "./history-manager"
import { GeminiClient } from "./gemini-client"
import { ResponseProcessor } from "./response-processor"
import { GeminiServerMCP } from "../../mcp/server/gemini-mcp"

export class GeminiSessionManager {
    private readonly playwrightMCP: GeminiServerMCP
    private readonly stepTool: StepTool
    private readonly salesforceTool: SalesforceTool
    private readonly playwrightTool: PlaywrightTool
    private readonly configurationManager: ConfigurationManager
    private readonly toolRegistry: ToolRegistry
    private readonly screenshotProcessor: ScreenshotProcessor
    private readonly tokenTracker: TokenTracker
    private readonly historyManager: HistoryManager
    private readonly geminiClient: GeminiClient
    private readonly responseProcessor: ResponseProcessor
    private stepStatus!: StepStatus
    private stepStatusCallback!: StepStatusCallback
    private stepFinishedCallback!: StepFinishedCallback

    constructor() {
        this.playwrightMCP = PlaywrightMCPServer.create()
        this.stepTool = new StepTool()
        this.salesforceTool = new SalesforceTool()
        this.playwrightTool = new PlaywrightTool(this.playwrightMCP)
        this.configurationManager = new ConfigurationManager()
        this.toolRegistry = new ToolRegistry(this.playwrightMCP, this.playwrightTool, this.stepTool, this.salesforceTool)
        this.screenshotProcessor = new ScreenshotProcessor(this.playwrightMCP)
        this.tokenTracker = new TokenTracker()
        this.historyManager = new HistoryManager()
        this.geminiClient = new GeminiClient(this.configurationManager, this.toolRegistry)
        this.responseProcessor = new ResponseProcessor(
            this.toolRegistry,
            this.geminiClient,
            this.historyManager,
            this.screenshotProcessor,
            this.tokenTracker,
            this.configurationManager
        )
    }

    private async initialize() {
        this.stepStatus = { passed: false, actual: "" }
        this.stepFinishedCallback = new Promise<StepStatus>(finishStep => {
            this.stepStatusCallback = finishStep
        })
        await this.geminiClient.initialize()
    }

    public async teardown() {
        await this.playwrightMCP.disconnect()
    }

    public async run(step: Step) {
        console.log(`\n>>> step started <<<`)
        console.log(`| action: ${step.action}`)
        console.log(`| expect: ${step.expect}`)
        try {
            await this.initialize()
            const response = await this.geminiClient.sendMessageWithRetry(
                [{ text: RUN_STEP_PROMPT(step) }]
            )
            await this.responseProcessor.handleResponse(response, step, this.stepStatusCallback)
            this.stepStatus = await this.stepFinishedCallback
            if (this.stepStatus.passed) {
                expect(this.stepStatus.actual, step.expect).toMatch(this.stepStatus.actual)
            } else {
                expect(this.stepStatus.actual, this.stepStatus.actual).toMatch(step.expect)
            }
        } catch (error) {
            throw new Error(`Failed to execute action:\n${step.action}\n\n${error}`)
        }
        console.log(`>>> step finished <<<`)
    }
}