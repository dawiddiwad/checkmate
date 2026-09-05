import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import {
	PUBLIC_CONTRACT_REFERENCES_V1,
	PUBLIC_ROUTE_RULES_V1,
	type AgentOnboardingV1,
	type CheckmateManifestV1,
	type DescribeResultV1,
	type DescribedDriverV1,
	type DescribedPolicyV1,
	type Diagnostic,
	type DriverDescriptorV1,
	type EffectiveLimits,
	type JsonObject,
	type ModelEgressPolicyV1,
	type RunRequestV1,
} from '../contracts/types.js'
import { serializeJson } from '../contracts/serialize.js'
import { validateRequest } from '../contracts/validator.js'
import {
	acquireJsonInput,
	boundDiagnostics,
	combineFailureStatus,
	INGESTION_LIMITS,
	rawRequestLimitDiagnostics,
	requestLimitDiagnostics,
	type InputFailureStatus,
	type JsonInputSource,
} from '../config/ingestion.js'
import { loadManifest, manifestReferenceDiagnostics } from '../config/manifest.js'
import { resolveModelEgress } from '../config/model-egress.js'
import {
	deepFreeze,
	describedAllowedTools,
	driverPolicyDiagnostics,
	requiredPolicyBindings,
	resolveEffectiveLimits,
	resolvedPolicy,
	selectedDriver,
	selectedPolicy,
	targetDiagnostics,
	type ResolvedPolicy,
} from '../config/policy.js'
import { compareUtf16, ownValue } from '../config/record.js'
import { secretAvailabilityDiagnostics, type EnvironmentReader } from '../config/secrets.js'
import { loadDriverDescriptor, type DescriptorResolver } from '../drivers/descriptor.js'

export type PreparationOptions = Readonly<{
	cwd?: string
	configPath?: string
	readEnvironment?: EnvironmentReader
	resolveDescriptorPath?: DescriptorResolver
}>

export type PreparedRun = Readonly<{
	invocationRoot: string
	outputDirectory: string
	request: RunRequestV1
	policy: ResolvedPolicy
	modelEgress: ModelEgressPolicyV1
	effectiveLimits: EffectiveLimits
	driver: Readonly<{
		id: string
		packageName: string
		descriptor: DriverDescriptorV1
		settings: JsonObject
		target: JsonObject
		allowedTools: '*' | readonly string[]
		secretBindings: Readonly<Record<string, string>>
	}>
}>

export type PreparationResult =
	| { ok: true; prepared: PreparedRun }
	| { ok: false; status: InputFailureStatus; diagnostics: [Diagnostic, ...Diagnostic[]] }

export async function prepareRun(requestInput: unknown, options: PreparationOptions = {}): Promise<PreparationResult> {
	return prepareRunSource({ kind: 'value', value: requestInput }, options)
}

