import type { Stagehand, StagehandBrowser } from '@browserbasehq/stagehand'
import { z } from 'zod/v4'
import type { DriverSession } from '../../driver.js'
import type { TelemetryReceiver } from './telemetry-receiver.js'
import { GenerationAdapter } from './tools/generation-adapter.js'
import { createBrowserTools } from './tools/tool.js'

export const webTarget = (input: unknown) => z.object({ baseUrl: z.url() }).strict().parse(input)
export const webSettings = (input: unknown) =>
	z
		.object({ headless: z.boolean().default(true) })
		.strict()
		.parse(input)
export type WebDriverTarget = ReturnType<typeof webTarget>
export type WebDriverSettings = ReturnType<typeof webSettings>

export class WebResources {
	browser?: StagehandBrowser
	stagehand?: Stagehand
	receiver?: TelemetryReceiver
	readonly generation = new GenerationAdapter()
	private closing = false
	private closePromise?: Promise<void>
	private browserClose?: Promise<void>
	private readonly force = new AbortController()
	private readonly onAbort = () => {
		void this.close(AbortSignal.abort()).catch(() => {})
	}

	constructor(private readonly signal: AbortSignal) {
		signal.addEventListener('abort', this.onAbort, { once: true })
	}

	async acquire<T extends { close(): Promise<void> }>(promise: Promise<T>, assign: (value: T) => void): Promise<T> {
		const value = await promise
		if (this.closing || this.signal.aborted) {
			await value.close()
			throw new Error('Browser startup ended')
		}
		assign(value)
		return value
	}

	assertLive(): void {
		this.signal.throwIfAborted()
		if (this.closing) throw new Error('Browser session closed')
		this.receiver?.assertLive()
	}

	close(signal: AbortSignal): Promise<void> {
		const force = () => {
			this.force.abort()
			void this.closeBrowser().catch(() => {})
			void this.receiver?.close().catch(() => {})
		}
		if (signal.aborted) force()
		else signal.addEventListener('abort', force, { once: true })
		if (!this.closePromise) {
			this.closing = true
			this.generation.close()
			this.signal.removeEventListener('abort', this.onAbort)
			this.closePromise = this.closeResources()
		}
		void this.closePromise.finally(() => signal.removeEventListener('abort', force)).catch(() => {})
		return this.closePromise
	}

	private closeBrowser(): Promise<void> {
		return (this.browserClose ??= Promise.resolve().then(() => this.browser?.close()))
	}

	private async closeResources(): Promise<void> {
		const failures: unknown[] = []
		try {
			await untilAborted(
				Promise.resolve().then(() => this.stagehand?.close()),
				this.force.signal
			)
		} catch (error) {
			failures.push(error)
		}
		try {
			await this.closeBrowser()
		} catch (error) {
			failures.push(error)
		}
		try {
			await this.receiver?.close()
		} catch (error) {
			failures.push(error)
		}
		if (failures.length) throw new AggregateError(failures, 'Web driver cleanup failed')
	}
}

export function createWebDriverSession(resources: WebResources): DriverSession {
	return {
		instructions: [
			'Use browser_observe when the next browser action is unclear.',
			'Use browser_act directly only when the intended action is unambiguous.',
			'Use browser_extract to inspect page facts needed for the expectation before issuing a pass or fail verdict.',
			'Do not pass or fail until the expectation is verified from a tool result. Navigation and action success alone are not verification. No automatic page snapshots or screenshots are supplied.',
			'Browser diagnostics are partial debugging context, not proof of page state or absence of errors.',
		],
		tools: createBrowserTools(resources.stagehand!, resources.receiver!).map((tool) => ({
			definition: tool.definition,
			execute: async (args, context) => {
				resources.assertLive()
				const onAbort = () => {
					void resources.close(AbortSignal.abort()).catch(() => {})
				}
				context.signal.addEventListener('abort', onAbort, { once: true })
				try {
					return await resources.generation.run(context, async () => {
						const result = await tool.execute(args, context)
						resources.assertLive()
						return result
					})
				} finally {
					context.signal.removeEventListener('abort', onAbort)
				}
			},
		})),
		buildInitialContext: async () => {
			resources.assertLive()
			return []
		},
		handleToolResponses: async () => {
			resources.assertLive()
			return []
		},
		close: ({ signal }) => resources.close(signal),
	}
}

function untilAborted(operation: Promise<void>, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = () => resolve()
		if (signal.aborted) abort()
		else signal.addEventListener('abort', abort, { once: true })
		operation
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', abort))
			.catch(() => {})
	})
}
