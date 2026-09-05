import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	validateDescribeResult,
	validateDescriptor,
	validateManifest,
	validateRequest,
	validateRunResult,
	validateValidationResult,
} from '../../contracts/validator.js'

const contracts = [
	['run-request.valid.json', validateRequest],
	['checkmate-config.valid.json', validateManifest],
	['driver-descriptor.valid.json', validateDescriptor],
	['run-result.valid.json', validateRunResult],
	['validation-result.valid.json', validateValidationResult],
	['describe-result.valid.json', validateDescribeResult],
] as const

describe('contract schemas', () => {
	it.each(contracts)('accepts the %s fixture', (fileName, validate) => {
		const fixture = readFixture(fileName)
		expect(validate(fixture).ok).toBe(true)
	})

	it.each(contracts)('rejects unknown fields in %s', (fileName, validate) => {
		const fixture = { ...readFixture(fileName), unknown: true }
		expect(validate(fixture).ok).toBe(false)
	})

	it('does not coerce, strip, default, or clamp request values', () => {
		const request = readFixture('run-request.valid.json')
		const scenario = request.scenario as Record<string, unknown>
		const limits = scenario.limits as Record<string, unknown>
		limits.timeoutMs = '180000'
		limits.unknown = true
		const before = structuredClone(request)

		expect(validateRequest(request).ok).toBe(false)
		expect(request).toEqual(before)
	})
})

function readFixture(fileName: string): Record<string, unknown> {
	const url = new URL(`../fixtures/contracts/${fileName}`, import.meta.url)
	return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}
