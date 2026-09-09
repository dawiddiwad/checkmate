import type { Readable } from 'node:stream'

export const MAX_WORKER_STREAM_BYTES = 64 * 1024

export type WorkerStreamSummary = Readonly<{
	stream: 'stdout' | 'stderr'
	bytes: number
	truncated: boolean
}>

export class WorkerStreamGuard {
	private bytes = 0
	private truncated = false
	private attached = false

	constructor(
		private readonly name: WorkerStreamSummary['stream'],
		private readonly onActivity?: (summary: WorkerStreamSummary) => void
	) {}

	attach(stream: Readable | null): void {
		if (!stream || this.attached) return
		this.attached = true
		stream.on('data', this.onData)
		stream.resume()
	}

	dispose(stream: Readable | null): void {
		if (!stream || !this.attached) return
		stream.off('data', this.onData)
		stream.destroy()
		this.attached = false
	}

	summary(): WorkerStreamSummary {
		return { stream: this.name, bytes: this.bytes, truncated: this.truncated }
	}

	private readonly onData = (chunk: string | Buffer): void => {
		const size = typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.byteLength
		const previous = this.bytes
		const wasTruncated = this.truncated
		this.bytes = Math.min(Number.MAX_SAFE_INTEGER, this.bytes + size)
		if (this.bytes > MAX_WORKER_STREAM_BYTES) this.truncated = true
		if (previous === 0 || (!wasTruncated && this.truncated)) {
			this.onActivity?.(this.summary())
		}
	}
}
