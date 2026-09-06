import { ResolvedConfig } from '../config/resolved-config.js'
import type { RuntimeLogger } from '../logging/types.js'

export class RateLimitPolicy {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly runtimeLogger: RuntimeLogger
	) {}

	async wait(signal?: AbortSignal): Promise<void> {
		const delay = this.config.rateLimitDelay
		if (delay <= 0) {
			return
		}

		this.runtimeLogger.warn(`waiting: ${Math.floor(delay / 1000)} seconds to avoid rate limit`)
		await abortableDelay(delay, signal)
	}
}

function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
	if (!signal) return new Promise((resolve) => setTimeout(resolve, delay))
	if (signal.aborted) return Promise.reject(signal.reason)
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort)
			resolve()
		}, delay)
		const onAbort = () => {
			clearTimeout(timer)
			reject(signal.reason)
		}
		signal.addEventListener('abort', onAbort, { once: true })
	})
}
