import type { Html } from './html.ts'
import type { Context } from './layout.ts'
import { html, short } from './html.ts'
import { banner } from './layout.ts'

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
	digestLabel: string
	approve: { value: string; label: string; confirm: string; summary: string }
	reject: { value: string; label: string; confirm: string; summary: string }
	staleMessage: string
	intro?: Html | ''
}

export function emptyState(): FormState {
	return { values: {}, error: null, stale: null, confirm: false }
}

function hidden(context: Context, sha256: string) {
	return html`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />`
}

function actorField(context: Context, state: FormState) {
	if (context.actor) return ''
	return html`<div class="field-group">
		<label class="lab" for="actor">Your name</label>
		<input id="actor" name="actor" required autocomplete="name" value="${state.values.actor ?? ''}" />
		<p class="help">Checkmate asks once, keeps it in a cookie, and records it with each decision.</p>
	</div>`
}

function messages(state: FormState) {
	return html`${state.stale ? banner('warn', state.stale) : ''}
	${state.error ? html`<p class="form-error" role="alert">${state.error}</p>` : ''}`
}

function rationaleField(state: FormState, placeholder: string) {
	return html`<div class="field-group">
		<label class="lab" for="rationale">Rationale</label>
		<textarea id="rationale" name="rationale" rows="4" required data-rationale placeholder="${placeholder}">
${state.values.rationale ?? ''}</textarea>
	</div>`
}

function confirmStep(context: Context, verdict: Verdict, state: FormState) {
	const choice = state.values.verdict === verdict.reject.value ? verdict.reject : verdict.approve
	return html`<form method="post" action="${verdict.action}" class="decision-form">
		${hidden(context, verdict.sha256)}
		<input type="hidden" name="verdict" value="${choice.value}" />
		<input type="hidden" name="rationale" value="${state.values.rationale ?? ''}" />
		${context.actor ? '' : html`<input type="hidden" name="actor" value="${state.values.actor ?? ''}" />`}
		<div class="confirm-box">
			<p class="lab">Confirm</p>
			<p>${choice.summary}</p>
			<blockquote>${state.values.rationale ?? ''}</blockquote>
		</div>
		<div class="btns">
			<button class="btn primary" name="confirmed" value="1">${choice.confirm}</button>
			<button class="btn" name="back" value="1" formnovalidate>Back</button>
		</div>
	</form>`
}

function chooseStep(context: Context, verdict: Verdict, state: FormState) {
	const button = (choice: Verdict['approve'], primary: boolean) =>
		html`<button
			class="btn${primary ? ' primary' : ''}"
			name="verdict"
			value="${choice.value}"
			data-needs-rationale
			data-confirm-label="${choice.confirm}"
			data-summary="${choice.summary}"
		>
			${choice.label}
		</button>`
	return html`<form method="post" action="${verdict.action}" class="decision-form" data-verdict-form>
		${hidden(context, verdict.sha256)} ${actorField(context, state)}
		${rationaleField(state, 'Why do you decide this?')}
		<div class="confirm-box" data-confirm hidden>
			<p class="lab">Confirm</p>
			<p data-confirm-summary></p>
		</div>
		<div class="btns" data-choose>${button(verdict.approve, true)} ${button(verdict.reject, false)}</div>
		<div class="btns" data-confirm-buttons hidden>
			<button class="btn primary" name="confirmed" value="1" data-confirm-submit>Confirm</button>
			<button class="btn" type="button" data-confirm-back>Back</button>
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
	title: Html
	question: string
	staleMessage: string
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
		<p class="subj">${form.title}</p>
		<p class="help">${form.question}</p>
		<div data-stale-slot>${messages(state)}</div>
		<form method="post" action="${form.action}" class="decision-form gap-form" data-gap-form>
			${hidden(context, form.sha256)}
			<fieldset class="seg-field">
				<legend class="lab">Kind of answer</legend>
				<div class="seg">
					${kinds.map(
						(kind) =>
							html`<input
									type="radio"
									id="kind-${kind.value}"
									name="kind"
									value="${kind.value}"
									${selected === kind.value ? html`checked` : ''}
								/><label for="kind-${kind.value}">${kind.label}</label>`
					)}
				</div>
			</fieldset>
			${kinds.map((kind) => html`<p class="help kind-help" data-kind="${kind.value}">${kind.help}</p>`)}
			<div class="field-group">
				<label class="lab" for="value">Answer</label>
				<textarea id="value" name="value" rows="3" required>${state.values.value ?? ''}</textarea>
			</div>
			<div class="field-group source-field">
				<label class="lab" for="source">Source <span class="req">required for Clarify</span></label>
				<input
					id="source"
					name="source"
					value="${state.values.source ?? ''}"
					placeholder="caller://refund-policy#window"
					data-source
				/>
				<p class="help">Where the answer comes from: a document, a ticket, or a person.</p>
			</div>
			${rationaleField(state, 'Why is this the right answer?')} ${actorField(context, state)}
			<div class="btns">
				<button class="btn primary" data-needs-rationale>Record answer</button>
				<a class="btn" href="${form.cancel}">Cancel</a>
			</div>
		</form>
	</section>`
}

export function recordPanel(title: string, content: Html) {
	return html`<section class="panel decision" aria-labelledby="decide-title" data-region="decision">
		<h2 class="lab" id="decide-title">${title}</h2>
		${content}
	</section>`
}
