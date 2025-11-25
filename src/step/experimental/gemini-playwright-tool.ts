import { FunctionDeclaration } from "@google/genai"
import { GeminiServerMCP, ToolCall } from "./gemini-mcp"

// Gemini-specific PlaywrightTool wrapper for the experimental Live API
export class GeminiPlaywrightTool {
    functionDeclarations: FunctionDeclaration[]
    ready: Promise<this>
    private playwrightMCP: GeminiServerMCP
    
    constructor(mcp: GeminiServerMCP) {
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

    async call(specified: ToolCall): Promise<any> {
        if (!specified.name) {
            throw new Error(`Tool name is required, received call\n: ${JSON.stringify(specified, null, 2)}`)
        }
        if (!this.functionDeclarations.find(declaration => declaration.name === specified.name)) {
            throw new Error(`Tool not found: ${specified.name}`)
        }
        await this.ready
        return this.playwrightMCP.callTool(specified)
    }
}
