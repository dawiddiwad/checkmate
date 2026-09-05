import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
	boundDiagnostics,
	INGESTION_LIMITS,
	inspectJsonStructure,
	parseJsonDocument,
	rawRequestLimitDiagnostics,
} from '../../config/ingestion.js'
import { serializeJson } from '../../contracts/serialize.js'
import { fixtureRequest } from '../fixtures/static-environment.js'

describe('fixed ingestion limits', () => {
	it('accepts the document byte boundary and rejects one byte beyond it', () => {
		const accepted = Buffer.from(`"${'a'.repeat(INGESTION_LIMITS.documentBytes - 2)}"`)
		expect(parseJsonDocument(accepted).ok).toBe(true)
		expect(parseJsonDocument(Buffer.concat([accepted, Buffer.from(' ')])).ok).toBe(false)
	})

	it('rejects invalid UTF-8 before parsing JSON', () => {
		const result = parseJsonDocument(Uint8Array.from([0xff]))
		expect(result).toEqual({
			ok: false,
			status: 'invalid',
			diagnostics: [{ code: 'input.invalid-utf8', path: '', message: 'must be valid UTF-8' }],
		})
	})

	it('bounds parsed depth and aggregate values', () => {
		let depth: unknown = null
		for (let index = 0; index < INGESTION_LIMITS.maxDepth; index++) depth = [depth]
		expect(inspectJsonStructure(depth)).toMatchObject({ ok: false, diagnostics: [{ code: 'input.too-deep' }] })

		const values = Array.from({ length: INGESTION_LIMITS.maxValues }, (): null => null)
		expect(inspectJsonStructure(values)).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'input.too-many-values' }],
		})
	})

	it('bounds step count, identifiers, names, and action text before preparation', () => {
		const request = structuredClone(fixtureRequest)
		request.scenario.id = 'x'.repeat(INGESTION_LIMITS.maxIdCharacters + 1)
		request.scenario.name = 'x'.repeat(INGESTION_LIMITS.maxNameCharacters + 1)
		request.scenario.steps[0].action = 'x'.repeat(INGESTION_LIMITS.maxStepTextBytes + 1)
		request.scenario.steps = Array.from({ length: INGESTION_LIMITS.maxSteps + 1 }, (_, index) => ({
			...request.scenario.steps[0],
			id: `step-${index}`,
		}))

		const paths = rawRequestLimitDiagnostics(request).map((diagnostic) => diagnostic.path)
		expect(paths).toContain('/scenario/id')
		expect(paths).toContain('/scenario/name')
		expect(paths).toContain('/scenario/steps')
		expect(paths).toContain('/scenario/steps/0/action')
	})

	it('caps diagnostic count with an explicit truncation row', () => {
		const diagnostics = Array.from({ length: INGESTION_LIMITS.maxDiagnostics + 20 }, (_, index) => ({
			code: 'fixture.error',
			path: `/errors/${index}`,
			message: 'invalid fixture value',
		}))
		const bounded = boundDiagnostics(diagnostics)
		expect(bounded).toHaveLength(INGESTION_LIMITS.maxDiagnostics)
		expect(bounded.at(-1)?.code).toBe('diagnostics.truncated')
		expect(Buffer.byteLength(serializeJson(bounded))).toBeLessThanOrEqual(INGESTION_LIMITS.maxDiagnosticBytes)
	})

	it('bounds the exact serialized diagnostic bytes and normalizes hostile fields', () => {
		const bounded = boundDiagnostics([
			{
				code: 'bad\ncode',
				path: '/bad\npath',
				message: 'first\r\nsecond',
			},
			{ code: 'huge.error', path: '/huge', message: '😀'.repeat(100_000) },
		])

		expect(Buffer.byteLength(serializeJson(bounded))).toBeLessThanOrEqual(INGESTION_LIMITS.maxDiagnosticBytes)
		expect(bounded[0].code).not.toContain('\n')
		expect(bounded[0].path).toBe('')
		expect(bounded[0].message).not.toMatch(/[\r\n]/)
		expect(bounded.at(-1)?.code).toBe('diagnostics.truncated')
	})
})
