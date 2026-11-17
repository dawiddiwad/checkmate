import type { Html } from './html.ts'
import { html } from './html.ts'
import { viewer } from './evidence.ts'

export type Theme = 'system' | 'light' | 'dark'
export type Section = 'home' | 'runs' | 'log' | 'settings' | null

export type Context = {
	path: string
	csrf: string
	actor: string | null
	theme: Theme
	toast: string | null
	queueCount: number
	cursor: number
	workspace: string
}

export type Page = {
	title: string
	section: Section
	subjects: string[]
	body: Html
	status?: number
	crumbs?: Array<[string, string | null]>
	nav?: Html
	back?: string | null
	drawer?: boolean
}

const themeIcon = html`<svg viewBox="0 0 16 16" aria-hidden="true">
	<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" />
	<path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
</svg>`

export function mark() {
	return html`<span class="mark" aria-hidden="true"><i></i><i></i><i class="on"></i><i></i></span>`
}

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

function header(context: Context) {
	const back = encodeURIComponent(context.path)
	const actor = context.actor
		? html`<a class="actor" href="/actor?back=${back}" title="Change your name">${context.actor}</a>`
		: html`<a class="actor att" href="/actor?back=${back}">Set your name</a>`
	return html`<header class="top">
		<div class="top-in">
			<a class="brand" href="/" aria-label="Checkmate, home">${mark()}<span>Checkmate</span></a>
			<span class="top-fill"></span>
			<div class="who">
				<span class="live" data-live hidden>Connecting</span>
				${actor} ${themeForm(context)}
			</div>
		</div>
	</header>`
}

function statusLink(page: Page, section: Section, href: string, label: string) {
	const current = page.section === section ? html` aria-current="page"` : ''
	return html`<a class="sb-btn" href="${href}" ${current}>${label}</a>`
}

function statusBar(context: Context, page: Page) {
	const path = page.crumbs?.length ? page.crumbs : [[page.title, null] as [string, null]]
	const waiting = context.queueCount
	return html`<footer class="statusbar" aria-label="Status bar">
		<nav class="sb-where" aria-label="Where you are">
			<ol>
				${path.map(([label, href]) =>
					href ? html`<li><a href="${href}">${label}</a></li>` : html`<li aria-current="page">${label}</li>`
				)}
			</ol>
		</nav>
		<span class="sb-links">
			<a class="sb-btn att" href="/" data-region="nav-count" ${waiting ? '' : html`hidden`}
				>${waiting} ${waiting === 1 ? 'needs' : 'need'} you</a
			>
			<button class="sb-btn" type="button" data-find-open hidden>Find</button>
			<button class="sb-btn" type="button" data-keys-open hidden>Keys</button>
			<span class="sb-btn-set" data-wide
				>${statusLink(page, 'runs', '/runs', 'Runs')} ${statusLink(page, 'log', '/log', 'Log')}
				${statusLink(page, 'settings', '/settings', 'Settings')}</span
			>
			<details class="sb-more menu" data-menu>
				<summary class="sb-btn">More</summary>
				<div class="menu-list">
					<a href="/runs">Runs</a><a href="/log">Log</a><a href="/settings">Settings</a>
				</div>
			</details>
		</span>
		<span class="sb-say" aria-live="polite" data-say></span>
		<span class="sb-keys" data-hints></span>
	</footer>`
}

const dialogs = html`<dialog class="sp-keys" data-keys aria-labelledby="keys-title">
		<div class="sp-dh">
			<h2 id="keys-title" class="sp-path">Keys</h2>
			<button class="sp-btn" type="button" data-keys-close><kbd>Esc</kbd><span>Close</span></button>
		</div>
		<div data-keys-table></div>
	</dialog>
	<dialog class="sp-find" data-find aria-label="Find">
		<input type="search" data-find-input aria-label="Find a plan, a defect, or a question" autocomplete="off" />
		<ul role="listbox" aria-label="Results" data-find-results></ul>
		<p class="sp-find-none" data-find-none hidden>Nothing matches.</p>
		<div class="sp-foot">
			<span><kbd>↑</kbd><kbd>↓</kbd>Choose</span><span><kbd>Enter</kbd>Go</span><span><kbd>Esc</kbd>Close</span>
		</div>
	</dialog>`

export function parentOf(page: Page) {
	if (page.back !== undefined) return page.back
	const links = page.crumbs?.filter(([, href]) => href) ?? []
	return links.at(-1)?.[1] ?? null
}

export function layout(context: Context, page: Page) {
	const theme = context.theme === 'system' ? '' : html` data-theme="${context.theme}"`
	const back = parentOf(page)
	const main = html`<main id="main" class="sp-main" tabindex="-1">${page.body}</main>`
	return html`<!doctype html>
		<html lang="en" ${theme}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>${page.title} · Checkmate</title>
				<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
				<link
					rel="preload"
					href="/assets/fonts/ibm-plex-mono-500.woff2"
					as="font"
					type="font/woff2"
					crossorigin
				/>
				<link rel="stylesheet" href="/assets/style.css" />
				<script src="/assets/client.js" defer></script>
			</head>
			<body
				data-subjects="${page.subjects.join(',')}"
				data-cursor="${context.cursor}"
				${back ? html`data-back="${back}"` : ''}
			>
				<a class="skip" href="#main">Skip to content</a>
				${header(context)}
				<div class="app${page.drawer ? ' with-drawer' : ''}">
					${page.nav ? html`<div class="with-nav">${page.nav}${main}</div>` : main}
				</div>
				${statusBar(context, page)}
				${context.toast ? html`<div class="toast" role="status" data-toast>${context.toast}</div>` : ''}
				<div class="sr-only" aria-live="polite" data-announcer></div>
				${dialogs} ${viewer}
			</body>
		</html>`
}

export function crumbBar(crumbs: Page['crumbs']) {
	if (!crumbs?.length) return html``
	return html`<p class="sp-path">
		${crumbs.map(([label, href], index) => [
			index ? html` › ` : '',
			href ? html`<a href="${href}">${label}</a>` : html`<span aria-current="page">${label}</span>`,
		])}
	</p>`
}

export function heading(title: Html | string, sub: Html | string | null = null, extra: Html | string = '') {
	return html`<div class="sp-h">
		<div>
			<h1>${title}</h1>
			${sub ? html`<p class="sp-sub">${sub}</p>` : ''}
		</div>
		${extra}
	</div>`
}

export function emptyNotice(what: string, next: Html | string, extra: Html | '' = '') {
	return html`<div class="sp-empty">
		<p><b>${what}</b></p>
		<p>${next}</p>
		${extra}
	</div>`
}

export function banner(tone: 'warn' | 'info' | 'fail', content: Html | string) {
	return html`<div class="banner ${tone}" role="${tone === 'info' ? 'status' : 'alert'}">${content}</div>`
}

const downloadNames: Record<string, [string, string]> = {
	html: ['HTML', 'print-ready'],
	md: ['Markdown', '.md'],
	json: ['JSON', 'data'],
	junit: ['JUnit XML', 'for CI'],
}

export function downloads(label: string, base: string, note: string, formats = ['html', 'md', 'json']) {
	const item = (format: string) =>
		html`<a href="${base}.${format}" download data-download="${format}"
			>${downloadNames[format][0]} <span class="muted">${downloadNames[format][1]}</span></a
		>`
	return html`<details class="menu" data-menu>
		<summary class="sp-btn" title="${note}">${label}</summary>
		<div class="menu-list">
			${formats.map(item)}
			<p class="menu-note">${note}</p>
		</div>
	</details>`
}