export async function prepareRunSource(
	requestSource: JsonInputSource,
	options: PreparationOptions = {}
): Promise<PreparationResult> {
	const [loaded, acquiredRequest] = await Promise.all([
		loadManifest(options),
		acquireJsonInput(requestSource, '/request'),
	])
	const diagnostics: Diagnostic[] = []
	const failureStatuses: InputFailureStatus[] = []

	if (loaded.ok === false) {
		diagnostics.push(...loaded.diagnostics)
		failureStatuses.push(loaded.status)
	} else {
		diagnostics.push(...manifestReferenceDiagnostics(loaded.value.manifest))
	}
	if (acquiredRequest.ok === false) {
		diagnostics.push(...acquiredRequest.diagnostics)
		failureStatuses.push(acquiredRequest.status)
	}
	if (loaded.ok === false || acquiredRequest.ok === false) {
		return preparationFailure(diagnostics, combineFailureStatus(...failureStatuses))
	}

	const requestValidation = validateRequestInput(acquiredRequest.value)
	if (requestValidation.ok === false) return preparationFailure([...diagnostics, ...requestValidation.diagnostics])
	diagnostics.push(...requestValidation.diagnostics)

	const { manifest, invocationRoot } = loaded.value
	const request = requestValidation.value
	const policySelection = selectedPolicy(manifest, request)
	diagnostics.push(...policySelection.diagnostics)
	if (!policySelection.policy || !policySelection.id) return preparationFailure(diagnostics)

	const effective = resolveEffectiveLimits(policySelection.policy, request.scenario.limits)
	const requiredBindings = new Set<string>([policySelection.policy.modelEgress.provider.apiKeyBinding])
	const driverSelection = selectedDriver({ manifest, policy: policySelection.policy, request })
	diagnostics.push(...driverSelection.diagnostics)
	if (!driverSelection.registration || !driverSelection.policyDriver) {
		diagnostics.push(...effective.diagnostics)
		diagnostics.push(...availableSecretDiagnostics(manifest, requiredBindings, options.readEnvironment))
		return preparationFailure(diagnostics)
	}

	const driverId = request.scenario.driver.id
	const descriptorValidation = await loadDriverDescriptor({
		invocationRoot,
		driverId,
		packageName: driverSelection.registration.package,
		registrationPath: `/drivers/${escapePointer(driverId)}`,
		resolveDescriptorPath: options.resolveDescriptorPath,
	})
	if (descriptorValidation.ok === false) {
		diagnostics.push(...descriptorValidation.diagnostics)
		diagnostics.push(...effective.diagnostics)
		diagnostics.push(...availableSecretDiagnostics(manifest, requiredBindings, options.readEnvironment))
		return preparationFailure(diagnostics, descriptorValidation.status ?? 'invalid')
	}
	const descriptor = descriptorValidation.value

	diagnostics.push(
		...driverPolicyDiagnostics({
			policyId: policySelection.id,
			driverId,
			settings: driverSelection.policyDriver.settings,
			allowedTools: driverSelection.policyDriver.tools.allowed,
			descriptor,
			registration: driverSelection.registration,
		}),
		...targetDiagnostics(descriptor, request.scenario.driver.target)
	)
	diagnostics.push(...effective.diagnostics)
	for (const binding of requiredPolicyBindings({
		policy: policySelection.policy,
		registration: driverSelection.registration,
		descriptor,
	})) {
		requiredBindings.add(binding)
	}
	diagnostics.push(...availableSecretDiagnostics(manifest, requiredBindings, options.readEnvironment))
	if (diagnostics.length > 0) return preparationFailure(diagnostics)

	const prepared = deepFreeze({
		invocationRoot,
		outputDirectory: resolve(invocationRoot, manifest.outputDirectory ?? '.checkmate/runs'),
		request: structuredClone(request),
		policy: resolvedPolicy(policySelection.id, policySelection.policy, effective.limits),
		modelEgress: resolveModelEgress(policySelection.policy),
		effectiveLimits: { ...effective.limits },
		driver: {
			id: driverId,
			packageName: driverSelection.registration.package,
			descriptor: structuredClone(descriptor),
			settings: structuredClone(driverSelection.policyDriver.settings),
			target: structuredClone(request.scenario.driver.target),
			allowedTools: describedAllowedTools(driverSelection.policyDriver.tools.allowed),
			secretBindings: { ...driverSelection.registration.secrets },
		},
	})

	if (Buffer.byteLength(serializeJson(prepared), 'utf8') > INGESTION_LIMITS.maxPreparedRunBytes) {
		return preparationFailure([
			{
				code: 'input.prepared-run-too-large',
				path: '',
				message: `prepared run must not exceed ${INGESTION_LIMITS.maxPreparedRunBytes} bytes`,
			},
		])
	}

	return { ok: true, prepared }
}

