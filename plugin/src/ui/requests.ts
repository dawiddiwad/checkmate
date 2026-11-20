import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { ListSpec } from './lists.ts'
import type { RequestContext, RequestRecord } from '../requests.ts'
import { one } from '../store.ts'
import { listedRequests, operationCountOf, requestOf, isEnded, isUnread } from '../requests.ts'
import { explorationPermissions } from '../permissions.ts'
import { currentConversation, conversationSize } from '../requests.ts'
import { ago, duration, html, pill, plural, time } from './html.ts'
import { crumbBar, emptyNotice, heading } from './layout.ts'
import { listHref, listState, pageTrail, pager } from './lists.ts'
import { failureOf, money } from './activity.ts'
import { requestHref } from './permissions.ts'
import { piErrorText } from '../pi.ts'
import { authenticationFailed, piAuthenticationHint } from '../sessions.ts'

const kinds: Record<string, string> = { c: 'defect', q: 'question', g: 'gap' }
const planPath = /^\/plans\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:@[1-9][0-9]{0,8})?(?:\/|$)/
const recordPaths: Array<[RegExp, string]> = [
	[/^\/explorations\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:\/|$)/, 'run'],
	[/^\/runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:\/|$)/, 'run'],
	[/^\/requests\/(R[1-9][0-9]{0,8})$/, 'request'],
]

export function screenContext(store: Store, address: string): RequestContext {
	let url: URL
	try {
		url = new URL(address, 'http://checkmate.local')
	} catch {
		return { planId: null, record: null }
	}
	const known = (planId: string | undefined) =>
		planId && one(store, 'SELECT 1 FROM plan_requests WHERE plan_id = ?', planId) ? planId : null
	let planId = known(planPath.exec(url.pathname)?.[1])
	let record: RequestContext['record'] = null
	const key = url.searchParams.get('item') ?? url.searchParams.get('at') ?? ''
	const [letter, ...rest] = key.split(':')
	if (planId && kinds[letter] && rest.length) record = { kind: kinds[letter], id: rest.join(':').slice(0, 96) }
	for (const [pattern, kind] of recordPaths) {
		const found = pattern.exec(url.pathname)
		if (!found || record) continue
		record = { kind, id: found[1] }
		if (url.pathname.startsWith('/explorations/'))
			planId = known(
				one<{ plan_id: string }>(store, 'SELECT plan_id FROM explorations WHERE exploration_id = ?', found[1])
					?.plan_id
			)
	}
	return { planId, record }
}

function firstLine(text: string | null) {
	return (text ?? '').trim().split('\n')[0]
}

function blocks(text: string) {
	return text
		.replace(/\r\n?/g, '\n')
		.trim()
		.split(/\n{2,}/)
		.map((block) => {
			const lines = block.split('\n')
			if (lines.every((line) => /^\s*[-*] /.test(line)))
				return html`<ul>
					${lines.map((line) => html`<li>${line.replace(/^\s*[-*] /, '')}</li>`)}
				</ul>`
			if (lines.every((line) => /^\s*\d+[.)] /.test(line)))
				return html`<ol>
					${lines.map((line) => html`<li>${line.replace(/^\s*\d+[.)] /, '')}</li>`)}
				</ol>`
			return html`<p>${lines.map((line, index) => (index ? html`<br />${line}` : line))}</p>`
		})
}

function contextLine(context: RequestContext) {
	if (!context.planId && !context.record) return ''
	return html`<p class="help" data-key="context">
		On screen:
		${context.planId ? html`<a href="/plans/${context.planId}">plan ${context.planId}</a>` : ''}${context.planId && context.record ? ', ' : ''}${context.record ? `${context.record.kind} ${context.record.id}` : ''}.
	</p>`
}

function hidden(name: string, value: string) {
	return html`<input type="hidden" name="${name}" value="${value}" />`
}

function followOption(n: number) {
	return html`<button
		type="button"
		class="sp-btn"
		data-option
		data-ask-follow
		aria-label="${n}: Ask a follow-up"
		title="Ask a follow-up. The conversation goes on."
	>
		<kbd aria-hidden="true">${n}</kbd><span>Ask a follow-up</span>
	</button>`
}

