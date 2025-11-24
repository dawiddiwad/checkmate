import sharp from "sharp"
import { GeminiServerMCP } from "../../mcp/server/gemini-mcp"

export class ScreenshotProcessor {
    constructor(private readonly playwrightMCP: GeminiServerMCP) { }

    async getCompressedScreenshot(): Promise<{ mimeType?: string; data: string }> {
        try {
            const screenshot = await this.playwrightMCP.callTool({ name: "browser_take_screenshot" })
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