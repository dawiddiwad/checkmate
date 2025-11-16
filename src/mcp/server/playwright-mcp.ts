import { GeminiServerMCP } from "./gemini-mcp"

export class PlaywrightMCPServer {
    static create(): GeminiServerMCP {
        const playwrightArgs: string[] = []

        if (process.env.PLAYWRIGHT_MCP_VERSION) {
            playwrightArgs.push(`@playwright/mcp@${process.env.PLAYWRIGHT_MCP_VERSION}`)
        } else {
            playwrightArgs.push('@playwright/mcp@latest')
        }

        if (process.env.PLAYWRIGHT_MCP_BROWSER) {
            playwrightArgs.push(`--browser=${process.env.PLAYWRIGHT_MCP_BROWSER}`)
        }

        if (process.env.PLAYWRIGHT_MCP_CAPS) {
            playwrightArgs.push(`--caps=${process.env.PLAYWRIGHT_MCP_CAPS}`)
        }

        if (process.env.PLAYWRIGHT_MCP_OUTPUT_DIR) {
            playwrightArgs.push(`--output-dir=${process.env.PLAYWRIGHT_MCP_OUTPUT_DIR}`)
        }

        if (process.env.PLAYWRIGHT_MCP_VIEWPORT_SIZE) {
            playwrightArgs.push(`--viewport-size=${process.env.PLAYWRIGHT_MCP_VIEWPORT_SIZE}`)
        }

        if (process.env.PLAYWRIGHT_MCP_SAVE_VIDEO_SIZE) {
            playwrightArgs.push(`--save-video=${process.env.PLAYWRIGHT_MCP_SAVE_VIDEO_SIZE}`)
        }

        if (process.env.PLAYWRIGHT_MCP_ISOLATED === 'true') {
            playwrightArgs.push('--isolated')
        }

        if (process.env.PLAYWRIGHT_MCP_HEADLESS === 'true') {
            playwrightArgs.push('--headless')
        }

        return new GeminiServerMCP({
            client: {
                name: 'playwright mcp server',
                version: '1.0.0',
            },
            server: {
                command: 'npx',
                args: playwrightArgs
            }
        })
    }
}