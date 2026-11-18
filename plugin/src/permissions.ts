import type { Reply, Store } from './store.ts'
import { all, completed, one, write } from './store.ts'
import { addEvent } from './explorations.ts'
import { addRequestEvent, isRequestId, requestStopped } from './requests.ts'
import { requireChoice, requireCondition, requireWellFormed } from './contracts.ts'
import { explorerActor } from './recorder.ts'

export const permissionDecisions = ['allow', 'allow-kind', 'allow-tool', 'always', 'deny', 'stop'] as const
export type PermissionChoice = (typeof permissionDecisions)[number]
export type Suggestion = Record<string, unknown>
export type RuleOfSuggestion = { toolName: string; ruleContent?: string }
export type PermissionDecision = {
	kind: PermissionChoice | 'rule' | 'closed'
	by: string
	at: string
	text: string
	reason: string | null
	rule: string | null
	setBy: string | null
	cause: ClosedCause | null
}
export type Permission = {
	askerId: string
	fromRequest: boolean
	planId: string | null
	id: string
	who: string
	tester: string | null
	tool: string
	input: unknown
	suggestions: Suggestion[]
	cwd: string | null
	at: string
	rule: string | null
	decision: PermissionDecision | null
}
export type ForceRule = {
	rule: string
	kind: 'allow-kind' | 'allow-tool'
	setBy: string
	at: string
	requestId: string
}
export type ClosedCause = 'timeout' | 'ui-stopped' | 'stopped' | 'disconnected'
export type PermissionRequestInput = {
	askerId: string
	who: string
	tool: string
	input: unknown
	suggestions: Suggestion[]
	cwd?: string
}

export const closedText: Record<ClosedCause, string> = {
	timeout: 'no answer in 10 minutes',
	'ui-stopped': 'closed, the UI stopped',
	stopped: 'closed, the tester or the run stopped',
	disconnected: 'closed, the tester did not wait any more',
}

const maxText = 2000
const requestStep = 'permission'
const decisionStep = 'permission-decision'

type Row = {
	asker_id: string
	from_request: number
	plan_id: string | null
	at: string
	step: string
	explorer: string | null
	status: string
	detail: string
}

function rows(store: Store, planId: string | undefined, askerId: string | undefined) {
	const wanted = `e.step IN ('${requestStep}', '${decisionStep}')`
	const exploration = all<Row>(
		store,
		`SELECT e.exploration_id AS asker_id, 0 AS from_request, x.plan_id, e.at, e.step, e.explorer, e.status, e.detail
		FROM exploration_events e JOIN explorations x ON x.exploration_id = e.exploration_id
		WHERE ${wanted} AND (?1 IS NULL OR x.plan_id = ?1) AND (?2 IS NULL OR e.exploration_id = ?2) ORDER BY e.rowid`,
		planId ?? null,
		askerId ?? null
	)
	const request = all<Row>(
		store,
		`SELECT e.request_id AS asker_id, 1 AS from_request, json_extract(r.context, '$.planId') AS plan_id, e.at, e.step, NULL AS explorer, e.status, e.detail
		FROM request_events e JOIN requests r ON r.request_id = e.request_id
		WHERE ${wanted} AND (?1 IS NULL OR json_extract(r.context, '$.planId') = ?1) AND (?2 IS NULL OR e.request_id = ?2) ORDER BY e.rowid`,
		planId ?? null,
		askerId ?? null
	)
	return [...exploration, ...request]
}

export function ruleText(rule: RuleOfSuggestion) {
	return rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName
}

function rulesOf(suggestion: Suggestion | undefined): RuleOfSuggestion[] {
	if (!suggestion || !Array.isArray(suggestion.rules)) return []
	return suggestion.rules.flatMap((rule: unknown) => {
		const item = rule as Partial<RuleOfSuggestion> | null
		if (typeof item?.toolName !== 'string' || !item.toolName) return []
		return [
			{
				toolName: item.toolName,
				...(typeof item.ruleContent === 'string' ? { ruleContent: item.ruleContent } : {}),
			},
		]
	})
}

export function kindSuggestion(suggestions: Suggestion[]) {
	return suggestions.find((item) => item.type === 'addRules' && rulesOf(item).length > 0)
}

