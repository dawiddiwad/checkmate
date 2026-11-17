import type { Html } from './html.ts'
import type { Context } from './layout.ts'
import { html, plural } from './html.ts'
import { actorField, hidden } from './forms.ts'

export type Picked = {
	key: string
	kind: 'question' | 'gap' | 'claim'
	planId: string
	id: string
	title: string
	explorationId: string | null
}

export type BulkState = {
	what: 'questions' | 'claims'
	values: Record<string, string>
	error: string | null
	confirm: boolean
}

const kindLabels: Record<string, string> = {
	defer: 'Defer',
	clarify: 'Clarify',
	accept_assumption: 'Accept assumption',
}

export function answerDefaults(values: Record<string, string>, actor: string) {
	const kind = values.kind || 'defer'
	return {
		kind,
		value: values.value?.trim() || (kind === 'defer' ? 'Deferred in the review UI.' : ''),
		source: values.source?.trim() || `${actor}, in the review UI`,
		rationale: values.rationale?.trim() || 'Answered in the review UI. No reason was given.',
	}
}

export function claimDefaults(values: Record<string, string>) {
	const verdict = values.verdict === 'rejected' ? ('rejected' as const) : ('approved' as const)
	return {
		verdict,
		rationale:
			values.rationale?.trim() ||
			(verdict === 'approved' ? 'Accepted in the review UI. No reason was given.' : ''),
	}
}

export function bulkProblem(what: BulkState['what'], values: Record<string, string>, actor: string) {
	if (!actor) return 'Enter your name. Checkmate records it with each decision.'
	if (what === 'questions') {
		const answer = answerDefaults(values, actor)
		if (!kindLabels[answer.kind]) return 'Choose Defer, Clarify, or Accept assumption.'
		if (!answer.value) return 'Write the answer. Only Defer needs no answer.'
		return null
	}
	if (values.verdict !== 'approved' && values.verdict !== 'rejected') return 'Choose Accept or Reject.'
	if (!claimDefaults(values).rationale) return 'Write a short reason for the reject.'
	return null
}

export function pickBox(key: string, label: string, checked: boolean) {
	return html`<input
		class="pick"
		type="checkbox"
		name="pick"
		value="${key}"
		form="bulk"
		tabindex="-1"
		aria-label="Select ${label}"
		data-pick
		${checked ? html`checked` : ''}
	/>`
}

function leftNote(left: number) {
	if (!left) return ''
	const text =
		left === 1
			? '1 selected row is not in this view. It is not selected now.'
			: `${left} selected rows are not in this view. They are not selected now.`
	return html`<p class="bulk-note" role="status">${text}</p>`
}

export function bulkBar(action: string, fields: Array<[string, string]>, count: number, clear: string, left = 0) {
	return html`<form
		id="bulk"
		class="bulk-bar"
		method="get"
		action="${action}"
		data-bulk-form
		${count ? '' : html`data-empty`}
	>
		${fields.map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}
		<span class="bulk-count" data-bulk-count
			>${count ? `${count} selected` : 'Select rows with x or the boxes.'}</span
		>
		<button class="btn small" data-bulk-submit>Act on selected</button>
		${count ? html`<a class="btn small ghost" href="${clear}" data-queue-go>Clear</a>` : ''} ${leftNote(left)}
	</form>`
}

function pickedList(picked: Picked[]) {
	return html`<ul class="plist bulk-items">
		${picked.map((item) => html`<li><span class="mono">${item.planId} · ${item.id}</span> ${item.title}</li>`)}
	</ul>`
}

function carried(picked: Picked[], what: BulkState['what'], back: string) {
	return html`${picked.map((item) => html`<input type="hidden" name="pick" value="${item.key}" />`)}
		<input type="hidden" name="what" value="${what}" />
		<input type="hidden" name="return" value="${back}" />`
}

