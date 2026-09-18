import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkmateDriver } from '../../../drivers/web/index.js'
import { TelemetryReceiver } from '../../../drivers/web/telemetry-receiver.js'
import { silentLogger } from '../../../logging/types.js'

const sdk = vi.hoisted(() => ({ launch: vi.fn(), create: vi.fn() }))
vi.mock('@browserbasehq/stagehand', () => ({ localBrowser: { launch: sdk.launch }, Stagehand: { create: sdk.create } }))

const startReceiver = TelemetryReceiver.start.bind(TelemetryReceiver)
let receiver: TelemetryReceiver | undefined
let endpoint: string
const goto = vi.fn(async () => {})
const page = { goto }
const activePage = vi.fn(async () => page)
const newPage = vi.fn(async () => page)
const closeBrowser = vi.fn(async () => {})
const closeStagehand = vi.fn(async () => {})
const browser = { context: { activePage, newPage }, close: closeBrowser }
const stagehand = { close: closeStagehand }

beforeEach(() => {
	vi.resetAllMocks()
	sdk.launch.mockResolvedValue(browser)
	sdk.create.mockResolvedValue(stagehand)
	activePage.mockResolvedValue(page)
	newPage.mockResolvedValue(page)
	vi.spyOn(TelemetryReceiver, 'start').mockImplementation(async (...args) => {
		receiver = await startReceiver(...args)
		endpoint = receiver.endpoint
		return receiver
	})
})

afterEach(async () => {
	await receiver?.close()
	receiver = undefined
	vi.restoreAllMocks()
})

function start(signal: AbortSignal) {
	return checkmateDriver.start({
		target: { baseUrl: 'http://127.0.0.1' },
		settings: {},
		signal,
		logger: silentLogger,
		secrets: { read: () => '' },
		evidence: { capture: async () => ({ status: 'discarded' }) },
		allowlistedTools: ['browser_extract'],
		diagnostics: { sanitizeText: (text) => text },
	})
}

describe('web startup rollback', () => {
	it('disables self-healing at SDK initialization, not in action options', async () => {
		const session = await start(new AbortController().signal)
		try {
			expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({ selfHeal: false, cache: false }))
		} finally {
			await session.close({ signal: new AbortController().signal })
		}
	})

	it.each(['launch', 'create', 'activePage', 'newPage', 'goto'] as const)(
		'closes acquired resources when %s fails',
		async (boundary) => {
			const failure = new Error('fixture acquisition failed')
			if (boundary === 'newPage') activePage.mockResolvedValueOnce(undefined)
			const operation = { ...sdk, activePage, newPage, goto }[boundary]
			operation.mockRejectedValueOnce(failure)
			await expect(start(new AbortController().signal)).rejects.toThrow('failed to start')
			await expect(fetch(endpoint)).rejects.toThrow()
			expect(closeBrowser).toHaveBeenCalledTimes(boundary === 'launch' ? 0 : 1)
			expect(closeStagehand).toHaveBeenCalledTimes(['activePage', 'newPage', 'goto'].includes(boundary) ? 1 : 0)
		}
	)

	it.each(['launch', 'create'] as const)('disposes late %s acquisition after cancellation', async (boundary) => {
		let deliver!: (value: unknown) => void
		sdk[boundary].mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					deliver = resolve
				})
		)
		const controller = new AbortController()
		const pending = start(controller.signal)
		const rejection = expect(pending).rejects.toThrow('failed to start')
		await vi.waitFor(() => expect(deliver).toBeTypeOf('function'))
		controller.abort()
		await expect(fetch(endpoint)).rejects.toThrow()
		deliver(boundary === 'launch' ? browser : stagehand)
		await rejection
		expect(closeBrowser).toHaveBeenCalledOnce()
		expect(closeStagehand).toHaveBeenCalledTimes(boundary === 'create' ? 1 : 0)
	})

	it('fails closed when the local receiver unexpectedly stops', async () => {
		const session = await start(new AbortController().signal)
		const server = (receiver as unknown as { server: import('node:http').Server }).server
		server.emit('error', new Error('fixture receiver failure'))
		await vi.waitFor(() => expect(closeBrowser).toHaveBeenCalledOnce())
		await expect(fetch(endpoint)).rejects.toThrow()
		await expect(
			session.buildInitialContext({
				step: { id: 'inspect', action: 'read', expect: 'fact' },
				signal: new AbortController().signal,
			})
		).rejects.toThrow('closed')
		await session.close({ signal: new AbortController().signal })
	})
})
