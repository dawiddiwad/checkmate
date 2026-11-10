export type Profile = {
	contractVersion: 'toolkit-2'
	targetId: string
	revision: number
	baseUrl: string
	environment: string
	capabilities: Array<string>
	tooling: Array<{
		capability: string
		executable: string
		version: string
	}>
	authentication: {
		kind: 'none' | 'environment' | 'browser_session'
		references: Array<string>
	}
	allowedOperations: Array<string>
	startup: {
		owner: 'caller' | 'checkmate'
		command: Array<string> | null
	}
	cleanup: string
	readyForLiveExecution: boolean
}

export type Plan = {
	contractVersion: 'toolkit-2'
	planId: string
	revision: number
	previousRevision: number | null
	target: {
		path: string
		sha256: string
	}
	targetId: string
	requirements: Array<{
		id: string
		text: string
		source: string
	}>
	tests: Array<{
		id: string
		requirementIds: Array<string>
		capability: string
		operations: Array<string>
		readiness: 'ready' | 'blocked' | 'deferred'
		gapIds: Array<string>
		dependsOn: Array<string>
		preconditions: Array<string>
		action: string
		expected: string | null
		oracleKind: 'deterministic' | 'agent_observation'
	}>
	gaps: Array<{
		id: string
		severity: 'blocking' | 'non_blocking'
		status: 'open' | 'resolved' | 'deferred'
		requirementIds: Array<string>
		testIds: Array<string>
		question: string
		consequence: string
		decisionId: string | null
	}>
	assumptions: Array<{
		decisionId: string
		text: string
	}>
	decisions: Array<{
		id: string
		gapId: string
		kind: 'clarify' | 'accept_assumption' | 'defer'
		actor: string
		rationale: string
		value: string
		source: string | null
	}>
	coverage: Array<{
		requirementId: string
		testIds: Array<string>
		status: 'planned' | 'blocked' | 'deferred'
	}>
}

export type SetupRequest = {
	contractVersion: 'toolkit-2'
	requestId: string
	caller: string
	operation: 'setup'
	profilePath: string
	targetId: string
	baseUrl: string
	capabilities: Array<string>
	allowedOperations: Array<string>
}

export type PlanRequest = {
	contractVersion: 'toolkit-2'
	requestId: string
	caller: string
	operation: 'plan'
	target: {
		path: string
		sha256: string
	}
	objective: string
	requirements: Array<{
		id: string
		text: string
		source: string
	}>
	sourceContext: Array<{
		uri: string
		content: string
	}>
	outputPlanId: string
	planDirectory: string
}

export type ReviseRequest = {
	contractVersion: 'toolkit-2'
	requestId: string
	caller: string
	operation: 'revise'
	basePlan: {
		path: string
		sha256: string
	}
	baseRevision: number
	decisions: Array<{
		id: string
		gapId: string
		kind: 'clarify' | 'accept_assumption' | 'defer'
		actor: string
		rationale: string
		value: string
		source: string | null
	}>
}

export type ExecuteRequest = {
	contractVersion: 'toolkit-2'
	requestId: string
	caller: string
	operation: 'execute'
	runId: string
	plan: {
		path: string
		sha256: string
	}
	target: {
		path: string
		sha256: string
	}
	selectedTestIds: Array<string>
	partialExecution?: 'wait_for_resolution' | 'ready_only'
	timeoutSeconds: number
	onNewBlocker: 'return_to_caller' | 'continue_independent'
	applicationBuild: string
	outputDirectory: string
	retestOf?: {
		path: string
		sha256: string
	}
}

export type ReportRequest = {
	contractVersion: 'toolkit-2'
	requestId: string
	caller: string
	operation: 'report'
	result: {
		path: string
		sha256: string
	}
}

