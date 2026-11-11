import type { Html } from './html.ts'
import { html } from './html.ts'

export type Theme = 'system' | 'light' | 'dark'
export type Section = 'inbox' | 'plans' | 'runs' | 'log' | null

export type Context = {
	path: string
	csrf: string
	actor: string | null
	theme: Theme
	toast: string | null
	inboxCount: number
	cursor: number
	workspace: string
}

export type Page = {
	title: string
	section: Section
	subjects: string[]
	body: Html
	status?: number
}

const nextTheme: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const themeIcons = html`<svg class="ti ti-system" viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
		<path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
	</svg>
	<svg class="ti ti-light" viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="8" cy="8" r="3" fill="currentColor" />
		<path
			d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
		/>
	</svg>
	<svg class="ti ti-dark" viewBox="0 0 16 16" aria-hidden="true">
		<path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" fill="currentColor" />
	</svg>`

export function mark() {
	return html`<span class="mark" aria-hidden="true"><i></i><i></i><i class="on"></i><i></i></span>`
}

function navLink(context: Context, page: Page, section: Section, href: string, label: string, extra: Html | '' = '') {
	const current = page.section === section ? html` aria-current="page"` : ''
	return html`<li><a href="${href}" ${current}>${label}${extra}</a></li>`
}

function themeForm(context: Context) {
	const next = nextTheme[context.theme]
	return html`<form method="post" action="/theme" class="theme-form" data-theme-form>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="back" value="${context.path}" />
		<button
			class="icon-btn"
			name="theme"
			value="${next}"
			data-current="${context.theme}"
			title="Theme: ${context.theme}. Switch to ${next}."
			aria-label="Theme: ${context.theme}. Switch to ${next}."
		>
			${themeIcons}
		</button>
	</form>`
}

function header(context: Context, page: Page) {
	const count = html`<b class="count" data-region="nav-count">${context.inboxCount || ''}</b>`
	const actor = context.actor
		? html`<a class="actor" href="/actor?back=${encodeURIComponent(context.path)}" title="Change your name"
				>actor: ${context.actor}</a
			>`
		: html`<a class="actor" href="/actor?back=${encodeURIComponent(context.path)}">Set your name</a>`
	return html`<header class="bar">
		<div class="bar-in">
			<a class="brand" href="/">${mark()}<span>checkmate</span></a>
			<nav aria-label="Main">
				<ul class="nav">
					${navLink(context, page, 'inbox', '/', 'Inbox', count)}
					${navLink(context, page, 'plans', '/plans', 'Plans')}
					${navLink(context, page, 'runs', '/runs', 'Runs')} ${navLink(context, page, 'log', '/log', 'Log')}
				</ul>
			</nav>
			<div class="who">
				<span class="live" data-live hidden>○ Connecting…</span>
				${actor} ${themeForm(context)}
				<button
					class="icon-btn"
					type="button"
					data-shortcuts-open
					hidden
					aria-label="Keyboard shortcuts"
					title="Keyboard shortcuts (?)"
				>
					?
				</button>
			</div>
		</div>
	</header>`
}

const shortcuts = html`<aside class="shortcuts" data-shortcuts hidden aria-labelledby="shortcuts-title">
	<div class="shortcuts-head">
		<h2 id="shortcuts-title">Keyboard shortcuts</h2>
		<button class="icon-btn" type="button" data-shortcuts-close aria-label="Close shortcuts">×</button>
	</div>
	<dl>
		<dt><kbd>/</kbd></dt>
		<dd>Search or filter</dd>
		<dt><kbd>j</kbd> <kbd>k</kbd></dt>
		<dd>Next or previous item</dd>
		<dt><kbd>Enter</kbd></dt>
		<dd>Open the item</dd>
		<dt><kbd>g</kbd> <kbd>i</kbd></dt>
		<dd>Go to the inbox</dd>
		<dt><kbd>Esc</kbd></dt>
		<dd>Close the viewer or this panel</dd>
		<dt><kbd>?</kbd></dt>
		<dd>Show these shortcuts</dd>
	</dl>
</aside>`

const viewer = html`<div
	class="viewer"
	data-viewer
	hidden
	role="dialog"
	aria-modal="false"
	aria-label="Evidence viewer"
>
	<div class="viewer-bar">
		<span class="viewer-name" data-viewer-name></span>
		<a class="btn" data-viewer-open href="#" target="_blank" rel="noopener">Open original</a>
		<button class="btn" type="button" data-viewer-close>Close <kbd>Esc</kbd></button>
	</div>
	<div class="viewer-body"><img data-viewer-image alt="" /></div>
</div>`

export function layout(context: Context, page: Page) {
	const theme = context.theme === 'system' ? '' : html` data-theme="${context.theme}"`
	return html`<!doctype html>
		<html lang="en" ${theme}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>${page.title} · Checkmate</title>
				<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
				<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin />
				<link rel="stylesheet" href="/assets/style.css" />
				<script src="/assets/client.js" defer></script>
			</head>
			<body data-subjects="${page.subjects.join(',')}" data-cursor="${context.cursor}">
				<a class="skip" href="#main">Skip to content</a>
				${header(context, page)}
				<main id="main" tabindex="-1">${page.body}</main>
				<footer class="foot">
					<span>Workspace <code>${context.workspace}</code></span>
					<span>Press <kbd>?</kbd> for keyboard shortcuts</span>
				</footer>
				${context.toast ? html`<div class="toast" role="status" data-toast>${context.toast}</div>` : ''}
				<div class="sr-only" aria-live="polite" data-announcer></div>
				${shortcuts} ${viewer}
			</body>
		</html>`
}

export function heading(title: Html | string, sub: Html | string | null = null, extra: Html | string = '') {
	return html`<div class="page-head">
		<div>
			<h1>${title}</h1>
			${sub ? html`<p class="sub">${sub}</p>` : ''}
		</div>
		${extra}
	</div>`
}

export function banner(tone: 'warn' | 'info' | 'fail', content: Html | string) {
	return html`<div class="banner ${tone}" role="${tone === 'info' ? 'status' : 'alert'}">${content}</div>`
}
