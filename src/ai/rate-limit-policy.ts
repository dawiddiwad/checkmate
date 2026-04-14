import { RuntimeConfig } from '../config/runtime-config'
import { logger } from '../logging'

export class RateLimitPolicy {
	constructor(private readonly config = new RuntimeConfig()) {}

	async wait(): Promise<void> {
		const delay = this.config.getApiRateLimitDelayMs()
		if (delay <= 0) {
			return
		}

		logger.warn(`waiting: ${Math.floor(delay / 1000)} seconds to avoid rate limit`)
		await new Promise((resolve) => setTimeout(resolve, delay))
	}
}
