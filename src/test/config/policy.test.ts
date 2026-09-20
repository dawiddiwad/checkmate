import { describe, expect, it } from 'vitest'
import { driverPolicyDiagnostics, resolveEffectiveLimits } from '../../config/policy.js'
import type { DriverDescriptorV1 } from '../../contracts/types.js'
import { fixtureManifest } from '../fixtures/static-environment.js'
import descriptorJson from '../fixtures/drivers/throwing-driver/checkmate-driver.json'
import webDescriptorJson from '../../drivers/web/checkmate-driver.json'

const descriptor = descriptorJson as DriverDescriptorV1

describe('policy resolution', () => {
	it('materializes every bound and permits only tightening request limits', () => {
		const policy = fixtureManifest.policies.ci
		const tightened = resolveEffectiveLimits(policy, { timeoutMs: 90_000, budgetTokens: 100_000 })

		expect(tightened.diagnostics).toEqual([])
		expect(tightened.limits).toEqual({
			scenarioTimeoutMs: 90_000,
			stepTimeoutMs: 120_000,
			turnsPerStep: 20,
			requestTimeoutMs: 60_000,
			maxRetries: 3,
			loopMaxRepetitions: 5,
			cleanupTimeoutMs: 10_000,
			budgetTokens: 100_000,
		})

		const raised = resolveEffectiveLimits(policy, { timeoutMs: 180_001, budgetTokens: 200_001 })
		expect(raised.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
			{ code: 'policy.limit-increase', path: '/scenario/limits/timeoutMs' },
			{ code: 'policy.limit-increase', path: '/scenario/limits/budgetTokens' },
		])
	})

	it('allows a request to introduce a token ceiling when the policy has none', () => {
		const policy = structuredClone(fixtureManifest.policies.ci)
		delete policy.bounds.budgetTokens

		expect(resolveEffectiveLimits(policy, { budgetTokens: 12_000 })).toMatchObject({
			limits: { budgetTokens: 12_000 },
			diagnostics: [],
		})
	})

	it('validates settings, declared tools, wildcard shape, and exact secret slots', () => {
		const diagnostics = driverPolicyDiagnostics({
			policyId: 'ci',
			driverId: 'fixture',
			settings: { readOnly: 'yes' },
			allowedTools: ['*', 'missing_tool'],
			descriptor,
			registration: { package: '@checkmate-test/throwing-driver', secrets: { extra: 'fixture-session' } },
		})

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			'schema.type',
			'policy.invalid-tool-wildcard',
			'policy.unknown-tool',
			'driver.missing-secret-slot',
			'driver.unknown-secret-slot',
		])
	})

	it('validates built-in web logging settings', () => {
		const registration = { package: '@xoxoai/checkmate/driver-web', secrets: {} }
		const valid = driverPolicyDiagnostics({
			policyId: 'ci',
			driverId: 'web',
			settings: { logLevel: 'debug', logsAsEvidence: true },
			allowedTools: ['*'],
			descriptor: webDescriptorJson as DriverDescriptorV1,
			registration,
		})
		const invalid = driverPolicyDiagnostics({
			policyId: 'ci',
			driverId: 'web',
			settings: { logLevel: 'trace', logsAsEvidence: 'yes' },
			allowedTools: ['*'],
			descriptor: webDescriptorJson as DriverDescriptorV1,
			registration,
		})

		expect(valid).toEqual([])
		expect(invalid.map(({ code }) => code)).toEqual(['schema.enum', 'schema.type'])
	})

	it('does not satisfy hostile required secret slots through Object.prototype', () => {
		const hostileDescriptor = { ...descriptor, requiredSecretSlots: ['constructor', 'toString'] }
		const diagnostics = driverPolicyDiagnostics({
			policyId: 'ci',
			driverId: 'fixture',
			settings: { readOnly: true },
			allowedTools: ['*'],
			descriptor: hostileDescriptor,
			registration: { package: '@checkmate-test/throwing-driver', secrets: {} },
		})

		expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
			"missing binding for required driver secret slot 'constructor'",
			"missing binding for required driver secret slot 'toString'",
		])
	})
})
