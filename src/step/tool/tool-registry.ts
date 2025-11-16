import { FunctionCall, FunctionDeclaration, FunctionResponse, Tool } from "@google/genai"
import { GeminiServerMCP } from "../../mcp/server/gemini-mcp"
import { PlaywrightTool } from "../../mcp/tool/playwright-tool"
import { SalesforceTool } from "../../salesforce/salesforce-tool"
import { StepTool } from "./step-tool"
import { StepStatusCallback } from "../types"

export class ToolRegistry {
    constructor(
        private readonly playwrightMCP: GeminiServerMCP,
        private readonly playwrightTool: PlaywrightTool,
        private readonly stepTool: StepTool,
        private readonly salesforceTool: SalesforceTool
    ) {}

    private logToolCall(toolCall: FunctionCall): void {
        console.log(`\nexecuting tool ${toolCall.name}`)
        console.log(JSON.stringify(toolCall.args ?? {}, null, 2))
    }

    async getTools(): Promise<Tool[]> {
        return [
            {
                functionDeclarations: [
                    ...await this.playwrightMCP.functionDeclarations(),
                    ...this.stepTool.functionDeclarations,
                    ...this.salesforceTool.functionDeclarations
                ] as FunctionDeclaration[]
            }
        ]
    }

    async executeBrowserTool(toolCall: FunctionCall): Promise<FunctionResponse> {
        this.logToolCall(toolCall)
        const result = await this.playwrightTool.call({ name: toolCall.name ?? '', arguments: toolCall.args ?? {} })
        return {
            name: toolCall.name,
            response: result
        }
    }

    executeStepTool(toolCall: FunctionCall, callback: StepStatusCallback): void {
        this.logToolCall(toolCall)
        this.stepTool.call(toolCall, callback)
    }

    async executeSalesforceTool(toolCall: FunctionCall): Promise<FunctionResponse> {
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