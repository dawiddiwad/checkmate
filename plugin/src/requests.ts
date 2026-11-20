import type { ModelCost } from './costs.ts'
import { costOf } from './sessions.ts'
import type { Store } from './store.ts'
import type { Harness } from './pi.ts'
import { randomUUID } from 'node:crypto'
import { all, canonical, completed, execute, one, write } from './store.ts'
import { requireText, requireWellFormed, unusedId } from './contracts.ts'

export const requestStates = ['waiting', 'running', 'answered', 'failed', 'stopped', 'interrupted'] as const
export type RequestState = (typeof requestStates)[number]
export type RequestContext = {
	planId: string | null
	record: { kind: string; id: string } | null
	page?: 'plans' | 'runs' | 'activity' | 'chats'
	planRevision?: number
	planChat?: true
}
export type RequestSelection = {
	harness: Harness
	model: string | null
	provider: string | null
	effort: string | null
	modelId: string | null
}
export type RequestChange = { text: string; command: string; subject: string; at: string; href: string | null }
export type RequestRecord = RequestSelection & {
	id: string
	text: string
	context: RequestContext
	asker: string
	conversation: string
	askedAt: string
	state: RequestState
	sessionId: string | null
	activity: Array<{ at: string; line: string }>
	reply: string | null
	observedModels: string[]
	costUsd: number | null
	costPartial: boolean
	costCumulative?: true
	startedAt: string | null
	endedAt: string | null
	reason: string | null
	hint: string | null
	denials: string[]
	changes: RequestChange[]
	read: boolean
}
export type Conversation = { sessionId: string; startedAt: string }

export const maxRequestText = 4000
export const requestAuthor = 'checkmate'
const chatIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const endStates: RequestState[] = ['answered', 'failed', 'stopped', 'interrupted']
const unreadStates: RequestState[] = ['answered', 'failed']

type EventRow = { request_id: string; at: string; step: string; status: string; detail: string }
type AskRow = {
	request_id: string
	text: string
	context: string
	asker: string
	conversation: string
	asked_at: string
	explicit_chat: number | null
}

const askRows = `SELECT r.*, json_type(o.arguments, '$.chatId') = 'null' AS explicit_chat
FROM requests r JOIN operations o ON o.id = r.operation_id`

export function screenText(context: RequestContext) {
	const parts = [
		...(context.planId ? [`plan ${context.planId}${context.planRevision ? `@${context.planRevision}` : ''}`] : []),
		...(context.record ? [`${context.record.kind} ${context.record.id}`] : []),
	]
	return parts.length ? parts.join(' and ') : context.page ? `the ${context.page} page` : null
}

export function requestActor(person: string, requestId: string) {
	return `${person} via request ${requestId}`
}

export function isRequestId(store: Store, id: string) {
	return one(store, 'SELECT 1 FROM requests WHERE request_id = ?', id) !== undefined
}

export function currentConversation(store: Store): Conversation | null {
	const row = one<{ value: string }>(
		store,
		"SELECT value FROM workspace_settings WHERE name = 'conversation' ORDER BY rowid DESC LIMIT 1"
	)
	return row ? (JSON.parse(row.value) as Conversation) : null
}

function insertConversation(store: Store, operationId: string, at: string) {
	const conversation: Conversation = { sessionId: randomUUID(), startedAt: at }
	execute(
		store,
		"INSERT INTO workspace_settings (name, value, operation_id) VALUES ('conversation', ?, ?)",
		canonical(conversation),
		operationId
	)
	return conversation
}

export function startConversation(store: Store, actor: string | undefined) {
	return write(store, { actor, command: 'request conversation', subject: 'conversation', input: null }, (id, at) => ({
		reply: completed('conversation', { ...insertConversation(store, id, at) }),
		subjects: ['requests', 'settings'],
	}))
}

function conversationHarness(store: Store, sessionId: string) {
	const row = one<{ detail: string }>(
		store,
		`SELECT e.detail FROM request_events e JOIN requests r ON r.request_id = e.request_id
		WHERE r.conversation = ? AND (e.step = 'session' OR
			(e.step = 'state' AND e.status = 'waiting' AND json_extract(e.detail, '$.harness') IS NOT NULL))
		ORDER BY e.rowid DESC LIMIT 1`,
		sessionId
	)
	return row ? (JSON.parse(row.detail).harness === 'pi' ? 'pi' : 'claude') : null
}

