import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { PreparedRun } from '../api/prepare-run.js'
import type { Diagnostic } from '../contracts/types.js'
import { serializeJson } from '../contracts/serialize.js'
import type { RunIdentity } from '../evidence/layout.js'

export const MAX_IPC_FRAME_BYTES = 1024 * 1024

export type ParentMessage =
	{ type: 'start'; identity: RunIdentity; prepared: PreparedRun } | { type: 'abort'; signal: 'SIGINT' | 'SIGTERM' }

export type TerminalDigest = { byteLength: number; sha256: string }

export type WorkerMessage =
	| {
			type: 'terminal-inline'
			runId: string
			committed: true
			resultJson: string
			digest: TerminalDigest
	  }
	| {
			type: 'terminal-file'
			runId: string
			committed: true
			digest: TerminalDigest
	  }
	| {
			type: 'terminal-inline'
			runId: string
			committed: false
			resultJson: string
	  }
	| { type: 'diagnostic'; runId: string; diagnostic: Diagnostic }
	| { type: 'cleanup-started'; runId: string }
	| { type: 'fatal'; runId: string; diagnostic: Diagnostic }

export class IpcProtocolError extends Error {
	constructor(
		readonly code: 'ipc-frame-too-large' | 'ipc-invalid-frame',
		message: string
	) {
		super(message)
		this.name = 'IpcProtocolError'
	}
}

export function ipcFrameBytes(message: unknown): number {
	return Buffer.byteLength(serializeJson(message), 'utf8')
}

export function assertIpcFrameSize(message: unknown): void {
	if (ipcFrameBytes(message) > MAX_IPC_FRAME_BYTES) {
		throw new IpcProtocolError('ipc-frame-too-large', `IPC frame exceeds ${MAX_IPC_FRAME_BYTES} bytes`)
	}
}

export function sendIpcFrame(
	send: (message: ParentMessage | WorkerMessage) => boolean,
	message: ParentMessage | WorkerMessage
): boolean {
	assertIpcFrameSize(message)
	return send(message)
}

export function terminalDigest(bytes: string): TerminalDigest {
	return {
		byteLength: Buffer.byteLength(bytes, 'utf8'),
		sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'),
	}
}

export function digestMatches(bytes: string, digest: TerminalDigest): boolean {
	const actual = terminalDigest(bytes)
	return actual.byteLength === digest.byteLength && actual.sha256 === digest.sha256
}

export function parseParentMessage(message: unknown): ParentMessage {
	assertIpcFrameSize(message)
	if (!isRecord(message)) throw invalidFrame()
	if (message.type === 'abort' && (message.signal === 'SIGINT' || message.signal === 'SIGTERM')) {
		return message as ParentMessage
	}
	if (message.type === 'start' && isRunIdentity(message.identity) && isRecord(message.prepared)) {
		return message as ParentMessage
	}
	throw invalidFrame()
}

export function parseWorkerMessage(message: unknown): WorkerMessage {
	assertIpcFrameSize(message)
	if (!isRecord(message) || !isRunId(message.runId) || typeof message.type !== 'string') throw invalidFrame()

	if (message.type === 'cleanup-started') return message as WorkerMessage
	if ((message.type === 'diagnostic' || message.type === 'fatal') && isDiagnostic(message.diagnostic)) {
		return message as WorkerMessage
	}
	if (message.type === 'terminal-file' && message.committed === true && isDigest(message.digest)) {
		return message as WorkerMessage
	}
	if (message.type === 'terminal-inline' && typeof message.resultJson === 'string') {
		if (message.committed === false) return message as WorkerMessage
		if (message.committed === true && isDigest(message.digest)) return message as WorkerMessage
	}
	throw invalidFrame()
}

export function diagnosticFrame(runId: string, diagnostic: Diagnostic): WorkerMessage {
	const frame: WorkerMessage = { type: 'diagnostic', runId, diagnostic }
	try {
		assertIpcFrameSize(frame)
		return frame
	} catch {
		return {
			type: 'diagnostic',
			runId,
			diagnostic: {
				code: 'diagnostic.frame-too-large',
				path: '',
				message: 'A worker diagnostic was omitted because its IPC frame exceeded the limit',
			},
		}
	}
}

function isRunIdentity(value: unknown): value is RunIdentity {
	return (
		isRecord(value) &&
		isRunId(value.runId) &&
		typeof value.startedAt === 'string' &&
		typeof value.runDirectory === 'string' &&
		typeof value.relativeRunDirectory === 'string'
	)
}

function isDigest(value: unknown): value is TerminalDigest {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.byteLength) &&
		(value.byteLength as number) >= 0 &&
		typeof value.sha256 === 'string' &&
		/^[0-9a-f]{64}$/.test(value.sha256)
	)
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return (
		isRecord(value) &&
		typeof value.code === 'string' &&
		value.code.length > 0 &&
		typeof value.path === 'string' &&
		typeof value.message === 'string' &&
		value.message.length > 0
	)
}

function isRunId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidFrame(): IpcProtocolError {
	return new IpcProtocolError('ipc-invalid-frame', 'IPC frame does not match the Checkmate worker protocol')
}
