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
	it.each([0, 1, 2, 3, '1'])('accepts only numeric driver contract version 1 (received %s)', (version) => {
		const descriptor = readFixture('driver-descriptor.valid.json')
		descriptor.driverContractVersion = version
		const result = readFixture('run-result.valid.json')
		;(result.driver as Record<string, unknown>).contractVersion = version
		const validation = readFixture('validation-result.valid.json')
		;(validation.driver as Record<string, unknown>).contractVersion = version
		const description = readFixture('describe-result.valid.json')
		const environment = description.environment as { drivers: Array<{ contractVersion: unknown }> }
		environment.drivers[0].contractVersion = version
		for (const actual of [
			validateDescriptor(descriptor),
			validateRunResult(result),
			validateValidationResult(validation),
			validateDescribeResult(description),
		]) {
			expect(actual.ok).toBe(version === 1)
		}
	})

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

	it.each([
		[
			'scenario id',
			(request: Record<string, unknown>): void => {
				;(request.scenario as Record<string, unknown>).id = 'x'.repeat(129)
			},
		],
		[
			'scenario name',
			(request: Record<string, unknown>): void => {
				;(request.scenario as Record<string, unknown>).name = 'x'.repeat(257)
			},
		],
		[
			'driver id controls',
			(request: Record<string, unknown>): void => {
				;((request.scenario as Record<string, unknown>).driver as Record<string, unknown>).id = 'web\nother'
			},
		],
		[
			'step id controls',
			(request: Record<string, unknown>): void => {
				;((request.scenario as Record<string, unknown>).steps as Array<Record<string, unknown>>)[0].id =
					'step\u0000other'
			},
		],
	] as const)('enforces request %s bounds', (_name, mutate) => {
		const request = readFixture('run-request.valid.json')
		mutate(request)
		expect(validateRequest(request).ok).toBe(false)
	})

	it.each(['/tmp/runs', '../runs', 'runs/../../outside', '.', 'runs//nested'])(
		'enforces contained outputDirectory syntax for %s',
		(outputDirectory) => {
			const manifest = readFixture('checkmate-config.valid.json')
			manifest.outputDirectory = outputDirectory
			expect(validateManifest(manifest).ok).toBe(false)
		}
	)

	it('enforces manifest and descriptor identifier bounds', () => {
		const manifest = readFixture('checkmate-config.valid.json')
		manifest.defaultPolicy = 'x'.repeat(129)
		const descriptor = readFixture('driver-descriptor.valid.json')
		descriptor.id = 'web\nother'

		expect(validateManifest(manifest).ok).toBe(false)
		expect(validateDescriptor(descriptor).ok).toBe(false)
	})
})

function readFixture(fileName: string): Record<string, unknown> {
	const url = new URL(`../fixtures/contracts/${fileName}`, import.meta.url)
	return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
}
