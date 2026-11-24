import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { ForceRule, Permission } from '../permissions.ts'
import { closedText, explorationPermissions, openPermissions, permissionOf, permissionRules } from '../permissions.ts'
import { ago, duration, glyph, html, pill, plural, time } from './html.ts'
import { crumbBar, heading } from './layout.ts'
import { inputLine } from './hooks.ts'
import { requestOf } from '../requests.ts'

export type PermissionRefusal = { error: string; reason: string; field: 'reason' | null }

const verbs: Record<string, string> = {
	Bash: 'run',
	Read: 'read',
	Write: 'write',
	Edit: 'edit',
	MultiEdit: 'edit',
	NotebookEdit: 'edit',
	NotebookRead: 'read',
	Glob: 'find files',
	Grep: 'search',
	WebFetch: 'fetch',
	WebSearch: 'search the web',
}

const shownLines = 40
const historySize = 20

export function asksFor(item: Permission) {
	const line = inputLine(item.input, item.cwd ?? undefined)
	const verb = verbs[item.tool] ?? `use ${item.tool}`
	return line ? `${verb}: ${line}` : verb
}

function askerPath(store: Store, item: Permission) {
	if (!item.fromRequest) return { label: 'Run', href: `/explorations/${item.askerId}`, fallback: '/activity' }
	const message = requestOf(store, item.askerId)
	const href = message ? `/chats/${message.conversation}` : '/chats'
	return { label: 'Chat', href, fallback: href }
}

const things: Record<string, string> = {
	Bash: 'run a command',
	Read: 'read a file',
	Write: 'write a file',
	Edit: 'edit a file',
	MultiEdit: 'edit a file',
	NotebookEdit: 'edit a notebook',
	NotebookRead: 'read a notebook',
	Glob: 'find files',
	Grep: 'search files',
	WebFetch: 'fetch a web page',
	WebSearch: 'search the web',
}

export function askerName(item: Permission) {
	if (item.fromRequest) return `Chat message ${item.askerId}`
	if (item.tester) return `Tester ${item.who}`
	if (item.who.startsWith('record-')) return `The recorder of ${item.who.slice('record-'.length)}`
	return `Step ${item.who}`
}

export function askTitle(item: Permission) {
	return `${askerName(item)} asks to ${asksFor(item)}`
}

export function askHeading(item: Permission) {
	return `${askerName(item)} asks to ${things[item.tool] ?? `use ${item.tool}`}`
}

function breakAtSlashes(path: string) {
	return path.split('/').map((part, index) => (index ? html`/<wbr />${part}` : part))
}

export function requestName(item: Pick<Permission, 'askerId' | 'id'>) {
	return `${item.askerId}/${item.id}`
}

export function recordPath(item: Pick<Permission, 'askerId' | 'id'>) {
	return `/permissions/${requestName(item)}`
}

export function requestHref(item: Pick<Permission, 'askerId' | 'id'>, from: string | null, history = false) {
	const params = new URLSearchParams()
	if (from) params.set('from', from)
	if (history) params.set('view', 'history')
	const query = params.toString()
	return query ? `${recordPath(item)}?${query}` : recordPath(item)
}

export function waitsFor(item: Permission) {
	return html`waits <span data-since="${item.at}">${duration(Math.max(0, Date.now() - Date.parse(item.at)))}</span>`
}

export function nextOpen(store: Store, after: Pick<Permission, 'askerId' | 'id'> | null) {
	const open = openPermissions(store).filter((item) => !after || requestName(item) !== requestName(after))
	return open[0] ?? null
}

type Choice = {
	decision: string
	label: string
	text: Html | string
	reveal?: string
	ask?: { title: string; text: string; yes: string }
}

