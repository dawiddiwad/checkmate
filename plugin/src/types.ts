export type Finding = {
	id: string
	type: 'defect' | 'potential_issue'
	severity: 'low' | 'medium' | 'high' | 'critical'
	assertionIds: Array<string>
	requirementIds: Array<string>
	title: string
	expected: string
	observed: string
	reproduction: Array<string>
	evidenceIds: Array<string>
	metadata?: Record<string, string | number | boolean>
}

export type Gap = {
	id: string
	severity: 'blocking' | 'non_blocking'
	status: 'open' | 'resolved' | 'deferred' | 'not_needed'
	requirementIds: Array<string>
	testIds: Array<string>
	question: string
	consequence: string
	decisionId: string | null
}

export type Instance = {
	entries: Record<string, string>
	environment?: string
	references?: Array<string>
}

export type JournalCriterion = {
	kind: 'criterion'
	id?: string
	build?: string
	supersedes?: string
	rule?: string
	text: string
	source?: string
	verdict?: 'ok' | 'wrong'
	saw?: string
	area?: string
}

export type JournalDefect = {
	kind: 'defect'
	id?: string
	build: string
	supersedes?: string
	rule?: string
	title: string
	expected: string
	actual: string
	severity: 'critical' | 'high' | 'medium' | 'low'
	about?: string
	steps?: string | Array<string>
	saw?: string
	value?: string
	via?: 'ui' | 'api' | 'code' | 'other'
	evidence?: string | Array<string>
	links?: Array<string>
	suspected?: boolean
	question?: string
}

export type JournalEntry = {
	kind: 'criterion' | 'observation' | 'defect' | 'question' | 'verdict' | 'note' | 'issue' | 'topic'
	id?: string
	build?: string
	supersedes?: string
}

export type JournalIssue = {
	kind: 'issue'
	id?: string
	build?: string
	supersedes?: string
	title: string
	severity: 'critical' | 'high' | 'medium' | 'low'
	reports: Array<string>
	note?: string
}

export type JournalNote = {
	kind: 'note'
	id?: string
	build?: string
	supersedes?: string
	text: string
	about?: string
	area?: string
	evidence?: string | Array<string>
}

export type JournalObservation = {
	kind: 'observation'
	id?: string
	build: string
	supersedes?: string
	about?: string
	steps?: string | Array<string>
	saw: string
	value?: string
	repeats?: string
	verdict?: 'ok' | 'wrong'
	via?: 'ui' | 'api' | 'code' | 'other'
	evidence?: string | Array<string>
	confirms?: string
	refutes?: string
}

export type JournalQuestion = {
	kind: 'question'
	id?: string
	build?: string
	supersedes?: string
	rule?: string
	question: string
	actual?: string
	about?: string
	blocking?: boolean
}

export type JournalTopic = {
	kind: 'topic'
	id?: string
	build?: string
	supersedes?: string
	question: string
	label?: string
	members: Array<string>
}

export type JournalVerdict = {
	kind: 'verdict'
	id?: string
	build: string
	supersedes?: string
	defect: string
	result: 'fixed' | 'not_fixed' | 'not_retested'
	saw?: string
	evidence?: string | Array<string>
}

export type PlanCandidate = {
	requirements?: Array<{
		id: string
		text: string
		source: string
		area?: string
		metadata?: Record<string, string | number | boolean>
	}>
	tests: Array<{
		id: string
		title: string
		requirementIds: Array<string>
		capability: string
		operations: Array<string>
		dependsOn: Array<string>
		preconditions: Array<string>
		action: string
		assertions: Array<{
			id: string
			check: string
			checkKind: 'deterministic' | 'agent_observation'
			observe?: string
			expected?: string
		}>
		metadata?: Record<string, string | number | boolean>
	}>
	gaps: Array<{
		id: string
		severity: 'blocking' | 'non_blocking'
		status: 'open' | 'resolved' | 'deferred' | 'not_needed'
		requirementIds: Array<string>
		testIds: Array<string>
		question: string
		consequence: string
		decisionId: string | null
	}>
}

export type PlanDelta = {
	requirements?: Record<
		string,
		{
			remove?: boolean
			text?: string
			source?: string
			area?: string
		}
	>
	tests: Record<
		string,
		{
			remove?: boolean
			title?: string
			requirementIds?: Array<string>
			capability?: string
			operations?: Array<string>
			dependsOn?: Array<string>
			preconditions?: Array<string>
			action?: string
			assertions?: Array<{
				check: string
				checkKind: 'deterministic' | 'agent_observation'
				observe?: string
				expected?: string
			}>
		}
	>
	gaps?: Record<
		string,
		{
			question: string
			consequence: string
			testIds: Array<string>
		}
	>
}

export type PlanPatch = {
	requirements?: Record<
		string,
		{
			text?: string
			source?: string
			area?: string
			metadata?: Record<string, string | number | boolean>
		} | null
	>
	tests?: Record<
		string,
		{
			title?: string
			requirementIds?: Array<string>
			capability?: string
			operations?: Array<string>
			dependsOn?: Array<string>
			preconditions?: Array<string>
			action?: string
			assertions?: Record<
				string,
				{
					check?: string
					checkKind?: 'deterministic' | 'agent_observation'
					observe?: string
					expected?: string
				} | null
			>
			metadata?: Record<string, string | number | boolean>
		} | null
	>
	gaps?: Record<
		string,
		{
			severity?: 'blocking' | 'non_blocking'
			requirementIds?: Array<string>
			testIds?: Array<string>
			question?: string
			consequence?: string
		} | null
	>
}

