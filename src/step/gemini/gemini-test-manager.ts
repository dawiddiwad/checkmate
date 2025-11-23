import { PlaywrightMCPServer } from "../../mcp/server/playwright-mcp"
import { StepTool } from "../tool/step-tool"
import { SalesforceTool } from "../../salesforce/salesforce-tool"
import { PlaywrightTool } from "../../mcp/tool/playwright-tool"
import { Step, StepFinishedCallback, StepStatus, StepStatusCallback } from "../types"
import { expect } from "@playwright/test"
import { RUN_STEP_PROMPT } from "./prompts"
import { ConfigurationManager } from "../configuration-manager"
import { ToolRegistry } from "../tool/tool-registry"
import { GeminiClient } from "./gemini-client"
import { ResponseProcessor } from "./response-processor"
import { GeminiServerMCP } from "../../mcp/server/gemini-mcp"

export class GeminiTestManager {
    private readonly playwrightMCP: GeminiServerMCP
    private readonly geminiClient: GeminiClient
    private readonly responseProcessor: ResponseProcessor

    constructor() {
        const configurationManager = new ConfigurationManager()
        const playwrightMCP = PlaywrightMCPServer.create()
        const playwrightTool = new PlaywrightTool(playwrightMCP)
        const stepTool = new StepTool()
        const salesforceTool = new SalesforceTool()
        const toolRegistry = new ToolRegistry({ playwrightMCP, playwrightTool, stepTool, salesforceTool })
        const geminiClient = new GeminiClient({ configurationManager, toolRegistry })
        const responseProcessor = new ResponseProcessor({ playwrightMCP, geminiClient })
        this.playwrightMCP = playwrightMCP
        this.geminiClient = geminiClient
        this.responseProcessor = responseProcessor
    }

    public async teardown() {
        await this.playwrightMCP.disconnect()
    }

    public async run(step: Step) {
        const testStep = new GeminiTestStep(this.geminiClient, this.responseProcessor)
        await testStep.run(step)
    }
}
class GeminiTestStep {
    private stepStatus: StepStatus
    private stepStatusCallback: StepStatusCallback
    private stepFinishedCallback: StepFinishedCallback

    constructor(
        private readonly geminiClient: GeminiClient,
        private readonly responseProcessor: ResponseProcessor
    ) {
        this.stepStatus = { passed: false, actual: "" }
        this.stepFinishedCallback = new Promise<StepStatus>(finishStep => {
            this.stepStatusCallback = finishStep
        })
    }

    async run(step: Step): Promise<void> {
        this.logStepStart(step)
        try {
            await this.geminiClient.initialize()
            const response = await this.geminiClient.sendMessageWithRetry(
                [{ text: RUN_STEP_PROMPT(step) }]
            )
            await this.responseProcessor.handleResponse(response, step, this.stepStatusCallback)
            this.stepStatus = await this.stepFinishedCallback
            this.assertStepResult(step)
        } catch (error) {
            throw new Error(`Failed to execute action:\n${step.action}\n\n${error}`)
        }
        this.logStepFinish()
    }

    private logStepStart(step: Step): void {
        console.log(`\n>>> step started <<<`)
        console.log(`| action: ${step.action}`)
        console.log(`| expect: ${step.expect}`)
    }

    private logStepFinish(): void {
        console.log(`>>> step finished <<<`)
    }

    private assertStepResult(step: Step): void {
        if (this.stepStatus.passed) {
            expect(this.stepStatus.actual, step.expect).toMatch(this.stepStatus.actual)
        } else {
            expect(this.stepStatus.actual, this.stepStatus.actual).toMatch(step.expect)
        }
    }
}