function choicesOf(item: Permission): Choice[] {
	const kind = item.tool.toLowerCase() === 'bash' ? 'command' : 'kind of call'
	const run = item.askerId
	const rule = item.rule
	const chat = item.fromRequest
	const scope = chat ? 'chat' : 'test'
	const everyone = chat ? 'later messages in this chat using the same harness' : 'any tester of this run'
	const where = chat ? `message ${run}` : `run ${run}`
	const ends = chat ? 'The rule applies only to this chat.' : 'The rule ends with the run.'
	return [
		{ decision: 'allow', label: 'Allow once', text: 'Answers this request with yes. Checkmate stores no rule.' },
		...(rule
			? [
					{
						decision: 'allow-kind',
						label: `Allow this ${kind} for this ${scope}`,
						text: html`Answers yes now and for every later permission request with the rule
							<code>${rule}</code>, from ${everyone}. Checkmate stores the rule in the record of ${where}.
							${ends}`,
					},
				]
			: []),
		{
			decision: 'allow-tool',
			label: `Allow every ${item.tool} call for this ${scope}`,
			text: `Answers yes now and for every later ${item.tool} call of ${everyone}, whatever the input. Checkmate stores the rule in the record of ${where}. ${ends}`,
		},
		...(rule
			? [
					{
						decision: 'always',
						label: `Always allow this ${kind} in this project`,
						text: html`Answers yes now. Claude Code writes the rule <code>${rule}</code> to
							<code>.claude/settings.local.json</code> of the project, and the rule stays after this
							${chat ? 'chat' : 'run'}. Checkmate writes no settings file.`,
					},
				]
			: []),
		{
			decision: 'deny',
			label: 'Deny…',
			reveal: 'deny',
			text: `Answers no. You write the reason first, and the tool receives your reason.`,
		},
		stopChoice(item),
	]
}

function stopChoice(item: Permission): Choice {
	const run = item.askerId
	if (item.fromRequest)
		return {
			decision: 'stop',
			label: 'Stop the reply…',
			ask: {
				title: `Stop the reply to message ${run}?`,
				text: `Checkmate denies this call and stops the reply. You can send another message in the chat.`,
				yes: 'Stop the reply',
			},
			text: `Answers no and stops the reply to message ${run}. You confirm first.`,
		}
	return {
		decision: 'stop',
		label: item.tester ? `Stop tester ${item.who}…` : 'Stop the run…',
		ask: {
			title: item.tester ? `Stop tester ${item.who}?` : 'Stop the run?',
			text: item.tester
				? `Checkmate denies this call and ends tester ${item.who}. The other testers go on.`
				: `Checkmate denies this call and stops the whole run ${run}.`,
			yes: item.tester ? `Stop tester ${item.who}` : 'Stop the run',
		},
		text: item.tester
			? `Answers no and ends tester ${item.who}. The other testers go on. You confirm first.`
			: `Answers no and stops the whole run ${run}. You confirm first.`,
	}
}

export function optionCount(item: Permission) {
	return choicesOf(item).length
}

function hidden(name: string, value: string) {
	return html`<input type="hidden" name="${name}" value="${value}" />`
}

export function rowOptions(context: Context, item: Permission, returnTo: string) {
	return html`<div
		class="sp-c-opts asks"
		aria-label="Options"
		title="${plural(optionCount(item), 'option')}. Open the request to see them."
	>
		<form method="post" action="${recordPath(item)}" class="sp-opt">
			${hidden('csrf', context.csrf)}${hidden('return', returnTo)}${hidden('decision', 'allow')}
			<button class="sp-btn" data-option aria-label="1: Allow once" title="Allow once">
				<kbd aria-hidden="true">1</kbd><span>Allow once</span>
			</button>
		</form>
		<span class="sp-c-more" aria-hidden="true">${glyph('→')} more</span>
	</div>`
}

export function askBadge() {
	return html`<span class="sp-pill amber">ASKS</span>`
}

export function askingPill() {
	return html`<span class="sp-pill amber"><span class="dot" aria-hidden="true"></span>Asks</span>`
}

