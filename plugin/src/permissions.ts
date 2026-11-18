import type { Reply, Store } from './store.ts'
import { all, completed, one, write } from './store.ts'
import { addEvent } from './explorations.ts'
import { requireChoice, requireCondition, requireWellFormed } from './contracts.ts'
import { explorerActor } from './recorder.ts'

export const permissionDecisions = ['allow', 'allow-kind', 'always', 'deny', 'stop'] as const
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
	explorationId: string
	planId: string
	id: string
	who: string
	tester: string | null
	tool: string
	input: unknown
	suggestions: Suggestion[]
	at: string
	rule: string | null
	decision: PermissionDecision | null
}
export type ForceRule = { rule: string; setBy: string; at: string; requestId: string }
export type ClosedCause = 'timeout' | 'ui-stopped' | 'stopped' | 'disconnected'
export type PermissionRequestInput = {
	explorationId: string
	who: string
	tool: string
	input: unknown
	suggestions: Suggestion[]
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
	exploration_id: string
	plan_id: string
	rowid: number
	at: string
	step: string
	explorer: string | null
	status: string
	detail: string
}

function rows(store: Store, where: string, ...parameters: string[]) {
	return all<Row>(
		store,
		`SELECT e.exploration_id, x.plan_id, e.rowid, e.at, e.step, e.explorer, e.status, e.detail
		FROM exploration_events e JOIN explorations x ON x.exploration_id = e.exploration_id
		WHERE e.step IN ('${requestStep}', '${decisionStep}') ${where} ORDER BY e.rowid`,
		...parameters
	)
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
		const key = `${row.exploration_id}/${detail.id}`
		if (row.step === requestStep) {
			const suggestions = detail.suggestions as Suggestion[]
			found.set(key, {
				explorationId: row.exploration_id,
				planId: row.plan_id,
				id: detail.id as string,
				who: detail.who as string,
				tester: row.explorer,
				tool: detail.tool as string,
				input: detail.input,
				suggestions,
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

export function explorationPermissions(store: Store, explorationId: string) {
	return permissionsOf(rows(store, 'AND e.exploration_id = ?', explorationId))
}

export function openPermissions(store: Store, planId?: string) {
	const list = planId === undefined ? rows(store, '') : rows(store, 'AND x.plan_id = ?', planId)
	return permissionsOf(list).filter((item) => !item.decision)
}

export function permissionRules(store: Store, explorationId: string): ForceRule[] {
	return explorationPermissions(store, explorationId).flatMap((item) =>
		item.decision?.kind === 'allow-kind' && item.decision.rule
			? [{ rule: item.decision.rule, setBy: item.decision.by, at: item.decision.at, requestId: item.id }]
			: []
	)
}

export function permissionOf(store: Store, explorationId: string, requestId: string) {
	return explorationPermissions(store, explorationId).find((item) => item.id === requestId)
}

function findPermission(store: Store, explorationId: string, requestId: string) {
	const found = permissionOf(store, explorationId, requestId)
	requireCondition(
		found,
		`Exploration ${explorationId} has no permission request ${requestId}.`,
		`Run checkmate explore show ${explorationId}.`
	)
	return found
}

function nextRequestId(store: Store, explorationId: string) {
	const count = one<{ count: number }>(
		store,
		`SELECT count(*) AS count FROM exploration_events WHERE exploration_id = ? AND step = '${requestStep}'`,
		explorationId
	)!.count
	return `P${count + 1}`
}

function addDecision(
	store: Store,
	request: Pick<Permission, 'explorationId' | 'id' | 'who' | 'tester'>,
	kind: PermissionDecision['kind'],
	detail: Record<string, unknown>,
	operationId: string,
	at: string
) {
	addEvent(
		store,
		request.explorationId,
		{
			step: decisionStep,
			explorer: request.tester,
			status: kind,
			detail: { id: request.id, who: request.who, ...detail },
		},
		operationId,
		at
	)
}

function ruleInForce(store: Store, explorationId: string, suggestions: Suggestion[]) {
	const wanted = kindRule(suggestions)
	return wanted ? permissionRules(store, explorationId).find((item) => item.rule === wanted) : undefined
}

export function requestPermission(store: Store, input: PermissionRequestInput) {
	const tester =
		one(
			store,
			"SELECT 1 FROM exploration_events WHERE exploration_id = ? AND step = 'launch' AND explorer = ?",
			input.explorationId,
			input.who
		) === undefined
			? null
			: input.who
	const operation = { actor: explorerActor(input.who), command: 'explore permission', subject: input.explorationId }
	return write(store, { ...operation, input: { who: input.who, tool: input.tool } }, (operationId, at) => {
		const id = nextRequestId(store, input.explorationId)
		const request = { explorationId: input.explorationId, id, who: input.who, tester }
		addEvent(
			store,
			input.explorationId,
			{
				step: requestStep,
				explorer: tester,
				status: 'open',
				detail: {
					id,
					who: input.who,
					tool: input.tool,
					input: shortened(input.input),
					suggestions: input.suggestions,
				},
			},
			operationId,
			at
		)
		const force = ruleInForce(store, input.explorationId, input.suggestions)
		if (force)
			addDecision(
				store,
				request,
				'rule',
				{
					by: 'rule',
					text: `allowed by rule ${force.rule}, set by ${force.setBy}`,
					rule: force.rule,
					setBy: force.setBy,
				},
				operationId,
				at
			)
		return {
			reply: completed(input.explorationId, { id, byRule: Boolean(force) }),
			subjects: [`exploration:${input.explorationId}`],
		}
	}).data as { id: string; byRule: boolean }
}

export type DecideInput = { explorationId: string; requestId: string; decision: string; reason?: string }

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
		command: 'explore permit',
		subject: input.explorationId,
		input: { requestId: input.requestId, decision: choice },
	}
	const reply = write(store, operation, (operationId, at, who) => {
		const request = findPermission(store, input.explorationId, input.requestId)
		requireCondition(
			!request.decision,
			`Permission request ${request.id} of ${request.explorationId} has an answer already: ${request.decision?.text}. Nothing changed.`
		)
		requireCondition(
			(choice !== 'allow-kind' && choice !== 'always') || request.rule,
			`Permission request ${request.id} has no rule that Claude Code can remember. Allow it once, or deny it.`
		)
		const texts: Record<PermissionChoice, string> = {
			allow: 'allowed once',
			'allow-kind': `allowed for this test: ${request.rule}`,
			always: `allowed always in this project: ${request.rule}`,
			deny: `denied: ${reason}`,
			stop: `stopped the ${request.tester ? 'tester' : 'run'}${reason ? `: ${reason}` : ''}`,
		}
		const rule = choice === 'allow-kind' || choice === 'always' ? request.rule : null
		addDecision(
			store,
			request,
			choice,
			{ by: who, text: `${texts[choice]}, by ${who}`, ...(reason ? { reason } : {}), ...(rule ? { rule } : {}) },
			operationId,
			at
		)
		return {
			reply: completed(request.explorationId, { requestId: request.id, decision: choice, who: request.tester }),
			subjects: [`exploration:${request.explorationId}`, `plan:${request.planId}`],
		}
	})
	if (choice === 'stop') stop((reply.data.who as string | null) ?? undefined, reason)
	return reply
}

export function closePermission(store: Store, explorationId: string, requestId: string, cause: ClosedCause) {
	return write(
		store,
		{
			actor: 'checkmate',
			command: 'explore permission-close',
			subject: explorationId,
			input: { requestId, cause },
		},
		(operationId, at) => {
			const request = findPermission(store, explorationId, requestId)
			if (request.decision) return { reply: completed(explorationId, { closed: false }), subjects: [] }
			addDecision(store, request, 'closed', { by: 'checkmate', text: closedText[cause], cause }, operationId, at)
			return {
				reply: completed(explorationId, { closed: true }),
				subjects: [`exploration:${explorationId}`, `plan:${request.planId}`],
			}
		}
	).data.closed as boolean
}

export function closeOpenPermissions(store: Store, cause: ClosedCause) {
	for (const item of openPermissions(store)) closePermission(store, item.explorationId, item.id, cause)
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
	return (
		one(
			store,
			`SELECT 1 FROM exploration_events WHERE exploration_id = ? AND step = 'stop'
			AND (explorer IS NULL OR explorer = ?)
			AND rowid > (SELECT rowid FROM exploration_events WHERE exploration_id = ? AND step = '${requestStep}' AND json_extract(detail, '$.id') = ?)`,
			request.explorationId,
			request.who,
			request.explorationId,
			request.id
		) !== undefined
	)
}
