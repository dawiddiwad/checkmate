import type { Store } from '../../store.ts'
import { permissionOf, permissionRules } from '../../permissions.ts'
import type { Context, Page } from '../layout.ts'
import type { PermissionRefusal } from '../permissions.ts'
import { button, formButton } from '../components/button.ts'
import { drawerHead } from '../components/drawer.ts'
import { crumbBar, heading } from '../components/page-heading.ts'
import { statusMark } from '../components/status-mark.ts'
import { ago, html, time } from '../html.ts'
import {
	askBadge,
	askHeading,
	asked,
	askerName,
	askerPath,
	breakAtSlashes,
	choicesOf,
	hidden,
	nextOpen,
	optionOf,
	recordPath,
	requestHref,
	requestName,
	rulesLines,
	stateOf,
	stateText,
	waitsFor,
} from '../permissions.ts'

export function permissionPage(
	store: Store,
	context: Context,
	askerId: string,
	requestId: string,
	view: { from: string | null; history: boolean },
	refusal: PermissionRefusal | null
): Page | null {
	const item = permissionOf(store, askerId, requestId)
	if (!item) return null
	const { from } = view
	const asker = askerPath(store, item)
	const back = from ?? asker.fallback
	const moves = item.decision && !view.history
	const next = nextOpen(store, item)
	const after = next ? requestHref(next, from) : back
	const name = requestName(item)
	const rules = permissionRules(store, askerId)
	const choices = item.decision ? [] : choicesOf(item)
	const title = askHeading(item)
	return {
		title: `${name} · Permission request`,
		section: 'home',
		subjects: [
			item.fromRequest ? `request:${askerId}` : `exploration:${askerId}`,
			...(item.planId ? [`plan:${item.planId}`] : []),
		],
		crumbs: [
			['Plans', '/'],
			...(item.planId ? [[item.planId, `/plans/${item.planId}`] as [string, string]] : []),
			[askerId, asker.href] as [string, string],
			[item.id, null],
		],
		back,
		status: refusal ? 422 : 200,
		body: html`<div
			class="sc-record"
			data-region="permission-record"
			data-drawer
			data-back="${back}"
			data-key="record:${name}"
			data-decided-message="${item.decision ? stateText(item) : ''}"
			${moves ? html`data-moves-on data-next="${after}"` : ''}
		>
			${crumbBar({ crumbs: [...(item.planId ? [[item.planId, `/plans/${item.planId}`] as [string, string]] : []), [askerId, asker.href]] })}
			<div data-stale-slot>
				${refusal && !refusal.field ? html`<p class="sc-error" role="alert">${refusal.error}</p>` : ''}
			</div>
			${drawerHead({
				label: name,
				tags: html`${item.decision ? statusMark({ state: item.decision.kind === 'closed' ? 'stopped' : 'completed', label: item.decision.kind === 'closed' ? 'Closed' : 'Answered' }) : askBadge()}
					<span class="sc-c-id">${name}</span>
					<span class="sc-c-id">${item.decision ? ago(item.at) : waitsFor(item)}</span>`,
				title,
				titleText: title,
				onOwnPage: true,
			})}
			${
				item.decision
					? html`<p class="sc-notice" role="status" data-key="state">
							${stateOf(item)}
							${
								moves
									? html`This view moves on in 2 seconds. Press any key to move on now.`
									: html`This request has no options now.`
							}
						</p>`
					: ''
			}
			<section aria-labelledby="asked-title">
				<h2 class="sc-label" id="asked-title">What it asks</h2>
				${asked(item)}
			</section>
			${
				choices.length
					? html`<section class="sc-opt-section" aria-labelledby="options-title" data-key="options:${name}">
							<h2 class="sc-label" id="options-title">Options</h2>
							<ol class="sc-ask-list asks">
								${choices.map((choice, index) => html`<li>${optionOf(context, item, from, choice, index + 1)}<span class="sc-help">${choice.text}</span></li>`)}
							</ol>
							<div class="sc-c-extra" data-extra="deny" ${refusal?.field ? '' : html`hidden`}>
								<form
									method="post"
									action="${recordPath(item)}"
									class="sc-form"
									id="deny"
									data-field-form
								>
									${hidden('csrf', context.csrf)}${from ? hidden('from', from) : ''}${hidden('decision', 'deny')}
									<label for="deny-text">Why do you deny it? The tester gets this text.</label>
									<textarea
										id="deny-text"
										name="reason"
										rows="3"
										required
										data-missing="Write the reason first. The tester gets it."
									>
${refusal?.reason ?? ''}</textarea>
									${refusal?.field ? html`<p class="sc-error" role="alert" data-field="reason">${refusal.error}</p>` : ''}
									<div class="sc-row-btns">
										${button({ label: 'Deny', emphasis: 'primary' })}
										<span class="sc-note sc-muted"
											>Enter sends. Shift+Enter starts a new line. Esc keeps the draft.</span
										>
									</div>
								</form>
							</div>
						</section>`
					: ''
			}
			<section aria-labelledby="details-title">
				<h2 class="sc-label" id="details-title">Details</h2>
				<dl class="sc-facts">
					<dt>Tool</dt>
					<dd class="sc-mono">${item.tool}</dd>
					<dt>Folder</dt>
					<dd class="path">
						${item.cwd ? html`<code>${breakAtSlashes(item.cwd)}</code>` : html`<span class="sc-muted">not recorded</span>`}
					</dd>
					<dt>Asked by</dt>
					<dd>${askerName(item)}</dd>
					<dt>Since</dt>
					<dd>${time(item.at)}</dd>
					<dt>${asker.label}</dt>
					<dd><a href="${asker.href}">${askerId}</a></dd>
					${
						item.planId
							? html`<dt>Plan</dt>
									<dd><a href="/plans/${item.planId}">${item.planId}</a></dd>`
							: ''
					}
				</dl>
			</section>
			${
				rules.length
					? html`<section aria-labelledby="rules-title">
							<h2 class="sc-label" id="rules-title">
								Rules of this ${item.fromRequest ? 'chat' : 'test'}
							</h2>
							${rulesLines(rules, item.fromRequest ? 'chat' : 'test')}
						</section>`
					: ''
			}
		</div>`,
	}
}

export function emptyRecord(explorationId: string, requestId: string): Page {
	return {
		title: 'No such request',
		section: null,
		subjects: ['inbox'],
		status: 404,
		back: '/activity',
		body: html`${heading({ title: 'No such request', sub: `Run ${explorationId} has no permission request ${requestId}.` })}
			<p class="sc-row-btns">${formButton({ label: 'Activity', href: '/activity', emphasis: 'primary' })}</p>`,
	}
}