export function kindRule(suggestions: Suggestion[]) {
	const found = kindSuggestion(suggestions)
	return found ? rulesOf(found).map(ruleText).join(', ') : null
}

function shortened(value: unknown): unknown {
	if (typeof value === 'string') return value.length > maxText ? `${value.slice(0, maxText)}…` : value
	if (Array.isArray(value)) return value.map(shortened)
	if (value && typeof value === 'object')
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shortened(item)]))
	return value
}

function decisionOf(row: Row): PermissionDecision {
	const detail = JSON.parse(row.detail) as Record<string, string | null>
	return {
		kind: row.status as PermissionDecision['kind'],
		by: detail.by ?? '',
		at: row.at,
		text: detail.text ?? '',
		reason: detail.reason ?? null,
		rule: detail.rule ?? null,
		setBy: detail.setBy ?? null,
		cause: (detail.cause as ClosedCause | undefined) ?? null,
	}
}

function permissionsOf(list: Row[]) {
	const found = new Map<string, Permission>()
	for (const row of list) {
		const detail = JSON.parse(row.detail) as Record<string, unknown>
		const key = `${row.asker_id}/${detail.id}`
		if (row.step === requestStep) {
			const suggestions = detail.suggestions as Suggestion[]
			found.set(key, {
				askerId: row.asker_id,
				fromRequest: row.from_request === 1,
				planId: row.plan_id,
				id: detail.id as string,
				who: detail.who as string,
				tester: row.explorer,
				tool: detail.tool as string,
				input: detail.input,
				suggestions,
				cwd: (detail.cwd as string | null | undefined) ?? null,
				at: row.at,
				rule: kindRule(suggestions),
				decision: null,
			})
		} else {
			const request = found.get(key)
			if (request && !request.decision) request.decision = decisionOf(row)
		}
	}
	return [...found.values()]
}

export function explorationPermissions(store: Store, askerId: string) {
	return permissionsOf(rows(store, undefined, askerId))
}

export function openPermissions(store: Store, planId?: string) {
	return permissionsOf(rows(store, planId, undefined)).filter((item) => !item.decision)
}

function conversationOf(store: Store, askerId: string) {
	return one<{ conversation: string }>(store, 'SELECT conversation FROM requests WHERE request_id = ?', askerId)
		?.conversation
}

function ruleScope(store: Store, askerId: string) {
	const conversation = conversationOf(store, askerId)
	if (!conversation) return explorationPermissions(store, askerId)
	return all<{ request_id: string }>(
		store,
		'SELECT request_id FROM requests WHERE conversation = ?',
		conversation
	).flatMap((row) => explorationPermissions(store, row.request_id))
}

export function permissionRules(store: Store, askerId: string): ForceRule[] {
	return ruleScope(store, askerId).flatMap((item) =>
		(item.decision?.kind === 'allow-kind' || item.decision?.kind === 'allow-tool') && item.decision.rule
			? [
					{
						rule: item.decision.rule,
						kind: item.decision.kind,
						setBy: item.decision.by,
						at: item.decision.at,
						requestId: item.fromRequest ? `${item.askerId}/${item.id}` : item.id,
					},
				]
			: []
	)
}

export function permissionOf(store: Store, askerId: string, requestId: string) {
	return explorationPermissions(store, askerId).find((item) => item.id === requestId)
}

function findPermission(store: Store, askerId: string, requestId: string) {
	const found = permissionOf(store, askerId, requestId)
	requireCondition(
		found,
		`Exploration ${askerId} has no permission request ${requestId}.`,
		`Run checkmate explore show ${askerId}.`
	)
	return found
}

function nextRequestId(store: Store, askerId: string) {
	const table = isRequestId(store, askerId) ? 'request_events' : 'exploration_events'
	const column = table === 'request_events' ? 'request_id' : 'exploration_id'
	const count = one<{ count: number }>(
		store,
		`SELECT count(*) AS count FROM ${table} WHERE ${column} = ? AND step = '${requestStep}'`,
		askerId
	)!.count
	return `P${count + 1}`
}

