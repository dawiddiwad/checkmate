import type { Context, Page, Section } from '../layout.ts'
import { html } from '../html.ts'
import { brand } from './brand.ts'

export type StatusBar = { context: Context; page: Page }

const themeIcon = html`<svg viewBox="0 0 16 16" aria-hidden="true">
	<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" />
	<path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
</svg>`

function themeForm(context: Context) {
	const next = context.theme === 'dark' ? 'light' : 'dark'
	return html`<form method="post" action="/theme" class="theme-form" data-theme-form>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="back" value="${context.path}" />
		<button
			class="sp-btn icon-btn"
			name="theme"
			value="${next}"
			data-current="${context.theme}"
			title="Switch light and dark"
			aria-label="Switch light and dark"
		>
			${themeIcon}
		</button>
	</form>`
}

function statusWho(context: Context) {
	const back = encodeURIComponent(context.path)
	const actor = context.actor
		? html`<a class="actor" href="/actor?back=${back}" title="${context.actor}. Change your name"
				>${context.actor}</a
			>`
		: html`<a class="actor att" href="/actor?back=${back}">Set your name</a>`
	return html`<div class="who">
		<span class="live" data-live hidden>Connecting</span>
		${actor} ${themeForm(context)}
	</div>`
}

function statusLink(page: Page, section: Section, href: string, label: string) {
	const current = page.section === section ? html` aria-current="page"` : ''
	return html`<a class="sb-btn" href="${href}" ${current}>${label}</a>`
}

export function statusBar({ context, page }: StatusBar) {
	const path = page.crumbs?.length ? page.crumbs : [[page.title, null] as [string, null]]
	const waiting = context.queueCount
	return html`<footer class="statusbar" aria-label="Status bar">
		${brand()}
		<nav class="sb-where" aria-label="Where you are">
			<ol>
				${path.map(([label, href]) =>
					href ? html`<li><a href="${href}">${label}</a></li>` : html`<li aria-current="page">${label}</li>`
				)}
			</ol>
		</nav>
		<nav class="sb-nav" aria-label="Main">
			<a class="sb-btn" href="/" ${page.section === 'home' ? html`aria-current="page"` : ''}>Plans</a>
			<span class="sb-btn-set" data-wide
				><a
					class="sb-btn"
					href="/activity"
					data-region="activity-link"
					${page.section === 'activity' ? html`aria-current="page"` : ''}
					>${html`<span>Activity${context.running ? html`<span class="sb-long"> · ${context.running} running</span>` : ''}</span>`}</a
				>
				${statusLink(page, 'chats', '/chats', 'Chats')} ${statusLink(page, 'runs', '/runs', 'Runs')}
				${statusLink(page, 'log', '/log', 'Log')} ${statusLink(page, 'settings', '/settings', 'Settings')}</span
			>
			<details class="sb-more menu" data-menu>
				<summary class="sb-btn">More</summary>
				<div class="menu-list">
					<button type="button" data-find-open>Find</button
					><a href="/activity" data-region="activity-menu"
						>Activity${context.running ? ` · ${context.running} running` : ''}</a
					><a href="/chats">Chats</a><a href="/runs">Runs</a><a href="/log">Log</a
					><a href="/settings">Settings</a>
				</div>
			</details>
		</nav>
		<span class="sb-fill"></span>
		<span class="sb-say" aria-live="polite" data-say></span>
		<span class="sb-keys" data-hints></span>
		<button class="sb-btn" type="button" data-find-open hidden>Find</button>
		<span class="sb-div" aria-hidden="true"></span>
		<a
			class="sb-btn"
			href="${context.requests.runningChat ? `/chats/${context.requests.runningChat}` : '/chats'}"
			title="The chat that is active now"
			data-region="request-link"
			${context.requests.running ? '' : html`hidden`}
			>${context.requests.running ? html`<span>Chat<span class="sb-long sb-running"> · working</span></span>` : ''}</a
		>
		<a
			class="sb-btn att"
			href="/permissions"
			title="Permission requests of testers that wait for you"
			data-region="permissions-link"
			${context.permissions ? '' : html`hidden`}
			>${context.permissions} ${context.permissions === 1 ? 'permission' : 'permissions'}</a
		>
		<a
			class="sb-btn att"
			href="${
				context.requests.unread === 1 && context.requests.firstUnreadChat
					? `/chats/${context.requests.firstUnreadChat}`
					: '/chats'
			}"
			title="Unread updates in your chats"
			aria-label="${context.requests.unread} unread chat updates"
			data-region="replies-link"
			${context.requests.unread ? '' : html`hidden`}
			>${context.requests.unread ? html`<span>${context.requests.unread}<span class="sb-long"> unread</span></span>` : ''}</a
		>
		<a
			class="sb-btn att"
			href="/"
			title="Items that wait for you in all plans"
			data-region="nav-count"
			${waiting ? '' : html`hidden`}
			><span
				>${waiting}<span class="sb-long"> ${waiting === 1 ? 'needs' : 'need'} you</span
				><span class="sb-all"> · all plans</span></span
			></a
		>
		${statusWho(context)}
	</footer>`
}
