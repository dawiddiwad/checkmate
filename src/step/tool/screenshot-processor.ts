import sharp from "sharp"
import { OpenAIServerMCP } from "../../mcp/server/openai-mcp"
import { PlaywrightToolNames } from "../../mcp/tool/playwright-tool-names"

export class ScreenshotProcessor {
    constructor(private readonly playwrightMCP: OpenAIServerMCP) { }

    async getCompressedScreenshot(): Promise<{ mimeType?: string; data: string }> {
        try {
            const screenshot = await this.playwrightMCP.callTool({ name: PlaywrightToolNames.BROWSER_TAKE_SCREENSHOT })
            const compressedBuffer = await sharp(Buffer.from(screenshot.content?.[1].data, "base64"))
                .resize({ width: 768, height: 768, fit: "inside" })
                .toBuffer()
            if (!compressedBuffer) {
                throw new Error("Failed to compress screenshot")
            }
            return {
                mimeType: screenshot.content?.[1].mimeType,
                data: compressedBuffer.toString("base64")
            }
        } catch (error) {
            throw new Error(`Failed to get compressed screenshot:\n${error}`)
        }
    }
}