export function addRequestEvent(
	store: Store,
	requestId: string,
	event: { step: string; status: string; detail: Record<string, unknown> },
	operationId: string,
	at: string
) {
	execute(
		store,
		'INSERT INTO request_events (request_id, at, step, status, detail, operation_id) VALUES (?, ?, ?, ?, ?, ?)',
		requestId,
		at,
		event.step,
		event.status,
		canonical(event.detail),
		operationId
	)
}

export function askRequest(
	store: Store,
	actor: string | undefined,
	input: Partial<RequestSelection> & {
		text: string
		context: RequestContext
		chatId?: string | null
	}
) {
	const text = requireText(input.text, 'request text')
	requireWellFormed(
		text.length <= maxRequestText,
		`The request has more than ${maxRequestText} characters.`,
		'Make the text shorter.'
	)
	return write(store, { actor, command: 'request ask', subject: 'requests', input }, (operationId, at, who) => {
		const requestId = unusedId(
			'R',
			all<{ request_id: string }>(store, 'SELECT request_id FROM requests').map((row) => row.request_id)
		)
		const harness = input.harness ?? 'claude'
		let chatId: string
		let context = input.context
		if (input.chatId) {
			requireWellFormed(chatIdPattern.test(input.chatId), 'Invalid chat ID.')
			const initial = one<AskRow>(
				store,
				`${askRows} WHERE r.conversation = ? ORDER BY r.rowid LIMIT 1`,
				input.chatId
			)
			requireWellFormed(initial, `Unknown chat: ${input.chatId}`)
			chatId = input.chatId
			const original = JSON.parse(initial.context) as RequestContext
			requireWellFormed(
				(!context.planChat && !original.planChat) ||
					(context.planChat === true && Boolean(initial.explicit_chat) && context.planId === original.planId),
				'The chat belongs to a different context.'
			)
			context = original
		} else if (input.chatId === null) {
			validateChatContext(store, context)
			chatId = randomUUID()
		} else {
			requireWellFormed(!context.planChat, 'Start a new chat for the plan.')
			const current = currentConversation(store)
			const previous = current && conversationHarness(store, current.sessionId)
			chatId = (
				current && (!previous || previous === harness) ? current : insertConversation(store, operationId, at)
			).sessionId
		}
		execute(
			store,
			'INSERT INTO requests (request_id, text, context, asker, conversation, asked_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
			requestId,
			text,
			canonical(context),
			who,
			chatId,
			at,
			operationId
		)
		const { model = null, provider = null, effort = null, modelId = null } = input
		addRequestEvent(
			store,
			requestId,
			{ step: 'state', status: 'waiting', detail: { harness, model, provider, effort, modelId } },
			operationId,
			at
		)
		return {
			reply: completed(requestId, { requestId }),
			subjects: [`request:${requestId}`, `chat:${chatId}`, 'requests', 'chats'],
		}
	}).data.requestId as string
}

function validateChatContext(store: Store, context: RequestContext) {
	requireWellFormed(!context.planChat || context.planId, 'A plan chat needs a plan.')
	if (context.page)
		requireWellFormed(['plans', 'runs', 'activity', 'chats'].includes(context.page), 'Unknown chat context page.')
	if (context.planId)
		requireWellFormed(
			one(store, 'SELECT 1 FROM plan_requests WHERE plan_id = ?', context.planId),
			`Unknown plan: ${context.planId}`
		)
	if (context.planRevision !== undefined)
		requireWellFormed(
			context.planId &&
				one(
					store,
					'SELECT 1 FROM plan_revisions WHERE plan_id = ? AND revision = ?',
					context.planId,
					context.planRevision
				),
			`Unknown plan revision: ${context.planId}@${context.planRevision}`
		)
	const { record } = context
	if (!record) return
	const query =
		record.kind === 'run'
			? 'SELECT plan_id, plan_revision FROM runs WHERE run_id = ?'
			: record.kind === 'exploration'
				? 'SELECT plan_id, plan_revision FROM explorations WHERE exploration_id = ?'
				: null
	requireWellFormed(query, `Unknown chat context kind: ${record.kind}`)
	const found = one<{ plan_id: string; plan_revision: number | null }>(store, query, record.id)
	requireWellFormed(found, `Unknown ${record.kind}: ${record.id}`)
	requireWellFormed(!context.planId || found.plan_id === context.planId, 'The chat context has a different plan.')
	requireWellFormed(
		context.planRevision === undefined || found.plan_revision === context.planRevision,
		'The chat context has a different plan revision.'
	)
}

