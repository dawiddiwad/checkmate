export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type Diagnostic = {
	code: string
	path: string
	message: string
}

export type Validation<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] }

export type RunRequestV1 = {
	schemaVersion: 1
	scenario: {
		id: string
		name?: string
		driver: { id: string; target: JsonObject }
		policy?: string
		limits?: { timeoutMs?: number; budgetTokens?: number }
		steps: Array<{ id: string; action: string; expect: string }>
	}
}

export type EffectiveLimits = {
	scenarioTimeoutMs: number
	stepTimeoutMs: number
	turnsPerStep: number
	requestTimeoutMs: number
	maxRetries: number
	loopMaxRepetitions: number
	cleanupTimeoutMs: number
	budgetTokens?: number
}

export type ModelEgressPolicyV1 = {
	provider: {
		id: 'openai'
		model: string
		baseUrl?: string
		apiKeyBinding: string
		temperature?: number
		reasoningEffort?: 'low' | 'medium' | 'high'
	}
	textRedaction: 'on' | 'off'
	allowOpaque: boolean
	maxStepBytes: number
	maxMessageBytes: number
}

export type EvidencePolicyV1 = {
	retention: 'on' | 'retain-on-failure' | 'off'
	redaction: 'on' | 'off'
	allowOpaque: boolean
}

export type CheckmateManifestV1 = {
	schemaVersion: 1
	outputDirectory?: string
	defaultPolicy: string
	secretBindings: Record<string, { source: 'environment'; name: string }>
	policies: Record<
		string,
		{
			modelEgress: ModelEgressPolicyV1
			bounds: EffectiveLimits
			evidence: EvidencePolicyV1
			drivers: Record<string, { settings: JsonObject; tools: { allowed: string[] } }>
		}
	>
	drivers: Record<string, { package: string; secrets: Record<string, string> }>
}

export type DriverDescriptorV1 = {
	schemaVersion: 1
	id: string
	driverContractVersion: 1
	targetSchema: JsonObject
	settingsSchema: JsonObject
	requiredSecretSlots: string[]
	tools: Array<{ name: string }>
	evidenceKinds: Array<{ kind: string; mediaType: string; content: 'text' | 'opaque' }>
}

export type TargetMutationState = 'not-attempted' | 'possibly-mutated'

export type Usage = {
	promptTokens: number
	cachedPromptTokens: number
	completionTokens: number
	totalTokens: number
}

export type StepReason =
	| 'met-expectation'
	| 'failed-expectation'
	| 'loop-detected'
	| 'turn-cap-exceeded'
	| 'step-timeout'
	| 'scenario-timeout'
	| 'tool-error'
	| 'provider-error'
	| 'token-budget-exceeded'
	| 'interrupted'

export type RunReason =
	| 'scenario-complete'
	| Exclude<StepReason, 'met-expectation'>
	| 'driver-load-failed'
	| 'driver-start-failed'
	| 'driver-teardown-failed'
	| 'evidence-write-failed'
	| 'result-write-failed'
	| 'internal-error'

export type StepToolCall = {
	turn: number
	driverId: string
	name: string
	arguments: JsonValue
	status: 'ok' | 'error'
}

export type ExecutedStepResult = {
	id: string
	status: 'passed' | 'failed'
	category: 'app' | 'model' | 'infra'
	reason: StepReason
	actual?: string
	turns: number
	durationMs: number
	usage: Usage
	toolCalls: StepToolCall[]
}

export type NotRunStepResult =
	| { id: string; status: 'not-run'; reason: 'prior-step-failed'; blockedBy: string }
	| { id: string; status: 'not-run'; reason: 'scenario-not-started' }

export type EvidenceReference = {
	kind: string
	mediaType: string
	path: string
	producer: 'harness' | string
	stepId?: string
}

export type ExecutionResultV1 = {
	kind: 'run-result'
	schemaVersion: 1
	runId: string
	scenarioId: string
	status: 'passed' | 'failed' | 'interrupted'
	category: 'passed' | 'app' | 'model' | 'infra'
	reason: RunReason
	targetMutation: TargetMutationState
	startedAt: string
	durationMs: number
	driver: { id: string; contractVersion: 1 }
	policy: { id: string; effectiveLimits: EffectiveLimits }
	usage: Usage & { state: 'complete' | 'partial' | 'unavailable' }
	steps: Array<ExecutedStepResult | NotRunStepResult>
	evidence: { state: 'complete' | 'partial'; references: EvidenceReference[] }
	diagnostics: Diagnostic[]
}

export type InvalidInvocationResultV1 = {
	kind: 'run-result'
	schemaVersion: 1
	status: 'invalid'
	category: 'invalid'
	reason: 'invalid-invocation'
	targetMutation: 'not-attempted'
	diagnostics: Diagnostic[]
}

export type ContainmentResultV1 = {
	kind: 'run-result'
	schemaVersion: 1
	source: 'parent'
	status: 'contained'
	category: 'infra'
	reason: 'parent-containment'
	executionState: 'unavailable'
	durability: 'uncommitted'
	runId?: string
	scenarioId: string
	declaredStepIds: string[]
	targetMutation: TargetMutationState
	startedAt: string
	durationMs: number
	containment: {
		phase: 'start' | 'run' | 'cleanup' | 'terminal'
		trigger:
			'start-frame-too-large' | 'run-deadline-expired' | 'cleanup-deadline-expired' | 'worker-result-unavailable'
	}
	diagnostics: [Diagnostic, ...Diagnostic[]]
}

export type RunResultV1 = ExecutionResultV1 | InvalidInvocationResultV1 | ContainmentResultV1