function questionForm(context: Context, picked: Picked[], back: string, state: BulkState | null) {
	const values = state?.what === 'questions' ? state.values : {}
	const kind = values.kind || 'defer'
	if (state?.what === 'questions' && state.confirm) {
		const answer = answerDefaults(values, context.actor ?? values.actor ?? '')
		return html`<form method="post" action="/bulk" class="decision-form" data-bulk-confirm>
			${hidden(context, '')} ${carried(picked, 'questions', back)}
			${Object.entries(values).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}
			<div class="confirm-box">
				<p class="lab">Confirm</p>
				<p>
					This records <strong>${kindLabels[answer.kind]}</strong> for ${plural(picked.length, 'question')},
					as ${context.actor ?? values.actor}. Each answer is one entry in the log.
				</p>
				<dl class="facts">
					<div>
						<dt>Answer</dt>
						<dd>${answer.value}</dd>
					</div>
					<div>
						<dt>Source</dt>
						<dd>${answer.source}</dd>
					</div>
					<div>
						<dt>Reason</dt>
						<dd>${answer.rationale}</dd>
					</div>
				</dl>
				${pickedList(picked)}
			</div>
			<div class="btns">
				<button class="btn primary" name="confirmed" value="1" data-bulk-send>
					Confirm ${plural(picked.length, 'answer')}
				</button>
				<button class="btn" name="back" value="1">Back</button>
			</div>
		</form>`
	}
	return html`<form method="post" action="/bulk" class="decision-form" data-bulk-questions>
		${hidden(context, '')} ${carried(picked, 'questions', back)}
		<fieldset class="seg-field">
			<legend class="lab">One answer for ${plural(picked.length, 'question')}</legend>
			<div class="seg">
				${['defer', 'clarify', 'accept_assumption'].map(
					(value) =>
						html`<input
								type="radio"
								id="bulk-kind-${value}"
								name="kind"
								value="${value}"
								${kind === value ? html`checked` : ''}
							/><label for="bulk-kind-${value}">${kindLabels[value]}</label>`
				)}
			</div>
		</fieldset>
		<label class="lab" for="bulk-value">Answer <span class="req">not needed to defer</span></label>
		<textarea id="bulk-value" name="value" rows="2" data-missing="Write the answer. Only Defer needs no answer.">
${values.value ?? ''}</textarea>
		<details class="more" ${values.source || values.rationale ? html`open` : ''}>
			<summary>Add source and reason</summary>
			<label class="lab" for="bulk-source">Source</label>
			<input id="bulk-source" name="source" value="${values.source ?? ''}" />
			<label class="lab" for="bulk-rationale">Reason</label>
			<textarea id="bulk-rationale" name="rationale" rows="2">${values.rationale ?? ''}</textarea>
		</details>
		${actorField(context, { values, error: null, stale: null, confirm: false })}
		<div class="btns">
			<button class="btn primary" data-bulk-review>Review ${plural(picked.length, 'answer')}</button>
		</div>
	</form>`
}

function claimForm(context: Context, picked: Picked[], back: string, state: BulkState | null) {
	const values = state?.what === 'claims' ? state.values : {}
	if (state?.what === 'claims' && state.confirm) {
		const decision = claimDefaults(values)
		const verb = decision.verdict === 'approved' ? 'Accept' : 'Reject'
		return html`<form method="post" action="/bulk" class="decision-form" data-bulk-confirm>
			${hidden(context, '')} ${carried(picked, 'claims', back)}
			${Object.entries(values).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}
			<div class="confirm-box">
				<p class="lab">Confirm</p>
				<p>
					This records <strong>${verb === 'Accept' ? 'Accept as a defect' : 'Reject'}</strong> for
					${plural(picked.length, 'claim')}, as ${context.actor ?? values.actor}. Each decision is one entry
					in the log.
				</p>
				<dl class="facts">
					<div>
						<dt>Reason</dt>
						<dd>${decision.rationale}</dd>
					</div>
				</dl>
				${pickedList(picked)}
			</div>
			<div class="btns">
				<button class="btn primary" name="confirmed" value="1" data-bulk-send>
					${verb} ${plural(picked.length, 'claim')}
				</button>
				<button class="btn" name="back" value="1">Back</button>
			</div>
		</form>`
	}
	return html`<form method="post" action="/bulk" class="decision-form" data-bulk-claims>
		${hidden(context, '')} ${carried(picked, 'claims', back)}
		<label class="lab" for="bulk-reason"
			>Reason for ${plural(picked.length, 'claim')} <span class="req">needed to reject</span></label
		>
		<textarea id="bulk-reason" name="rationale" rows="2" placeholder="Optional to accept">
${values.rationale ?? ''}</textarea>
		${actorField(context, { values, error: null, stale: null, confirm: false })}
		<div class="btns">
			<button class="btn primary" name="verdict" value="approved">
				Accept ${plural(picked.length, 'claim')}
			</button>
			<button class="btn" name="verdict" value="rejected">Reject ${plural(picked.length, 'claim')}</button>
		</div>
	</form>`
}

export function bulkPanel(context: Context, picked: Picked[], back: string, state: BulkState | null): Html {
	const questions = picked.filter((item) => item.kind !== 'claim')
	const claims = picked.filter((item) => item.kind === 'claim')
	return html`<div class="q-crumbs">
			<nav aria-label="Breadcrumb">
				<ol>
					<li><a href="${back}" data-queue-go>Clear the selection</a></li>
				</ol>
			</nav>
		</div>
		<h2 class="q-h">
			${picked.length ? `${plural(picked.length, 'item')} selected` : 'No selected item waits now'}
		</h2>
		${state?.error ? html`<p class="form-error" role="alert">${state.error}</p>` : ''}
		${
			questions.length
				? html`<section class="panel decision" aria-labelledby="bulk-questions" data-region="decision">
						<h3 class="lab" id="bulk-questions">${plural(questions.length, 'question')}</h3>
						${state?.confirm && state.what === 'questions' ? '' : pickedList(questions)}
						${questionForm(context, questions, back, state)}
					</section>`
				: ''
		}
		${
			claims.length
				? html`<section class="panel decision" aria-labelledby="bulk-claims" data-region="decision">
						<h3 class="lab" id="bulk-claims">${plural(claims.length, 'claim')}</h3>
						${state?.confirm && state.what === 'claims' ? '' : pickedList(claims)}
						${claimForm(context, claims, back, state)}
					</section>`
				: ''
		}`
}
