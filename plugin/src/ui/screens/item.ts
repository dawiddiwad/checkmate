import type { Store } from '../../store.ts'
import { buildStateWords } from '../../rulemap.ts'
import type { EvidenceFile } from '../evidence.ts'
import type { FormState } from '../forms.ts'
import type { Html } from '../html.ts'
import type { Context } from '../layout.ts'
import type { Item, Review } from '../review.ts'
import { banner } from '../components/banner.ts'
import { button } from '../components/button.ts'
import { closeButton, drawer, drawerHead } from '../components/drawer.ts'
import { emptyLine } from '../components/empty-state.ts'
import { recordFacts } from '../components/facts.ts'
import { wordMark } from '../components/status-mark.ts'
import { htmlPreview, imageTypes, shownAsText, size } from '../evidence.ts'
import { claimEvidenceFiles } from './exploration.ts'
import { keptText } from '../forms.ts'
import { html, plural, time, words } from '../html.ts'
import { buildLabel, itemTag, latestClaimBuild, optionsOf, outside, reviewHref } from '../review.ts'

export type Refusal = { key: string; state: FormState; subject?: string }

function acrossBuilds(review: Review, item: Item) {
	const builds = item.detail?.builds ?? []
	if (!builds.length) return null
	return builds
		.map((on) => `${buildStateWords[on.state] ?? words(on.state)} in build ${buildLabel(review, on.build)}`)
		.join(', ')
		.replace(/^./, (first) => first.toUpperCase())
}

function ruleText(review: Review, rule: string | null) {
	if (rule === null || rule === outside) return 'Outside the rules of the plan.'
	const row = review.map.rows.find((each) => each.rule.id === rule)
	return row ? `${rule} ${row.rule.text}` : rule
}

export function filesOf(store: Store, review: Review, item: Item): EvidenceFile[] {
	return item.claim ? claimEvidenceFiles(store, review.planId, item.claim) : []
}

function fileRows(files: EvidenceFile[], base: string, current: number | null, viewer = false) {
	if (!files.length) return emptyLine({ text: 'The tester gave no evidence.' })
	return html`<div class="sp-files" role="listbox" aria-label="Evidence">
		${files.map(
			(file, index) =>
				html`<a
					class="sp-file${current === index ? ' hl' : ''}"
					role="option"
					aria-selected="${current === index ? 'true' : 'false'}"
					tabindex="-1"
					href="${`${base}&file=${index}`}"
					${viewer ? html`data-vfile="${index}"` : html`data-sub data-href="${`${base}&file=${index}`}"`}
					data-label="${file.name}"
					><span class="sp-file-k">${index + 1}</span
					><span class="ell" title="${file.name}">${file.name}</span
					><span class="sp-file-k">${viewer ? (file.size ? size(file.size) : '') : 'View'}</span></a
				>`
		)}
	</div>`
}

function hiddenFields(context: Context, item: Item, back: string, fields: Array<[string, string]>) {
	return html`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="return" value="${back}" data-return />
		<input type="hidden" name="item" value="${item.key}" />
		${fields.map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}`
}

function textForm(
	context: Context,
	item: Item,
	back: string,
	spec: {
		id: string
		action: string
		label: string
		name: string
		send: string
		fields: Array<[string, string]>
		value?: string
		more?: Html
		missing: string
	}
) {
	return html`<form method="post" action="${spec.action}" class="sp-form" id="${spec.id}" data-field-form>
		${hiddenFields(context, item, back, spec.fields)}
		<label for="${spec.id}-text">${spec.label}</label>
		<textarea id="${spec.id}-text" name="${spec.name}" rows="3" required data-missing="${spec.missing}">
${spec.value ?? ''}</textarea>
		${spec.more ?? ''}
		<div class="btns">
			${button({ label: spec.send, emphasis: 'primary' })}
			<span class="small muted">Enter sends. Shift+Enter starts a new line.</span>
		</div>
	</form>`
}

function claimAction(item: Item) {
	return `/explorations/${item.claim!.explorationId}/claims/${item.claim!.id}`
}

function questionAction(review: Review, item: Item) {
	if (item.question) return `/explorations/${item.question.explorationId}/questions/${item.question.id}`
	return `/plans/${review.planId}@${review.revision}/gaps/${item.id}`
}