export type Observation = {
	contractVersion: 'toolkit-2'
	requestId: string
	runId: string
	completion: 'completed' | 'interrupted' | 'operational_error'
	plan: {
		path: string
		sha256: string
	}
	target: {
		path: string
		sha256: string
	}
	applicationBuild: string
	host: {
		name: string
		version: string | null
		model: string | null
	}
	selectedTestIds: Array<string>
	startedAt: string
	tests: Array<{
		testId: string
		outcome: 'passed' | 'failed' | 'blocked' | 'not_run' | 'error'
		expected: string | null
		observed: string | null
		assertionKind: 'deterministic' | 'agent_observation' | null
		evidenceIds: Array<string>
		reason: string | null
	}>
	findings: Array<{
		id: string
		type: 'defect' | 'potential_issue'
		severity: 'low' | 'medium' | 'high' | 'critical'
		testIds: Array<string>
		requirementIds: Array<string>
		title: string
		expected: string
		observed: string
		reproduction: Array<string>
		evidenceIds: Array<string>
	}>
	newGaps: Array<{
		id: string
		severity: 'blocking' | 'non_blocking'
		status: 'open' | 'resolved' | 'deferred'
		requirementIds: Array<string>
		testIds: Array<string>
		question: string
		consequence: string
		decisionId: string | null
	}>
	evidence: Array<{
		id: string
		kind: 'observation' | 'http_exchange' | 'screenshot' | 'trace'
		path: string
	}>
	cleanup: {
		status: 'completed' | 'failed' | 'not_applicable'
		reason: string
	}
	retestOf?: {
		path: string
		sha256: string
	}
}

export type Result = {
	contractVersion: 'toolkit-2'
	requestId: string
	runId: string
	completion: 'completed' | 'interrupted' | 'operational_error'
	plan: {
		path: string
		sha256: string
	}
	target: {
		path: string
		sha256: string
	}
	applicationBuild: string
	host: {
		name: string
		version: string | null
		model: string | null
		source: 'launcher' | 'declared'
		permissions: 'allow_rules' | 'unrestricted' | 'session'
	}
	selectedTestIds: Array<string>
	startedAt: string
	finishedAt: string
	tests: Array<{
		testId: string
		outcome: 'passed' | 'failed' | 'blocked' | 'not_run' | 'error'
		expected: string | null
		observed: string | null
		assertionKind: 'deterministic' | 'agent_observation' | null
		evidenceIds: Array<string>
		reason: string | null
	}>
	coverage: {
		status: 'complete' | 'partial' | 'not_executed'
		requirements: Array<{
			requirementId: string
			status: 'tested' | 'uncovered'
			testIds: Array<string>
			reason: string | null
		}>
	}
	findings: Array<{
		id: string
		type: 'defect' | 'potential_issue'
		severity: 'low' | 'medium' | 'high' | 'critical'
		testIds: Array<string>
		requirementIds: Array<string>
		title: string
		expected: string
		observed: string
		reproduction: Array<string>
		evidenceIds: Array<string>
	}>
	newGaps: Array<{
		id: string
		severity: 'blocking' | 'non_blocking'
		status: 'open' | 'resolved' | 'deferred'
		requirementIds: Array<string>
		testIds: Array<string>
		question: string
		consequence: string
		decisionId: string | null
	}>
	evidence: Array<{
		id: string
		kind: 'observation' | 'http_exchange' | 'screenshot' | 'trace'
		path: string
		sha256: string
	}>
	cleanup: {
		status: 'completed' | 'failed' | 'not_applicable'
		reason: string
	}
	retestOf?: {
		path: string
		sha256: string
	}
}

export type Response = {
	contractVersion: 'toolkit-2'
	requestId: string
	operation: 'setup' | 'plan' | 'revise' | 'execute' | 'report'
	status: 'completed' | 'needs_decision' | 'invalid_request' | 'interrupted' | 'operational_error'
	artifact: {
		path: string
		sha256: string
	} | null
	reasons: Array<string>
}

export type Reference = { path: string; sha256: string }
export type Request = SetupRequest | PlanRequest | ReviseRequest | ExecuteRequest | ReportRequest
