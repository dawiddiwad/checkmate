import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { RequestContext, RequestRecord } from '../requests.ts'
import { one } from '../store.ts'
import { isEnded, operationCountOf } from '../requests.ts'
import { explorationPermissions } from '../permissions.ts'
import { ago, costText, duration, html, pill, plural, time } from './html.ts'
import { crumbBar } from './layout.ts'
import { failureOf } from './activity.ts'
import { requestHref } from './permissions.ts'
import { piErrorText } from '../pi.ts'
import { authenticationFailed, piAuthenticationHint } from '../sessions.ts'
import { chatMarkdown } from './markdown.ts'

const kinds: Record<string, string> = { c: 'defect', q: 'question', g: 'gap' }
const planPath = /^\/plans\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:@[1-9][0-9]{0,8})?(?:\/|$)/
const recordPaths: Array<[RegExp, string]> = [
	[/^\/explorations\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:\/|$)/, 'run'],
	[/^\/runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:\/|$)/, 'run'],
	[/^\/requests\/(R[1-9][0-9]{0,8})$/, 'request'],
]

export function screenContext(store: Store, address: string, chat = false): RequestContext {
	let url: URL
	try {
		url = new URL(address, 'http://checkmate.local')
	} catch {
		return { planId: null, record: null }
	}
	const known = (planId: string | undefined) =>
		planId && one(store, 'SELECT 1 FROM plan_requests WHERE plan_id = ?', planId) ? planId : null
	let planId = known(planPath.exec(url.pathname)?.[1])
	if (chat) {
		if (url.origin !== 'http://checkmate.local') return { planId: null, record: null }
		if (url.pathname === '/' || url.pathname === '/plans') return { planId: null, record: null, page: 'plans' }
		if (url.pathname === '/runs' || url.pathname === '/activity')
			return { planId: null, record: null, page: url.pathname === '/runs' ? 'runs' : 'activity' }
		const run = /^\/(runs|explorations)\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})$/.exec(url.pathname)
		if (run) {
			const [, section, id] = run
			const record =
				section === 'runs'
					? one<{ plan_id: string; plan_revision: number }>(
							store,
							'SELECT plan_id, plan_revision FROM runs WHERE run_id = ?',
							id
						)
					: one<{ plan_id: string; plan_revision: number | null }>(
							store,
							'SELECT plan_id, plan_revision FROM explorations WHERE exploration_id = ?',
							id
						)
			return {
				planId: record?.plan_id ?? null,
				record: record ? { kind: section === 'runs' ? 'run' : 'exploration', id } : null,
				...(record?.plan_revision ? { planRevision: record.plan_revision } : {}),
			}
		}
		const revision = /^\/plans\/[^/@]+@([1-9]\d{0,8})(?:\/|$)/.exec(url.pathname)
		const planRevision =
			planId && revision
				? one<{ revision: number }>(
						store,
						'SELECT revision FROM plan_revisions WHERE plan_id = ? AND revision = ?',
						planId,
						Number(revision[1])
					)?.revision
				: undefined
		return { planId, record: null, ...(planRevision ? { planRevision } : {}) }
	}
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

