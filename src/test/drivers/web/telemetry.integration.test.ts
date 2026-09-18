import { localBrowser, Stagehand } from '@browserbasehq/stagehand'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { TelemetryReceiver } from '../../../drivers/web/telemetry-receiver.js'
import { DiagnosticSanitizer } from '../../../redaction/diagnostic-sanitizer.js'

describe('pinned extension telemetry path', () => {
	it.each([true, false])(
		'routes actual browser exports locally throughout lifecycle, buffering=%s',
		async (enabled) => {
			const directory = await mkdtemp(join(tmpdir(), 'checkmate-telemetry-'))
			const netlog = join(directory, 'netlog.json')
			const sanitizer = new DiagnosticSanitizer(['fixture-secret'])
			const receiver = await TelemetryReceiver.start(enabled, (text) => sanitizer.text(text))
			const endpoint = receiver.endpoint
			const arrivals: { phase: string; origin?: string; status: number }[] = []
			let phase = 'initialization'
			const server = (receiver as unknown as { server: Server }).server
			server.on('request', (request, response) => {
				response.once('finish', () =>
					arrivals.push({ phase, origin: request.headers.origin, status: response.statusCode })
				)
			})
			const pageServer = createServer((_request, response) => {
				response.setHeader('content-type', 'text/html')
				response.end('<html><body><h1>Inspection fact: cobalt heron</h1></body></html>')
			})
			await new Promise<void>((resolve) => pageServer.listen(0, '127.0.0.1', resolve))
			const address = pageServer.address()
			if (!address || typeof address === 'string') throw new Error('No page address')
			let browser: Awaited<ReturnType<typeof localBrowser.launch>> | undefined
			let stagehand: Stagehand | undefined
			try {
				browser = await localBrowser.launch({ headless: true, args: [`--log-net-log=${netlog}`] })
				stagehand = await Stagehand.create({
					browser,
					logging: { level: 'off' },
					cache: false,
					telemetry: { traces: { endpoint, headers: receiver.headers } },
					model: {
						generate: async (request) => {
							expect(request.responseFormat?.type).toBe('json_schema')
							const value =
								request.responseFormat &&
								'name' in request.responseFormat &&
								request.responseFormat.name === 'Metadata'
									? { completed: true, progress: 'Complete' }
									: { extraction: 'cobalt heron' }
							return {
								role: 'assistant',
								outputFormat: 'json_schema',
								content: { type: 'text', text: JSON.stringify(value) },
								structuredContent: value,
							}
						},
					},
				})
				await eventually(() => arrivals.some((arrival) => arrival.phase === phase && arrival.status === 200))
				phase = 'operations'
				const page = (await browser.context.activePage()) ?? (await browser.context.newPage())
				await page.goto(`http://127.0.0.1:${address.port}`)
				expect(
					(await stagehand.extract('Read the inspection fact', { screenshot: false })).data.extraction
				).toBe('cobalt heron')
				await eventually(() => arrivals.some((arrival) => arrival.phase === phase && arrival.status === 200))
				phase = 'errors'
				await expect(page.evaluate('(() => { throw new Error("fixture-secret") })()')).rejects.toThrow()
				await eventually(() => arrivals.some((arrival) => arrival.phase === phase && arrival.status === 200))
				if (enabled) {
					expect(receiver.read().events.length).toBeGreaterThan(0)
					expect(JSON.stringify(receiver.read())).not.toContain('fixture-secret')
				} else {
					expect(() => receiver.read()).toThrow('not permitted')
					expect((receiver as unknown as { events: unknown[] }).events).toEqual([])
				}
				phase = 'shutdown'
				await stagehand.close()
				stagehand = undefined
				await eventually(() => arrivals.some((arrival) => arrival.phase === phase && arrival.status === 200))
				let urls: string[] = []
				await eventually(async () => {
					const log = await readFile(netlog, 'utf8')
					urls = [
						...new Set(
							[...log.matchAll(/"url":\s*("(?:[^"\\]|\\.)*")/g)].map(
								(match) => JSON.parse(match[1]) as string
							)
						),
					]
					return urls.includes(endpoint)
				})
				await browser.close()
				browser = undefined
				const finalLog = await readFile(netlog, 'utf8')
				urls = [
					...new Set([
						...urls,
						...[...finalLog.matchAll(/"url":\s*("(?:[^"\\]|\\.)*")/g)].map(
							(match) => JSON.parse(match[1]) as string
						),
					]),
				]
				expect(urls).toContain(endpoint)
				expect(urls.filter((url) => url.includes('/v1/traces'))).toEqual([endpoint])
				expect(urls.some((url) => url.includes('example.com'))).toBe(false)
				expect(arrivals.every((arrival) => /^chrome-extension:\/\/[a-p]{32}$/.test(arrival.origin ?? ''))).toBe(
					true
				)
			} finally {
				await stagehand?.close().catch(() => {})
				await browser?.close().catch(() => {})
				await receiver.close()
				pageServer.closeAllConnections()
				await new Promise<void>((resolve) => pageServer.close(() => resolve()))
				await rm(directory, { recursive: true, force: true })
			}
			await expect(fetch(endpoint)).rejects.toThrow()
		},
		60_000
	)
})

async function eventually(condition: () => boolean | Promise<boolean>): Promise<void> {
	for (let index = 0; index < 200; index++) {
		if (await condition()) return
		await delay(100)
	}
	throw new Error('Expected extension export was not observed within 20 seconds')
}
