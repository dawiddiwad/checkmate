import type { Html } from './html.ts'
import type { Context } from './layout.ts'
import { notice } from './components/notice.ts'
import { formButton } from './components/button.ts'
import { field, textArea, textInput } from './components/field.ts'
import { actorLimit, html, short } from './html.ts'

export type FormState = {
	values: Record<string, string>
	error: string | null
	stale: Html | null
	confirm: boolean
}

export type Verdict = {
	action: string
	subject: string
	question: string
	sha256: string
	token: string
	digestLabel: string
	approve: { value: string; label: string; confirm: string; summary: string }
	reject: { value: string; label: string; confirm: string; summary: string }
	staleMessage: string
	intro?: Html | ''
	extra?: Html
}

export function emptyState(): FormState {
	return { values: {}, error: null, stale: null, confirm: false }
}

export function hidden(context: Context, sha256: string, token = '') {
	return html`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />
		${token ? html`<input type="hidden" name="decision" value="${token}" />` : ''}`
}

export function actorField(context: Context, state: FormState) {
	if (context.actor) return ''
	return html`${field({ id: 'actor', label: 'Your name', control: textInput({ id: 'actor', name: 'actor', value: state.values.actor ?? '', attrs: { required: true, maxlength: actorLimit, autocomplete: 'name', 'data-missing': 'Enter your name. Checkmate records it with your decision.' } }), help: 'Checkmate asks once, keeps it in a cookie, and records it with each decision.' })}`
}

export function messages(state: FormState) {
	return html`${state.stale ? notice({ kind: 'warn', content: state.stale }) : ''}
	${state.error ? html`<p class="form-error" role="alert">${state.error}</p>` : ''}`
}

export function keptText(state: FormState) {
	const typed = state.values.value || state.values.rationale || ''
	if (!typed.trim()) return ''
	return html`<div class="kept" data-kept>
		<p class="lab">Your text</p>
		<blockquote>${typed}</blockquote>
	</div>`
}

export function rationaleField(
	state: FormState,
	placeholder: string,
	missing = 'Write a rationale. Checkmate records it with your decision.'
) {
	return html`${field({ id: 'rationale', label: 'Rationale', control: textArea({ id: 'rationale', name: 'rationale', rows: 4, value: state.values.rationale ?? '', attrs: { required: true, 'data-rationale': true, placeholder: placeholder, 'data-missing': missing } }) })}`
}

function confirmStep(context: Context, verdict: Verdict, state: FormState) {
	const choice = state.values.verdict === verdict.reject.value ? verdict.reject : verdict.approve
	return html`<form method="post" action="${verdict.action}" class="decision-form">
		${hidden(context, verdict.sha256, verdict.token)} ${verdict.extra ?? ''}
		<input type="hidden" name="verdict" value="${choice.value}" />
		<input type="hidden" name="rationale" value="${state.values.rationale ?? ''}" />
		${context.actor ? '' : html`<input type="hidden" name="actor" value="${state.values.actor ?? ''}" />`}
		<div class="confirm-box">
			<p class="lab">Confirm</p>
			<p>${choice.summary}</p>
			<blockquote>${state.values.rationale ?? ''}</blockquote>
		</div>
		<div class="btns">
			${formButton({ label: choice.confirm, emphasis: 'primary', attrs: { name: 'confirmed', value: '1' } })}
			${formButton({ label: 'Back', attrs: { name: 'back', value: '1', formnovalidate: true } })}
		</div>
	</form>`
}

function chooseStep(context: Context, verdict: Verdict, state: FormState) {
	const button = (choice: Verdict['approve'], primary: boolean) =>
		formButton({
			label: choice.label,
			emphasis: primary ? 'primary' : undefined,
			attrs: {
				name: 'verdict',
				value: choice.value,
				'data-needs-rationale': true,
				'data-confirm-label': choice.confirm,
				'data-summary': choice.summary,
			},
		})
	return html`<form method="post" action="${verdict.action}" class="decision-form" data-verdict-form>
		${hidden(context, verdict.sha256, verdict.token)} ${verdict.extra ?? ''} ${actorField(context, state)}
		${rationaleField(state, 'Why do you decide this?')}
		<div class="confirm-box" data-confirm hidden>
			<p class="lab">Confirm</p>
			<p data-confirm-summary></p>
		</div>
		<div class="btns" data-choose>${button(verdict.approve, true)} ${button(verdict.reject, false)}</div>
		<div class="btns" data-confirm-buttons hidden>
			${formButton({ label: 'Confirm', emphasis: 'primary', attrs: { name: 'confirmed', value: '1', 'data-confirm-submit': true } })}
			${formButton({ label: 'Back', attrs: { type: 'button', 'data-confirm-back': true } })}
		</div>
	</form>`
}

