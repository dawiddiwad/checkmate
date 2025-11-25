import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"
import { OpenAIServerMCP, ToolCall } from "../../mcp/server/openai-mcp"
import { PlaywrightTool } from "../../mcp/tool/playwright-tool"
import { SalesforceTool } from "../../salesforce/salesforce-tool"
import { StepTool } from "./step-tool"
import { StepStatusCallback } from "../types"

export type ToolResponse = {
    name?: string
    response: any
}

export type ToolRegistryDependencies = {
    playwrightMCP: OpenAIServerMCP
    playwrightTool: PlaywrightTool
    stepTool: StepTool
    salesforceTool: SalesforceTool
}

export class ToolRegistry {
    private readonly playwrightMCP: OpenAIServerMCP
    private readonly playwrightTool: PlaywrightTool
    private readonly stepTool: StepTool
    private readonly salesforceTool: SalesforceTool

    constructor({ playwrightMCP, playwrightTool, stepTool, salesforceTool }: ToolRegistryDependencies) {
        this.playwrightMCP = playwrightMCP
        this.playwrightTool = playwrightTool
        this.stepTool = stepTool
        this.salesforceTool = salesforceTool
    }

    private logToolCall(toolCall: ToolCall): void {
        console.log(`\nexecuting tool ${toolCall.name}`)
        console.log(JSON.stringify(toolCall.arguments ?? {}, null, 2))
    }

    async getTools(): Promise<ChatCompletionFunctionTool[]> {
        return [
            ...await this.playwrightMCP.functionDeclarations(),
            ...this.stepTool.functionDeclarations,
            ...this.salesforceTool.functionDeclarations
        ]
    }

    async executeBrowserTool(toolCall: ToolCall): Promise<ToolResponse> {
        this.logToolCall(toolCall)
        const result = await this.playwrightTool.call({ name: toolCall.name ?? '', arguments: toolCall.arguments ?? {} })
        return {
            name: toolCall.name,
            response: result
        }
    }

    executeStepTool(toolCall: ToolCall, callback: StepStatusCallback): void {
        this.logToolCall(toolCall)
        this.stepTool.call(toolCall, callback)
    }

    async executeSalesforceTool(toolCall: ToolCall): Promise<ToolResponse> {
        this.logToolCall(toolCall)
        const frontDoorUrl = await this.salesforceTool.call(toolCall)
        return {
            name: toolCall.name,
            response: {
                output: frontDoorUrl
            }
        }
    }
}
