import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import { frozenRevision, planCandidate } from '../plans.ts'
import { planDetail } from '../views.ts'
import { html, short } from './html.ts'
import { banner, heading } from './layout.ts'

type Candidate = ReturnType<typeof planCandidate>
type Requirement = Candidate['requirements'][number]
type Test = Candidate['tests'][number]

export type EditState = {
	mode: 'form' | 'json'
	candidate: Candidate
	json: string
	actor: string
	error: string | null
	stale: Html | null
}

function words(values: string) {
	return values
		.split(/[\s,]+/)
		.map((value) => value.trim())
		.filter(Boolean)
}

function lines(values: string) {
	return values
		.split('\n')
		.map((value) => value.trim())
		.filter(Boolean)
}

export function candidateFromForm(base: Candidate, form: URLSearchParams): Candidate {
	const text = (name: string, fallback: string) => (form.get(name) ?? fallback).trim()
	const covered = new Set(form.getAll('cover'))
	return {
		requirements: base.requirements.map((requirement, i) => ({
			id: requirement.id,
			text: text(`r${i}.text`, requirement.text),
			source: text(`r${i}.source`, requirement.source),
		})),
		tests: base.tests.map((test, i) => ({
			...test,
			title: text(`t${i}.title`, test.title),
			capability: text(`t${i}.capability`, test.capability),
			operations: words(form.get(`t${i}.operations`) ?? test.operations.join(', ')),
			dependsOn: words(form.get(`t${i}.dependsOn`) ?? test.dependsOn.join(', ')),
			preconditions: lines(form.get(`t${i}.preconditions`) ?? test.preconditions.join('\n')),
			action: text(`t${i}.action`, test.action),
			requirementIds: base.requirements
				.filter((requirement) => covered.has(`${test.id} ${requirement.id}`))
				.map((requirement) => requirement.id),
			assertions: test.assertions.map((assertion, j) => ({
				id: assertion.id,
				check: text(`t${i}.a${j}.check`, assertion.check),
				checkKind: form.get(`t${i}.a${j}.kind`) === 'agent_observation' ? 'agent_observation' : 'deterministic',
			})),
		})),
		gaps: base.gaps,
	}
}

export function candidateJson(candidate: unknown) {
	return JSON.stringify(candidate, null, 2)
}

function field(label: string, name: string, value: string, help = '') {
	return html`<div class="field-group">
		<label class="lab" for="${name}">${label}</label>
		<input id="${name}" name="${name}" value="${value}" />
		${help ? html`<p class="help">${help}</p>` : ''}
	</div>`
}

function area(label: string, name: string, value: string, rows: number, help = '') {
	return html`<div class="field-group">
		<label class="lab" for="${name}">${label}</label>
		<textarea id="${name}" name="${name}" rows="${rows}">${value}</textarea>
		${help ? html`<p class="help">${help}</p>` : ''}
	</div>`
}

function requirementFields(requirement: Requirement, i: number) {
	return html`<fieldset class="edit-card" id="edit-${requirement.id}">
		<legend class="mono">${requirement.id}</legend>
		${area('Text', `r${i}.text`, requirement.text, 2)}
		${field('Source', `r${i}.source`, requirement.source, 'Where the requirement comes from.')}
	</fieldset>`
}

function testFields(test: Test, i: number) {
	return html`<fieldset class="edit-card" id="edit-${test.id}">
		<legend><span class="mono">${test.id}</span> ${test.title}</legend>
		${field('Title', `t${i}.title`, test.title)}
		<div class="edit-row">
			${field('Capability', `t${i}.capability`, test.capability)}
			${field('Operations', `t${i}.operations`, test.operations.join(', '), 'Separate with commas.')}
		</div>
		${field(
			'Depends on',
			`t${i}.dependsOn`,
			test.dependsOn.join(', '),
			'Test IDs, separated with commas. Use plan:T1 for a test in another plan.'
		)}
		${area('Preconditions', `t${i}.preconditions`, test.preconditions.join('\n'), 2, 'One per line.')}
		${area('Action', `t${i}.action`, test.action, 2)}
		<div class="field-group">
			<p class="lab">Assertions</p>
			${
				test.assertions.length
					? html`<ul class="edit-asrs">
							${test.assertions.map(
								(assertion, j) =>
									html`<li>
										<label class="aid" for="t${i}.a${j}.check">${assertion.id}</label>
										<textarea id="t${i}.a${j}.check" name="t${i}.a${j}.check" rows="1">
${assertion.check}</textarea>
										<label class="sr-only" for="t${i}.a${j}.kind"
											>Check kind of ${assertion.id}</label
										>
										<select id="t${i}.a${j}.kind" name="t${i}.a${j}.kind">
											${['deterministic', 'agent_observation'].map(
												(kind) =>
													html`<option
														value="${kind}"
														${kind === assertion.checkKind ? html`selected` : ''}
													>
														${kind.replace('_', ' ')}
													</option>`
											)}
										</select>
									</li>`
							)}
						</ul>`
					: html`<p class="help">No assertions. Add them in the JSON editor.</p>`
			}
		</div>
	</fieldset>`
}