function formOption(
	context: Context,
	action: string,
	n: number,
	label: string,
	hints: Html | string,
	fields: Array<[string, string]>,
	ask?: { title: string; text: string; yes: string }
) {
	const confirm = ask ? html`data-ask-title="${ask.title}" data-ask-text="${ask.text}" data-ask-yes="${ask.yes}"` : ''
	return html`<form method="post" action="${action}" class="sp-opt">
		${hidden('csrf', context.csrf)}${fields.map(([name, value]) => hidden(name, value))}
		<button class="sp-btn" data-option ${confirm} aria-label="${n}: ${label}" title="${hints}">
			<kbd aria-hidden="true">${n}</kbd><span>${label}</span>
		</button>
	</form>`
}

function stateLabel(request: RequestRecord) {
	return pill(request.state)
}

function elapsed(request: RequestRecord, now: number) {
	const start = Date.parse(request.startedAt ?? request.askedAt)
	if (!isEnded(request) && request.state === 'running')
		return html`<span data-since="${request.startedAt}">${duration(Math.max(0, now - start))}</span>`
	const end = request.endedAt ? Date.parse(request.endedAt) : now
	return duration(Math.max(0, end - start))
}

function failureText(request: RequestRecord) {
	if (request.harness === 'pi' && !/No pi executable/.test(request.reason ?? '')) {
		const cause = piErrorText(request.reason) || 'The request failed. No reason is recorded.'
		const authentication =
			request.hint === piAuthenticationHint || authenticationFailed({ failure: ['operational_error', cause] })
		return { cause, lines: [], detail: authentication ? 'Check the provider login in Pi. Then ask again.' : null }
	}
	const [sentence, ...lines] = (request.reason ?? '').split('\n')
	const known = failureOf(request.reason, request.hint, [])
	const cause =
		/No (?:claude|pi) executable|Host authentication/.test(request.reason ?? '') || request.hint
			? `${known.cause} ${known.next}`
			: sentence || 'The request failed. No reason is recorded.'
	return { cause, lines, detail: request.hint ? known.detail : null }
}

