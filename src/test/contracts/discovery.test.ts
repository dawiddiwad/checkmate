import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUBLIC_CONTRACT_REFERENCES_V1, PUBLIC_ROUTE_RULES_V1 } from '../../contracts/types.js'
import { validateDescribeResult } from '../../contracts/validator.js'

describe('describe discovery contract', () => {
	it('requires all six unique exact contract references', () => {
		const result = describeFixture()
		expect(result.contracts).toEqual(PUBLIC_CONTRACT_REFERENCES_V1)
		expect(validateDescribeResult(result).ok).toBe(true)

		expect(validateDescribeResult({ ...result, contracts: result.contracts.slice(1) }).ok).toBe(false)
		expect(
			validateDescribeResult({ ...result, contracts: [...result.contracts.slice(0, 5), result.contracts[0]] }).ok
		).toBe(false)
		expect(
			validateDescribeResult({
				...result,
				contracts: result.contracts.map((reference, index) =>
					index === 0 ? { ...reference, schemaPath: './schemas/run-request.v1.json' } : reference
				),
			}).ok
		).toBe(false)
	})

	it('requires all eighteen unique exact routing tuples', () => {
		const result = describeFixture()
		expect(result.onboarding.routing).toEqual(PUBLIC_ROUTE_RULES_V1)

		expect(
			validateDescribeResult({
				...result,
				onboarding: { ...result.onboarding, routing: result.onboarding.routing.slice(1) },
			}).ok
		).toBe(false)
		expect(
			validateDescribeResult({
				...result,
				onboarding: {
					...result.onboarding,
					routing: [...result.onboarding.routing.slice(0, 17), result.onboarding.routing[0]],
				},
			}).ok
		).toBe(false)
	})

	it.each([
		['category', 'infra'],
		['exitCode', 3],
		['retry', 'repair-then-new-run'],
		['mutation', 'not-attempted'],
		['nextAction', 'repair-environment-and-inspect-target'],
	] as const)('rejects a routing contradiction in %s', (field, value) => {
		const result = describeFixture()
		const routing = result.onboarding.routing.map((rule, index) =>
			index === 0 ? { ...rule, [field]: value } : rule
		)
		expect(validateDescribeResult({ ...result, onboarding: { ...result.onboarding, routing } }).ok).toBe(false)
	})
})

function describeFixture(): DescribeFixture {
	const url = new URL('../fixtures/contracts/describe-result.valid.json', import.meta.url)
	return JSON.parse(readFileSync(url, 'utf8')) as DescribeFixture
}

type DescribeFixture = {
	contracts: Array<{ id: string; schemaVersion: number; schemaPath: string }>
	onboarding: {
		routing: Array<Record<string, unknown>>
		[key: string]: unknown
	}
	[key: string]: unknown
}
