import type { Store } from '../../../plugin/src/store.ts'
import type { Plan } from '../../../plugin/src/types.ts'
import type { Context, Page } from './layout.ts'
import { planDetail } from '../../../plugin/src/views.ts'
import { html } from './html.ts'
import { banner, heading } from './layout.ts'

export function planEditValues(plan: Plan, form: URLSearchParams) {
	const list = (name: string, separator = ',') =>
		(form.get(name) ?? '')
			.split(separator)
			.map((value) => value.trim())
			.filter(Boolean)
	return {
		objective: form.get('objective') ?? '',
		requirements: plan.requirements.map((item) => ({
			...item,
			text: form.get(`requirement.${item.id}.text`) ?? '',
			source: form.get(`requirement.${item.id}.source`) ?? '',
		})),
		tests: plan.tests.map((test) => ({
			...test,
			title: form.get(`test.${test.id}.title`) ?? '',
			action: form.get(`test.${test.id}.action`) ?? '',
			requirementIds: list(`test.${test.id}.requirements`),
			dependsOn: list(`test.${test.id}.dependsOn`),
			operations: list(`test.${test.id}.operations`),
			preconditions: list(`test.${test.id}.preconditions`, '\n'),
			assertions: [
				...test.assertions
					.filter((item) => !form.has(`test.${test.id}.${item.id}.remove`))
					.map((item) => ({
						...item,
						check: form.get(`test.${test.id}.${item.id}.check`) ?? '',
						oracleKind: (form.get(`test.${test.id}.${item.id}.oracle`) ?? '') as
							'deterministic' | 'agent_observation',
					})),
				...(form.get(`test.${test.id}.new.id`)?.trim()
					? [
							{
								id: form.get(`test.${test.id}.new.id`)!.trim(),
								check: form.get(`test.${test.id}.new.check`) ?? '',
								oracleKind: (form.get(`test.${test.id}.new.oracle`) ?? 'deterministic') as
									'deterministic' | 'agent_observation',
							},
						]
					: []),
			],
		})),
	}
}

export function editPage(
	store: Store,
	context: Context,
	planId: string,
	revision: number,
	form?: URLSearchParams,
	error?: string
): Page {
	const detail = planDetail(store, planId, revision)
	const { plan } = detail
	const subject = `${planId}@${revision}`
	const value = (name: string, fallback: string) => form?.get(name) ?? fallback
	const field = (label: string, name: string, fallback: string, multiline = false, required = true) =>
		html`<div class="field-group">
			<label class="lab" for="${name}">${label}</label
			>${multiline ? html`<textarea id="${name}" name="${name}" rows="3" ${required ? html`required` : ''}>${value(name, fallback)}</textarea>` : html`<input id="${name}" name="${name}" value="${value(name, fallback)}" ${required ? html`required` : ''} />`}
		</div>`
	return {
		title: `Edit ${subject}`,
		section: 'plans',
		subjects: [`plan:${planId}`, 'inbox'],
		body: html`${heading(`Edit ${subject}`, 'Save a new revision. Existing runs keep their original plan. Coverage and readiness update from requirements, tests, and gap decisions.')}
			${error ? banner('warn', error) : ''}
			${detail.latestRevision !== revision ? banner('warn', html`A newer revision is available. <a href="/plans/${planId}@${detail.latestRevision}/edit">Edit the latest revision</a>.`) : ''}
			<form method="post" action="/plans/${subject}/edit" class="plan-editor">
				<input type="hidden" name="csrf" value="${context.csrf}" />
				<input type="hidden" name="sha" value="${value('sha', detail.sha256)}" />
				${!context.actor ? field('Your name', 'actor', '') : ''}
				<section>
					<h2>Plan</h2>
					${field('Objective', 'objective', plan.objective, true)}
				</section>
				<section>
					<h2>Requirements and coverage</h2>
					<p class="help">
						Edit requirement text and source here. Change the requirement IDs on each test to update
						coverage. Coverage status is calculated.
					</p>
					${plan.requirements.map(
						(item) =>
							html`<fieldset class="edit-card">
								<legend>${item.id}</legend>
								${field('Requirement', `requirement.${item.id}.text`, item.text, true)}${field('Source', `requirement.${item.id}.source`, item.source)}
							</fieldset>`
					)}
				</section>
				<section>
					<h2>Tests</h2>
					${plan.tests.map(
						(test) =>
							html`<fieldset class="edit-card" id="edit-${test.id}">
								<legend>${test.id}</legend>
								${field('Title', `test.${test.id}.title`, test.title)}
								${field('Action', `test.${test.id}.action`, test.action, true)}
								${field('Requirement IDs (comma separated)', `test.${test.id}.requirements`, test.requirementIds.join(', '))}
								${field('Depends on (comma separated)', `test.${test.id}.dependsOn`, test.dependsOn.join(', '), false, false)}
								${field('Operations (comma separated)', `test.${test.id}.operations`, test.operations.join(', '), false, false)}
								${field('Preconditions (one per line)', `test.${test.id}.preconditions`, test.preconditions.join('\n'), true, false)}
								${test.assertions.map(
									(assertion) =>
										html`${field(`${assertion.id} · Check`, `test.${test.id}.${assertion.id}.check`, assertion.check, true)}
											<div class="field-group">
												<label class="lab" for="test.${test.id}.${assertion.id}.oracle"
													>${assertion.id} · Oracle</label
												><select
													id="test.${test.id}.${assertion.id}.oracle"
													name="test.${test.id}.${assertion.id}.oracle"
												>
													${['deterministic', 'agent_observation'].map((oracle) => html`<option value="${oracle}" ${value(`test.${test.id}.${assertion.id}.oracle`, assertion.oracleKind) === oracle ? html`selected` : ''}>${oracle === 'deterministic' ? 'Deterministic' : 'Agent observation'}</option>`)}
												</select>
											</div>
											<label class="remove-assertion"
												><input
													type="checkbox"
													name="test.${test.id}.${assertion.id}.remove"
													${form?.has(`test.${test.id}.${assertion.id}.remove`) ? html`checked` : ''}
												/>
												Remove ${assertion.id}</label
											>`
								)}
								<h3>Add assertion</h3>
								${field('New assertion ID', `test.${test.id}.new.id`, '', false, false)}${field('New assertion check', `test.${test.id}.new.check`, '', true, false)}<label
									class="lab"
									for="test.${test.id}.new.oracle"
									>New assertion oracle</label
								><select id="test.${test.id}.new.oracle" name="test.${test.id}.new.oracle">
									${['deterministic', 'agent_observation'].map((oracle) => html`<option value="${oracle}" ${value(`test.${test.id}.new.oracle`, 'deterministic') === oracle ? html`selected` : ''}>${oracle === 'deterministic' ? 'Deterministic' : 'Agent observation'}</option>`)}
								</select>
							</fieldset>`
					)}
				</section>
				<div class="btns">
					<button class="btn primary">Save new revision</button
					><a class="btn" href="/plans/${subject}">Cancel</a>
				</div>
			</form>`,
		...(error ? { status: 422 } : {}),
	}
}