function coverageMatrix(candidate: Candidate) {
	return html`<div class="scroll">
		<table class="matrix">
			<thead>
				<tr>
					<th scope="col">Requirement</th>
					${candidate.tests.map((test) => html`<th scope="col" class="mono">${test.id}</th>`)}
				</tr>
			</thead>
			<tbody>
				${candidate.requirements.map(
					(requirement) =>
						html`<tr>
							<th scope="row">
								<span class="mono">${requirement.id}</span>
								<span class="muted small matrix-text">${requirement.text}</span>
							</th>
							${candidate.tests.map(
								(test) =>
									html`<td>
										<input
											type="checkbox"
											name="cover"
											value="${test.id} ${requirement.id}"
											aria-label="${test.id} covers ${requirement.id}"
											${test.requirementIds.includes(requirement.id) ? html`checked` : ''}
										/>
									</td>`
							)}
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function hidden(context: Context, sha256: string, mode: string) {
	return html`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />
		<input type="hidden" name="mode" value="${mode}" />`
}

function actorLine(context: Context, state: EditState, path: string, mode: string) {
	if (context.actor)
		return html`<p class="help">
			Saving as <strong>${context.actor}</strong>.
			<a href="/actor?back=${encodeURIComponent(path)}">Change name</a>
		</p>`
	return html`<div class="field-group">
		<label class="lab" for="actor-${mode}">Your name</label>
		<input id="actor-${mode}" name="actor" required autocomplete="name" value="${state.actor}" />
		<p class="help">Checkmate records it with the edit.</p>
	</div>`
}

export function editPage(
	store: Store,
	context: Context,
	planId: string,
	revision: number,
	state: EditState | null = null
): Page {
	const detail = planDetail(store, planId, revision)
	const subject = `${planId}@${revision}`
	const path = `/plans/${subject}/edit`
	const title = `Edit ${subject}`
	if (detail.revision !== detail.latestRevision)
		return {
			title,
			section: 'plans',
			subjects: [`plan:${planId}`],
			body: html`${heading(title, detail.plan.objective)}
			${banner(
				'info',
				html`Only the latest revision can change.
					<a href="/plans/${planId}@${detail.latestRevision}/edit"
						>Edit ${planId}@${detail.latestRevision}</a
					>`
			)}`,
		}
	const frozen = frozenRevision(store, planId, revision)
	const needsApproval = detail.approval.policy !== 'none'
	const next = revision + 1
	const save = frozen ? `Save as ${planId}@${next}` : 'Save changes'
	const why = frozen === 'run' ? `A run uses ${subject}.` : `${subject} is approved.`
	const notice = frozen
		? banner(
				'warn',
				html`<strong
						>${why} Saving creates revision ${next}${needsApproval ? ', which needs approval' : ''}.</strong
					>
					${subject} stays as it is.`
			)
		: banner(
				'info',
				html`<strong>Edits change this revision in place.</strong> ${subject} is not approved and no run uses
					it.`
			)
	const shown = state ?? {
		mode: 'form' as const,
		candidate: planCandidate(detail.plan),
		json: candidateJson(planCandidate(detail.plan)),
		actor: '',
		error: null,
		stale: null,
	}
	const messages = html`${shown.stale ? banner('warn', shown.stale) : ''}
	${shown.error ? html`<p class="form-error" role="alert">${shown.error}</p>` : ''}`
	const buttons = (mode: string) =>
		html`<div class="btns">
				<button class="btn primary">${save}</button>
				<a class="btn" href="/plans/${subject}">Cancel</a>
			</div>
			${actorLine(context, shown, path, mode)}`
	const body = html`${heading(
			title,
			detail.plan.objective,
			html`<div class="meta">
				<a class="pill" href="/plans/${subject}">${subject}</a>
				<span class="pill" title="${detail.sha256}"
					>sha256 <span class="mono">${short(detail.sha256)}</span></span
				>
			</div>`
		)}
		<div data-region="edit" data-stale-message="${planId} changed. Review it before you save.">
			<div data-stale-slot>${notice} ${messages}</div>
			<form method="post" action="${path}" class="edit-form" data-edit-form>
				${hidden(context, detail.sha256, 'form')}
				<section aria-labelledby="edit-requirements">
					<h2 id="edit-requirements">
						Requirements <span class="n">${shown.candidate.requirements.length}</span>
					</h2>
					<div class="stack">${shown.candidate.requirements.map(requirementFields)}</div>
				</section>
				<section aria-labelledby="edit-tests">
					<h2 id="edit-tests">Tests <span class="n">${shown.candidate.tests.length}</span></h2>
					<div class="stack">${shown.candidate.tests.map(testFields)}</div>
				</section>
				<section aria-labelledby="edit-coverage">
					<h2 id="edit-coverage">Coverage</h2>
					<p class="help">Mark the requirements that each test covers. Each test covers one or more.</p>
					${coverageMatrix(shown.candidate)}
				</section>
				<div class="edit-save">${buttons('form')}</div>
			</form>
			<details class="edit-json" ${shown.mode === 'json' ? html`open` : ''}>
				<summary>Edit as JSON</summary>
				<form method="post" action="${path}" class="edit-form" data-edit-form>
					${hidden(context, detail.sha256, 'json')}
					<p class="help">
						Add or remove requirements, tests, assertions, and gaps. The JSON has the fields of a plan
						candidate:
						<code>requirements</code>, <code>tests</code>, and <code>gaps</code>.
					</p>
					<label class="sr-only" for="json">Plan candidate JSON</label>
					<textarea id="json" name="json" rows="24" class="code" spellcheck="false">${shown.json}</textarea>
					${buttons('json')}
				</form>
			</details>
		</div>`
	return { title, section: 'plans', subjects: [`plan:${planId}`], body }
}
