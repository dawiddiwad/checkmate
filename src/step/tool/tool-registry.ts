import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"
import { SalesforceTool } from "../../salesforce/salesforce-tool"
import { StepTool } from "./step-tool"
import { StepStatusCallback } from "../types"
import { ConfigurationManager } from "../configuration-manager"
import { BrowserTool } from "./browser-tool"
import { ToolCall } from "../../mcp/tool/openai-tool"
import { logger } from "../openai/openai-test-manager"

export type ToolResponse = {
    name?: string
    response: any
}

export type ToolRegistryDependencies = {
    browserTool: BrowserTool
    stepTool: StepTool
    salesforceTool: SalesforceTool
    configurationManager: ConfigurationManager
}

export class ToolRegistry {
    private readonly browserTool: BrowserTool
    private readonly stepTool: StepTool
    private readonly salesforceTool: SalesforceTool
    private readonly configurationManager: ConfigurationManager

    constructor({ browserTool, stepTool, salesforceTool, configurationManager }: ToolRegistryDependencies) {
        this.browserTool = browserTool
        this.stepTool = stepTool
        this.salesforceTool = salesforceTool
        this.configurationManager = configurationManager
    }

    private logToolCall(toolCall: ToolCall): void {
        logger.info(`executing tool: ${toolCall.name}:\n${JSON.stringify(toolCall.arguments ?? {}, null, 2)}`)
    }

    async getTools(): Promise<ChatCompletionFunctionTool[]> {
        const allowedNames = this.configurationManager.getAllowedFunctionNames()
        const allTools = [
            ...this.browserTool.functionDeclarations,
            ...this.stepTool.functionDeclarations,
            ...this.salesforceTool.functionDeclarations
        ]

        if (allowedNames.length > 0) {
            return allTools.filter(tool => allowedNames.includes(tool.function.name))
        }
        return allTools
    }

    async executeBrowserTool(toolCall: ToolCall): Promise<ToolResponse> {
        this.logToolCall(toolCall)
        const result = await this.browserTool.call({ name: toolCall.name ?? '', arguments: toolCall.arguments ?? {} })
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
        const result = await this.salesforceTool.call(toolCall)
        return {
            name: toolCall.name,
            response: result
        }
    }
}