function optionOf(context: Context, item: Permission, from: string | null, choice: Choice, n: number) {
	const key = html`<kbd aria-hidden="true">${n}</kbd><span>${choice.label}</span>`
	if (choice.reveal)
		return html`<button
			type="button"
			class="sp-btn"
			data-option
			data-reveal="${choice.reveal}"
			aria-label="${n}: ${choice.label}"
			title="${choice.label}"
		>
			${key}
		</button>`
	const ask = choice.ask
		? html`data-ask-title="${choice.ask.title}" data-ask-text="${choice.ask.text}" data-ask-yes="${choice.ask.yes}"`
		: ''
	return html`<form method="post" action="${recordPath(item)}" class="sp-opt">
		${hidden('csrf', context.csrf)}${from ? hidden('from', from) : ''}${hidden('decision', choice.decision)}
		<button class="sp-btn" data-option ${ask} aria-label="${n}: ${choice.label}" title="${choice.label}">
			${key}
		</button>
	</form>`
}

function cut(text: string) {
	const lines = text.split('\n')
	const more = lines.length - shownLines
	return more > 0 ? `${lines.slice(0, shownLines).join('\n')}\n… ${plural(more, 'more line')}` : text
}

function edits(input: Record<string, unknown>) {
	const list = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [input]
	return list
		.flatMap((edit) => [
			...String(edit.old_string ?? '')
				.split('\n')
				.map((line) => `- ${line}`),
			...String(edit.new_string ?? edit.new_source ?? '')
				.split('\n')
				.map((line) => `+ ${line}`),
		])
		.join('\n')
}

function asked(item: Permission) {
	const input = item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {}
	const path = ['file_path', 'notebook_path', 'path']
		.map((key) => input[key])
		.find((value) => typeof value === 'string')
	const block = (label: string, text: string) =>
		html`<p class="sp-lbl">${label}</p>
			<pre class="sp-code" tabindex="0">${text}</pre>`
	if (typeof input.command === 'string') return block('Command', input.command)
	if (typeof path === 'string') {
		const body =
			item.tool === 'Write' && typeof input.content === 'string'
				? block('Content', cut(input.content))
				: item.tool === 'Edit' || item.tool === 'MultiEdit' || item.tool === 'NotebookEdit'
					? block('Change', cut(edits(input)))
					: ''
		return html`<p class="sp-lbl">File</p>
			<pre class="sp-code" tabindex="0">${path}</pre>
			${body}`
	}
	return block('Input', JSON.stringify(item.input, null, 2))
}

export function rulesLines(rules: ForceRule[], scope = 'test') {
	return rules.map(
		(rule) =>
			html`<p class="help" data-key="rule:${rule.requestId}">
				Allowed for this ${scope}:
				${rule.kind === 'allow-tool' ? `every ${rule.rule} call` : html`<code>${rule.rule}</code>`}, set by
				${rule.setBy} ${ago(rule.at)}.
			</p>`
	)
}

function stateOf(item: Permission) {
	const decision = item.decision!
	if (decision.kind === 'closed')
		return html`<strong>Closed ${ago(decision.at)}:</strong> ${closedText[decision.cause!]}.
			${decision.cause === 'timeout' ? 'The tool call was denied.' : ''}`
	if (decision.kind === 'rule')
		return html`<strong>Answered ${ago(decision.at)} by a rule:</strong> ${decision.text}.`
	return html`<strong>Answered ${ago(decision.at)}:</strong> ${decision.text}.`
}

function stateText(item: Permission) {
	const decision = item.decision!
	return decision.kind === 'closed' ? `Closed: ${closedText[decision.cause!]}.` : `Answered: ${decision.text}.`
}

