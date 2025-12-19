import { LogLevel } from "./logger"

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
        return process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
    }

    getMaxRetries(): number {
        return parseInt(process.env.OPENAI_RETRY_MAX_ATTEMPTS ?? "3")
    }

    includeScreenshotInSnapshot(): boolean {
        return process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT?.toLowerCase() === "true"
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

    getTokenBudgetUSD(): number | undefined {
        const env = process.env.OPENAI_API_TOKEN_BUDGET_USD
        if (!env) return undefined
        const parsed = parseFloat(env)
        if (Number.isNaN(parsed)) return undefined
        return parsed
    }

    getTokenBudgetCount(): number | undefined {
        const env = process.env.OPENAI_API_TOKEN_BUDGET_COUNT
        if (!env) return undefined
        const parsed = parseInt(env, 10)
        if (Number.isNaN(parsed)) return undefined
        return parsed
    }

    getLoopMaxRepetitions(): number {
        const env = process.env.OPENAI_LOOP_MAX_REPETITIONS
        if (!env) return 5
        const parsed = parseInt(env, 10)
        if (Number.isNaN(parsed)) return 5
        return parsed
    }

    getReasoningEffort(): "none" | "low" | "medium" | "high" | undefined {
        const effort = process.env.OPENAI_REASONING_EFFORT?.toLowerCase()
        if (effort === "low" || effort === "medium" || effort === "high") {
            return effort
        }
        return undefined
    }

    getLogLevel(): LogLevel {
        const level = process.env.CHECKMATE_LOG_LEVEL?.toLowerCase()
        if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error' || level === 'off') {
            return level
        }
        return 'off'
    }
}
