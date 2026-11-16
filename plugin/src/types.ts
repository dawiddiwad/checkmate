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
	text: string
	source?: string
	area?: string
}

export type JournalDefect = {
	kind: 'defect'
	id?: string
	build: string
	supersedes?: string
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
	kind: 'criterion' | 'observation' | 'defect' | 'question' | 'verdict' | 'note' | 'issue'
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
	question: string
	about?: string
}

export type JournalVerdict = {
	kind: 'verdict'
	id?: string
	build: string
	supersedes?: string
	defect: string
	result: 'fixed' | 'not_fixed'
	saw?: string
	evidence?: string | Array<string>
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
		owner: 'factory' | 'checkmate'
		command: Array<string> | null
	}
	readyForLiveExecution: boolean
	approvals?: {
		plan: 'required' | 'none'
		result: 'required' | 'none'
	}
}
