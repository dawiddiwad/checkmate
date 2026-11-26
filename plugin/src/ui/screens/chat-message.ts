import type { Store } from '../../store.ts'
import type { RequestRecord } from '../../requests.ts'
import { isEnded, operationCountOf } from '../../requests.ts'
import { explorationPermissions } from '../../permissions.ts'
import type { Context, Page } from '../layout.ts'
import { drawerHead } from '../components/drawer.ts'
import { crumbBar } from '../components/page-heading.ts'
import { ago, costText, html, plural, time } from '../html.ts'
import { chatMarkdown } from '../markdown.ts'
import { requestHref } from '../permissions.ts'
import {
	contextLine,
	elapsed,
	failureText,
	followOption,
	formOption,
	requestModelLabel,
	stateLabel,
} from '../requests.ts'

export function chatMessagePage(store: Store, context: Context, request: RequestRecord): Page {
	const requestId = request.id
	const now = Date.now()
	const open = explorationPermissions(store, requestId).filter((item) => !item.decision)
	const ended = isEnded(request)
	const model = requestModelLabel(request)
	const { planId, planRevision, planChat } = request.context
	const plan = planChat ? `/plans/${planId}${planRevision ? `@${planRevision}` : ''}` : null
	const chat = plan ? `${plan}?chat=${request.conversation}` : `/chats/${request.conversation}`
	const back = `${chat}${plan ? '&' : '?'}at=${encodeURIComponent(`request:${requestId}`)}`
	const details = `/chats/${request.conversation}/messages/${requestId}`
	const again = formOption(
		context,
		plan ? `${plan}/chats/${request.conversation}/turns` : `${chat}/turns`,
		request.state === 'failed' ? 1 : 2,
		'Ask again',
		'Send this message again in the same chat.',
		[
			['text', request.text],
			['return', chat],
		]
	)
	const options = !ended
		? [
				formOption(
					context,
					`/requests/${requestId}/stop`,
					1,
					'Stop this turn…',
					'Stop work on this message.',
					[['return', context.path.startsWith('/chats/') ? details : `/requests/${requestId}`]],
					{
						title: 'Stop this turn?',
						text: 'You can review any changes it already made.',
						yes: 'Stop this turn',
					}
				),
			]
		: request.state === 'failed'
			? [again]
			: [followOption(1), again]
	const failure = request.state === 'failed' ? failureText(request) : null
	const tried = ended && !request.changes.length ? operationCountOf(store, requestId) : 0
	return {
		title: 'Message details',
		section: 'chats',
		subjects: [`request:${requestId}`, 'requests'],
		crumbs: [
			['Chats', '/chats'],
			['Chat', back],
			['Message details', null],
		],
		back,
		body: html`<div
			class="sp-record"
			data-region="request-record"
			data-drawer
			data-back="${back}"
			data-chat-back="${chat}"
			data-key="request:${requestId}"
		>
			${crumbBar({
				crumbs: [
					['Chats', '/chats'],
					['Chat', back],
				],
			})}
			${drawerHead({
				label: 'Message details',
				tags: html`${stateLabel(request)}
					<span class="sp-c-id">${request.harness === 'pi' ? 'Pi' : 'Claude Code'}</span>
					${model ? html`<span class="sp-c-id">${model}</span>` : ''}
					<span class="sp-c-id">${request.asker}</span>
					<span class="sp-c-id">${ago(request.askedAt)}</span>`,
				title: 'Message details',
				onOwnPage: true,
			})}
			<section aria-labelledby="asked-title" data-key="asked">
				<h2 class="lab" id="asked-title">You asked</h2>
				<p class="sp-reply sp-asked">${request.text}</p>
				${contextLine(request.context)}
			</section>
			${
				request.state === 'waiting'
					? html`<p class="banner info" role="status" data-key="state">
							This message will start when the current turn ends.
						</p>`
					: ''
			}
			${
				open.length
					? html`<p class="banner warn" role="status" data-key="waits">
							This turn is waiting for permission.
							<a href="${requestHref(open[0], context.path)}">Answer it</a>
						</p>`
					: ''
			}
			${
				request.state === 'running' || request.activity.length
					? html`<section aria-labelledby="activity-title">
							<h2 class="lab" id="activity-title">
								Activity <span class="n">${request.activity.length}</span>
							</h2>
							${
								request.activity.length
									? html`<ol class="sp-activity" aria-live="polite">
											${request.activity.map((entry, index) => html`<li data-key="line:${index}" class="ell" title="${entry.line}">${entry.line}</li>`)}
										</ol>`
									: html`<p class="help">Waiting for the first tool call.</p>`
							}
						</section>`
					: ''
			}
			${
				request.state === 'running' || request.state === 'waiting'
					? html`<p class="help" data-key="elapsed">
							${request.state === 'running' ? html`Running for ${elapsed(request, now)}.` : ''}
						</p>`
					: ''
			}
			${
				request.state === 'answered'
					? html`<section aria-labelledby="reply-title" data-key="reply">
							<h2 class="lab" id="reply-title">Reply</h2>
							<div class="sp-reply chat-markdown">
								${request.reply?.trim() ? chatMarkdown(request.reply) : html`<p class="muted">The reply has no text.</p>`}
							</div>
						</section>`
					: ''
			}
			${
				failure
					? html`<section aria-labelledby="failed-title" data-key="failure">
							<h2 class="lab" id="failed-title">What went wrong</h2>
							<p class="banner fail" role="alert">${failure.cause}</p>
							${failure.detail ? html`<p class="help">${failure.detail}</p>` : ''}
							${failure.lines.length ? html`<pre class="sp-code" tabindex="0">${failure.lines.join('\n')}</pre>` : ''}
						</section>`
					: ''
			}
			${
				request.state === 'stopped' || request.state === 'interrupted'
					? html`<p class="banner info" role="status" data-key="state">${request.reason ?? ''}</p>`
					: ''
			}
			${
				ended
					? html`<p class="help" data-key="took">
							${request.costUsd === null ? '' : `Cost ${costText(request.costUsd, request.costPartial)}. `}Took
							${elapsed(request, now)}.
						</p>`
					: ''
			}
			${
				ended && request.denials.length
					? html`<p class="help" data-key="denials">
							${plural(request.denials.length, 'tool call was', 'tool calls were')} denied:
							${request.denials.join(', ')}.
						</p>`
					: ''
			}
			${
				ended
					? html`<section aria-labelledby="changes-title" data-key="changes">
							<h2 class="lab" id="changes-title">
								Changed <span class="n">${request.changes.length}</span>
							</h2>
							${
								request.changes.length
									? html`<ul class="sp-changes">
											${request.changes.map((change) => html`<li>${change.href ? html`<a href="${change.href}">${change.text}</a>` : change.text} <span class="muted">${time(change.at)}</span></li>`)}
										</ul>`
									: tried
										? html`<p class="help">
												The Log shows ${plural(tried, 'attempted change')} for this turn.
											</p>`
										: html`<p class="help">This turn changed no records.</p>`
							}
						</section>`
					: request.state === 'running'
						? html`<p class="help" data-key="changes">Changes appear when this turn ends.</p>`
						: ''
			}
			<section class="sp-options" aria-labelledby="options-title" data-key="options:${requestId}">
				<h2 class="lab" id="options-title">Options</h2>
				<ol class="sp-optlist asks">
					${options.map((option) => html`<li>${option}</li>`)}
				</ol>
			</section>
		</div>`,
	}
}