export function requestPage(store: Store, context: Context, requestId: string): Page | null {
	const request = requestOf(store, requestId)
	if (!request) return null
	const now = Date.now()
	const open = explorationPermissions(store, requestId).filter((item) => !item.decision)
	const ended = isEnded(request)
	const back = '/requests'
	const asked = [
		['text', request.text],
		['context', JSON.stringify(request.context)],
		['harness', context.harness],
	] as Array<[string, string]>
	const again = formOption(
		context,
		'/requests',
		ended && request.state !== 'failed' ? 2 : 1,
		'Ask again',
		`Send the same text to ${context.harness === 'pi' ? 'Pi' : 'Claude Code'} as a new request.`,
		[...asked, ['return', `/requests/${requestId}`]]
	)
	const options = !ended
		? [
				formOption(
					context,
					`/requests/${requestId}/stop`,
					1,
					'Stop the request…',
					'Ends this request. The conversation goes on with the next request.',
					[],
					{
						title: `Stop request ${requestId}?`,
						text: `Stop this request? You can review any changes it already made.`,
						yes: 'Stop the request',
					}
				),
			]
		: request.state === 'failed'
			? [again]
			: [
					followOption(1),
					again,
					formOption(
						context,
						'/requests/conversation',
						3,
						'New conversation',
						'Start the next request with an empty conversation.',
						[['return', `/requests/${requestId}`]]
					),
				]
	const failure = request.state === 'failed' ? failureText(request) : null
	const tried = ended && !request.changes.length ? operationCountOf(store, requestId) : 0
	return {
		title: `${requestId} · Request`,
		section: null,
		subjects: [`request:${requestId}`, 'requests'],
		crumbs: [
			['Replies', '/requests'],
			[requestId, null],
		],
		back,
		body: html`<div
			class="sp-record"
			data-region="request-record"
			data-drawer
			data-back="${back}"
			data-key="request:${requestId}"
		>
			${crumbBar([['Replies', '/requests']])}
			<section class="sp-dhead" tabindex="-1" data-sub data-label="${requestId}">
				<div class="sp-pills">
					${stateLabel(request)}
					<span class="sp-c-id">${requestId}</span>
					<span class="sp-c-id">${request.harness === 'pi' ? 'Pi' : 'Claude Code'}</span>
					<span class="sp-c-id">${request.asker}</span>
					<span class="sp-c-id">${ago(request.askedAt)}</span>
				</div>
				<h1 id="record-title" class="sp-ask-title">Request ${requestId}</h1>
			</section>
			<section aria-labelledby="asked-title" data-key="asked">
				<h2 class="lab" id="asked-title">You asked</h2>
				<p class="sp-reply sp-asked">${request.text}</p>
				${contextLine(request.context)}
			</section>
			${
				request.state === 'waiting'
					? html`<p class="banner info" role="status" data-key="state">
							This request waits. Another request runs now. It starts when that one ends.
						</p>`
					: ''
			}
			${
				open.length
					? html`<p class="banner warn" role="status" data-key="waits">
							This request waits for you: a permission request.
							<a href="${requestHref(open[0], `/requests/${requestId}`)}">Answer it</a>
						</p>`
					: ''
			}
			${
				request.state === 'running' || request.activity.length
					? html`<section aria-labelledby="activity-title">
							<h2 class="lab" id="activity-title">
								Activity <span class="n">${request.activity.length}</span>
							</h2>
							${
								request.activity.length
									? html`<ol class="sp-activity" aria-live="polite">
											${request.activity.map((entry, index) => html`<li data-key="line:${index}" class="ell" title="${entry.line}">${entry.line}</li>`)}
										</ol>`
									: html`<p class="help">Waiting for the first tool call.</p>`
							}
						</section>`
					: ''
			}
			${
				request.state === 'running' || request.state === 'waiting'
					? html`<p class="help" data-key="elapsed">
							${request.state === 'running' ? html`Running for ${elapsed(request, now)}.` : ''}
						</p>`
					: ''
			}
			${
				request.state === 'answered'
					? html`<section aria-labelledby="reply-title" data-key="reply">
							<h2 class="lab" id="reply-title">Reply</h2>
							<div class="sp-reply">
								${request.reply?.trim() ? blocks(request.reply) : html`<p class="muted">The reply has no text.</p>`}
							</div>
						</section>`
					: ''
			}
			${
				failure
					? html`<section aria-labelledby="failed-title" data-key="failure">
							<h2 class="lab" id="failed-title">What went wrong</h2>
							<p class="banner fail" role="alert">${failure.cause}</p>
							${failure.detail ? html`<p class="help">${failure.detail}</p>` : ''}
							${failure.lines.length ? html`<pre class="sp-code" tabindex="0">${failure.lines.join('\n')}</pre>` : ''}
						</section>`
					: ''
			}
			${
				request.state === 'stopped' || request.state === 'interrupted'
					? html`<p class="banner info" role="status" data-key="state">${request.reason ?? ''}</p>`
					: ''
			}
			${
				ended
					? html`<p class="help" data-key="took">
							${request.costUsd === null ? '' : `Cost ${money(request.costUsd)}. `}Took
							${elapsed(request, now)}.
						</p>`
					: ''
			}
			${
				ended && request.denials.length
					? html`<p class="help" data-key="denials">
							${plural(request.denials.length, 'tool call was', 'tool calls were')} denied:
							${request.denials.join(', ')}.
						</p>`
					: ''
			}
			${
				ended
					? html`<section aria-labelledby="changes-title" data-key="changes">
							<h2 class="lab" id="changes-title">
								Changed <span class="n">${request.changes.length}</span>
							</h2>
							${
								request.changes.length
									? html`<ul class="sp-changes">
											${request.changes.map((change) => html`<li>${change.href ? html`<a href="${change.href}">${change.text}</a>` : change.text} <span class="muted">${time(change.at)}</span></li>`)}
										</ul>`
									: tried
										? html`<p class="help">
												The Log has ${plural(tried, 'write')} of the request. The request has no
												completed change.
											</p>`
										: html`<p class="help">The request changed no record.</p>`
							}
						</section>`
					: request.state === 'running'
						? html`<p class="help" data-key="changes">Changes show when the request ends.</p>`
						: ''
			}
			<section class="sp-options" aria-labelledby="options-title" data-key="options:${requestId}">
				<h2 class="lab" id="options-title">Options</h2>
				<ol class="sp-optlist asks">
					${options.map((option) => html`<li>${option}</li>`)}
				</ol>
			</section>
		</div>`,
	}
}

