import { Buffer } from 'node:buffer'
import type { RuntimeLogger } from './types.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'

export type LevelLogger = Readonly<{
	logger: RuntimeLogger
	transcript(): string | undefined
}>

const DEFAULT_TRANSCRIPT_BYTES = 1024 * 1024
const TRUNCATION_MARKER = '[log truncated]\n'
const levelRank: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	off: 4,
}

export function createLevelLogger(
	sink: RuntimeLogger,
	level: LogLevel,
	options: { collect?: boolean; maxTranscriptBytes?: number } = {}
): LevelLogger {
	const collect = options.collect ?? false
	const maxBytes = options.maxTranscriptBytes ?? DEFAULT_TRANSCRIPT_BYTES
	if (!Number.isSafeInteger(maxBytes) || maxBytes < Buffer.byteLength(TRUNCATION_MARKER)) {
		throw new Error('Log transcript byte limit is too small')
	}

	let transcript = ''
	let transcriptBytes = 0
	let truncated = false

	const write = (entryLevel: Exclude<LogLevel, 'off'>, message: string, details: unknown[]): void => {
		if (levelRank[entryLevel] < levelRank[level]) return
		if (collect && !truncated) append(`[${entryLevel}] ${format(message, details)}\n`)
		sink[entryLevel](message, ...details)
	}

	const append = (line: string): void => {
		const lineBytes = Buffer.byteLength(line)
		if (transcriptBytes + lineBytes <= maxBytes) {
			transcript += line
			transcriptBytes += lineBytes
			return
		}

		const markerBytes = Buffer.byteLength(TRUNCATION_MARKER)
		const contentLimit = maxBytes - markerBytes
		transcript = utf8Prefix(transcript, contentLimit)
		transcriptBytes = Buffer.byteLength(transcript)
		transcript += utf8Prefix(line, contentLimit - transcriptBytes)
		transcript += TRUNCATION_MARKER
		transcriptBytes = Buffer.byteLength(transcript)
		truncated = true
	}

	return {
		logger: {
			debug: (message, ...details) => write('debug', message, details),
			info: (message, ...details) => write('info', message, details),
			warn: (message, ...details) => write('warn', message, details),
			error: (message, ...details) => write('error', message, details),
		},
		transcript: () => (transcript.length > 0 ? transcript : undefined),
	}
}

function format(message: string, details: readonly unknown[]): string {
	if (details.length === 0) return message
	return `${message} ${details.map(formatDetail).join(' ')}`
}

function formatDetail(value: unknown): string {
	if (value instanceof Error) return `${value.name}: ${value.message}`
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}

function utf8Prefix(value: string, maxBytes: number): string {
	let result = ''
	let bytes = 0
	for (const character of value) {
		const characterBytes = Buffer.byteLength(character)
		if (bytes + characterBytes > maxBytes) break
		result += character
		bytes += characterBytes
	}
	return result
}
