import { ToolCall } from "../../mcp/server/openai-mcp"
import { ToolRegistry } from "./tool-registry"
import { StepStatusCallback } from "../types"

export class ToolDispatcher {
    private readonly toolRegistry: ToolRegistry

    constructor(toolRegistry: ToolRegistry) {
        this.toolRegistry = toolRegistry
    }

    public async dispatch(toolCall: ToolCall, stepStatusCallback: StepStatusCallback): Promise<any> {
        const { name } = toolCall

        if (name.includes("browser")) {
            return this.toolRegistry.executeBrowserTool(toolCall)
        } else if (name.includes("test_step")) {
            this.toolRegistry.executeStepTool(toolCall, stepStatusCallback)
            return null
        } else if (name.includes("salesforce")) {
            return this.toolRegistry.executeSalesforceTool(toolCall)
        } else {
            throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(toolCall, null, 2)}`)
        }
    }
}