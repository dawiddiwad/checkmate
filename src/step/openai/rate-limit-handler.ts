import { env } from "process"
import { logger } from "./openai-test-manager"

export class RateLimitHandler {
    public async waitForRateLimit(): Promise<void> {
        if (env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS) {
            logger.warn(`waiting: ${env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS} seconds to avoid rate limit`)
            await new Promise(resolve => setTimeout(resolve, parseInt(env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS ?? "0") * 1000))
        }
    }
}