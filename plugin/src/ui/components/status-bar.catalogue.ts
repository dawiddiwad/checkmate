import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { html } from '../html.ts'
import { statusBar } from './status-bar.ts'

const context: Context = {
	harness: 'claude',
	path: '/catalogue',
	csrf: 'catalogue',
	actor: 'qa-lead',
	theme: 'system',
	toast: null,
	queueCount: 0,
	permissions: 0,
	requests: { running: null, unread: 0, firstUnread: null },
	running: 0,
	cursor: 0,
	workspace: '/workspace',
	testerRules: '',
}

const page: Page = { title: 'Catalogue', section: null, subjects: [], body: html`` }

export const examples: Array<[string, Html | string]> = [
	['statusBar quiet', statusBar({ context, page })],
	[
		'statusBar with work waiting',
		statusBar({
			context: {
				...context,
				actor: null,
				queueCount: 3,
				permissions: 1,
				running: 2,
				requests: {
					running: 'R1',
					runningChat: 'chat-1',
					unread: 2,
					firstUnread: 'R2',
					firstUnreadChat: 'chat-2',
				},
			},
			page: {
				...page,
				section: 'activity',
				crumbs: [
					['Plans', '/'],
					['checkout', null],
				],
			},
		}),
	],
]
