import type { Context, Page, Section } from '../layout.ts'
import { html } from '../html.ts'
import { brand } from './brand.ts'

export type StatusBar = { context: Context; page: Page }

const themeIcon = html`<svg viewBox="0 0 14 14" aria-hidden="true">
	<circle class="s" cx="7" cy="7" r="6" />
	<path class="d" d="M7 1a6 6 0 0 1 0 12z" />
</svg>`

function themeForm(context: Context) {
	const next = context.theme === 'dark' ? 'light' : 'dark'
	return html`<form method="post" action="/theme" class="sc-bar-form" data-theme-form>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="back" value="${context.path}" />
		<button
			class="sc-bar-theme"
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
		? html`<a class="sc-bar-actor" href="/actor?back=${back}" title="${context.actor}. Change your name"
				>${context.actor}</a
			>`
		: html`<a class="sc-bar-actor sc-hot" href="/actor?back=${back}">Set your name</a>`
	return html`<div class="sc-bar-who">
		<span class="sc-bar-live" data-live hidden>Connecting</span>
		${actor} ${themeForm(context)}
	</div>`
}

function statusLink(page: Page, section: Section, href: string, label: string) {
	const current = page.section === section ? html` aria-current="page"` : ''
	return html`<a href="${href}" ${current}>${label}</a>`
}

export function statusBar({ context, page }: StatusBar) {
	const path = page.crumbs?.length ? page.crumbs : [[page.title, null] as [string, null]]
	const waiting = context.queueCount
	return html`<footer class="sc-bar is-fixed" aria-label="Status bar">
		${brand()}
		<nav class="sc-sr" aria-label="Where you are" data-where>
			<ol>
				${path.map(([label, href]) =>
					href ? html`<li><a href="${href}">${label}</a></li>` : html`<li aria-current="page">${label}</li>`
				)}
			</ol>
		</nav>
		<nav class="sc-bar-nav" aria-label="Main">
			<a href="/" ${page.section === 'home' ? html`aria-current="page"` : ''}>Plans</a>
			<span class="sc-bar-set" data-wide
				>${statusLink(page, 'runs', '/runs', 'Runs')} ${statusLink(page, 'chats', '/chats', 'Chats')}
				<a
					href="/activity"
					data-region="activity-link"
					${page.section === 'activity' ? html`aria-current="page"` : ''}
					>${html`<span
						>Activity${context.running ? html`<b>${context.running}</b><span class="sc-sr"> running</span>` : ''}</span
					>`}</a
				>
				${statusLink(page, 'log', '/log', 'Log')} ${statusLink(page, 'settings', '/settings', 'Settings')}</span
			>
			<details class="sc-bar-more menu" data-menu>
				<summary>More</summary>
				<div class="menu-list">
					<button type="button" data-find-open>Find</button><a href="/runs">Runs</a><a href="/chats">Chats</a
					><a href="/activity" data-region="activity-menu"
						>Activity${context.running ? ` · ${context.running} running` : ''}</a
					><a href="/log">Log</a><a href="/settings">Settings</a>
				</div>
			</details>
		</nav>
		<span class="sc-bar-fill"></span>
		<span class="sc-bar-say" aria-live="polite" data-say></span>
		<span class="sc-bar-keys" data-hints></span>
		<button class="sc-bar-link" type="button" data-find-open hidden>Find</button>
		<span class="sc-bar-div" aria-hidden="true"></span>
		<a
			class="sc-bar-link"
			href="${context.requests.runningChat ? `/chats/${context.requests.runningChat}` : '/chats'}"
			title="The chat that is active now"
			data-region="request-link"
			${context.requests.running ? '' : html`hidden`}
			>${context.requests.running ? html`<span>Chat<span class="sc-bar-long"> · working</span></span>` : ''}</a
		>
		<a
			class="sc-bar-need"
			href="/permissions"
			title="Permission requests of testers that wait for you"
			data-region="permissions-link"
			${context.permissions ? '' : html`hidden`}
			>${context.permissions} ${context.permissions === 1 ? 'permission' : 'permissions'}</a
		>
		<a
			class="sc-bar-need"
			href="${
				context.requests.unread === 1 && context.requests.firstUnreadChat
					? `/chats/${context.requests.firstUnreadChat}`
					: '/chats'
			}"
			title="Unread updates in your chats"
			aria-label="${context.requests.unread} unread chat updates"
			data-region="replies-link"
			${context.requests.unread ? '' : html`hidden`}
			>${context.requests.unread ? html`<span>${context.requests.unread}<span class="sc-bar-long"> unread</span></span>` : ''}</a
		>
		<a
			class="sc-bar-need"
			href="/"
			title="Items that wait for you in all plans"
			data-region="nav-count"
			${waiting ? '' : html`hidden`}
			><span
				>${waiting}<span class="sc-bar-long"> ${waiting === 1 ? 'needs' : 'need'} you</span
				><span class="sc-bar-all"> · all plans</span></span
			></a
		>
		${statusWho(context)}
	</footer>`
}
