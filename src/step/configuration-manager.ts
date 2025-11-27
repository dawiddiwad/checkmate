export class ConfigurationManager {
    getApiKey(): string {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY environment variable is not set")
        }
        return process.env.OPENAI_API_KEY
    }

    getBaseURL(): string | undefined {
        return process.env.OPENAI_BASE_URL
    }

    getModel(): string {
        return process.env.OPENAI_MODEL ?? "gpt-5-mini"
    }

    getMaxRetries(): number {
        return parseInt(process.env.OPENAI_RETRY_MAX_ATTEMPTS ?? "3")
    }

    includeScreenshotInSnapshot(): boolean {
        return process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT?.toLowerCase() === "true"
    }

    enableSnapshotCompression(): boolean {
        return process.env.OPENAI_ENABLE_SNAPSHOT_COMPRESSION?.toLowerCase() !== "false"
    }

    getToolChoice(): "auto" | "required" | "none" {
        const choice = process.env.OPENAI_TOOL_CHOICE?.toLowerCase()
        if (choice === "required" || choice === "none" || choice === "auto") {
            return choice
        }
        return "required"
    }

    getTemperature(): number {
        return parseFloat(process.env.OPENAI_TEMPERATURE ?? "1")
    }

    getTimeout(): number {
        return parseInt(process.env.OPENAI_TIMEOUT_SECONDS ?? "60") * 1000
    }

    getAllowedFunctionNames(): string[] {
        const envValue = process.env.OPENAI_ALLOWED_TOOLS?.trim()
        if (!envValue) {
            return []
        }
        return envValue.split(",").map(name => name.trim()).filter(name => name.length > 0)
    }
}