export function recordRequestEvent(
	store: Store,
	requestId: string,
	event: { step: string; status: string; detail: Record<string, unknown> },
	options: { actor?: string; subjects: string[] }
) {
	return write(
		store,
		{
			actor: options.actor ?? requestAuthor,
			command: `request ${event.step}`,
			subject: requestId,
			input: { status: event.status },
		},
		(operationId, at) => {
			addRequestEvent(store, requestId, event, operationId, at)
			return { reply: completed(requestId), subjects: options.subjects }
		}
	)
}

export function setRequestState(
	store: Store,
	requestId: string,
	state: RequestState,
	detail: Record<string, unknown> = {}
) {
	recordRequestEvent(
		store,
		requestId,
		{ step: 'state', status: state, detail },
		{ subjects: [`request:${requestId}`, 'requests'] }
	)
}

export function addRequestActivity(store: Store, requestId: string, line: string) {
	recordRequestEvent(
		store,
		requestId,
		{ step: 'activity', status: 'started', detail: { line } },
		{ subjects: [`request:${requestId}`] }
	)
}

export function markRequestRead(store: Store, actor: string | undefined, requestId: string) {
	return write(store, { actor, command: 'request read', subject: requestId, input: null }, (operationId, at) => {
		addRequestEvent(store, requestId, { step: 'read', status: 'read', detail: {} }, operationId, at)
		return { reply: completed(requestId), subjects: [`request:${requestId}`, 'requests'] }
	})
}

export function requestStopped(store: Store, requestId: string) {
	return one(store, "SELECT 1 FROM request_events WHERE request_id = ? AND step = 'stop'", requestId) !== undefined
}

export function stopRequestRecord(store: Store, actor: string | undefined, requestId: string, reason: string) {
	return write(store, { actor, command: 'request stop', subject: requestId, input: null }, (operationId, at, who) => {
		addRequestEvent(
			store,
			requestId,
			{ step: 'stop', status: 'stopped', detail: { by: who, ...(reason ? { reason } : {}) } },
			operationId,
			at
		)
		return { reply: completed(requestId), subjects: [`request:${requestId}`, 'requests', 'permissions'] }
	})
}

function recordOf(ask: AskRow, events: EventRow[]): RequestRecord {
	const states = events.filter((event) => event.step === 'state')
	const last = states.at(-1)!
	const session = events.findLast((event) => event.step === 'session')
	const recorded = session ? (JSON.parse(session.detail) as { sessionId?: string; harness?: Harness }) : null
	const selection = JSON.parse(states[0].detail) as Partial<RequestSelection>
	const harness = selection.harness ?? recorded?.harness
	const finished = endStates.includes(last.status as RequestState) ? last : null
	const detail = finished ? (JSON.parse(finished.detail) as Record<string, unknown>) : {}
	const listOf = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : [])
	return {
		id: ask.request_id,
		text: ask.text,
		context: JSON.parse(ask.context) as RequestContext,
		asker: ask.asker,
		conversation: ask.conversation,
		harness: harness === 'pi' ? 'pi' : 'claude',
		model: selection.model ?? null,
		provider: selection.provider ?? null,
		effort: selection.effort ?? null,
		modelId:
			selection.modelId ??
			(selection.provider && selection.model ? `${selection.provider}/${selection.model}` : selection.model) ??
			null,
		askedAt: ask.asked_at,
		state: last.status as RequestState,
		sessionId: recorded?.sessionId ?? null,
		activity: events
			.filter((event) => event.step === 'activity')
			.map((event) => ({ at: event.at, line: (JSON.parse(event.detail) as { line: string }).line })),
		reply: typeof detail.reply === 'string' ? detail.reply : null,
		observedModels: listOf<string>(detail.observedModels),
		costUsd:
			typeof detail.costUsd === 'number' && Number.isFinite(detail.costUsd) && detail.costUsd >= 0
				? detail.costUsd
				: null,
		costPartial: detail.costPartial === true,
		...(detail.costScope !== 'turn' && harness !== 'pi' ? { costCumulative: true } : {}),
		startedAt: states.find((event) => event.status === 'running')?.at ?? null,
		endedAt: finished?.at ?? null,
		reason: typeof detail.reason === 'string' ? detail.reason : null,
		hint: typeof detail.hint === 'string' ? detail.hint : null,
		denials: listOf<string>(detail.denials),
		changes: listOf<RequestChange>(detail.changes),
		read: events.some((event) => event.step === 'read'),
	}
}