function claimBody(
	context: Context,
	store: Store,
	review: Review,
	item: Item,
	base: string,
	back: string,
	state: FormState | null
) {
	const claim = item.claim!
	const detail = item.detail
	const files = filesOf(store, review, item)
	const uncertain = detail?.uncertain ?? []
	const decided = claim.decision
		? `${claim.decision.verdict === 'approved' ? 'Accepted' : 'Rejected'} by ${claim.decision.actor}: ${claim.decision.rationale}`
		: null
	return html`${
			uncertain.length
				? html`<p class="sp-why">
						${uncertain.map((reason) => `${words(reason.reason)}${reason.text ? `: ${reason.text}` : ''}`).join(' · ')}
					</p>`
				: ''
		}
		<div class="sp-ea">
			<div>
				<span class="sp-lbl">Expected</span>
				<p>${claim.expected}</p>
			</div>
			<div>
				<span class="sp-lbl">Actual</span>
				<p>${claim.actual}</p>
			</div>
		</div>
		${
			claim.steps?.length
				? html`<div>
						<span class="sp-lbl">Steps</span>
						<ol class="sp-steps">
							${(Array.isArray(claim.steps) ? claim.steps : [claim.steps]).map((step) => html`<li>${step}</li>`)}
						</ol>
					</div>`
				: ''
		}
		<div><span class="sp-lbl">Evidence</span>${fileRows(files, base, null)}</div>
		${recordFacts({
			rows: [
				['Across builds', acrossBuilds(review, item)],
				['Rule', ruleText(review, item.rule)],
				['Seen by', claim.actors.join(', ')],
				['State', words(claim.state)],
				['Decision', decided],
				['Handed over', claim.handoff ? `To ${claim.handoff.to}, by ${claim.handoff.actor}` : null],
			],
		})}
		${
			item.kind === 'finding'
				? textForm(context, item, back, {
						id: 'reject',
						action: claimAction(item),
						label: 'Why is it not a defect?',
						name: 'rationale',
						send: 'Reject',
						missing: 'Write a short reason for the reject.',
						fields: [['verdict', 'rejected']],
						value: state?.values.rationale,
					})
				: ''
		}
		${
			item.kind === 'defect' && !claim.handoff
				? textForm(context, item, back, {
						id: 'handoff',
						action: `/plans/${review.planId}/handoff`,
						label: 'Hand over to whom?',
						name: 'to',
						send: 'Hand over',
						missing: 'Name who takes the defect.',
						fields: [['claim', item.id]],
					})
				: ''
		}`
}

function questionBody(context: Context, review: Review, item: Item, back: string, state: FormState | null) {
	const question = item.question
	const members = question?.members ?? []
	const open = item.kind === 'question' || item.kind === 'gap' || item.kind === 'deferred'
	const more = html`<details class="sp-more">
		<summary>Source and reason</summary>
		<div class="sp-form">
			<label for="answer-source">Source</label>
			<input
				id="answer-source"
				name="source"
				value="${state?.values.source ?? ''}"
				placeholder="${context.actor ?? 'You'}, in the review UI"
			/>
			<label for="answer-rationale">Reason</label>
			<input id="answer-rationale" name="rationale" value="${state?.values.rationale ?? ''}" />
		</div>
	</details>`
	return html`${question?.actual ? html`<p class="sp-today"><span class="sp-lbl">What the build does</span>${question.actual}</p>` : ''}
	${recordFacts({
		rows: [
			['Rule', item.kind === 'gap' ? null : ruleText(review, item.rule)],
			['Topic', item.topic],
			['Asked on', question?.builds.map((build) => `${buildLabel(review, build)} ${build}`).join(', ') ?? null],
			[
				'Asked by',
				members.length > 1
					? `${plural(members.length, 'question')}: ${members.join(', ')}. One answer answers all of them.`
					: (members[0] ?? null),
			],
			['Blocks testing', item.blocking ? 'Yes' : null],
			[
				'From',
				item.waiting?.runId ? html`run <a href="/runs/${item.waiting.runId}">${item.waiting.runId}</a>` : null,
			],
			['Answer', question?.answer ?? null],
		],
	})}
	${
		open
			? textForm(context, item, back, {
					id: 'answer',
					action: questionAction(review, item),
					label: 'How it should be, in one sentence',
					name: 'value',
					send: 'Send the answer',
					missing: 'Write the answer.',
					fields: [
						...(item.kind === 'gap' ? [['sha', review.sha] as [string, string]] : []),
						['kind', 'clarify'],
					],
					value: state?.values.kind === 'clarify' ? state.values.value : undefined,
					more,
				})
			: ''
	}`
}

