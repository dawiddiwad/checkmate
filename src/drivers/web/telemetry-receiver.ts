import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { z } from 'zod/v4'

export const TELEMETRY_LIMITS = Object.freeze({
	requestBytes: 256 * 1024,
	requestMs: 2000,
	concurrency: 8,
	events: 256,
	bufferBytes: 256 * 1024,
	responseBytes: 16 * 1024,
	readEvents: 50,
})

const attribute = z.object({ key: z.string(), value: z.object({ stringValue: z.string().optional() }) })
const spanSchema = z.object({
	name: z.string(),
	traceId: z
		.string()
		.regex(/^[a-f0-9]{32}$/i)
		.optional(),
	spanId: z
		.string()
		.regex(/^[a-f0-9]{16}$/i)
		.optional(),
	startTimeUnixNano: z
		.string()
		.regex(/^\d{1,24}$/)
		.optional(),
	status: z.object({ code: z.number().int().min(0).max(2).optional(), message: z.string().optional() }).optional(),
	attributes: z.array(attribute).optional(),
	events: z.array(z.object({ name: z.string(), attributes: z.array(attribute).optional() })).optional(),
})
const payloadSchema = z.object({
	resourceSpans: z.array(z.object({ scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })) })),
})

type DiagnosticEvent = {
	sequence: number
	receivedAt: string
	sourceTime?: string
	traceId?: string
	spanId?: string
	name: string
	status?: number
	message?: string
}

export type DiagnosticSnapshot = {
	events: DiagnosticEvent[]
	nextCursor: number
	truncated: boolean
	evicted: boolean
	partial: true
}

export class TelemetryReceiver {
	private readonly token = randomBytes(32).toString('hex')
	private readonly server = createServer({ connectionsCheckingInterval: 100 }, (request, response) =>
		this.receive(request, response)
	)
	private readonly sockets = new Set<Socket>()
	private readonly events: { event: DiagnosticEvent; bytes: number }[] = []
	private bytes = 0
	private sequence = 0
	private evictedThrough = 0
	private pending = 0
	private closed = false
	private closePromise?: Promise<void>
	private failure?: Error
	private onFailure?: () => void
	private address?: string

	private constructor(
		private readonly enabled: boolean,
		private readonly sanitizeText: (text: string) => string
	) {
		this.server.maxConnections = TELEMETRY_LIMITS.concurrency * 2
		this.server.headersTimeout = TELEMETRY_LIMITS.requestMs
		this.server.requestTimeout = TELEMETRY_LIMITS.requestMs
		this.server.on('connection', (socket) => {
			this.sockets.add(socket)
			socket.setTimeout(TELEMETRY_LIMITS.requestMs, () => socket.destroy())
			socket.once('close', () => this.sockets.delete(socket))
		})
		this.server.on('clientError', (_error, socket) => socket.destroy())
		this.server.on('error', () => this.fail())
		this.server.on('close', () => {
			if (!this.closed) this.fail()
		})
	}

	static async start(enabled: boolean, sanitizeText: (text: string) => string): Promise<TelemetryReceiver> {
		const receiver = new TelemetryReceiver(enabled, sanitizeText)
		await new Promise<void>((resolve, reject) => {
			receiver.server.once('error', reject)
			receiver.server.listen(0, '127.0.0.1', () => {
				receiver.server.removeListener('error', reject)
				resolve()
			})
		})
		const address = receiver.server.address()
		if (!address || typeof address === 'string') throw new Error('Local telemetry receiver unavailable')
		receiver.address = `http://127.0.0.1:${address.port}/v1/traces`
		return receiver
	}

	get endpoint(): string {
		this.assertLive()
		return this.address!
	}

	get headers(): Record<string, string> {
		return { 'x-checkmate-telemetry': this.token }
	}

	onUnexpectedFailure(callback: () => void): void {
		this.onFailure = callback
		if (this.failure) callback()
	}

	assertLive(): void {
		if (this.failure) throw this.failure
		if (this.closed) throw new Error('Local telemetry receiver closed')
	}

