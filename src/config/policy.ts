import type {
	CheckmateManifestV1,
	Diagnostic,
	DriverDescriptorV1,
	EffectiveLimits,
	EvidencePolicyV1,
	RunRequestV1,
} from '../contracts/types.js'
import { appendPointer } from './ingestion.js'
import { compareUtf16, ownValue } from './record.js'
import { validateDriverValue } from '../drivers/descriptor.js'

export type ManifestPolicy = CheckmateManifestV1['policies'][string]
export type DriverRegistration = CheckmateManifestV1['drivers'][string]

export type ResolvedPolicy = Readonly<{
	id: string
	bounds: EffectiveLimits
	evidence: EvidencePolicyV1
}>

export function resolveEffectiveLimits(
	policy: ManifestPolicy,
	requestLimits: RunRequestV1['scenario']['limits']
): { limits: EffectiveLimits; diagnostics: Diagnostic[] } {
	const limits = { ...policy.bounds }
	const diagnostics: Diagnostic[] = []

	if (requestLimits?.timeoutMs !== undefined) {
		if (requestLimits.timeoutMs > policy.bounds.scenarioTimeoutMs) {
			diagnostics.push({
				code: 'policy.limit-increase',
				path: '/scenario/limits/timeoutMs',
				message: `must not exceed the selected policy ceiling of ${policy.bounds.scenarioTimeoutMs}`,
			})
		} else {
			limits.scenarioTimeoutMs = requestLimits.timeoutMs
		}
	}

	if (requestLimits?.budgetTokens !== undefined) {
		if (policy.bounds.budgetTokens !== undefined && requestLimits.budgetTokens > policy.bounds.budgetTokens) {
			diagnostics.push({
				code: 'policy.limit-increase',
				path: '/scenario/limits/budgetTokens',
				message: `must not exceed the selected policy ceiling of ${policy.bounds.budgetTokens}`,
			})
		} else {
			limits.budgetTokens = requestLimits.budgetTokens
		}
	}

	return { limits, diagnostics }
}

export function selectedPolicy(
	manifest: CheckmateManifestV1,
	request: RunRequestV1
): { id?: string; policy?: ManifestPolicy; diagnostics: Diagnostic[] } {
	const id = request.scenario.policy ?? manifest.defaultPolicy
	const policy = ownValue(manifest.policies, id)
	if (!policy) {
		return {
			diagnostics: [
				{
					code: 'policy.unavailable',
					path: request.scenario.policy ? '/scenario/policy' : '/defaultPolicy',
					message: `policy '${id}' is not available`,
				},
			],
		}
	}
	return { id, policy, diagnostics: [] }
}

export function selectedDriver(input: {
	manifest: CheckmateManifestV1
	policy: ManifestPolicy
	request: RunRequestV1
}): {
	registration?: DriverRegistration
	policyDriver?: ManifestPolicy['drivers'][string]
	diagnostics: Diagnostic[]
} {
	const id = input.request.scenario.driver.id
	const registration = ownValue(input.manifest.drivers, id)
	const policyDriver = ownValue(input.policy.drivers, id)
	const diagnostics: Diagnostic[] = []

	if (!registration) {
		diagnostics.push({
			code: 'driver.unregistered',
			path: '/scenario/driver/id',
			message: `driver '${id}' is not registered`,
		})
	}
	if (!policyDriver) {
		diagnostics.push({
			code: 'driver.disabled-by-policy',
			path: '/scenario/driver/id',
			message: `driver '${id}' is not enabled by the selected policy`,
		})
	}

	return { registration, policyDriver, diagnostics }
}

export function driverPolicyDiagnostics(input: {
	policyId: string
	driverId: string
	settings: unknown
	allowedTools: string[]
	descriptor: DriverDescriptorV1
	registration: DriverRegistration
}): Diagnostic[] {
	const policyPath = pointer('policies', input.policyId, 'drivers', input.driverId)
	const registrationPath = pointer('drivers', input.driverId)
	const diagnostics = validateDriverValue(input.descriptor.settingsSchema, input.settings, `${policyPath}/settings`)
	const availableTools = new Set(input.descriptor.tools.map((tool) => tool.name))

	if (input.allowedTools.includes('*') && input.allowedTools.length !== 1) {
		diagnostics.push({
			code: 'policy.invalid-tool-wildcard',
			path: `${policyPath}/tools/allowed`,
			message: "'*' must be the only allowed tool entry when used",
		})
	}
	for (const [index, tool] of input.allowedTools.entries()) {
		if (tool !== '*' && !availableTools.has(tool)) {
			diagnostics.push({
				code: 'policy.unknown-tool',
				path: `${policyPath}/tools/allowed/${index}`,
				message: `driver '${input.driverId}' does not declare tool '${tool}'`,
			})
		}
	}

	const requiredSlots = new Set(input.descriptor.requiredSecretSlots)
	for (const slot of input.descriptor.requiredSecretSlots) {
		if (!ownValue(input.registration.secrets, slot)) {
			diagnostics.push({
				code: 'driver.missing-secret-slot',
				path: `${registrationPath}/secrets`,
				message: `missing binding for required driver secret slot '${slot}'`,
			})
		}
	}
	for (const slot of Object.keys(input.registration.secrets).sort(compareUtf16)) {
		if (!requiredSlots.has(slot)) {
			diagnostics.push({
				code: 'driver.unknown-secret-slot',
				path: appendPointer(`${registrationPath}/secrets`, slot),
				message: `descriptor does not declare driver secret slot '${slot}'`,
			})
		}
	}

	return diagnostics
}

export function targetDiagnostics(descriptor: DriverDescriptorV1, target: unknown): Diagnostic[] {
	return validateDriverValue(descriptor.targetSchema, target, '/scenario/driver/target')
}

export function requiredPolicyBindings(input: {
	policy: ManifestPolicy
	registration: DriverRegistration
	descriptor: DriverDescriptorV1
}): string[] {
	const bindings = new Set<string>([input.policy.modelEgress.provider.apiKeyBinding])
	for (const slot of input.descriptor.requiredSecretSlots) {
		const binding = ownValue(input.registration.secrets, slot)
		if (binding) bindings.add(binding)
	}
	return [...bindings].sort(compareUtf16)
}

export function describedAllowedTools(allowed: string[]): '*' | string[] {
	return allowed.length === 1 && allowed[0] === '*' ? '*' : [...allowed]
}

export function resolvedPolicy(id: string, policy: ManifestPolicy, limits: EffectiveLimits): ResolvedPolicy {
	return deepFreeze({ id, bounds: { ...limits }, evidence: { ...policy.evidence } })
}

export function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value)
		for (const child of Object.values(value)) deepFreeze(child)
	}
	return value
}

function pointer(...members: string[]): string {
	return `/${members.map((member) => member.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}
