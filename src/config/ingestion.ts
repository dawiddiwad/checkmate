import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { serializeJson } from '../contracts/serialize.js'
import type { Diagnostic } from '../contracts/types.js'
import { ownValue } from './record.js'

export const INGESTION_LIMITS = Object.freeze({
	documentBytes: 256 * 1024,
	maxDepth: 64,
	maxValues: 10_000,
	maxSteps: 100,
	maxIdCharacters: 128,
	maxNameCharacters: 256,
	maxStepTextBytes: 16 * 1024,
	maxDiagnostics: 100,
	maxDiagnosticBytes: 64 * 1024,
	maxPreparedRunBytes: 1024 * 1024,
})

export type InputFailureStatus = 'invalid' | 'error'

export type InputResult<T> =
	{ ok: true; value: T } | { ok: false; status: InputFailureStatus; diagnostics: [Diagnostic, ...Diagnostic[]] }

export type JsonInputSource =
	| { kind: 'value'; value: unknown }
	| { kind: 'file'; path: string }
	| { kind: 'stdin'; stream: AsyncIterable<string | Uint8Array> }

export async function acquireJsonInput(source: JsonInputSource, path = ''): Promise<InputResult<unknown>> {
	if (source.kind === 'value') return inspectJsonStructure(source.value, path)
	if (source.kind === 'file') return readJsonDocument(source.path, path)
	return readJsonStream(source.stream, path)
}

export async function readJsonDocument(filePath: string, path = ''): Promise<InputResult<unknown>> {
	let file
	try {
		file = await open(filePath, 'r')
	} catch (error) {
		return fileFailure(error, path)
	}

	try {
		const stat = await file.stat()
		if (!stat.isFile()) return invalidFailure('input.unreadable', path, 'path must identify a regular file')
		if (stat.size > INGESTION_LIMITS.documentBytes) return tooLarge(path)

		const buffer = Buffer.alloc(INGESTION_LIMITS.documentBytes + 1)
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
		if (bytesRead > INGESTION_LIMITS.documentBytes) return tooLarge(path)
		return parseJsonDocument(buffer.subarray(0, bytesRead), path)
	} catch (error) {
		return fileFailure(error, path)
	} finally {
		await file.close().catch((): void => undefined)
	}
}

export async function readJsonStream(
	stream: AsyncIterable<string | Uint8Array>,
	path = ''
): Promise<InputResult<unknown>> {
	const chunks: Buffer[] = []
	let bytes = 0
	try {
		for await (const chunk of stream) {
			const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
			bytes += buffer.byteLength
			if (bytes > INGESTION_LIMITS.documentBytes) return tooLarge(path)
			chunks.push(buffer)
		}
	} catch {
		return operationalFailure('input.read-failed', path, 'input stream could not be read')
	}
	return parseJsonDocument(Buffer.concat(chunks, bytes), path)
}

export function parseJsonDocument(bytes: Uint8Array, path = ''): InputResult<unknown> {
	if (bytes.byteLength > INGESTION_LIMITS.documentBytes) return tooLarge(path)

	let text: string
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		return invalidFailure('input.invalid-utf8', path, 'must be valid UTF-8')
	}

	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return invalidFailure('input.invalid-json', path, 'must be valid JSON')
	}

	return inspectJsonStructure(value, path)
}

