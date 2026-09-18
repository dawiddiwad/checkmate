import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelemetryReceiver, TELEMETRY_LIMITS } from '../../../drivers/web/telemetry-receiver.js'
import { DiagnosticSanitizer } from '../../../redaction/diagnostic-sanitizer.js'

const receivers: TelemetryReceiver[] = []
afterEach(async () => {
	await Promise.all(receivers.splice(0).map((receiver) => receiver.close()))
})

async function start(
	enabled = true,
	sanitize = (text: string) => new DiagnosticSanitizer(['fixture-secret']).text(text)
) {
	const receiver = await TelemetryReceiver.start(enabled, sanitize)
	receivers.push(receiver)
	return receiver
}

function payload(count = 1, name = 'operation fixture-secret') {
	return JSON.stringify({
		resourceSpans: [
			{
				scopeSpans: [
					{
						spans: Array.from({ length: count }, () => ({
							name,
							traceId: 'a'.repeat(32),
							spanId: 'b'.repeat(16),
							startTimeUnixNano: '123456789',
							status: { code: 2, message: 'Bearer credential-token' },
							attributes: [{ key: 'cdp.params', value: { stringValue: 'opaque raw data' } }],
						})),
					},
				],
			},
		],
	})
}

async function post(receiver: TelemetryReceiver, body = payload(), headers = receiver.headers) {
	return fetch(receiver.endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body,
	})
}

describe('driver-owned telemetry', () => {
	it('retains normalized sanitized diagnostics, not raw OTLP or CDP data', async () => {
		const receiver = await start()
		expect((await post(receiver)).status).toBe(200)
		const snapshot = receiver.read()
		expect(snapshot).toMatchObject({ partial: true, nextCursor: 1, truncated: false, evicted: false })
		expect(snapshot.events[0]).toMatchObject({ sequence: 1, traceId: 'a'.repeat(32), sourceTime: '123456789' })
		expect(JSON.stringify(snapshot)).not.toMatch(/fixture-secret|credential-token|opaque raw data|resourceSpans/)
		expect(receiver.read(1).events).toEqual([])
	})

	it('discards without parsing or sanitizing and rejects direct reads', async () => {
		const sanitize = vi.fn(() => {
			throw new Error('must not sanitize discarded bytes')
		})
		const receiver = await start(false, sanitize)
		expect((await post(receiver, 'not even JSON')).status).toBe(200)
		expect(sanitize).not.toHaveBeenCalled()
		expect(() => receiver.read()).toThrow('not permitted')
	})

	it('authenticates sessions, refuses web origins and unsupported encodings', async () => {
		const first = await start()
		const second = await start()
		expect((await post(first, payload(), second.headers)).status).toBe(401)
		expect((await post(first, payload(), {})).status).toBe(401)
		expect((await post(first, payload(), { ...first.headers, origin: 'https://example.test' })).status).toBe(415)
		expect((await post(first, payload(), { ...first.headers, 'content-encoding': 'gzip' })).status).toBe(415)
		expect((await post(first, 'not JSON')).status).toBe(400)
		expect((await post(first, '{}')).status).toBe(400)
		const accepted = await post(first, payload(), {
			...first.headers,
			origin: `chrome-extension://${'a'.repeat(32)}`,
		})
		expect(accepted.status).toBe(200)
		expect(accepted.headers.has('access-control-allow-origin')).toBe(false)
		expect(second.read().events).toEqual([])
	})

	it('bounds retained count, bytes, cursor reads, and response size', async () => {
		const receiver = await start()
		for (let index = 0; index < 10; index++)
			expect((await post(receiver, payload(40, 'x'.repeat(300)))).status).toBe(200)
		const snapshot = receiver.read(0, 50)
		expect(snapshot.evicted).toBe(true)
		expect(snapshot.truncated).toBe(true)
		expect(snapshot.events[0].sequence).toBe(145)
		expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(TELEMETRY_LIMITS.responseBytes)
		expect(receiver.read(snapshot.nextCursor).events[0].sequence).toBe(snapshot.nextCursor + 1)
		expect(() => receiver.read(-1)).toThrow()
		expect(() => receiver.read(0, 51)).toThrow()
	})

	it('rejects oversized bodies and closes ports and active sockets idempotently', async () => {
		const receiver = await start()
		expect((await post(receiver, 'x'.repeat(TELEMETRY_LIMITS.requestBytes + 1))).status).toBe(413)
		const endpoint = receiver.endpoint
		const socket = connect(Number(new URL(endpoint).port), '127.0.0.1')
		socket.on('error', () => {})
		await new Promise<void>((resolve) => socket.once('connect', resolve))
		const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
		const first = receiver.close()
		expect(receiver.close()).toBe(first)
		await first
		await closed
		await expect(fetch(endpoint)).rejects.toThrow()
		expect(() => receiver.read()).toThrow('closed')
	})

	it('bounds concurrent partial uploads and their absolute lifetime in discard mode', async () => {
		const receiver = await start(false)
		const port = Number(new URL(receiver.endpoint).port)
		const sockets = Array.from({ length: TELEMETRY_LIMITS.concurrency }, () => connect(port, '127.0.0.1'))
		const closed = sockets.map(
			(socket) =>
				new Promise<void>((resolve) => {
					socket.on('error', () => {})
					socket.once('close', () => resolve())
					socket.once('connect', () =>
						socket.write(
							`POST /v1/traces HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10\r\nx-checkmate-telemetry: ${receiver.headers['x-checkmate-telemetry']}\r\n\r\nx`
						)
					)
				})
		)
		try {
			await vi.waitFor(() =>
				expect((receiver as unknown as { pending: number }).pending).toBe(TELEMETRY_LIMITS.concurrency)
			)
			expect((await post(receiver)).status).toBe(429)
			await Promise.all(closed)
			expect((await post(receiver)).status).toBe(200)
		} finally {
			for (const socket of sockets) socket.destroy()
		}
	}, 5000)

	it('evicts by retained bytes independently of event count', async () => {
		const receiver = await start()
		const body = JSON.parse(payload(20))
		for (const span of body.resourceSpans[0].scopeSpans[0].spans) span.status.message = '\u0800'.repeat(2048)
		for (let index = 0; index < 4; index++) expect((await post(receiver, JSON.stringify(body))).status).toBe(200)
		const retained = receiver as unknown as { bytes: number; events: unknown[] }
		expect(retained.bytes).toBeLessThanOrEqual(TELEMETRY_LIMITS.bufferBytes)
		expect(retained.events.length).toBeLessThan(80)
		expect(receiver.read().evicted).toBe(true)
	})
})