export function permissionPage(
	store: Store,
	context: Context,
	askerId: string,
	requestId: string,
	view: { from: string | null; history: boolean },
	refusal: PermissionRefusal | null
): Page | null {
	const item = permissionOf(store, askerId, requestId)
	if (!item) return null
	const { from } = view
	const asker = askerPath(store, item)
	const back = from ?? asker.fallback
	const moves = item.decision && !view.history
	const next = nextOpen(store, item)
	const after = next ? requestHref(next, from) : back
	const name = requestName(item)
	const rules = permissionRules(store, askerId)
	const choices = item.decision ? [] : choicesOf(item)
	const title = askHeading(item)
	return {
		title: `${name} · Permission request`,
		section: 'home',
		subjects: [
			item.fromRequest ? `request:${askerId}` : `exploration:${askerId}`,
			...(item.planId ? [`plan:${item.planId}`] : []),
		],
		crumbs: [
			['Plans', '/'],
			...(item.planId ? [[item.planId, `/plans/${item.planId}`] as [string, string]] : []),
			[askerId, asker.href] as [string, string],
			[item.id, null],
		],
		back,
		status: refusal ? 422 : 200,
		body: html`<div
			class="sp-record"
			data-region="permission-record"
			data-drawer
			data-back="${back}"
			data-key="record:${name}"
			data-decided-message="${item.decision ? stateText(item) : ''}"
			${moves ? html`data-moves-on data-next="${after}"` : ''}
		>
			${crumbBar([...(item.planId ? [[item.planId, `/plans/${item.planId}`] as [string, string]] : []), [askerId, asker.href]])}
			<div data-stale-slot>
				${refusal && !refusal.field ? html`<p class="form-error" role="alert">${refusal.error}</p>` : ''}
			</div>
			<section class="sp-dhead" tabindex="-1" data-sub data-label="${name}">
				<div class="sp-pills">
					${item.decision ? pill(item.decision.kind === 'closed' ? 'stopped' : 'completed', item.decision.kind === 'closed' ? 'Closed' : 'Answered') : askBadge()}
					<span class="sp-c-id">${name}</span>
					<span class="sp-c-id">${item.decision ? ago(item.at) : waitsFor(item)}</span>
				</div>
				<h1 id="record-title" class="sp-ask-title" title="${title}">${title}</h1>
			</section>
			${
				item.decision
					? html`<p class="banner info" role="status" data-key="state">
							${stateOf(item)}
							${
								moves
									? html`This view moves on in 2 seconds. Press any key to move on now.`
									: html`This request has no options now.`
							}
						</p>`
					: ''
			}
			<section aria-labelledby="asked-title">
				<h2 class="lab" id="asked-title">What it asks</h2>
				${asked(item)}
			</section>
			${
				choices.length
					? html`<section class="sp-options" aria-labelledby="options-title" data-key="options:${name}">
							<h2 class="lab" id="options-title">Options</h2>
							<ol class="sp-optlist asks">
								${choices.map((choice, index) => html`<li>${optionOf(context, item, from, choice, index + 1)}<span class="help">${choice.text}</span></li>`)}
							</ol>
							<div class="sp-c-extra" data-extra="deny" ${refusal?.field ? '' : html`hidden`}>
								<form
									method="post"
									action="${recordPath(item)}"
									class="sp-form"
									id="deny"
									data-field-form
								>
									${hidden('csrf', context.csrf)}${from ? hidden('from', from) : ''}${hidden('decision', 'deny')}
									<label for="deny-text">Why do you deny it? The tester gets this text.</label>
									<textarea
										id="deny-text"
										name="reason"
										rows="3"
										required
										data-missing="Write the reason first. The tester gets it."
									>
${refusal?.reason ?? ''}</textarea>
									${refusal?.field ? html`<p class="form-error" role="alert" data-field="reason">${refusal.error}</p>` : ''}
									<div class="btns">
										<button class="sp-btn pri"><span>Deny</span></button>
										<span class="small muted"
											>Enter sends. Shift+Enter starts a new line. Esc keeps the draft.</span
										>
									</div>
								</form>
							</div>
						</section>`
					: ''
			}
			<section aria-labelledby="details-title">
				<h2 class="lab" id="details-title">Details</h2>
				<dl class="facts">
					<dt>Tool</dt>
					<dd class="mono">${item.tool}</dd>
					<dt>Folder</dt>
					<dd class="path">
						${item.cwd ? html`<code>${breakAtSlashes(item.cwd)}</code>` : html`<span class="muted">not recorded</span>`}
					</dd>
					<dt>Asked by</dt>
					<dd>${askerName(item)}</dd>
					<dt>Since</dt>
					<dd>${time(item.at)}</dd>
					<dt>${asker.label}</dt>
					<dd><a href="${asker.href}">${askerId}</a></dd>
					${
						item.planId
							? html`<dt>Plan</dt>
									<dd><a href="/plans/${item.planId}">${item.planId}</a></dd>`
							: ''
					}
				</dl>
			</section>
			${
				rules.length
					? html`<section aria-labelledby="rules-title">
							<h2 class="lab" id="rules-title">Rules of this ${item.fromRequest ? 'chat' : 'test'}</h2>
							${rulesLines(rules, item.fromRequest ? 'chat' : 'test')}
						</section>`
					: ''
			}
		</div>`,
	}
}