export function inspectJsonStructure(value: unknown, path = ''): InputResult<unknown> {
	const pending: Array<{ value: unknown; depth: number; path: string }> = [{ value, depth: 1, path }]
	const visited = new WeakSet<object>()
	let values = 0

	while (pending.length > 0) {
		const current = pending.pop()!
		values++
		if (values > INGESTION_LIMITS.maxValues) {
			return invalidFailure(
				'input.too-many-values',
				path,
				`must contain at most ${INGESTION_LIMITS.maxValues} values`
			)
		}
		if (current.depth > INGESTION_LIMITS.maxDepth) {
			return invalidFailure('input.too-deep', current.path, `must not exceed depth ${INGESTION_LIMITS.maxDepth}`)
		}

		if (current.value === null || typeof current.value !== 'object') continue
		if (visited.has(current.value)) continue
		visited.add(current.value)
		if (!Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype) {
			return invalidFailure('input.non-json', current.path, 'must contain only JSON values')
		}

		const entries = Array.isArray(current.value)
			? current.value.map((entry, index) => [String(index), entry] as const)
			: Object.entries(current.value)
		for (let index = entries.length - 1; index >= 0; index--) {
			const [key, entry] = entries[index]
			pending.push({ value: entry, depth: current.depth + 1, path: appendPointer(current.path, key) })
		}
	}

	return { ok: true, value }
}

export function requestLimitDiagnostics(input: {
	scenario: {
		id: string
		name?: string
		driver: { id: string }
		policy?: string
		steps: Array<{ id: string; action: string; expect: string }>
	}
}): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	if (input.scenario.steps.length > INGESTION_LIMITS.maxSteps) {
		diagnostics.push(limitDiagnostic('/scenario/steps', `${INGESTION_LIMITS.maxSteps} steps`))
	}
	for (const [index, step] of input.scenario.steps.entries()) {
		const base = `/scenario/steps/${index}`
		checkText(diagnostics, step.action, `${base}/action`)
		checkText(diagnostics, step.expect, `${base}/expect`)
	}
	return diagnostics
}

export function rawRequestLimitDiagnostics(input: unknown): Diagnostic[] {
	if (!isRecord(input)) return []
	const scenario = ownValue(input, 'scenario')
	if (!isRecord(scenario)) return []

	const diagnostics: Diagnostic[] = []
	checkRawId(diagnostics, ownValue(scenario, 'id'), '/scenario/id')
	checkRawId(diagnostics, ownValue(scenario, 'policy'), '/scenario/policy')
	const name = ownValue(scenario, 'name')
	if (typeof name === 'string' && name.length > INGESTION_LIMITS.maxNameCharacters) {
		diagnostics.push(limitDiagnostic('/scenario/name', `${INGESTION_LIMITS.maxNameCharacters} characters`))
	}
	const driver = ownValue(scenario, 'driver')
	if (isRecord(driver)) checkRawId(diagnostics, ownValue(driver, 'id'), '/scenario/driver/id')

	const steps = ownValue(scenario, 'steps')
	if (!Array.isArray(steps)) return diagnostics
	if (steps.length > INGESTION_LIMITS.maxSteps) {
		diagnostics.push(limitDiagnostic('/scenario/steps', `${INGESTION_LIMITS.maxSteps} steps`))
	}
	for (const [index, step] of steps.entries()) {
		if (!isRecord(step)) continue
		const base = `/scenario/steps/${index}`
		checkRawId(diagnostics, ownValue(step, 'id'), `${base}/id`)
		const action = ownValue(step, 'action')
		const expectation = ownValue(step, 'expect')
		if (typeof action === 'string') checkText(diagnostics, action, `${base}/action`)
		if (typeof expectation === 'string') checkText(diagnostics, expectation, `${base}/expect`)
	}
	return diagnostics
}

export function boundDiagnostics(diagnostics: readonly Diagnostic[]): [Diagnostic, ...Diagnostic[]] {
	const marker: Diagnostic = {
		code: 'diagnostics.truncated',
		path: '',
		message: 'additional diagnostics were omitted because the diagnostic limit was reached',
	}
	const accepted: Diagnostic[] = []

	for (const diagnostic of diagnostics) {
		const normalized = normalizeDiagnostic(diagnostic)
		const candidate = [...accepted, normalized]
		const countExceeded = candidate.length > INGESTION_LIMITS.maxDiagnostics
		const bytesExceeded = diagnosticBytes(candidate) > INGESTION_LIMITS.maxDiagnosticBytes
		if (countExceeded || bytesExceeded) {
			while (
				accepted.length > 0 &&
				(accepted.length + 1 > INGESTION_LIMITS.maxDiagnostics ||
					diagnosticBytes([...accepted, marker]) > INGESTION_LIMITS.maxDiagnosticBytes)
			) {
				accepted.pop()
			}
			accepted.push(marker)
			break
		}
		accepted.push(normalized)
	}

	return (accepted.length > 0 ? accepted : [marker]) as [Diagnostic, ...Diagnostic[]]
}