	read(after = 0, limit = 20): DiagnosticSnapshot {
		this.assertLive()
		if (!this.enabled) throw new Error('Browser diagnostics are not permitted')
		if (
			!Number.isSafeInteger(after) ||
			after < 0 ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > TELEMETRY_LIMITS.readEvents
		)
			throw new Error('Invalid diagnostic cursor or limit')
		const candidates = this.events.filter(({ event }) => event.sequence > after)
		const result: DiagnosticSnapshot = {
			events: [],
			nextCursor: after,
			truncated: false,
			evicted: after < this.evictedThrough,
			partial: true,
		}
		for (const { event } of candidates) {
			if (
				result.events.length === limit ||
				Buffer.byteLength(JSON.stringify(result)) + Buffer.byteLength(JSON.stringify(event)) >
					TELEMETRY_LIMITS.responseBytes - 128
			) {
				result.truncated = true
				break
			}
			result.events.push(structuredClone(event))
			result.nextCursor = event.sequence
		}
		return result
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise
		this.closed = true
		this.events.length = 0
		this.bytes = 0
		this.closePromise = new Promise<void>((resolve, reject) => {
			this.server.close((error) => (error ? reject(error) : resolve()))
			for (const socket of this.sockets) socket.destroy()
			this.server.closeAllConnections()
		})
		return this.closePromise
	}

	private fail(): void {
		this.failure ??= new Error('Local telemetry receiver failed')
		this.onFailure?.()
	}

	private receive(request: IncomingMessage, response: ServerResponse): void {
		const reject = (status: number) => {
			response.writeHead(status, { connection: 'close' }).end()
			request.resume()
		}
		if (this.closed || this.failure) return reject(503)
		if (request.method !== 'POST' || request.url !== '/v1/traces') return reject(404)
		const auth = request.headers['x-checkmate-telemetry']
		if (
			typeof auth !== 'string' ||
			Buffer.byteLength(auth) !== this.token.length ||
			!timingSafeEqual(Buffer.from(auth), Buffer.from(this.token))
		)
			return reject(401)
		const origin = request.headers.origin
		if (
			(origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) ||
			request.headers['content-encoding'] ||
			request.headers['content-type']?.split(';')[0] !== 'application/json'
		)
			return reject(415)
		if (this.pending >= TELEMETRY_LIMITS.concurrency) return reject(429)
		if (Number(request.headers['content-length']) > TELEMETRY_LIMITS.requestBytes) return reject(413)
		this.pending++
		let size = 0
		let finished = false
		const chunks: Buffer[] = []
		const timer = setTimeout(() => request.destroy(), TELEMETRY_LIMITS.requestMs)
		const finish = () => {
			if (finished) return
			finished = true
			clearTimeout(timer)
			this.pending--
			chunks.length = 0
		}
		request.once('close', finish)
		request.once('error', finish)
		request.on('data', (chunk: Buffer) => {
			size += chunk.length
			if (size > TELEMETRY_LIMITS.requestBytes) {
				finish()
				request.destroy()
				return
			}
			if (this.enabled && !finished) chunks.push(chunk)
		})
		request.once('end', () => {
			if (finished) return
			try {
				if (this.enabled) {
					const payload = payloadSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
					for (const resource of payload.resourceSpans)
						for (const scope of resource.scopeSpans) for (const span of scope.spans) this.retain(span)
				}
				response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
			} catch {
				reject(400)
			} finally {
				finish()
			}
		})
	}

	private retain(span: z.infer<typeof spanSchema>): void {
		const messages = [span.status?.message]
		for (const attribute of [
			...(span.attributes ?? []),
			...(span.events ?? []).flatMap((event) => event.attributes ?? []),
		]) {
			if (['exception.message', 'stagehand.log.message', 'rpc.method'].includes(attribute.key))
				messages.push(attribute.value.stringValue)
		}
		const event: DiagnosticEvent = {
			sequence: ++this.sequence,
			receivedAt: new Date().toISOString(),
			name: this.sanitizeText(span.name).slice(0, 256),
			...(span.startTimeUnixNano ? { sourceTime: span.startTimeUnixNano } : {}),
			...(span.traceId ? { traceId: span.traceId } : {}),
			...(span.spanId ? { spanId: span.spanId } : {}),
			...(span.status?.code === undefined ? {} : { status: span.status.code }),
			message: this.sanitizeText(messages.filter((value) => value !== undefined).join('\n')).slice(0, 2048),
		}
		const bytes = Buffer.byteLength(JSON.stringify(event))
		this.events.push({ event, bytes })
		this.bytes += bytes
		while (this.events.length > TELEMETRY_LIMITS.events || this.bytes > TELEMETRY_LIMITS.bufferBytes) {
			const removed = this.events.shift()!
			this.bytes -= removed.bytes
			this.evictedThrough = removed.event.sequence
		}
	}
}