export function verdictPanel(context: Context, verdict: Verdict, state: FormState) {
	return html`<section
		class="panel decision"
		id="decide"
		aria-labelledby="decide-title"
		data-region="decision"
		data-stale-message="${verdict.staleMessage}"
	>
		<h2 class="lab" id="decide-title">Decision</h2>
		<p class="subj">${verdict.question}</p>
		<p class="help">
			${verdict.digestLabel} sha256 <code title="${verdict.sha256}">${short(verdict.sha256)}</code>. Your decision
			is recorded in the log.
		</p>
		<div data-stale-slot>${messages(state)}</div>
		${verdict.intro ?? ''}
		${state.confirm ? confirmStep(context, verdict, state) : chooseStep(context, verdict, state)}
	</section>`
}

const kinds = [
	{
		value: 'clarify',
		label: 'Clarify',
		help: 'Clarify gives the expected behaviour. The agent updates the affected assertions in the next revision.',
	},
	{
		value: 'accept_assumption',
		label: 'Accept assumption',
		help: 'Accept assumption records your answer as an assumption. Tests run on it, and reports list it.',
	},
	{
		value: 'defer',
		label: 'Defer',
		help: 'Defer moves the gap out of this scope. The affected tests become deferred and do not run.',
	},
]

export type GapForm = {
	action: string
	cancel: string
	sha256: string
	title: Html | ''
	question: string
	staleMessage: string
	extra?: Html
}

export function gapPanel(context: Context, form: GapForm, state: FormState) {
	const selected = state.values.kind ?? 'clarify'
	return html`<section
		class="panel decision"
		id="answer"
		aria-labelledby="answer-title"
		data-region="decision"
		data-stale-message="${form.staleMessage}"
	>
		<h2 class="lab" id="answer-title">Answer gap</h2>
		${form.title ? html`<p class="subj">${form.title}</p>` : ''}
		${form.question ? html`<p class="help">${form.question}</p>` : ''}
		<div data-stale-slot>${messages(state)}</div>
		<form method="post" action="${form.action}" class="decision-form gap-form" data-gap-form>
			${hidden(context, form.sha256)} ${form.extra ?? ''}
			<fieldset class="seg-field">
				<legend class="lab">Kind of answer</legend>
				<div class="seg">
					${kinds.map(
						(kind) =>
							html`<label
								><input
									type="radio"
									id="kind-${kind.value}"
									name="kind"
									value="${kind.value}"
									${selected === kind.value ? html`checked` : ''}
								/>${kind.label}</label
							>`
					)}
				</div>
			</fieldset>
			${kinds.map((kind) => html`<p class="help kind-help" data-kind="${kind.value}">${kind.help}</p>`)}
			${field({ id: 'value', label: 'Answer', control: textArea({ id: 'value', name: 'value', rows: 3, value: state.values.value ?? '', attrs: { required: true, 'data-missing': 'Write the answer.' } }) })}
			<div class="field-group source-field">
				<label class="lab" for="source">Source <span class="req">required for Clarify</span></label>
				<input
					id="source"
					name="source"
					value="${state.values.source ?? ''}"
					placeholder="oracle://refund-policy#window"
					data-source
					data-missing="A clarification needs a source. Name where the answer comes from."
				/>
				<p class="help">Where the answer comes from: a document, a ticket, or a person.</p>
			</div>
			${rationaleField(state, 'Why is this the right answer?', 'Write a rationale. Checkmate records it with your answer.')}
			${actorField(context, state)}
			<div class="btns">
				${formButton({ label: 'Record answer', emphasis: 'primary', attrs: { 'data-needs-rationale': true } })}
				${formButton({ label: 'Cancel', href: form.cancel })}
			</div>
		</form>
	</section>`
}

export function recordPanel(title: string, content: Html, decided = '') {
	return html`<section
		class="panel decision"
		aria-labelledby="decide-title"
		data-region="decision"
		${decided ? html`data-decided-message="${decided}"` : ''}
	>
		<h2 class="lab" id="decide-title">${title}</h2>
		${content}
	</section>`
}

export function returnFields(item: { key: string }, back: string) {
	return html`<input type="hidden" name="item" value="${item.key}" />
		<input type="hidden" name="return" value="${back}" />`
}

export function sourceAndReason(context: Context, state: FormState, reasonLabel: string) {
	const used = Boolean(state.values.source || state.values.rationale)
	return html`<details class="more" data-more ${used ? html`open` : ''}>
		<summary>Add source and reason</summary>
		${field({ id: 'source', label: 'Source', control: textInput({ id: 'source', name: 'source', value: state.values.source ?? '', attrs: { placeholder: `Default: ${context.actor ?? 'you'}, in the review UI` } }) })}
		${field({ id: 'rationale', label: reasonLabel, control: textArea({ id: 'rationale', name: 'rationale', rows: 2, value: state.values.rationale ?? '' }) })}
	</details>`
}
