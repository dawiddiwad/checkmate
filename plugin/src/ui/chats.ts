import type { Store } from '../store.ts'
import type { Chat, RequestRecord, RequestSelection } from '../requests.ts'
import type { Env } from '../sessions.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import { chatOf, isUnread, listedChats, waitingBehind } from '../requests.ts'
import { explorationPermissions } from '../permissions.ts'
import { ago, costText, glyph, html, pill, time } from './html.ts'
import { emptyNotice, heading } from './layout.ts'
import { requestHref } from './permissions.ts'
import { chatPreferences } from './requester.ts'
import { failureText, requestModelLabel } from './requests.ts'
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
				>Search models
				<input type="search" data-chat-model-search autocomplete="off" placeholder="Provider or name"
			/></label>
			<label
				>Model
				<select name="model" data-chat-model>
					${model ? html`<option value="${model}" selected>${model}</option>` : ''}
					<option value="">Host default</option>
				</select></label
			>
			<label hidden
				>Effort
				<select name="effort" data-chat-effort data-selected="${selection.effort ?? ''}">
					<option value="">Host default</option>
				</select></label
			>
			<button class="sp-btn pri" type="submit">Send</button>
		</div>
		<p class="help" data-chat-model-status aria-live="polite"></p>
		<p class="form-error" data-chat-error role="alert" hidden></p>
	</form>`
}

// The record decides what this turn saved. The reply text does not.
function savedThisTurn(changes: RequestRecord['changes']) {
	if (!changes.length) return html`<p class="help" data-chat-saved>Saved this turn: nothing.</p>`
	return html`<div class="chat-saved" data-chat-saved>
		<p class="help">Saved this turn</p>
		<ul>
			${changes.map(
				(change) =>
					html`<li>${change.href ? html`<a href="${change.href}">${change.text}</a>` : change.text}</li>`
			)}
		</ul>
	</div>`
}

function title(text: string) {
	const line = text.split('\n')[0]
	return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

function chatRow(key: string, href: string, label: string) {
	return html`data-row data-key="${key}" data-href="${href}" data-label="${label}"`
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

function commandOf(input: unknown, tool: string) {
	const command = typeof input === 'object' && input !== null ? (input as { command?: unknown }).command : undefined
	return typeof command === 'string' ? command : tool
}

function turn(store: Store, request: RequestRecord, context: Context, number: number, back: string) {
	const permissions = explorationPermissions(store, request.id).filter((item) => !item.decision)
	const failure = request.state === 'failed' ? failureText(request) : null
	const model = requestModelLabel(request)
	const details = `/chats/${request.conversation}/messages/${request.id}`
	return html`<article
		class="chat-turn"
		data-chat-turn
		tabindex="-1"
		aria-label="Turn ${number}"
		${chatRow(`request:${request.id}`, details, `Turn ${number}`)}
	>
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
				${request.harness === 'pi' ? 'Pi' : 'Claude Code'}${model ? ` · ${model}` : ''}${request.effort ? ` · ${request.effort}` : ''}
				<span class="chat-status"
					>${request.state === 'answered' ? '' : pill(request.state)}
					<a href="${details}">Turn ${number}</a></span
				>
			</div>
			${request.reply ? html`<div class="chat-markdown" data-chat-content>${chatMarkdown(request.reply)}</div>` : ''}
			${['answered', 'failed', 'stopped', 'interrupted'].includes(request.state) ? savedThisTurn(request.changes) : ''}
			${request.state === 'waiting' ? html`<p class="help" data-chat-waiting-behind>${waitingBehind(store, request)}</p>` : ''}
			${request.state === 'running' ? html`<p class="help">Working…</p>` : ''}
			${permissions.map(
				(item) =>
					html`<p class="banner warn" data-chat-waiting>
						Waiting for your permission. The chat asks to run
						<code>${commandOf(item.input, item.tool)}</code>.
						<a href="${requestHref(item, back)}">Answer it</a>. If no one answers in about 10 minutes,
						Checkmate denies the command and the reply goes on without it.
					</p>`
			)}
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
			${request.state === 'running' || request.state === 'waiting' ? html`<form method="post" action="/requests/${request.id}/stop"><input type="hidden" name="csrf" value="${context.csrf}" /><input type="hidden" name="return" value="${back}" /><button class="sp-btn" type="submit">Stop</button></form>` : ''}
		</div>
	</article>`
}

function chatList(chats: Chat[], href: (chat: Chat) => string, empty: Html, selected?: string) {
	return html`<div class="${chats.length ? 'chat-list' : ''}" data-region="chat-list">
		${
			chats.length
				? chats.map((chat) => {
						const last = chat.turns.at(-1)!
						const unread = chat.turns.filter(isUnread).length
						const first = title(chat.turns[0].text)
						const link = href(chat)
						return html`<a
							class="chat-list-item"
							id="chat-${chat.id}"
							href="${link}"
							${chatRow(`chat:${chat.id}`, link, first)}
							${chat.id === selected ? html`aria-current="page"` : ''}
							><strong>${first}</strong
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

function globalChatHref({ id, context }: Chat) {
	return context.planChat && context.planId
		? `/plans/${context.planId}${context.planRevision ? `@${context.planRevision}` : ''}?chat=${id}`
		: `/chats/${id}`
}

function workspace(view: 'thread' | 'new' | 'list', newHref: string, list: Html, conversation?: Html) {
	return html`<div class="chat-workspace" data-chat-view="${view}">
		<aside class="chat-sidebar" aria-label="Conversations" data-chat-lane="list">
			<div class="chat-sidebar-header">
				<h2>Conversations</h2>
				<a class="sp-btn" href="${newHref}" ${chatRow('chat:new', newHref, 'New chat')}>New chat</a>
			</div>
			${list}
		</aside>
		${conversation || html`<div class="chat-workspace-empty">${emptyNotice('Choose a conversation.', 'Start a new chat to ask Checkmate.')}</div>`}
	</div>`
}

export function chatsPage(store: Store, context: Context, params: URLSearchParams, env: Env): Page {
	const chats = listedChats(store)
	const fresh = params.has('new')
	return {
		title: 'Chats',
		section: 'chats',
		subjects: ['requests'],
		back: fresh ? '/chats' : '/',
		body: html`${heading('Chats')}
		${workspace(
			fresh ? 'new' : 'list',
			'/chats?new=1',
			chatList(chats, globalChatHref, html`<p class="help">No chats yet.</p>`),
			fresh
				? newThread(context, '/chats', chatPreferences(store, env), '/chats', params.get('screen') ?? '')
				: undefined
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
	return html`<div
		class="chat-history"
		data-region="chat-history"
		data-chat-history
		data-chat-lane="thread"
		role="region"
		aria-label="Conversation"
		tabindex="0"
	>
		${chat.turns.map((item, index) => turn(store, item, context, index + 1, back))}
	</div>`
}

function thread(
	store: Store,
	context: Context,
	env: Env,
	chat: Chat,
	options: { list: string; back: string; action: string; origin?: boolean }
) {
	return html`<section class="chat-thread" aria-label="Current conversation">
		<header class="chat-thread-header">
			<a class="chat-mobile-back" href="${options.list}">${glyph('←')} All chats</a>
			<div class="chat-thread-title">
				<h2>${title(chat.turns[0].text)}</h2>
				<p class="chat-cost" data-region="chat-cost">Chat cost ${costText(chat.costUsd, chat.costPartial)}</p>
			</div>
			${options.origin ? origin(chat.turns[0]) : ''}
		</header>
		${history(store, context, chat, options.back)}
		${composer(context, options.action, chatSelection(store, env, chat), '', options.back)}
	</section>`
}

function newThread(
	context: Context,
	action: string,
	selection: RequestSelection,
	list: string,
	screen = '',
	back = ''
) {
	return html`<section class="chat-thread" aria-label="New chat">
		<header class="chat-thread-header">
			<a class="chat-mobile-back" href="${list}">${glyph('←')} All chats</a>
			<h2>New chat</h2>
		</header>
		${composer(context, action, selection, screen, back)}
	</section>`
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
		if (/^(chat|request):/.test(params.get('at') ?? '')) params.delete('at')
		if (key) params.set(key, value)
		if (value === 'list' && chat) params.set('at', `chat:${chat.id}`)
		const query = params.toString()
		return query ? `${path}?${query}` : path
	}
	const list = address('chat', 'list')
	const newChat = address('newChat', '1')
	return {
		back: chat || fresh ? list : address(),
		body: html`<section
			class="plan-chat"
			aria-label="Plan chats"
			data-plan-chat="${path.slice('/plans/'.length).split('@')[0]}"
		>
			${heading(
				'Plan chats',
				html`<a href="${address()}">${glyph('←')} Plan</a> · ${decodeURIComponent(path.slice('/plans/'.length))}`
			)}
			${workspace(
				chat ? 'thread' : fresh ? 'new' : 'list',
				newChat,
				chatList(chats, (item) => address('chat', item.id), html`<p class="help">No chats yet.</p>`, chat?.id),
				chat
					? thread(store, context, env, chat, {
							list,
							back: address('chat', chat.id),
							action: `${path}/chats/${encodeURIComponent(chat.id)}/turns`,
						})
					: fresh
						? newThread(context, `${path}/chats`, chatPreferences(store, env), list, '', newChat)
						: undefined
			)}
		</section>`,
	}
}

export function chatPage(store: Store, context: Context, id: string, env: Env): Page | null {
	const chat = chatOf(store, id)
	if (!chat) return null
	const list = `/chats?at=${encodeURIComponent(`chat:${id}`)}`
	return {
		title: 'Chat',
		section: 'chats',
		back: list,
		subjects: ['requests', ...chat.turns.map((item) => `request:${item.id}`)],
		crumbs: [
			['Chats', '/chats'],
			['Chat', null],
		],
		body: html`${heading('Chats')}
		${workspace(
			'thread',
			'/chats?new=1',
			chatList(listedChats(store), globalChatHref, html``, id),
			thread(store, context, env, chat, {
				list,
				back: `/chats/${id}`,
				action: `/chats/${id}/turns`,
				origin: true,
			})
		)}`,
	}
}
