import { env } from "process"

export class RateLimitHandler {
    public async waitForRateLimit(): Promise<void> {
        if (env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS) {
            console.log(`\nwaiting ${env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS} seconds to avoid rate limit`)
            await new Promise(resolve => setTimeout(resolve, parseInt(env.OPENAI_API_RATE_LIMIT_DELAY_SECONDS ?? "0") * 1000))
        }
    }
}