import type { Store } from './store.ts'
import { randomUUID } from 'node:crypto'
import { all, canonical, completed, execute, one, write } from './store.ts'
import { requireText, requireWellFormed, unusedId } from './contracts.ts'

export const requestStates = ['waiting', 'running', 'answered', 'failed', 'stopped', 'interrupted'] as const
export type RequestState = (typeof requestStates)[number]
export type RequestContext = { planId: string | null; record: { kind: string; id: string } | null }
export type RequestChange = { text: string; command: string; subject: string; at: string; href: string | null }
export type RequestRecord = {
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
	costUsd: number | null
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
}

export function screenText(context: RequestContext) {
	const parts = [
		...(context.planId ? [`plan ${context.planId}`] : []),
		...(context.record ? [`${context.record.kind} ${context.record.id}`] : []),
	]
	return parts.length ? `${parts.join(', ')}.` : null
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

export function conversationSize(store: Store, sessionId: string) {
	return one<{ count: number }>(store, 'SELECT count(*) AS count FROM requests WHERE conversation = ?', sessionId)!
		.count
}

export function conversationStarted(store: Store, sessionId: string) {
	return (
		one(
			store,
			`SELECT 1 FROM request_events e JOIN requests r ON r.request_id = e.request_id
			WHERE r.conversation = ? AND e.step = 'session'`,
			sessionId
		) !== undefined
	)
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

export function askRequest(store: Store, actor: string | undefined, input: { text: string; context: RequestContext }) {
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
		const conversation = currentConversation(store) ?? insertConversation(store, operationId, at)
		execute(
			store,
			'INSERT INTO requests (request_id, text, context, asker, conversation, asked_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
			requestId,
			text,
			canonical(input.context),
			who,
			conversation.sessionId,
			at,
			operationId
		)
		addRequestEvent(store, requestId, { step: 'state', status: 'waiting', detail: {} }, operationId, at)
		return {
			reply: completed(requestId, { requestId }),
			subjects: [`request:${requestId}`, 'requests'],
		}
	}).data.requestId as string
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
	const finished = endStates.includes(last.status as RequestState) ? last : null
	const detail = finished ? (JSON.parse(finished.detail) as Record<string, unknown>) : {}
	const listOf = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : [])
	return {
		id: ask.request_id,
		text: ask.text,
		context: JSON.parse(ask.context) as RequestContext,
		asker: ask.asker,
		conversation: ask.conversation,
		askedAt: ask.asked_at,
		state: last.status as RequestState,
		sessionId: session ? (JSON.parse(session.detail) as { sessionId: string }).sessionId : null,
		activity: events
			.filter((event) => event.step === 'activity')
			.map((event) => ({ at: event.at, line: (JSON.parse(event.detail) as { line: string }).line })),
		reply: typeof detail.reply === 'string' ? detail.reply : null,
		costUsd: typeof detail.costUsd === 'number' ? detail.costUsd : null,
		startedAt: states.find((event) => event.status === 'running')?.at ?? null,
		endedAt: finished?.at ?? null,
		reason: typeof detail.reason === 'string' ? detail.reason : null,
		hint: typeof detail.hint === 'string' ? detail.hint : null,
		denials: listOf<string>(detail.denials),
		changes: listOf<RequestChange>(detail.changes),
		read: events.some((event) => event.step === 'read'),
	}
}

function eventsByRequest(store: Store, where: string, ...parameters: string[]) {
	const found = new Map<string, EventRow[]>()
	for (const row of all<EventRow>(
		store,
		`SELECT request_id, at, step, status, detail FROM request_events WHERE step IN ('state', 'session', 'activity', 'read') ${where} ORDER BY rowid`,
		...parameters
	)) {
		const list = found.get(row.request_id) ?? []
		list.push(row)
		found.set(row.request_id, list)
	}
	return found
}

export function requestOf(store: Store, requestId: string) {
	const ask = one<AskRow>(store, 'SELECT * FROM requests WHERE request_id = ?', requestId)
	return ask ? recordOf(ask, eventsByRequest(store, 'AND request_id = ?', requestId).get(requestId) ?? []) : null
}

export function allRequests(store: Store) {
	const events = eventsByRequest(store, '')
	return all<AskRow>(store, 'SELECT * FROM requests ORDER BY rowid').map((ask) =>
		recordOf(ask, events.get(ask.request_id) ?? [])
	)
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
	return {
		running: requests.find((request) => request.state === 'running')?.id ?? null,
		waiting: requests.filter((request) => request.state === 'waiting').length,
		unread: unread.length,
		firstUnread: unread.at(-1)?.id ?? null,
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

export function changesOf(store: Store, actor: string): RequestChange[] {
	return all<ChangeRow>(
		store,
		`SELECT at, command, arguments, subjects, json_extract(response, '$.subject') AS subject
		FROM operations WHERE actor = ? AND status = 'completed' ORDER BY rowid`,
		actor
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
