import type { Harness } from '../pi.ts'
import type { Html } from './html.ts'
import { confirmDialog } from './components/confirm-dialog.ts'
import { evidenceOverlay } from './components/evidence-viewer.ts'
import { findPalette } from './components/find-palette.ts'
import { keysHelp } from './components/keys-help.ts'
import { statusBar } from './components/status-bar.ts'
import { html } from './html.ts'

export type Theme = 'system' | 'light' | 'dark'
export type Section = 'home' | 'activity' | 'runs' | 'log' | 'settings' | 'chats' | null

export type Context = {
	harness: Harness
	path: string
	csrf: string
	actor: string | null
	theme: Theme
	toast: string | null
	queueCount: number
	permissions: number
	requests: {
		running: string | null
		runningChat?: string | null
		unread: number
		firstUnread: string | null
		firstUnreadChat?: string | null
	}
	running: number
	cursor: number
	workspace: string
	testerRules: string
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
	address?: string
	viewer?: boolean
	drawer?: boolean
}

export function parentOf(page: Page) {
	if (page.back !== undefined) return page.back
	const links = page.crumbs?.filter(([, href]) => href) ?? []
	return links.at(-1)?.[1] ?? null
}

function cut(text: string) {
	return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

export function layout(context: Context, page: Page) {
	const theme = context.theme === 'system' ? '' : html` data-theme="${context.theme}"`
	const back = parentOf(page)
	const main = html`<main id="main" class="sc-main${page.nav ? '' : ' is-wide'}" tabindex="-1">${page.body}</main>`
	return html`<!doctype html>
		<html lang="en" ${theme}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>${page.title} · Checkmate</title>
				<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
				<link rel="stylesheet" href="/assets/style.css" />
				<script src="/assets/client.js" defer></script>
			</head>
			<body
				class="sc-app"
				data-subjects="${page.subjects.join(',')}"
				data-cursor="${context.cursor}"
				${back ? html`data-back="${back}"` : ''}
				${page.address ? html`data-address="${page.address}"` : ''}
			>
				<a class="skip" href="#main">Skip to content</a>
				<div class="sc-shell${page.drawer ? ' has-drawer' : ''}">
					${page.nav ? html`<div class="sc-body">${page.nav}${main}</div>` : main}
				</div>
				${statusBar({ context, page })}
				<div class="sc-saystrip" role="status" data-say-strip hidden></div>
				${context.toast ? html`<div class="toast" role="status" data-toast title="${context.toast}">${cut(context.toast)}</div>` : ''}
				<div class="sc-sr" aria-live="polite" data-announcer></div>
				${keysHelp()} ${findPalette({ harness: context.harness })} ${confirmDialog()}
				${page.viewer ? evidenceOverlay : ''}
			</body>
		</html>`
}