export function appendPointer(path: string, member: string): string {
	return `${path}/${member.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

export function combineFailureStatus(...statuses: InputFailureStatus[]): InputFailureStatus {
	return statuses.includes('error') ? 'error' : 'invalid'
}

function normalizeDiagnostic(diagnostic: Diagnostic): Diagnostic {
	return {
		code: normalizeSingleLine(diagnostic.code) || 'diagnostic.invalid',
		path: validPointer(diagnostic.path) ? diagnostic.path : '',
		message: normalizeSingleLine(diagnostic.message) || 'diagnostic message was empty',
	}
}

function diagnosticBytes(diagnostics: Diagnostic[]): number {
	return Buffer.byteLength(serializeJson(diagnostics), 'utf8')
}

export function normalizeSingleLine(value: string): string {
	let normalized = ''
	let replacingControls = false
	for (const character of value) {
		const code = character.codePointAt(0)!
		const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f)
		if (control) {
			if (!replacingControls) normalized += ' '
			replacingControls = true
		} else {
			normalized += character
			replacingControls = false
		}
	}
	return normalized.trim()
}

function validPointer(path: string): boolean {
	if (path === '') return true
	if (!path.startsWith('/')) return false
	for (let index = 0; index < path.length; index++) {
		if (path[index] !== '~') continue
		if (path[index + 1] !== '0' && path[index + 1] !== '1') return false
		index++
	}
	for (const character of path) {
		const code = character.codePointAt(0)!
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false
	}
	return true
}

function checkText(diagnostics: Diagnostic[], value: string, path: string): void {
	if (Buffer.byteLength(value, 'utf8') > INGESTION_LIMITS.maxStepTextBytes) {
		diagnostics.push(limitDiagnostic(path, `${INGESTION_LIMITS.maxStepTextBytes} UTF-8 bytes`))
	}
}

function checkRawId(diagnostics: Diagnostic[], value: unknown, path: string): void {
	if (typeof value === 'string' && value.length > INGESTION_LIMITS.maxIdCharacters) {
		diagnostics.push(limitDiagnostic(path, `${INGESTION_LIMITS.maxIdCharacters} characters`))
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function limitDiagnostic(path: string, maximum: string): Diagnostic {
	return { code: 'input.limit-exceeded', path, message: `must not exceed ${maximum}` }
}

function tooLarge(path: string): InputResult<never> {
	return invalidFailure('input.too-large', path, `must not exceed ${INGESTION_LIMITS.documentBytes} bytes`)
}

function fileFailure(error: unknown, path: string): InputResult<never> {
	const code = errorCode(error)
	if (code === 'ENOENT') return invalidFailure('input.unreadable', path, 'file does not exist')
	if (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR') {
		return invalidFailure('input.unreadable', path, 'file could not be read')
	}
	return operationalFailure('input.read-failed', path, 'file could not be read because of an operational error')
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object' || !Object.prototype.hasOwnProperty.call(error, 'code')) return undefined
	return typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined
}

function invalidFailure(code: string, path: string, message: string): InputResult<never> {
	return { ok: false, status: 'invalid', diagnostics: [{ code, path, message }] }
}

function operationalFailure(code: string, path: string, message: string): InputResult<never> {
	return { ok: false, status: 'error', diagnostics: [{ code, path, message }] }
}