function eventsByRequest(store: Store, where: string, parameters: string[], activity = true) {
	const found = new Map<string, EventRow[]>()
	for (const row of all<EventRow>(
		store,
		`SELECT request_id, at, step, status, detail FROM request_events WHERE step IN ('state', 'session'${activity ? ", 'activity', 'read'" : ''}) ${where} ORDER BY rowid`,
		...parameters
	)) {
		const list = found.get(row.request_id) ?? []
		list.push(row)
		found.set(row.request_id, list)
	}
	return found
}

export function requestOf(store: Store, requestId: string) {
	const ask = one<AskRow>(store, `${askRows} WHERE r.request_id = ?`, requestId)
	return ask ? recordOf(ask, eventsByRequest(store, 'AND request_id = ?', [requestId]).get(requestId) ?? []) : null
}

export function allRequests(store: Store) {
	const events = eventsByRequest(store, '', [])
	return all<AskRow>(store, `${askRows} ORDER BY r.rowid`).map((ask) =>
		recordOf(ask, events.get(ask.request_id) ?? [])
	)
}

export type Chat = ModelCost & { id: string; planId: string | null; context: RequestContext; turns: RequestRecord[] }

function chatFromTurns(first: AskRow, turns: RequestRecord[]): Chat {
	const sessions = new Set<string>()
	const calls = []
	for (const turn of turns) {
		if (!turn.startedAt) continue
		const repeated = turn.sessionId !== null && sessions.has(turn.sessionId)
		if (turn.harness === 'claude' && turn.sessionId) sessions.add(turn.sessionId)
		if (turn.costUsd === null || (turn.costCumulative && (repeated || !turn.sessionId))) calls.push({})
		else calls.push({ costUsd: turn.costUsd, costPartial: turn.costPartial })
	}
	const { costUsd, costPartial } = costOf(calls)
	const context = turns[0].context
	return {
		id: first.conversation,
		planId: first.explicit_chat ? context.planId : null,
		context,
		turns,
		costUsd: costUsd ?? null,
		costPartial: costPartial ?? false,
	}
}

export function chatOf(store: Store, id: string): Chat | null {
	if (!chatIdPattern.test(id)) return null
	const asks = all<AskRow>(store, `${askRows} WHERE r.conversation = ? ORDER BY r.rowid`, id)
	if (!asks.length) return null
	const events = eventsByRequest(
		store,
		'AND request_id IN (SELECT request_id FROM requests WHERE conversation = ?)',
		[id]
	)
	return chatFromTurns(
		asks[0],
		asks.map((ask) => recordOf(ask, events.get(ask.request_id) ?? []))
	)
}

export function listedChats(store: Store, planId?: string): Chat[] {
	return readChats(store, planId, true)
}

export function planChatsForCosts(store: Store, planId?: string) {
	return readChats(store, planId ?? null, false)
}

function readChats(store: Store, planId: string | null | undefined, activity: boolean): Chat[] {
	const firstAsks = `${askRows}
		WHERE r.rowid IN (SELECT min(rowid) FROM requests GROUP BY conversation)
		AND json_extract(r.context, '$.planId') IS NOT NULL
		AND json_type(o.arguments, '$.chatId') = 'null'${typeof planId !== 'string' ? '' : " AND json_extract(r.context, '$.planId') = ?"}`
	const scoped = planId !== undefined
	const parameters = typeof planId === 'string' ? [planId] : []
	const conversations = `SELECT conversation FROM (${firstAsks})`
	const asks = all<AskRow>(
		store,
		`${askRows}${scoped ? ` WHERE r.conversation IN (${conversations})` : ''} ORDER BY r.rowid`,
		...parameters
	)
	const events = eventsByRequest(
		store,
		scoped ? `AND request_id IN (SELECT request_id FROM requests WHERE conversation IN (${conversations}))` : '',
		parameters,
		activity
	)
	const chats = new Map<string, { first: AskRow; turns: RequestRecord[] }>()
	for (const ask of asks) {
		const chat = chats.get(ask.conversation) ?? { first: ask, turns: [] }
		chat.turns.push(recordOf(ask, events.get(ask.request_id) ?? []))
		chats.delete(ask.conversation)
		chats.set(ask.conversation, chat)
	}
	return [...chats.values()].reverse().map(({ first, turns }) => chatFromTurns(first, turns))
}