export type PlanRequest = {
	objective: string
	requirements?: Array<{
		id: string
		text: string
		source: string
		area?: string
		metadata?: Record<string, string | number | boolean>
	}>
	sourceContext?: Array<{
		uri: string
		content: string
	}>
	context?: {
		sources: Array<string>
		instructions?: string
	}
	tools?: Array<
		| string
		| {
				name: string
				kind: 'cli' | 'mcp' | 'skill'
				purpose: string
		  }
	>
}

export type Plan = {
	contractVersion: 'toolkit-2'
	planId: string
	revision: number
	previousRevision: number | null
	target: {
		targetId: string
		revision: number
		sha256: string
	}
	objective: string
	requirements: Array<{
		id: string
		text: string
		source: string
		area?: string
		metadata?: Record<string, string | number | boolean>
	}>
	tests: Array<{
		id: string
		title: string
		requirementIds: Array<string>
		capability: string
		operations: Array<string>
		readiness: 'ready' | 'blocked' | 'deferred'
		gapIds: Array<string>
		dependsOn: Array<string>
		preconditions: Array<string>
		action: string
		assertions: Array<{
			id: string
			check: string
			checkKind: 'deterministic' | 'agent_observation'
			observe?: string
			expected?: string
		}>
		metadata?: Record<string, string | number | boolean>
	}>
	gaps: Array<{
		id: string
		severity: 'blocking' | 'non_blocking'
		status: 'open' | 'resolved' | 'deferred' | 'not_needed'
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
	removals?: Array<{
		revision: number
		actor: string
		rationale: string
		testIds: Array<string>
		closedGaps: Array<{
			gapId: string
			reason: string
		}>
	}>
	coverage: Array<{
		requirementId: string
		testIds: Array<string>
		status: 'planned' | 'blocked' | 'deferred'
	}>
}

export type Profile = {
	contractVersion: 'toolkit-2'
	targetId: string
	revision: number
	entryPoints: Array<{
		name: string
		kind: 'url' | 'command' | 'value'
		purpose: string
	}>
	capabilities: Array<string>
	tools: Array<{
		name: string
		kind: 'cli' | 'mcp' | 'skill'
		purpose: string
		version?: string
		executable?: string
		reachable: boolean
	}>
	authentication: {
		kind: 'none' | 'environment' | 'browser_session'
		references: Array<string>
	}
	allowedOperations: Array<string>
	startup: {
		owner: 'factory' | 'checkmate'
		command: Array<string> | null
	}
	cleanup: string
	reset?: {
		owner: 'checkmate' | 'environment' | 'isolation'
		command: Array<string> | null
		cleanup?: Array<string> | null
		policy?:
			| {
					text: string
			  }
			| {
					path: string
			  }
			| null
		timeoutSeconds?: number
	}
	readyForLiveExecution: boolean
	explore?: {
		level?: 'smoke' | 'normal' | 'deep'
		explorers?: number
	}
	approvals?: {
		plan: 'required' | 'none'
		result: 'required' | 'none'
	}
}

export type Response = {
	status: 'completed' | 'needs_decision' | 'interrupted' | 'operational_error' | 'rejected'
	subject: string
	reasons: Array<string>
}

export type Result = {
	contractVersion: 'toolkit-2'
	runId: string
	plan: {
		planId: string
		revision: number
		sha256: string
	}
	target: {
		targetId: string
		revision: number
		sha256: string
	}
	instanceId: string
	applicationBuild: string
	selectedTestIds: Array<string>
	retestOf: string | null
	startedAt: string
	finishedAt: string
	attempts: number
	completion: 'completed' | 'interrupted' | 'operational_error'
	completionCause?: 'deadline' | 'host_stopped' | 'tool_unavailable' | null
	completionReason?: string | null
	tests: Array<{
		testId: string
		outcome: 'passed' | 'failed' | 'inconclusive' | 'blocked' | 'not_run' | 'error'
		cause?: 'deadline'
		reason: string | null
		assertions: Array<{
			assertionId: string
			check: string
			checkKind: 'deterministic' | 'agent_observation'
			result: 'passed' | 'failed' | 'inconclusive' | 'not_checked'
			observed: string | null
			reason: string | null
			evidenceIds: Array<string>
		}>
	}>
	findings: Array<{
		id: string
		type: 'defect' | 'potential_issue'
		severity: 'low' | 'medium' | 'high' | 'critical'
		requirementIds: Array<string>
		title: string
		expected: string
		observed: string
		reproduction: Array<string>
		evidenceIds: Array<string>
		testIds: Array<string>
		assertionIds: Array<string>
		metadata?: Record<string, string | number | boolean>
	}>
	newGaps: Array<{
		id: string
		severity: 'blocking' | 'non_blocking'
		status: 'open' | 'resolved' | 'deferred' | 'not_needed'
		requirementIds: Array<string>
		testIds: Array<string>
		question: string
		consequence: string
		decisionId: string | null
	}>
	evidence: Array<{
		id: string
		testId: string
		assertionId: string | null
		kind: 'observation' | 'http_exchange' | 'screenshot' | 'trace'
		name: string
		mediaType: string
		sha256: string
		size: number
	}>
	cleanup: {
		status: 'completed' | 'failed' | 'not_applicable'
		reason: string
	}
	coverage: {
		status: 'complete' | 'partial' | 'not_executed'
		requirements: Array<{
			requirementId: string
			status: 'tested' | 'deferred' | 'uncovered'
			testIds: Array<string>
			reason: string | null
		}>
	}
}
