import { ChatCompletionFunctionTool } from "openai/resources/chat/completions"
import { OpenAITool, ToolCallArgs } from "./openai-tool"
import { OpenAIServerMCP } from "../server/openai-mcp"

export class PlaywrightTool implements OpenAITool {
    functionDeclarations: ChatCompletionFunctionTool[]
    ready: Promise<this>
    private playwrightMCP: OpenAIServerMCP
    constructor(mcp: OpenAIServerMCP) {
        this.playwrightMCP = mcp
        this.ready = new Promise(async (makeReady, reject) => {
            try {
                this.functionDeclarations = await this.playwrightMCP.functionDeclarations()
                makeReady(this)
            } catch (error) {
                reject(error)
            }
        })
    }

    async call(specified: ToolCallArgs): Promise<any> {
        if (!specified.name) {
            throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
        }
        if (!this.functionDeclarations.find(declaration => declaration.function.name === specified.name)) {
            throw new Error(`Tool not found: ${specified.name}`)
        }
        await this.ready
        return this.playwrightMCP.callTool(specified)
    }
}