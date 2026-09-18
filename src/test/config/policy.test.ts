import { describe, expect, it } from 'vitest'
import { driverPolicyDiagnostics, resolveEffectiveLimits } from '../../config/policy.js'
import type { DriverDescriptorV1 } from '../../contracts/types.js'
import { fixtureManifest } from '../fixtures/static-environment.js'
import descriptorJson from '../fixtures/drivers/throwing-driver/checkmate-driver.json'
import webDescriptor from '../../drivers/web/checkmate-driver.json'

const descriptor = descriptorJson as DriverDescriptorV1

describe('policy resolution', () => {
	it('accepts the five-tool web surface and rejects every removed tool and setting', () => {
		const check = (allowedTools: string[], settings = {}) =>
			driverPolicyDiagnostics({
				policyId: 'ci',
				driverId: 'web',
				settings,
				allowedTools,
				descriptor: webDescriptor as DriverDescriptorV1,
				registration: { package: '@xoxoai/checkmate/driver-web', secrets: {} },
			})
		expect(check(['*'])).toEqual([])
		expect(webDescriptor.tools.map((tool) => tool.name)).toEqual([
			'browser_navigate',
			'browser_observe',
			'browser_act',
			'browser_extract',
			'browser_diagnostics',
		])
		expect(check(webDescriptor.tools.map((tool) => tool.name))).toEqual([])
		expect(check(['browser_navigate', 'browser_observe', 'browser_act', 'browser_extract'])).toEqual([])
		for (const name of [
			'browser_click_or_hover',
			'browser_set_dialog_response',
			'browser_drag',
			'browser_upload',
			'browser_type_or_select',
			'browser_press_key',
			'browser_snapshot',
			'browser_wait',
			'browser_list_tabs',
			'browser_select_tab',
			'browser_close_tab',
			'browser_network_requests',
			'browser_network_request',
		]) {
			expect(check([name])).toEqual([expect.objectContaining({ code: 'policy.unknown-tool' })])
		}
		for (const [name, value] of Object.entries({
			snapshotFilter: true,
			snapshotTopPercent: 10,
			screenshotsInModelContext: true,
		})) {
			expect(check(['*'], { [name]: value }).length).toBeGreaterThan(0)
		}
	})

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