export function permissionHistory(store: Store, explorationId: string, params: URLSearchParams, from: string) {
	const all = explorationPermissions(store, explorationId).reverse()
	if (!all.length) return ''
	const last = Math.ceil(all.length / historySize)
	const asked = Number(params.get('requests'))
	const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, last) : 1
	const shown = all.slice((page - 1) * historySize, page * historySize)
	const link = (target: number, label: string, rel: string) => {
		const next = new URLSearchParams(params)
		if (target === 1) next.delete('requests')
		else next.set('requests', String(target))
		next.set('at', `request:${requestName(all[(target - 1) * historySize])}`)
		const query = next.toString()
		return html`<a class="btn small" href="/explorations/${explorationId}${query ? `?${query}` : ''}" rel="${rel}"
			>${label}</a
		>`
	}
	const decided = (item: Permission) =>
		item.decision ? html`${item.decision.text} · ${time(item.decision.at)}` : html`open · ${time(item.at)}`
	const rows = shown.map(
		(item, index) =>
			html`<div
				class="sp-row"
				role="option"
				aria-selected="false"
				tabindex="-1"
				id="request-${index}"
				data-row
				data-key="request:${requestName(item)}"
				data-href="${requestHref(item, from, true)}"
				data-label="${requestName(item)}"
			>
				<span class="sp-c-cb"></span>
				<span class="sp-c-tag">${item.decision ? decisionPill(item) : askingPill()}</span>
				<span class="sp-c-id" title="${requestName(item)}">${requestName(item)}</span>
				<span class="sp-c-title ell" title="${askTitle(item)}">${askTitle(item)}</span>
				<span class="sp-c-meta ell" title="${item.decision?.text ?? 'open'}">${decided(item)}</span>
			</div>`
	)
	return html`<details
		class="fold"
		data-open-key="section:permission-history"
		${params.has('requests') || all.some((item) => !item.decision) ? html`open` : ''}
	>
		<summary>
			<h2>Permission requests <span class="n">${all.length}</span></h2>
		</summary>
		<div class="fold-b" data-list-region>
			<div class="sp-list" role="listbox" aria-label="Permission requests of ${explorationId}" data-list>
				${rows}
			</div>
			${
				last > 1
					? html`<nav class="pager" aria-label="Pages of permission requests">
							${page > 1 ? link(page - 1, '‹ Newer', 'prev') : ''}
							<span class="pager-at">Page ${page} of ${last}</span>
							${page < last ? link(page + 1, 'Older ›', 'next') : ''}
						</nav>`
					: ''
			}
		</div>
	</details>`
}

function decisionPill(item: Permission) {
	const kind = item.decision!.kind
	const look: Record<string, [string, string]> = {
		allow: ['Allowed', 'green'],
		'allow-kind': ['Allowed', 'green'],
		'allow-tool': ['Allowed', 'green'],
		always: ['Allowed', 'green'],
		rule: ['By rule', 'green'],
		deny: ['Denied', 'red'],
		stop: ['Stopped', 'red'],
		closed: ['Closed', ''],
	}
	const [label, tone] = look[kind]
	return html`<span class="sp-pill ${tone}">${label}</span>`
}

export function emptyRecord(explorationId: string, requestId: string): Page {
	return {
		title: 'No such request',
		section: null,
		subjects: ['inbox'],
		status: 404,
		back: '/activity',
		body: html`${heading('No such request', `Run ${explorationId} has no permission request ${requestId}.`)}
			<p class="actions"><a class="btn primary" href="/activity">Activity</a></p>`,
	}
}
