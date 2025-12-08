import { PlaywrightMCPServer } from "../../mcp/server/playwright-mcp"
import { StepTool } from "../tool/step-tool"
import { SalesforceTool } from "../../salesforce/salesforce-tool"
import { PlaywrightTool } from "../../mcp/tool/playwright-tool"
import { Step, StepFinishedCallback, StepStatus, StepStatusCallback } from "../types"
import { expect } from "@playwright/test"
import { RUN_STEP_PROMPT } from "./prompts"
import { ConfigurationManager } from "../configuration-manager"
import { ToolRegistry } from "../tool/tool-registry"
import { OpenAIClient } from "./openai-client"
import { OpenAIServerMCP } from "../../mcp/server/openai-mcp"

export class OpenAITestManager {
    private readonly playwrightMCP: OpenAIServerMCP
    private readonly openaiClient: OpenAIClient

    constructor() {
        const configurationManager = new ConfigurationManager()
        const playwrightMCP = PlaywrightMCPServer.create()
        const playwrightTool = new PlaywrightTool(playwrightMCP)
        const stepTool = new StepTool()
        const salesforceTool = new SalesforceTool(playwrightTool)
        const toolRegistry = new ToolRegistry({ playwrightMCP, playwrightTool, stepTool, salesforceTool, configurationManager })
        const openaiClient = new OpenAIClient({ configurationManager, toolRegistry, playwrightMCP })
        this.playwrightMCP = playwrightMCP
        this.openaiClient = openaiClient
    }

    public async teardown() {
        await this.playwrightMCP.disconnect()
    }

    public async run(step: Step) {
        const testStep = new OpenAITestStep(this.openaiClient)
        await testStep.run(step)
    }
}

class OpenAITestStep {
    private stepStatus: StepStatus
    private stepStatusCallback!: StepStatusCallback
    private stepFinishedCallback: StepFinishedCallback

    constructor(
        private readonly openaiClient: OpenAIClient,
    ) {
        this.stepStatus = { passed: false, actual: "" }
        this.stepFinishedCallback = new Promise<StepStatus>(finishStep => {
            this.stepStatusCallback = finishStep
        })
    }

    async run(step: Step): Promise<void> {
        this.logStepStart(step)
        try {
            await this.openaiClient.initialize(step, this.stepStatusCallback)
            await this.openaiClient.sendMessage(RUN_STEP_PROMPT(step))
            this.stepStatus = await this.stepFinishedCallback
            this.assertStepResult(step)
        } catch (error) {
            throw new Error(`\nFailed to execute action:\n${step.action}\n\n${error}`)
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
        expect(this.stepStatus.passed, this.assertionMessage(step)).toBeTruthy()
    }

    private assertionMessage(step: Step): string {
        if (this.stepStatus.passed) {
            return step.expect
        } else {
            return `\nExpected: ${step.expect}\nActual: ${this.stepStatus.actual}`
        }
    }
}
