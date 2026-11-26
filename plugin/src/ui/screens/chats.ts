import type { Store } from '../../store.ts'
import type { Chat, RequestRecord, RequestSelection } from '../../requests.ts'
import type { Env } from '../../sessions.ts'
import { chatOf, isUnread, listedChats, waitingBehind } from '../../requests.ts'
import { explorationPermissions } from '../../permissions.ts'
import type { Attrs, Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { formButton } from '../components/button.ts'
import { chatTurn } from '../components/chat-turn.ts'
import { composer } from '../components/composer.ts'
import { emptyNotice } from '../components/empty-state.ts'
import { heading } from '../components/page-heading.ts'
import { statusMark } from '../components/status-mark.ts'
import { ago, attributes, costText, glyph, html } from '../html.ts'
import { requestHref } from '../permissions.ts'
import { chatPreferences } from '../requester.ts'
import { failureText, requestModelLabel } from '../requests.ts'

function title(text: string) {
	const line = text.split('\n')[0]
	return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

function chatRowAttrs(key: string, href: string, label: string): Attrs {
	return { 'data-row': true, 'data-key': key, 'data-href': href, 'data-label': label }
}

function chatRow(key: string, href: string, label: string) {
	return attributes(chatRowAttrs(key, href, label))
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
	const details = `/chats/${request.conversation}/messages/${request.id}`
	return chatTurn({
		request,
		number,
		details,
		back,
		csrf: context.csrf,
		model: requestModelLabel(request),
		failure: request.state === 'failed' ? failureText(request) : null,
		waitingBehind: request.state === 'waiting' ? waitingBehind(store, request) : '',
		permissions: explorationPermissions(store, request.id)
			.filter((item) => !item.decision)
			.map((item) => ({ command: commandOf(item.input, item.tool), href: requestHref(item, back) })),
		rowAttrs: chatRowAttrs(`request:${request.id}`, details, `Turn ${number}`),
	})
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
								${unread ? html`<span class="chat-unread">${unread} unread</span> · ` : ''}${last.state === 'answered' ? '' : html`${statusMark({ state: last.state })} · `}${ago(last.askedAt)}
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
				${formButton({ label: 'New chat', href: newHref, attrs: chatRowAttrs('chat:new', newHref, 'New chat') })}
			</div>
			${list}
		</aside>
		${conversation || html`<div class="chat-workspace-empty">${emptyNotice({ what: 'Choose a conversation.', next: 'Start a new chat to ask Checkmate.' })}</div>`}
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
		body: html`${heading({ title: 'Chats' })}
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
		${composer({ csrf: context.csrf, action: options.action, selection: chatSelection(store, env, chat), back: options.back })}
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
		${composer({ csrf: context.csrf, action, selection, screen, back })}
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
			${heading({ title: 'Plan chats', sub: html`<a href="${address()}">${glyph('←')} Plan</a> · ${decodeURIComponent(path.slice('/plans/'.length))}` })}
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
		body: html`${heading({ title: 'Chats' })}
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
