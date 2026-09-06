import { DiagnosticSanitizer } from '../redaction/diagnostic-sanitizer.js'
import type { RuntimeLogger } from './types.js'

export function createInvocationLogger(sink: RuntimeLogger, sanitizer: DiagnosticSanitizer): RuntimeLogger {
	return {
		debug: (message, ...details) => sink.debug(sanitizeLog(message, details, sanitizer)),
		info: (message, ...details) => sink.info(sanitizeLog(message, details, sanitizer)),
		warn: (message, ...details) => sink.warn(sanitizeLog(message, details, sanitizer)),
		error: (message, ...details) => sink.error(sanitizeLog(message, details, sanitizer)),
	}
}

function sanitizeLog(message: string, details: readonly unknown[], sanitizer: DiagnosticSanitizer): string {
	const suffix =
		details.length === 0 ? '' : ` ${details.map((detail) => diagnosticDetail(detail, sanitizer)).join(' ')}`
	return sanitizer.text(`${message}${suffix}`)
}

function diagnosticDetail(value: unknown, sanitizer: DiagnosticSanitizer): string {
	if (value instanceof Error) return `${value.name}: ${sanitizer.error(value)}`
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}
