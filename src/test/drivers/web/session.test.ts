import type { Stagehand, StagehandBrowser } from '@browserbasehq/stagehand'
import { describe, expect, it, vi } from 'vitest'
import { WebResources, webSettings } from '../../../drivers/web/session.js'
import { TelemetryReceiver } from '../../../drivers/web/telemetry-receiver.js'

describe('web resource ownership', () => {
	it('closes Stagehand before its owned browser and receiver, sharing one close promise', async () => {
		const resources = new WebResources(new AbortController().signal)
		const order: string[] = []
		resources.stagehand = {
			close: vi.fn(async () => {
				order.push('stagehand')
			}),
		} as unknown as Stagehand
		resources.browser = {
			close: vi.fn(async () => {
				order.push('browser')
			}),
		} as unknown as StagehandBrowser
		resources.receiver = {
			close: vi.fn(async () => {
				order.push('receiver')
			}),
		} as unknown as TelemetryReceiver
		const signal = new AbortController().signal
		const close = resources.close(signal)
		expect(resources.close(signal)).toBe(close)
		await close
		expect(order).toEqual(['stagehand', 'browser', 'receiver'])
	})

	it('closes the browser and active receiver despite stuck SDK shutdown', async () => {
		const resources = new WebResources(new AbortController().signal)
		resources.receiver = await TelemetryReceiver.start(false, (text) => text)
		const endpoint = resources.receiver.endpoint
		resources.stagehand = { close: () => new Promise(() => {}) } as unknown as Stagehand
		const closeBrowser = vi.fn(async () => {})
		resources.browser = { close: closeBrowser } as unknown as StagehandBrowser
		const controller = new AbortController()
		const close = resources.close(controller.signal)
		controller.abort()
		await close
		expect(closeBrowser).toHaveBeenCalledTimes(1)
		await expect(fetch(endpoint)).rejects.toThrow()
	})

	it('disposes resources that arrive after startup cancellation', async () => {
		const controller = new AbortController()
		const resources = new WebResources(controller.signal)
		const close = vi.fn(async () => {})
		let deliver!: (value: { close: typeof close }) => void
		const acquisition = resources.acquire(
			new Promise<{ close: typeof close }>((resolve) => {
				deliver = resolve
			}),
			() => {
				throw new Error('late assignment')
			}
		)
		controller.abort()
		deliver({ close })
		await expect(acquisition).rejects.toThrow('startup ended')
		expect(close).toHaveBeenCalledTimes(1)
	})

	it('aggregates shutdown failures without abandoning remaining resources', async () => {
		const resources = new WebResources(new AbortController().signal)
		resources.stagehand = {
			close: async () => {
				throw new Error('SDK close failed')
			},
		} as unknown as Stagehand
		const close = vi.fn(async () => {})
		resources.browser = { close } as unknown as StagehandBrowser
		await expect(resources.close(new AbortController().signal)).rejects.toThrow('cleanup failed')
		expect(close).toHaveBeenCalledTimes(1)
		expect(() => webSettings({ snapshotFilter: false })).toThrow()
	})
})