export async function describeEnvironment(options: PreparationOptions = {}): Promise<DescribeResultV1> {
	const loaded = await loadManifest(options)
	if (loaded.ok === false) return describeFailure(loaded.diagnostics, loaded.status)

	const { manifest, invocationRoot } = loaded.value
	const diagnostics = manifestReferenceDiagnostics(manifest)
	let failureStatus: InputFailureStatus = 'invalid'
	const descriptors = new Map<string, DriverDescriptorV1>()

	for (const driverId of Object.keys(manifest.drivers).sort(compareUtf16)) {
		const registration = ownValue(manifest.drivers, driverId)!
		const descriptor = await loadDriverDescriptor({
			invocationRoot,
			driverId,
			packageName: registration.package,
			registrationPath: `/drivers/${escapePointer(driverId)}`,
			resolveDescriptorPath: options.resolveDescriptorPath,
		})
		if (descriptor.ok === false) {
			diagnostics.push(...descriptor.diagnostics)
			failureStatus = combineFailureStatus(failureStatus, descriptor.status ?? 'invalid')
		} else {
			descriptors.set(driverId, descriptor.value)
		}
	}

	const policies: DescribedPolicyV1[] = []
	for (const policyId of Object.keys(manifest.policies).sort(compareUtf16)) {
		const policy = ownValue(manifest.policies, policyId)!
		const requiredBindings = new Set<string>([policy.modelEgress.provider.apiKeyBinding])
		const drivers: DescribedPolicyV1['drivers'] = []

		for (const driverId of Object.keys(policy.drivers).sort(compareUtf16)) {
			const descriptor = descriptors.get(driverId)
			const registration = ownValue(manifest.drivers, driverId)
			const policyDriver = ownValue(policy.drivers, driverId)
			if (!descriptor || !registration || !policyDriver) continue
			diagnostics.push(
				...driverPolicyDiagnostics({
					policyId,
					driverId,
					settings: policyDriver.settings,
					allowedTools: policyDriver.tools.allowed,
					descriptor,
					registration,
				})
			)
			for (const binding of requiredPolicyBindings({ policy, registration, descriptor })) {
				requiredBindings.add(binding)
			}
			drivers.push({ id: driverId, allowedTools: describedAllowedTools(policyDriver.tools.allowed) })
		}

		policies.push({
			id: policyId,
			limits: { ...policy.bounds },
			evidence: { ...policy.evidence },
			drivers,
			requiredSecretBindings: [...requiredBindings].sort(compareUtf16),
		})
	}

	if (diagnostics.length > 0) return describeFailure(diagnostics, failureStatus)
	return {
		kind: 'describe-result',
		schemaVersion: 1,
		status: 'available',
		contracts: [...PUBLIC_CONTRACT_REFERENCES_V1],
		environment: {
			defaultPolicy: manifest.defaultPolicy,
			policies,
			drivers: [...descriptors.entries()].map(([id, descriptor]) => describeDriver(id, descriptor)),
		},
		onboarding: onboarding(),
		diagnostics: [],
	}
}

function validateRequestInput(
	input: unknown
): { ok: true; value: RunRequestV1; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] } {
	const rawLimits = rawRequestLimitDiagnostics(input)
	if (rawLimits.length > 0) return { ok: false, diagnostics: rawLimits }
	const validation = validateRequest(input)
	if (validation.ok === false) return validation

	const diagnostics = requestLimitDiagnostics(validation.value)
	const seen = new Set<string>()
	for (const [index, step] of validation.value.scenario.steps.entries()) {
		if (seen.has(step.id)) {
			diagnostics.push({
				code: 'request.duplicate-step-id',
				path: `/scenario/steps/${index}/id`,
				message: `step id '${step.id}' must be unique within the scenario`,
			})
		}
		seen.add(step.id)
	}
	return { ok: true, value: validation.value, diagnostics }
}

function availableSecretDiagnostics(
	manifest: CheckmateManifestV1,
	bindings: ReadonlySet<string>,
	readEnvironment?: EnvironmentReader
): Diagnostic[] {
	const available = [...bindings].filter((binding) => ownValue(manifest.secretBindings, binding)).sort(compareUtf16)
	return secretAvailabilityDiagnostics(manifest, available, readEnvironment)
}

function describeDriver(id: string, descriptor: DriverDescriptorV1): DescribedDriverV1 {
	return {
		id,
		contractVersion: descriptor.driverContractVersion,
		targetSchema: structuredClone(descriptor.targetSchema),
		settingsSchema: structuredClone(descriptor.settingsSchema),
		requiredSecretSlots: [...descriptor.requiredSecretSlots],
		tools: descriptor.tools.map((tool) => ({ ...tool })),
		evidenceKinds: descriptor.evidenceKinds.map((kind) => ({ ...kind })),
	}
}

function onboarding(): AgentOnboardingV1 {
	return {
		workflow: ['describe', 'author-request', 'validate', 'run', 'route-result'],
		commands: {
			validate: 'checkmate validate <request.json>',
			runFile: 'checkmate run <request.json>',
			runStdin: 'checkmate run -',
		},
		routing: [...PUBLIC_ROUTE_RULES_V1],
		evidence: {
			pathBase: 'invocation-root',
			followReferencesOnly: true,
			retentionIsPolicyDependent: true,
			inspectCompletenessState: true,
		},
	}
}

function preparationFailure(
	diagnostics: readonly Diagnostic[],
	status: InputFailureStatus = 'invalid'
): PreparationResult {
	return { ok: false, status, diagnostics: boundDiagnostics(diagnostics) }
}

function describeFailure(diagnostics: readonly Diagnostic[], status: InputFailureStatus = 'invalid'): DescribeResultV1 {
	return {
		kind: 'describe-result',
		schemaVersion: 1,
		status,
		diagnostics: boundDiagnostics(diagnostics),
	}
}

function escapePointer(value: string): string {
	return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
