import { ResolvedConfig } from '../config/resolved-config.js'
import { logger } from '../logging/index.js'

export class RateLimitPolicy {
	constructor(private readonly config: ResolvedConfig) {}

	async wait(): Promise<void> {
		const delay = this.config.rateLimitDelay
		if (delay <= 0) {
			return
		}

		logger.warn(`waiting: ${Math.floor(delay / 1000)} seconds to avoid rate limit`)
		await new Promise((resolve) => setTimeout(resolve, delay))
	}
}