function addAskerEvent(
	store: Store,
	request: Pick<Permission, 'askerId' | 'fromRequest' | 'tester'>,
	event: { step: string; status: string; detail: Record<string, unknown> },
	operationId: string,
	at: string
) {
	if (request.fromRequest) addRequestEvent(store, request.askerId, event, operationId, at)
	else addEvent(store, request.askerId, { ...event, explorer: request.tester }, operationId, at)
}

function subjectsOf(request: Pick<Permission, 'askerId' | 'fromRequest' | 'planId'>) {
	return [
		request.fromRequest ? `request:${request.askerId}` : `exploration:${request.askerId}`,
		...(request.planId ? [`plan:${request.planId}`] : []),
		'permissions',
	]
}

function addDecision(
	store: Store,
	request: Pick<Permission, 'askerId' | 'fromRequest' | 'id' | 'who' | 'tester'>,
	kind: PermissionDecision['kind'],
	detail: Record<string, unknown>,
	operationId: string,
	at: string
) {
	addAskerEvent(
		store,
		request,
		{ step: decisionStep, status: kind, detail: { id: request.id, who: request.who, ...detail } },
		operationId,
		at
	)
}

function ruleInForce(store: Store, askerId: string, tool: string, suggestions: Suggestion[]) {
	const wanted = kindRule(suggestions)
	return permissionRules(store, askerId).find((item) =>
		item.kind === 'allow-tool' ? item.rule === tool : item.rule === wanted
	)
}

export function requestPermission(store: Store, input: PermissionRequestInput) {
	const fromRequest = isRequestId(store, input.askerId)
	const tester =
		fromRequest ||
		one(
			store,
			"SELECT 1 FROM exploration_events WHERE exploration_id = ? AND step = 'launch' AND explorer = ?",
			input.askerId,
			input.who
		) === undefined
			? null
			: input.who
	const operation = {
		actor: fromRequest ? `request:${input.askerId}` : explorerActor(input.who),
		command: fromRequest ? 'request permission' : 'explore permission',
		subject: input.askerId,
	}
	return write(store, { ...operation, input: { who: input.who, tool: input.tool } }, (operationId, at) => {
		const id = nextRequestId(store, input.askerId)
		const request = { askerId: input.askerId, fromRequest, id, who: input.who, tester }
		addAskerEvent(
			store,
			request,
			{
				step: requestStep,
				status: 'open',
				detail: {
					id,
					who: input.who,
					tool: input.tool,
					input: shortened(input.input),
					suggestions: input.suggestions,
					...(input.cwd ? { cwd: input.cwd } : {}),
				},
			},
			operationId,
			at
		)
		const force = ruleInForce(store, input.askerId, input.tool, input.suggestions)
		if (force)
			addDecision(
				store,
				request,
				'rule',
				{
					by: 'rule',
					text: `allowed by rule ${force.kind === 'allow-tool' ? `every ${force.rule} call` : force.rule}, set by ${force.setBy}`,
					rule: force.rule,
					setBy: force.setBy,
				},
				operationId,
				at
			)
		return {
			reply: completed(input.askerId, { id, byRule: Boolean(force) }),
			subjects: [fromRequest ? `request:${input.askerId}` : `exploration:${input.askerId}`, 'permissions'],
		}
	}).data as { id: string; byRule: boolean }
}

export type DecideInput = { askerId: string; requestId: string; decision: string; reason?: string }

