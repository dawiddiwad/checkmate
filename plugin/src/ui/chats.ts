import type { Store } from '../store.ts'
import type { RequestRecord, RequestSelection } from '../requests.ts'
import type { Env } from '../sessions.ts'
import type { Context, Page } from './layout.ts'
import { chatOf, listedChats } from '../requests.ts'
import { explorationPermissions } from '../permissions.ts'
import { ago, html, pill, time } from './html.ts'
import { emptyNotice, heading } from './layout.ts'
import { requestHref } from './permissions.ts'
import { chatPreferences } from './requester.ts'
import { failureText } from './requests.ts'

function composer(context: Context, action: string, selection: RequestSelection, screen = '') {
	const model = selection.provider && selection.model ? `${selection.provider}/${selection.model}` : selection.model
	return html`<form method="post" action="${action}" class="chat-composer" data-chat-composer>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		${screen ? html`<input type="hidden" name="screen" value="${screen}" />` : ''}
		<label for="chat-text">Message</label>
		<textarea id="chat-text" name="text" required maxlength="4000" rows="4" placeholder="Ask Checkmate…"></textarea>
		<div class="chat-controls">
			<label
				>Harness
				<select name="harness" data-chat-harness>
					<option value="claude" ${selection.harness === 'claude' ? 'selected' : ''}>Claude Code</option>
					<option value="pi" ${selection.harness === 'pi' ? 'selected' : ''}>Pi</option>
				</select></label
			>
			<label
				>Model
				<select name="model" data-chat-model>
					<option value="">Host default</option>
					${model ? html`<option value="${model}" selected>${model}</option>` : ''}
				</select></label
			>
			<label hidden
				>Effort
				<select name="effort" data-chat-effort data-selected="${selection.effort ?? ''}">
					<option value="">Host default</option>
				</select></label
			>
			<button class="btn primary" type="submit">Send</button>
		</div>
		<p class="help" data-chat-model-status aria-live="polite"></p>
		<p class="form-error" data-chat-error role="alert" hidden></p>
	</form>`
}

