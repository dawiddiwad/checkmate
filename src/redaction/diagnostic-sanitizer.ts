import { Redactor } from './redactor.js'

const MAX_CAUSE_DEPTH = 16

export class DiagnosticSanitizer {
	private readonly redactor: Redactor

	constructor(exactSecrets: Iterable<string>) {
		this.redactor = new Redactor({ mode: 'off', exactSecrets })
	}

	text(value: string): string {
		return this.redactor.redactDiagnosticText(value)
	}

	error(error: unknown): string {
		const messages: string[] = []
		const seen = new Set<unknown>()
		let current: unknown = error
		for (let depth = 0; current !== undefined && depth < MAX_CAUSE_DEPTH; depth++) {
			if (seen.has(current)) {
				messages.push('[circular cause]')
				break
			}
			seen.add(current)
			messages.push(this.text(errorMessage(current)))
			current = errorCause(current)
		}
		return messages.join('\ncaused by: ')
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	try {
		return JSON.stringify(error) ?? String(error)
	} catch {
		return String(error)
	}
}

function errorCause(error: unknown): unknown {
	return error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : undefined
}