export function decidePermission(
	store: Store,
	actor: string | undefined,
	input: DecideInput,
	stop: (explorer: string | undefined, reason: string) => void
): Reply {
	const choice = requireChoice(input.decision, permissionDecisions, 'decision')
	const reason = input.reason?.trim() ?? ''
	requireWellFormed(choice !== 'deny' || reason, 'A denial needs a reason.', 'Give the reason with --reason <text>.')
	const operation = {
		actor,
		command: isRequestId(store, input.askerId) ? 'request permit' : 'explore permit',
		subject: input.askerId,
		input: { requestId: input.requestId, decision: choice },
	}
	const reply = write(store, operation, (operationId, at, who) => {
		const request = findPermission(store, input.askerId, input.requestId)
		requireCondition(
			!request.decision,
			`Permission request ${request.id} of ${request.askerId} has an answer already: ${request.decision?.text}. Nothing changed.`
		)
		requireCondition(
			(choice !== 'allow-kind' && choice !== 'always') || request.rule,
			`Permission request ${request.id} has no rule that Claude Code can remember. Allow it once, or deny it.`
		)
		const scope = request.fromRequest ? 'conversation' : 'test'
		const stopped = request.fromRequest ? 'request' : request.tester ? 'tester' : 'run'
		const texts: Record<PermissionChoice, string> = {
			allow: 'allowed once',
			'allow-kind': `allowed for this ${scope}: ${request.rule}`,
			'allow-tool': `allowed for this ${scope}: every ${request.tool} call`,
			always: `allowed always in this project: ${request.rule}`,
			deny: `denied: ${reason}`,
			stop: `stopped the ${stopped}${reason ? `: ${reason}` : ''}`,
		}
		const rule =
			choice === 'allow-tool'
				? request.tool
				: choice === 'allow-kind' || choice === 'always'
					? request.rule
					: null
		addDecision(
			store,
			request,
			choice,
			{ by: who, text: `${texts[choice]}, by ${who}`, ...(reason ? { reason } : {}), ...(rule ? { rule } : {}) },
			operationId,
			at
		)
		return {
			reply: completed(request.askerId, { requestId: request.id, decision: choice, who: request.tester }),
			subjects: subjectsOf(request),
		}
	})
	if (choice === 'stop') stop((reply.data.who as string | null) ?? undefined, reason)
	return reply
}

export function closePermission(store: Store, askerId: string, requestId: string, cause: ClosedCause) {
	return write(
		store,
		{
			actor: 'checkmate',
			command: 'explore permission-close',
			subject: askerId,
			input: { requestId, cause },
		},
		(operationId, at) => {
			const request = findPermission(store, askerId, requestId)
			if (request.decision) return { reply: completed(askerId, { closed: false }), subjects: [] }
			addDecision(store, request, 'closed', { by: 'checkmate', text: closedText[cause], cause }, operationId, at)
			return {
				reply: completed(askerId, { closed: true }),
				subjects: subjectsOf(request),
			}
		}
	).data.closed as boolean
}

export function closeOpenPermissions(store: Store, cause: ClosedCause) {
	for (const item of openPermissions(store)) closePermission(store, item.askerId, item.id, cause)
}

function decisionBody(decision: Record<string, unknown>) {
	return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })
}

export function permissionAnswer(request: Permission, decision: PermissionDecision) {
	const withRule = (destination: string) => {
		const suggestion = kindSuggestion(request.suggestions)!
		const update = {
			type: 'addRules',
			rules: rulesOf(suggestion),
			...(typeof suggestion.behavior === 'string' ? { behavior: suggestion.behavior } : {}),
			destination,
		}
		return decisionBody({ behavior: 'allow', updatedPermissions: [update] })
	}
	const forTool = (decision.kind === 'allow-tool' || decision.kind === 'rule') && decision.rule === request.tool
	if (forTool)
		return decisionBody({
			behavior: 'allow',
			updatedPermissions: [
				{ type: 'addRules', rules: [{ toolName: request.tool }], behavior: 'allow', destination: 'session' },
			],
		})
	if (decision.kind === 'allow') return decisionBody({ behavior: 'allow' })
	if (decision.kind === 'allow-kind' || decision.kind === 'rule') return withRule('session')
	if (decision.kind === 'always') return withRule('localSettings')
	if (decision.kind === 'deny') return decisionBody({ behavior: 'deny', message: decision.reason })
	if (decision.kind === 'stop')
		return decisionBody({
			behavior: 'deny',
			message: decision.reason ?? `Stopped by ${decision.by}.`,
			interrupt: true,
		})
	return ''
}

export function stoppedSince(store: Store, request: Permission) {
	if (request.fromRequest) return requestStopped(store, request.askerId)
	return (
		one(
			store,
			`SELECT 1 FROM exploration_events WHERE exploration_id = ? AND step = 'stop'
			AND (explorer IS NULL OR explorer = ?)
			AND rowid > (SELECT rowid FROM exploration_events WHERE exploration_id = ? AND step = '${requestStep}' AND json_extract(detail, '$.id') = ?)`,
			request.askerId,
			request.who,
			request.askerId,
			request.id
		) !== undefined
	)
}
