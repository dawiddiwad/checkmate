import type { Store } from '../store.ts'
import type { RequestContext, RequestRecord } from '../requests.ts'
import { one } from '../store.ts'
import { isEnded } from '../requests.ts'
import { piErrorText } from '../pi.ts'
import { authenticationFailed, piAuthenticationHint } from '../sessions.ts'
import type { Context } from './layout.ts'
import { failureOf } from './activity.ts'
import { button } from './components/button.ts'
import { statusMark } from './components/status-mark.ts'
import { duration, html } from './html.ts'

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

export function contextLine(context: RequestContext) {
	if (!context.planId && !context.record) return ''
	const plan = context.planRevision ? `${context.planId}@${context.planRevision}` : context.planId
	const record = context.record
	return html`<p class="sc-help" data-key="context">
		Started from
		${plan ? html`<a href="/plans/${plan}">plan ${plan}</a>` : ''}${plan && record ? ', ' : ''}${record ? `${record.kind === 'request' ? 'chat turn' : record.kind} ${record.id}` : ''}.
	</p>`
}

function hidden(name: string, value: string) {
	return html`<input type="hidden" name="${name}" value="${value}" />`
}

export function followOption(n: number) {
	return button({
		label: 'Ask a follow-up',
		keyName: n,
		keySpoken: false,
		attrs: {
			type: 'button',
			'data-option': true,
			'data-ask-follow': true,
			'aria-label': `${n}: Ask a follow-up`,
			title: 'Ask a follow-up. The conversation goes on.',
		},
	})
}

export function formOption(
	context: Context,
	action: string,
	n: number,
	label: string,
	hints: string,
	fields: Array<[string, string]>,
	ask?: { title: string; text: string; yes: string }
) {
	const confirm = ask ? { 'data-ask-title': ask.title, 'data-ask-text': ask.text, 'data-ask-yes': ask.yes } : {}
	return html`<form method="post" action="${action}" class="sc-opt-form">
		${hidden('csrf', context.csrf)}${fields.map(([name, value]) => hidden(name, value))}
		${button({
			label,
			keyName: n,
			keySpoken: false,
			attrs: { 'data-option': true, ...confirm, 'aria-label': `${n}: ${label}`, title: hints },
		})}
	</form>`
}

export function stateLabel(request: RequestRecord) {
	return request.state === 'answered' ? '' : statusMark({ state: request.state })
}

export function elapsed(request: RequestRecord, now: number) {
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

export function requestModelLabel(request: RequestRecord) {
	return request.observedModels.length
		? request.observedModels.join(', ')
		: [request.provider, request.model].filter(Boolean).join('/')
}