const spec: ListSpec = {
	path: '/requests',
	region: 'replies',
	noun: 'request',
	search: '',
	columns: [],
	sort: '',
	direction: 'desc',
	filters: [],
	none: ['No request yet.', 'Press / and type a request. Choose Ask Checkmate.'],
}

function row(request: RequestRecord, n: number) {
	const reply = request.state === 'answered' ? firstLine(request.reply) : firstLine(request.reason) || ''
	const meta = [request.asker, request.askedAt, request.costUsd === null ? null : money(request.costUsd)]
		.filter(Boolean)
		.join(' · ')
	const title = `${firstLine(request.text)}${reply ? ` · ${reply}` : ''}`
	return html`<div
		class="sp-row"
		role="option"
		aria-selected="false"
		tabindex="-1"
		id="reply-${n}"
		data-row
		data-key="request:${request.id}"
		data-href="/requests/${request.id}"
		data-label="${request.id}"
	>
		<span class="sp-c-cb"></span>
		<span class="sp-c-tag">${stateLabel(request)}</span>
		<span class="sp-c-id" title="${request.id}">${request.id}</span>
		<span class="sp-c-title ell" title="${request.text}${reply ? `\n${reply}` : ''}">${title}</span>
		<span class="sp-c-meta ell" title="${meta}"
			>${request.asker} ·
			${time(request.askedAt)}${request.costUsd === null ? '' : ` · ${money(request.costUsd)}`}</span
		>
	</div>`
}

export function repliesPage(store: Store, params: URLSearchParams): Page {
	const state = listState(params, spec)
	const requests = listedRequests(store)
	const last = Math.max(1, Math.ceil(requests.length / state.size))
	const shown = { ...state, page: Math.min(state.page, last) }
	const rows = requests.slice((shown.page - 1) * shown.size, shown.page * shown.size)
	const unread = rows.filter(isUnread)
	const earlier = rows.filter((request) => !isUnread(request))
	let n = 0
	const group = (label: string, items: RequestRecord[]) =>
		items.length
			? html`<div class="sp-gh" role="presentation">${label} <span>${items.length}</span></div>
					${items.map((request) => row(request, n++))}`
			: ''
	const total = requests.length
	const unreadTotal = requests.filter(isUnread).length
	const first = total ? (shown.page - 1) * shown.size + 1 : 0
	const end = Math.min(total, shown.page * shown.size)
	return {
		title: 'Replies',
		section: null,
		subjects: ['requests'],
		address: listHref(spec, shown),
		...pageTrail(spec, shown, total, 'Replies'),
		body: html`${heading('Replies', unreadTotal ? `${plural(unreadTotal, 'reply', 'replies')} not read yet.` : 'Every request and its reply.')}
			<div data-region="replies" data-list-region>
				<p class="list-count" data-list-count role="status">
					${total ? `Showing ${first}–${end} of ${plural(total, 'request')}` : ''}
				</p>
				${
					total
						? html`<div class="sp-list activity" role="listbox" aria-label="Requests" data-list>
									${group('Not read', unread)}${group('Earlier', earlier)}
								</div>
								${pager(spec, shown, total)}`
						: emptyNotice(spec.none[0], spec.none[1])
				}
			</div>`,
	}
}

export function conversationText(store: Store) {
	const conversation = currentConversation(store)
	if (!conversation) return 'No conversation yet. The next request starts one.'
	const count = conversationSize(store, conversation.sessionId)
	return html`Conversation started ${ago(conversation.startedAt)}, ${plural(count, 'request')}.`
}
