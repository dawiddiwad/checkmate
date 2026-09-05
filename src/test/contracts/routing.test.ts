import { describe, expect, it } from 'vitest'
import { PUBLIC_ROUTE_RULES_V1, type RouteRuleV1 } from '../../contracts/types.js'

const expectedRules: RouteRuleV1[] = [
	{
		reason: 'scenario-complete',
		category: 'passed',
		exitCode: 0,
		retry: 'never',
		mutation: 'read-result-target-mutation',
		nextAction: 'continue',
	},
	{
		reason: 'failed-expectation',
		category: 'app',
		exitCode: 1,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction: 'inspect-evidence-and-verify-sut-or-expectation',
	},
	...modelRules(['loop-detected', 'turn-cap-exceeded', 'step-timeout']),
	...environmentRules([
		'scenario-timeout',
		'tool-error',
		'provider-error',
		'token-budget-exceeded',
		'interrupted',
		'driver-load-failed',
		'driver-start-failed',
		'driver-teardown-failed',
	]),
	{
		reason: 'evidence-write-failed',
		category: 'infra',
		exitCode: 3,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction: 'repair-output-and-inspect-target',
	},
	{
		reason: 'result-write-failed',
		category: 'infra',
		exitCode: 3,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction: 'repair-output-and-inspect-target',
	},
	...environmentRules(['internal-error']),
	{
		reason: 'invalid-invocation',
		category: 'invalid',
		exitCode: 4,
		retry: 'repair-then-new-run',
		mutation: 'not-attempted',
		nextAction: 'repair-request-or-configuration',
	},
	...environmentRules(['parent-containment']),
]

describe('agent result routing', () => {
	it('pins every complete public routing tuple', () => {
		expect(PUBLIC_ROUTE_RULES_V1).toEqual(expectedRules)
		expect(PUBLIC_ROUTE_RULES_V1).toHaveLength(18)
		expect(new Set(PUBLIC_ROUTE_RULES_V1.map((rule) => rule.reason)).size).toBe(18)
	})

	it('never authorizes an automatic whole-scenario retry', () => {
		expect(PUBLIC_ROUTE_RULES_V1.every((rule) => ['never', 'repair-then-new-run'].includes(rule.retry))).toBe(true)
	})
})

function modelRules(reasons: Array<'loop-detected' | 'turn-cap-exceeded' | 'step-timeout'>): RouteRuleV1[] {
	return reasons.map((reason) => ({
		reason,
		category: 'model',
		exitCode: 2,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction: 'repair-model-policy-or-egress',
	}))
}

function environmentRules(
	reasons: Array<
		| 'scenario-timeout'
		| 'tool-error'
		| 'provider-error'
		| 'token-budget-exceeded'
		| 'interrupted'
		| 'driver-load-failed'
		| 'driver-start-failed'
		| 'driver-teardown-failed'
		| 'internal-error'
		| 'parent-containment'
	>
): RouteRuleV1[] {
	return reasons.map((reason) => ({
		reason,
		category: 'infra',
		exitCode: 3,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction: 'repair-environment-and-inspect-target',
	}))
}