export type ValidationResultV1 =
	| {
			kind: 'validation-result'
			schemaVersion: 1
			status: 'valid'
			scenarioId: string
			policy: { id: string; effectiveLimits: EffectiveLimits }
			driver: { id: string; contractVersion: 1 }
			diagnostics: []
	  }
	| {
			kind: 'validation-result'
			schemaVersion: 1
			status: 'invalid' | 'error'
			diagnostics: [Diagnostic, ...Diagnostic[]]
	  }

export type ContractReferenceV1 = {
	id:
		| 'checkmate-config'
		| 'run-request'
		| 'run-result'
		| 'validation-result'
		| 'describe-result'
		| 'driver-descriptor'
	schemaVersion: 1
	schemaPath:
		| './schemas/checkmate-config.v1.json'
		| './schemas/run-request.v1.json'
		| './schemas/run-result.v1.json'
		| './schemas/validation-result.v1.json'
		| './schemas/describe-result.v1.json'
		| './schemas/driver-descriptor.v1.json'
}

export type DescribedPolicyV1 = {
	id: string
	limits: EffectiveLimits
	evidence: EvidencePolicyV1
	drivers: Array<{ id: string; allowedTools: '*' | string[] }>
	requiredSecretBindings: string[]
}

export type DescribedDriverV1 = {
	id: string
	contractVersion: 1
	targetSchema: JsonObject
	settingsSchema: JsonObject
	requiredSecretSlots: string[]
	tools: Array<{ name: string }>
	evidenceKinds: Array<{ kind: string; mediaType: string; content: 'text' | 'opaque' }>
}

export type RouteReason = RunReason | 'invalid-invocation' | 'parent-containment'

export type RouteRuleV1 = {
	reason: RouteReason
	category: 'passed' | 'app' | 'model' | 'infra' | 'invalid'
	exitCode: 0 | 1 | 2 | 3 | 4
	retry: 'never' | 'repair-then-new-run'
	mutation: 'not-attempted' | 'possibly-mutated' | 'read-result-target-mutation'
	nextAction:
		| 'continue'
		| 'repair-request-or-configuration'
		| 'inspect-evidence-and-verify-sut-or-expectation'
		| 'repair-model-policy-or-egress'
		| 'repair-environment-and-inspect-target'
		| 'repair-output-and-inspect-target'
}

export type AgentOnboardingV1 = {
	workflow: ['describe', 'author-request', 'validate', 'run', 'route-result']
	commands: {
		validate: 'checkmate validate <request.json>'
		runFile: 'checkmate run <request.json>'
		runStdin: 'checkmate run -'
	}
	routing: RouteRuleV1[]
	evidence: {
		pathBase: 'invocation-root'
		followReferencesOnly: true
		retentionIsPolicyDependent: true
		inspectCompletenessState: true
	}
}

export type DescribeResultV1 =
	| {
			kind: 'describe-result'
			schemaVersion: 1
			status: 'available'
			contracts: ContractReferenceV1[]
			environment: {
				defaultPolicy: string
				policies: DescribedPolicyV1[]
				drivers: DescribedDriverV1[]
			}
			onboarding: AgentOnboardingV1
			diagnostics: []
	  }
	| {
			kind: 'describe-result'
			schemaVersion: 1
			status: 'invalid' | 'error'
			diagnostics: [Diagnostic, ...Diagnostic[]]
	  }

export const PUBLIC_CONTRACT_REFERENCES_V1: readonly ContractReferenceV1[] = [
	{ id: 'checkmate-config', schemaVersion: 1, schemaPath: './schemas/checkmate-config.v1.json' },
	{ id: 'run-request', schemaVersion: 1, schemaPath: './schemas/run-request.v1.json' },
	{ id: 'run-result', schemaVersion: 1, schemaPath: './schemas/run-result.v1.json' },
	{ id: 'validation-result', schemaVersion: 1, schemaPath: './schemas/validation-result.v1.json' },
	{ id: 'describe-result', schemaVersion: 1, schemaPath: './schemas/describe-result.v1.json' },
	{ id: 'driver-descriptor', schemaVersion: 1, schemaPath: './schemas/driver-descriptor.v1.json' },
]

export const PUBLIC_ROUTE_RULES_V1: readonly RouteRuleV1[] = [
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
	...routeRules(
		['loop-detected', 'turn-cap-exceeded', 'step-timeout'] as const,
		'model',
		2,
		'repair-model-policy-or-egress'
	),
	...routeRules(
		[
			'scenario-timeout',
			'tool-error',
			'provider-error',
			'token-budget-exceeded',
			'interrupted',
			'driver-load-failed',
			'driver-start-failed',
			'driver-teardown-failed',
		] as const,
		'infra',
		3,
		'repair-environment-and-inspect-target'
	),
	...routeRules(
		['evidence-write-failed', 'result-write-failed'] as const,
		'infra',
		3,
		'repair-output-and-inspect-target'
	),
	...routeRules(['internal-error'] as const, 'infra', 3, 'repair-environment-and-inspect-target'),
	{
		reason: 'invalid-invocation',
		category: 'invalid',
		exitCode: 4,
		retry: 'repair-then-new-run',
		mutation: 'not-attempted',
		nextAction: 'repair-request-or-configuration',
	},
	{
		reason: 'parent-containment',
		category: 'infra',
		exitCode: 3,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction: 'repair-environment-and-inspect-target',
	},
]

function routeRules<T extends RouteReason>(
	reasons: readonly T[],
	category: RouteRuleV1['category'],
	exitCode: RouteRuleV1['exitCode'],
	nextAction: RouteRuleV1['nextAction']
): RouteRuleV1[] {
	return reasons.map((reason) => ({
		reason,
		category,
		exitCode,
		retry: 'repair-then-new-run',
		mutation: 'read-result-target-mutation',
		nextAction,
	}))
}