function approvalBody(item: Item) {
	return html`<p class="sp-today">${item.title}</p>
		<div class="btns">
			${button({
				label: `Open ${item.kind === 'approval' && item.key.startsWith('p:') ? 'the plan' : 'the run'} to decide`,
				href: item.href,
				emphasis: 'primary',
				attrs: { 'data-sub': true, 'data-href': item.href, 'data-label': 'Open' },
			})}
		</div>`
}

export function recordDrawer(
	store: Store,
	context: Context,
	review: Review,
	item: Item,
	view: string,
	refusal: Refusal | null
) {
	const list = reviewHref(review.planId, view, `&at=${encodeURIComponent(item.key)}&focus=list`)
	const base = reviewHref(review.planId, view, `&item=${encodeURIComponent(item.key)}`)
	const state = refusal?.key === item.key ? refusal.state : null
	const options = optionsOf({ ...context, path: list }, review, item)
	const body = item.claim
		? claimBody(context, store, review, item, base, list, state)
		: item.kind === 'approval'
			? approvalBody(item)
			: questionBody(context, review, item, list, state)
	const when = item.claim ? null : (item.question?.at ?? item.waiting?.since ?? null)
	return drawer({
		back: list,
		key: `record:${item.key}`,
		path: `${review.planId} › ${view === 'needs' ? 'Needs you' : view.replace(/^[a-z]+:/, '')} › ${item.id}`,
		slot: state
			? html`<div data-stale-slot>
					${state.stale ? banner({ kind: 'warn', content: state.stale }) : ''}${state.error ? html`<p class="form-error" role="alert">${state.error}</p>` : ''}${keptText(state)}
				</div>`
			: html`<div data-stale-slot></div>`,
		head: drawerHead({
			label: item.id,
			tags: html`${itemTag(item)}
				${item.detail && item.kind !== 'rejected' ? wordMark({ state: 'build_state', label: buildStateWords[latestClaimBuild(item.detail)?.state ?? ''] ?? '' }) : ''}
				${item.claim?.handoff ? wordMark({ state: 'handed_over', label: 'Handed over' }) : ''}
				<span class="sp-c-id">${item.id}</span>
				${when ? html`<span class="sp-c-id">${time(when)}</span>` : ''}`,
			title: item.title,
			options,
		}),
		body,
	})
}

function preview(file: EvidenceFile) {
	if (file.size === 0 && file.href) return emptyLine({ text: 'Empty file.' })
	if (file.href && imageTypes.includes(file.mediaType))
		return html`<img src="${file.href}" alt="Evidence ${file.name}" data-ev-image /><span class="sp-empty" hidden
				>This image cannot be shown.</span
			>`
	if (file.text && (!file.href || shownAsText(file.mediaType, file.size)))
		return html`<pre tabindex="0">${file.text()}</pre>`
	return htmlPreview(file) ?? emptyLine({ text: 'No preview for this file type.' })
}

export function evidenceViewer(store: Store, review: Review, item: Item, view: string, index: number) {
	const files = filesOf(store, review, item)
	const base = reviewHref(review.planId, view, `&item=${encodeURIComponent(item.key)}`)
	const shown = Math.min(Math.max(0, index), files.length - 1)
	return html`<section class="sp-viewer" aria-label="Evidence of ${item.id}" data-viewer-pane data-back="${base}">
		<div class="sp-dh">
			<p class="sp-path">
				${review.planId} › ${item.id} › Evidence › <span data-file-name>${files[shown]?.name ?? ''}</span>
			</p>
			${closeButton({ href: base })}
		</div>
		<div class="sp-vb">
			${fileRows(files, base, shown, true)}
			<div>
				${files.map(
					(file, n) =>
						html`<figure class="sp-fig" data-vfig="${n}" ${n === shown ? '' : html`hidden`}>
							${preview(file)}
							<figcaption>
								<span class="ell" title="${file.name}"
									>${file.name}${file.size ? ` · ${size(file.size)}` : ''}</span
								>
								${file.href ? button({ label: 'Download', href: file.href, attrs: { download: file.name } }) : ''}
							</figcaption>
						</figure>`
				)}
			</div>
		</div>
	</section>`
}