export function chatHistory(turns: RequestRecord[]) {
	const entries: string[] = []
	let remaining = 12_000
	for (const turn of turns.slice(-8).reverse()) {
		if (!isEnded(turn)) continue
		const entry = JSON.stringify({
			request: turn.text.slice(0, 2_000),
			state: turn.state,
			reply: turn.reply?.slice(0, 2_000) ?? null,
			changes: turn.changes.slice(0, 10).map((change) => change.text.slice(0, 120)),
		})
		if (entry.length + 1 > remaining) break
		entries.unshift(entry)
		remaining -= entry.length + 1
	}
	return entries.join('\n')
}

export function isUnread(request: RequestRecord) {
	return unreadStates.includes(request.state) && !request.read
}

export function isEnded(request: RequestRecord) {
	return endStates.includes(request.state)
}

export function requestStatus(store: Store) {
	const requests = allRequests(store)
	const unread = requests.filter(isUnread)
	const running = requests.find((request) => request.state === 'running')
	const firstUnread = unread.at(-1)
	return {
		running: running?.id ?? null,
		runningChat: running?.conversation ?? null,
		waiting: requests.filter((request) => request.state === 'waiting').length,
		unread: unread.length,
		firstUnread: firstUnread?.id ?? null,
		firstUnreadChat: firstUnread?.conversation ?? null,
	}
}

export function listedRequests(store: Store) {
	const requests = allRequests(store).reverse()
	return [...requests.filter(isUnread), ...requests.filter((request) => !isUnread(request))]
}

type ChangeRow = { at: string; command: string; arguments: string; subjects: string; subject: string }

const recordPaths: Record<string, string> = {
	plan: '/plans/',
	run: '/runs/',
	exploration: '/explorations/',
	target: '/settings/targets/',
}

function describeChange(command: string, subject: string, input: Record<string, unknown>) {
	const named = (ids: unknown) =>
		Array.isArray(ids) ? ids.map((id) => `${subject}/${String(id)}`).join(', ') : subject
	if (command === 'claim handoff') return `${input.undo ? 'took back' : 'handed over'} ${named(input.claimIds)}`
	if (command === 'gap answer') return `answered ${subject}/${String(input.gapId)}`
	if (command === 'claim accept') return `accepted ${subject}/${String(input.claimId)}`
	if (command === 'claim reject') return `rejected ${subject}/${String(input.claimId)}`
	if (command === 'plan edit') return `edited plan ${subject}`
	if (command === 'plan save') return `saved plan ${subject}`
	if (command === 'plan revise') return `revised plan ${subject}`
	if (command === 'plan open') return `opened plan ${subject}`
	if (command === 'setting set') return `changed the setting ${subject}`
	return `${command} ${subject}`
}

export function operationCountOf(store: Store, requestId: string) {
	return one<{ count: number }>(store, 'SELECT count(*) AS count FROM operations WHERE via = ?', requestId)!.count
}

export function changesOf(store: Store, requestId: string): RequestChange[] {
	return all<ChangeRow>(
		store,
		`SELECT at, command, arguments, subjects, json_extract(response, '$.subject') AS subject
		FROM operations WHERE via = ? AND status = 'completed' ORDER BY rowid`,
		requestId
	).map((row) => {
		const record = (JSON.parse(row.subjects) as string[])
			.map((subject) => /^(plan|run|exploration|target):(.+)$/.exec(subject))
			.find((found) => found)
		const subject = record ? record[2] : row.subject
		return {
			text: describeChange(row.command, subject, JSON.parse(row.arguments) as Record<string, unknown>),
			command: row.command,
			subject,
			at: row.at,
			href: record ? `${recordPaths[record[1]]}${subject}` : null,
		}
	})
}

export function staleRequests(store: Store) {
	for (const request of allRequests(store))
		if (request.state === 'running' || request.state === 'waiting')
			setRequestState(store, request.id, 'interrupted', {
				reason:
					request.state === 'running'
						? 'The UI stopped before the request ended.'
						: 'The UI stopped before the request started.',
			})
}
