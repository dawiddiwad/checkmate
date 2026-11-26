import type { RequestRecord } from '../../requests.ts'
import type { Attrs } from '../html.ts'
import { attributes, html, time } from '../html.ts'
import { chatMarkdown } from '../markdown.ts'
import { formButton } from './button.ts'
import { statusMark } from './status-mark.ts'

// The record decides what this turn saved. The reply text does not.
function savedThisTurn(changes: RequestRecord['changes']) {
	if (!changes.length) return html`<p class="sc-help" data-chat-saved>Saved this turn: nothing.</p>`
	return html`<div class="sc-turn-saved" data-chat-saved>
		<b>Saved this turn</b>
		<ul>
			${changes.map(
				(change) =>
					html`<li>${change.href ? html`<a href="${change.href}">${change.text}</a>` : change.text}</li>`
			)}
		</ul>
	</div>`
}

export type ChatTurn = {
	request: RequestRecord
	number: number
	details: string
	back: string
	csrf: string
	model: string
	failure: { cause: string; lines: string[]; detail: string | null } | null
	waitingBehind: string
	permissions: Array<{ command: string; href: string }>
	rowAttrs: Attrs
}

export function chatTurn({
	request,
	number,
	details,
	back,
	csrf,
	model,
	failure,
	waitingBehind,
	permissions,
	rowAttrs,
}: ChatTurn) {
	return html`<article
		class="sc-turn-pair"
		data-chat-turn
		tabindex="-1"
		aria-label="Turn ${number}"
		${attributes(rowAttrs)}
	>
		<div class="sc-turn is-ask">
			<div class="sc-turn-h">You ${time(request.askedAt)}</div>
			<div class="sc-turn-b"><p data-chat-content>${request.text}</p></div>
		</div>
		<div
			class="sc-turn"
			${['answered', 'failed', 'stopped', 'interrupted'].includes(request.state) ? html`data-chat-terminal="${request.state}"` : ''}
		>
			<div class="sc-turn-h">
				Checkmate
				<span
					>${request.harness === 'pi' ? 'Pi' : 'Claude Code'}${model ? ` · ${model}` : ''}${request.effort ? ` · ${request.effort}` : ''}</span
				>
				<span class="sc-turn-status"
					>${request.state === 'answered' ? '' : statusMark({ state: request.state })}
					<a href="${details}">Turn ${number}</a></span
				>
			</div>
			${request.reply ? html`<div class="sc-turn-b sc-markdown" data-chat-content>${chatMarkdown(request.reply)}</div>` : ''}
			${['answered', 'failed', 'stopped', 'interrupted'].includes(request.state) ? savedThisTurn(request.changes) : ''}
			${request.state === 'waiting' ? html`<p class="sc-help" data-chat-waiting-behind>${waitingBehind}</p>` : ''}
			${request.state === 'running' ? html`<p class="sc-help">Working…</p>` : ''}
			${permissions.map(
				(item) =>
					html`<p class="sc-notice is-warn" data-chat-waiting>
						Waiting for your permission. The chat asks to run
						<code>${item.command}</code>. <a href="${item.href}">Answer it</a>. If no one answers in about
						10 minutes, Checkmate denies the command and the reply goes on without it.
					</p>`
			)}
			${
				request.activity.length
					? html`<details data-open-key="activity:${request.id}">
							<summary>Activity (${request.activity.length})</summary>
							<ol class="sc-activity">
								${request.activity.map((entry) => html`<li>${entry.line}</li>`)}
							</ol>
						</details>`
					: ''
			}
			${
				failure
					? html`<p class="sc-notice is-error">${failure.cause}</p>
							${failure.detail ? html`<p class="sc-help">${failure.detail}</p>` : ''}${failure.lines.length ? html`<pre class="sc-code">${failure.lines.join('\n')}</pre>` : ''}`
					: request.reason
						? html`<p class="sc-notice">${request.reason}</p>`
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
			${request.state === 'running' || request.state === 'waiting' ? html`<form method="post" action="/requests/${request.id}/stop"><input type="hidden" name="csrf" value="${csrf}" /><input type="hidden" name="return" value="${back}" />${formButton({ label: 'Stop', attrs: { type: 'submit' } })}</form>` : ''}
		</div>
	</article>`
}
