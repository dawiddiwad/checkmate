import type { Store } from '../store.ts'
import type { Chat, RequestRecord, RequestSelection } from '../requests.ts'
import type { Env } from '../sessions.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import { chatOf, isUnread, listedChats } from '../requests.ts'
import { explorationPermissions } from '../permissions.ts'
import { ago, costText, glyph, html, pill, time } from './html.ts'
import { emptyNotice, heading } from './layout.ts'
import { requestHref } from './permissions.ts'
import { chatPreferences } from './requester.ts'
import { failureText } from './requests.ts'
import { chatMarkdown } from './markdown.ts'

function composer(context: Context, action: string, selection: RequestSelection, screen = '', back = '') {
	const model = selection.provider && selection.model ? `${selection.provider}/${selection.model}` : selection.model
	return html`<form method="post" action="${action}" class="chat-composer" data-chat-composer>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		${screen ? html`<input type="hidden" name="screen" value="${screen}" />` : ''}
		${back ? html`<input type="hidden" name="return" value="${back}" />` : ''}
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

function turn(store: Store, request: RequestRecord, context: Context, number: number, back: string) {
	const permissions = explorationPermissions(store, request.id).filter((item) => !item.decision)
	const failure = request.state === 'failed' ? failureText(request) : null
	return html`<article class="chat-turn" data-key="request:${request.id}">
		<div class="chat-message chat-user">
			<div class="chat-meta">You · ${time(request.askedAt)}</div>
			<p data-chat-content>${request.text}</p>
		</div>
		<div
			class="chat-message chat-assistant"
			${['answered', 'failed', 'stopped', 'interrupted'].includes(request.state) ? html`data-chat-terminal="${request.state}"` : ''}
		>
			<div class="chat-meta">
				Checkmate ·
				${request.harness === 'pi' ? 'Pi' : 'Claude Code'}${request.model ? ` · ${request.provider ? `${request.provider}/` : ''}${request.model}` : ''}${request.effort ? ` · ${request.effort}` : ''}
				<span class="chat-status"
					>${request.state === 'answered' ? '' : pill(request.state)}
					<a href="/chats/${request.conversation}/messages/${request.id}">Turn ${number}</a></span
				>
			</div>
			${request.reply ? html`<div class="chat-markdown" data-chat-content>${chatMarkdown(request.reply)}</div>` : ''}
			${request.state === 'waiting' ? html`<p class="help">Waiting for another chat to finish.</p>` : ''}
			${request.state === 'running' ? html`<p class="help">Working…</p>` : ''}
			${permissions.map((item) => html`<p class="banner warn">Waiting for permission. <a href="${requestHref(item, back)}">Answer it</a></p>`)}
			${
				request.activity.length
					? html`<details data-open-key="activity:${request.id}">
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
					? html`<details data-open-key="changes:${request.id}">
							<summary>Changes (${request.changes.length})</summary>
							<ul>
								${request.changes.map((change) => html`<li>${change.href ? html`<a href="${change.href}">${change.text}</a>` : change.text}</li>`)}
							</ul>
						</details>`
					: ''
			}
			${request.state === 'running' || request.state === 'waiting' ? html`<form method="post" action="/requests/${request.id}/stop"><input type="hidden" name="csrf" value="${context.csrf}" /><input type="hidden" name="return" value="${back}" /><button class="btn" type="submit">Stop</button></form>` : ''}
		</div>
	</article>`
}

function chatList(chats: Chat[], href: (chat: Chat) => string, empty: Html) {
	return html`<div class="${chats.length ? 'chat-list' : ''}" data-region="chat-list">
		${
			chats.length
				? chats.map((chat) => {
						const last = chat.turns.at(-1)!
						const unread = chat.turns.filter(isUnread).length
						return html`<a class="chat-list-item" id="chat-${chat.id}" href="${href(chat)}"
							><strong>${title(chat.turns[0].text)}</strong
							><span>
								${unread ? html`<span class="chat-unread">${unread} unread</span> · ` : ''}${last.state === 'answered' ? '' : html`${pill(last.state)} · `}${ago(last.askedAt)}
								· ${chat.turns.length} ${chat.turns.length === 1 ? 'message' : 'messages'} ·
								<span title="Chat cost">${costText(chat.costUsd, chat.costPartial)}</span></span
							></a
						>`
					})
				: empty
		}
	</div>`
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
			${chatList(
				chats,
				({ id, context }) =>
					context.planChat && context.planId
						? `/plans/${context.planId}${context.planRevision ? `@${context.planRevision}` : ''}?chat=${id}`
						: `/chats/${id}`,
				emptyNotice('No chats yet.', 'Start a chat or use Find to ask Checkmate.')
			)}`,
	}
}

function chatSelection(store: Store, env: Env, chat: Chat) {
	const last = chat.turns.at(-1)!
	return chatPreferences(store, env, {
		harness: last.harness,
		model: last.provider && last.model ? `${last.provider}/${last.model}` : (last.model ?? undefined),
		effort: last.effort ?? undefined,
	})
}

function history(store: Store, context: Context, chat: Chat, back: string) {
	return html`<p class="chat-cost" data-region="chat-cost">Chat cost ${costText(chat.costUsd, chat.costPartial)}</p>
		<div
			class="chat-history"
			data-region="chat-history"
			data-chat-history
			role="region"
			aria-label="Conversation"
			tabindex="0"
		>
			${chat.turns.map((item, index) => turn(store, item, context, index + 1, back))}
		</div>`
}

export function planChat(
	store: Store,
	context: Context,
	env: Env,
	options: { path: string; chats: Chat[]; chat: Chat | null; fresh: boolean; params: URLSearchParams }
) {
	const { path, chats, chat, fresh } = options
	const address = (key = '', value = '') => {
		const params = new URLSearchParams(options.params)
		params.delete('chat')
		params.delete('newChat')
		if (key) params.set(key, value)
		const query = params.toString()
		return query ? `${path}?${query}` : path
	}
	return html`<section class="plan-chat" aria-label="Plan chats">
		<div class="chat-thread-heading">
			<a href="${address()}">${glyph('←')} Plan</a>
			<a class="btn" href="${address('newChat', '1')}">New chat</a>
		</div>
		<h1>Plan chats · ${decodeURIComponent(path.slice('/plans/'.length))}</h1>
		${
			chat
				? html`<div class="chat-thread">
						<a href="${address('chat', 'list')}">${glyph('←')} All chats</a>
						<h2>${title(chat.turns[0].text)}</h2>
						${history(store, context, chat, address('chat', chat.id))}
						${composer(context, `${path}/chats/${encodeURIComponent(chat.id)}/turns`, chatSelection(store, env, chat), '', address('chat', chat.id))}
					</div>`
				: fresh
					? composer(context, `${path}/chats`, chatPreferences(store, env), '', address('newChat', '1'))
					: chatList(chats, (item) => address('chat', item.id), html`<p class="help">No chats yet.</p>`)
		}
	</section>`
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
			<div class="chat-thread-heading">
				<a href="/chats">${glyph('←')} Chats</a><a href="/chats?new=1">New chat</a>
			</div>
			<h1>${title(chat.turns[0].text)}</h1>
			${origin(chat.turns[0])} ${history(store, context, chat, `/chats/${id}`)}
			${composer(context, `/chats/${id}/turns`, chatSelection(store, env, chat))}
		</div>`,
	}
}