function title(text: string) {
	const line = text.split('\n')[0]
	return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

function origin(request: RequestRecord) {
	const context = request.context
	const revision = context.planRevision ? `@${context.planRevision}` : ''
	const record = context.record
	const links = {
		plans: ['Plans', '/'],
		runs: ['Runs', '/runs'],
		activity: ['Activity', '/activity'],
		chats: ['Chats', '/chats'],
	}
	const page = context.page && links[context.page]
	const start =
		record?.kind === 'run' || record?.kind === 'exploration'
			? html`<a href="/${record.kind === 'run' ? 'runs' : 'explorations'}/${encodeURIComponent(record.id)}"
					>${record.kind} ${record.id}</a
				>`
			: context.planId
				? html`<a href="/plans/${encodeURIComponent(context.planId)}${revision}"
						>plan ${context.planId}${revision}</a
					>`
				: page
					? html`<a href="${page[1]}">${page[0]}</a>`
					: ''
	return start ? html`<p class="help">Started from ${start}.</p>` : ''
}

function turn(store: Store, request: RequestRecord, context: Context) {
	const permissions = explorationPermissions(store, request.id).filter((item) => !item.decision)
	const failure = request.state === 'failed' ? failureText(request) : null
	return html`<article class="chat-turn" data-key="request:${request.id}">
		<div class="chat-message chat-user">
			<div class="chat-meta">You · ${time(request.askedAt)}</div>
			<p>${request.text}</p>
		</div>
		<div class="chat-message chat-assistant">
			<div class="chat-meta">
				Checkmate ·
				${request.harness === 'pi' ? 'Pi' : 'Claude Code'}${request.model ? ` · ${request.provider ? `${request.provider}/` : ''}${request.model}` : ''}${request.effort ? ` · ${request.effort}` : ''}
				${pill(request.state)}
				<a href="/requests/${request.id}">${request.id}</a>
			</div>
			${request.reply ? html`<p>${request.reply}</p>` : ''}
			${request.state === 'waiting' ? html`<p class="help">Waiting for another request to finish.</p>` : ''}
			${request.state === 'running' ? html`<p class="help">Working…</p>` : ''}
			${permissions.map((item) => html`<p class="banner warn">Waiting for permission. <a href="${requestHref(item, `/chats/${request.conversation}`)}">Answer it</a></p>`)}
			${
				request.activity.length
					? html`<details>
							<summary>Activity (${request.activity.length})</summary>
							<ol class="sp-activity">
								${request.activity.map((entry) => html`<li>${entry.line}</li>`)}
							</ol>
						</details>`
					: ''
			}
			${
				failure
					? html`<p class="banner fail">${failure.cause}</p>
							${failure.detail ? html`<p class="help">${failure.detail}</p>` : ''}${failure.lines.length ? html`<pre class="sp-code">${failure.lines.join('\n')}</pre>` : ''}`
					: request.reason
						? html`<p class="banner info">${request.reason}</p>`
						: ''
			}
			${
				request.changes.length
					? html`<details>
							<summary>Changes (${request.changes.length})</summary>
							<ul>
								${request.changes.map((change) => html`<li>${change.href ? html`<a href="${change.href}">${change.text}</a>` : change.text}</li>`)}
							</ul>
						</details>`
					: ''
			}
			${request.state === 'running' || request.state === 'waiting' ? html`<form method="post" action="/requests/${request.id}/stop"><input type="hidden" name="csrf" value="${context.csrf}" /><input type="hidden" name="return" value="/chats/${request.conversation}" /><button class="btn" type="submit">Stop</button></form>` : ''}
		</div>
	</article>`
}

export function chatsPage(store: Store, context: Context, params: URLSearchParams, env: Env): Page {
	const chats = listedChats(store)
	const fresh = params.has('new')
	return {
		title: 'Chats',
		section: 'chats',
		subjects: ['requests'],
		body: html`${heading('Chats', 'Your conversations with Checkmate.')}
			<div class="chat-list-actions"><a class="btn" href="/chats?new=1">New chat</a></div>
			${fresh ? composer(context, '/chats', chatPreferences(store, env), params.get('screen') ?? '') : ''}
			${
				chats.length
					? html`<div class="chat-list">
							${chats.map((chat) => {
								const first = chat.turns[0]
								const last = chat.turns[chat.turns.length - 1]
								return html`<a class="chat-list-item" href="/chats/${chat.id}"
									><strong>${title(first.text)}</strong
									><span
										>${pill(last.state)} · ${ago(last.askedAt)} · ${chat.turns.length}
										${chat.turns.length === 1 ? 'message' : 'messages'}</span
									></a
								>`
							})}
						</div>`
					: emptyNotice('No chats yet.', 'Start a chat or use Find to ask Checkmate.')
			}`,
	}
}

export function chatPage(store: Store, context: Context, id: string, env: Env): Page | null {
	const chat = chatOf(store, id)
	if (!chat) return null
	return {
		title: 'Chat',
		section: 'chats',
		subjects: ['requests', ...chat.turns.map((item) => `request:${item.id}`)],
		crumbs: [
			['Chats', '/chats'],
			['Chat', null],
		],
		body: html`<div class="chat-thread">
			<div class="chat-thread-heading"><a href="/chats">← Chats</a><a href="/chats?new=1">New chat</a></div>
			<h1>${title(chat.turns[0].text)}</h1>
			${origin(chat.turns[0])}
			<div class="chat-history" data-region="chat-history" aria-label="Conversation">
				${chat.turns.map((item) => turn(store, item, context))}
			</div>
			${composer(context, `/chats/${id}/turns`, chatPreferences(store, env, { harness: chat.turns.at(-1)!.harness, model: chat.turns.at(-1)!.provider && chat.turns.at(-1)!.model ? `${chat.turns.at(-1)!.provider}/${chat.turns.at(-1)!.model}` : (chat.turns.at(-1)!.model ?? undefined), effort: chat.turns.at(-1)!.effort ?? undefined }))}
		</div>`,
	}
}
