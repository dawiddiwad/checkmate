import type { Html } from '../html.ts'
import { html } from '../html.ts'

export type NoticeKind = 'warn' | 'info' | 'fail'

const look: Record<NoticeKind, string> = { info: 'sc-notice', warn: 'sc-notice is-warn', fail: 'sc-notice is-error' }

export function notice({ kind, content }: { kind: NoticeKind; content: Html | string }) {
	return html`<div class="${look[kind]}" role="${kind === 'info' ? 'status' : 'alert'}">${content}</div>`
}