function contextLine(context: RequestContext) {
	if (!context.planId && !context.record) return ''
	const plan = context.planRevision ? `${context.planId}@${context.planRevision}` : context.planId
	const record = context.record
	return html`<p class="help" data-key="context">
		Started from
		${plan ? html`<a href="/plans/${plan}">plan ${plan}</a>` : ''}${plan && record ? ', ' : ''}${record ? `${record.kind === 'request' ? 'chat turn' : record.kind} ${record.id}` : ''}.
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
	return request.state === 'answered' ? '' : pill(request.state)
}

function elapsed(request: RequestRecord, now: number) {
	const start = Date.parse(request.startedAt ?? request.askedAt)
	if (!isEnded(request) && request.state === 'running')
		return html`<span data-since="${request.startedAt}">${duration(Math.max(0, now - start))}</span>`
	const end = request.endedAt ? Date.parse(request.endedAt) : now
	return duration(Math.max(0, end - start))
}

export function failureText(request: RequestRecord) {
	if (request.harness === 'pi' && !/No pi executable/.test(request.reason ?? '')) {
		const cause = piErrorText(request.reason) || 'The message failed. No reason is recorded.'
		const authentication =
			request.hint === piAuthenticationHint || authenticationFailed({ failure: ['operational_error', cause] })
		return { cause, lines: [], detail: authentication ? 'Check the provider login in Pi. Then ask again.' : null }
	}
	const [sentence, ...lines] = (request.reason ?? '').split('\n')
	const known = failureOf(request.reason, request.hint, [])
	const cause =
		/No (?:claude|pi) executable|Host authentication/.test(request.reason ?? '') || request.hint
			? `${known.cause} ${known.next}`
			: sentence || 'The message failed. No reason is recorded.'
	return { cause, lines, detail: request.hint ? known.detail : null }
}

export function chatMessagePage(store: Store, context: Context, request: RequestRecord): Page {
	const requestId = request.id
	const now = Date.now()
	const open = explorationPermissions(store, requestId).filter((item) => !item.decision)
	const ended = isEnded(request)
	const { planId, planRevision, planChat } = request.context
	const plan = planChat ? `/plans/${planId}${planRevision ? `@${planRevision}` : ''}` : null
	const chat = plan ? `${plan}?chat=${request.conversation}` : `/chats/${request.conversation}`
	const back = `${chat}${plan ? '&' : '?'}at=${encodeURIComponent(`request:${requestId}`)}`
	const details = `/chats/${request.conversation}/messages/${requestId}`
	const again = formOption(
		context,
		plan ? `${plan}/chats/${request.conversation}/turns` : `${chat}/turns`,
		request.state === 'failed' ? 1 : 2,
		'Ask again',
		'Send this message again in the same chat.',
		[
			['text', request.text],
			['return', chat],
		]
	)
	const options = !ended
		? [
				formOption(
					context,
					`/requests/${requestId}/stop`,
					1,
					'Stop this turn…',
					'Stop work on this message.',
					[['return', context.path.startsWith('/chats/') ? details : `/requests/${requestId}`]],
					{
						title: 'Stop this turn?',
						text: 'You can review any changes it already made.',
						yes: 'Stop this turn',
					}
				),
			]
		: request.state === 'failed'
			? [again]
			: [followOption(1), again]
	const failure = request.state === 'failed' ? failureText(request) : null
	const tried = ended && !request.changes.length ? operationCountOf(store, requestId) : 0
	return {
		title: 'Message details',
		section: 'chats',
		subjects: [`request:${requestId}`, 'requests'],
		crumbs: [
			['Chats', '/chats'],
			['Chat', back],
			['Message details', null],
		],
		back,
		body: html`<div
			class="sp-record"
			data-region="request-record"
			data-drawer
			data-back="${back}"
			data-chat-back="${chat}"
			data-key="request:${requestId}"
		>
			${crumbBar([
				['Chats', '/chats'],
				['Chat', back],
			])}
			<section class="sp-dhead" tabindex="-1" data-sub data-label="Message details">
				<div class="sp-pills">
					${stateLabel(request)}
					<span class="sp-c-id">${request.harness === 'pi' ? 'Pi' : 'Claude Code'}</span>
					<span class="sp-c-id">${request.asker}</span>
					<span class="sp-c-id">${ago(request.askedAt)}</span>
				</div>
				<h1 id="record-title" class="sp-ask-title">Message details</h1>
			</section>
			<section aria-labelledby="asked-title" data-key="asked">
				<h2 class="lab" id="asked-title">You asked</h2>
				<p class="sp-reply sp-asked">${request.text}</p>
				${contextLine(request.context)}
			</section>
			${
				request.state === 'waiting'
					? html`<p class="banner info" role="status" data-key="state">
							This message will start when the current turn ends.
						</p>`
					: ''
			}
			${
				open.length
					? html`<p class="banner warn" role="status" data-key="waits">
							This turn is waiting for permission.
							<a href="${requestHref(open[0], context.path)}">Answer it</a>
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
							<div class="sp-reply chat-markdown">
								${request.reply?.trim() ? chatMarkdown(request.reply) : html`<p class="muted">The reply has no text.</p>`}
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
							${request.costUsd === null ? '' : `Cost ${costText(request.costUsd, request.costPartial)}. `}Took
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
												The Log shows ${plural(tried, 'attempted change')} for this turn.
											</p>`
										: html`<p class="help">This turn changed no records.</p>`
							}
						</section>`
					: request.state === 'running'
						? html`<p class="help" data-key="changes">Changes appear when this turn ends.</p>`
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
