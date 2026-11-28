import type { Store } from '../store.ts'
import { one } from '../store.ts'
import { levelNames } from '../levels.ts'
import { planRequest } from '../plans.ts'
import { instanceList } from '../targets.ts'
import type { Attrs, Html } from './html.ts'
import type { Context } from './layout.ts'
import { button, formButton, optionButton } from './components/button.ts'
import { textInput } from './components/field.ts'
import { radioGroup } from './components/radio-group.ts'
import { html, plural } from './html.ts'

export type TestValues = {
	build: string
	level: string
	since: string
	until: string
	repo: string
	instance?: string
}

export type InstanceChoice = { planId: string; instances: string[]; chosen: string }

type Subject = { explorationId: string; planId: string; build: string; session: boolean }

type Again = Omit<TestValues, 'level' | 'instance'> & { planId: string; level: string | null; instanceId: string }

const levelNotes: Record<string, string> = {
	smoke: '1 tester, no verifier',
	normal: '2 testers and a verifier',
	deep: '3 testers and a verifier',
}

function shell(id: string, title: string, gone: string, action: string, context: Context, body: Html) {
	return html`<dialog
		class="sc-confirm is-act"
		data-act-dialog="${id}"
		data-gone="${gone}"
		aria-labelledby="act-${id}-title"
	>
		<h2 id="act-${id}-title" data-act-title>${title}</h2>
		<form method="post" action="${action}" class="sc-form" data-act-form>
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<div data-act-error aria-live="polite"></div>
			${body}
		</form>
	</dialog>`
}

function dialogField(id: string, label: string, name: string, value: string, missing = '') {
	return html`<label for="${id}">${label}</label> ${textInput({
			id,
			name,
			value,
			attrs: {
				maxlength: 200,
				autocomplete: 'off',
				required: Boolean(missing),
				'data-missing': missing || null,
				'data-stop': true,
			},
		})}`
}

export function instanceChoice(store: Store, planId: string): InstanceChoice | null {
	const targetId = planRequest(store, planId).target.profile.targetId
	const active = instanceList(store, targetId)
		.filter((instance) => !instance.retired)
		.map((instance) => instance.instanceId)
	if (active.length < 2) return null
	const last = one<{ instance_id: string }>(
		store,
		'SELECT instance_id FROM explorations WHERE plan_id = ? ORDER BY rowid DESC LIMIT 1',
		planId
	)
	return { planId, instances: active, chosen: active.find((id) => id === last?.instance_id) ?? '' }
}

function instanceField(choice: InstanceChoice, shown: boolean) {
	return radioGroup({
		label: 'Instance',
		name: 'instance',
		choices: choice.instances.map((instance) => ({
			value: instance,
			title: instance,
			checked: instance === choice.chosen,
		})),
		attrs: { 'data-instances': choice.planId, hidden: !shown, disabled: !shown },
	})
}

export function testerToolHelp(harness: Context['harness']) {
	return harness === 'pi'
		? 'List tool names, for example read bash. Pi enables the listed tools for the tester.'
		: 'List tool rules, for example Read Bash. With the rule, a tester does not ask. Without it, each call asks you here.'
}

export function testerModels(context: Context) {
	return html`<details class="sc-fold" data-tester-models data-harness="${context.harness}">
		<summary data-stop>Models by tester</summary>
		<p class="sc-help">Choose a model for a tester, or use the workspace tester model.</p>
		<p class="sc-help" role="status" data-tester-count-status></p>
		<p class="sc-help" role="status" data-tester-model-status>Open to load models.</p>
		${formButton({ label: 'Refresh models', attrs: { type: 'button', 'data-stop': true, 'data-tester-model-refresh': true } })}
		<label for="tester-model-filter">Filter models</label>
		<input id="tester-model-filter" type="search" autocomplete="off" data-stop data-tester-model-filter />
		${Array.from(
			{ length: 10 },
			(_, index) =>
				html`<div class="sc-field" data-tester-model-row="${index + 1}" hidden>
					<label for="tester-model-a${index + 1}">Tester a${index + 1}</label>
					<select
						id="tester-model-a${index + 1}"
						name="testerModel.a${index + 1}"
						data-stop
						data-tester-model-select
						disabled
					>
						<option value="">Use workspace tester model</option>
					</select>
					<div hidden>
						<label for="tester-effort-a${index + 1}">Reasoning effort for tester a${index + 1}</label>
						<select
							id="tester-effort-a${index + 1}"
							name="testerEffort.a${index + 1}"
							data-stop
							data-tester-effort-select
							disabled
						></select>
					</div>
				</div>`
		)}
	</details>`
}

export function testDialog(
	context: Context,
	planId: string | null,
	values: TestValues,
	fallbackBuild = '',
	instances: InstanceChoice[] = []
) {
	const build = values.build || fallbackBuild
	const shown = { ...values, build }
	return shell(
		'test',
		planId ? `Test a build of ${planId}` : 'Test a build',
		planId ? `A test of ${planId} is in progress now. Nothing was started here.` : 'Nothing was started.',
		planId ? `/plans/${planId}/test` : '/activity',
		context,
		html`<input type="hidden" name="harness" value="${context.harness}" />
			<p class="sc-note">Start a test of the plan on this computer. The testers run in the background.</p>
			${dialogField('act-test-build', 'Build', 'build', shown.build, 'Write the build name.')}
			${instances.map((choice) => instanceField(choice, choice.planId === planId))}
			${radioGroup({
				label: 'Level',
				name: 'level',
				choices: levelNames.map((level) => ({
					value: level,
					title: levelNotes[level],
					checked: level === shown.level,
				})),
			})}
			<label for="act-test-rules">Testers may use without asking</label>
			<input
				id="act-test-rules"
				name="rules"
				value="${context.testerRules}"
				maxlength="400"
				autocomplete="off"
				aria-describedby="act-test-rules-help"
				data-stop
			/>
			<p class="sc-help" id="act-test-rules-help">${testerToolHelp(context.harness)}</p>
			<details class="sc-fold" data-more>
				<summary data-stop>More</summary>
				${dialogField('act-test-since', 'Since (git ref)', 'since', shown.since)}
				${dialogField('act-test-until', 'Until (git ref)', 'until', shown.until)}
				${dialogField('act-test-repo', 'Repository folder', 'repo', shown.repo)}
			</details>
			${testerModels(context)}
			<div class="sc-confirm-foot">
				${button({ label: 'Start the test', keyName: 'Enter', emphasis: 'primary', attrs: { 'data-stop': true } })}
				${button({ label: 'Cancel', keyName: 'Esc', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true } })}
			</div>`
	)
}

export function ruleDialog(kind: 'edit' | 'add', context: Context, planId: string, areas: string[]) {
	const id = `rule-${kind}`
	return shell(
		id,
		kind === 'edit' ? 'Edit the rule' : `Add a rule to ${planId}`,
		'The rules of this plan changed. Nothing was done.',
		`/plans/${planId}/rules`,
		context,
		html`<label for="act-${id}-text">Text</label>
			<input
				id="act-${id}-text"
				name="text"
				maxlength="400"
				autocomplete="off"
				required
				data-missing="Write the text of the rule."
				data-stop
			/>
			${radioGroup({
				label: 'Area',
				name: 'area',
				choices: areas.map((area, index) => ({
					value: area,
					title: area,
					checked: index === 0,
					truncate: true,
				})),
			})}
			<label for="act-${id}-new">Or a new area</label>
			<input id="act-${id}-new" name="newArea" autocomplete="off" data-stop />
			${
				kind === 'add'
					? html`<label for="act-${id}-source">Source (optional)</label>
							<input id="act-${id}-source" name="source" maxlength="200" autocomplete="off" data-stop />`
					: ''
			}
			<div class="sc-confirm-foot">
				${button({ label: 'Save the rule', keyName: 'Enter', emphasis: 'primary', attrs: { 'data-stop': true } })}
				${button({ label: 'Cancel', keyName: 'Esc', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true } })}
			</div>`
	)
}

export function copyDialog() {
	return html`<dialog
		class="sc-confirm is-act"
		data-act-dialog="copy"
		data-gone="The text is not copied."
		aria-labelledby="act-copy-title"
	>
		<h2 id="act-copy-title" data-copy-title>Copy the text</h2>
		<div class="sc-form">
			<p class="sc-note">Checkmate cannot use the clipboard here: copy the selected text with Ctrl+C or Cmd+C.</p>
			<label for="act-copy-text">Text for the developer</label>
			<textarea id="act-copy-text" class="sc-textarea" rows="12" readonly data-stop data-copy-text></textarea>
			<div class="sc-confirm-foot">
				${button({ label: 'Close', keyName: 'Esc', emphasis: 'primary', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true } })}
			</div>
		</div>
	</dialog>`
}

export function followDialog(context: Context, planId: string, subject: Subject, count: number) {
	const answers = `${count} ${count === 1 ? 'answer' : 'answers'}`
	return shell(
		'follow',
		`Test the ${answers}`,
		`The answers of ${subject.explorationId} are tested, or a test is in progress. Nothing was started.`,
		`/plans/${planId}/follow`,
		context,
		html`<input type="hidden" name="exploration" value="${subject.explorationId}" />
			<p class="sc-note">
				${planId}, build ${subject.build}: the testers read ${answers} of the product owner and test again.
			</p>
			${
				subject.session
					? html`<p class="sc-note" data-key="follow-session">
							${subject.explorationId} runs in the session that started it. Checkmate starts no process.
							The follow-up waits until that session continues the test. You can stop it on its page.
						</p>`
					: ''
			}
			<div class="sc-confirm-foot">
				${button({ label: `Test the ${answers}`, keyName: '1', emphasis: 'primary', attrs: { 'data-stop': true, 'data-key-n': '1' } })}
				${button({ label: 'Cancel', keyName: '2', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true, 'data-key-n': '2' } })}
			</div>`
	)
}

export function storeDialog(context: Context, planId: string, count: number, approval: boolean) {
	return shell(
		'store',
		`Store ${plural(count, 'defect')} as tests`,
		'The defects of this plan changed. Nothing was stored.',
		`/plans/${planId}/harvest`,
		context,
		html`<input type="hidden" name="view" value="all" />
			<input type="hidden" name="count" value="${count}" />
			<p class="sc-note">
				Checkmate stores each defect as a test of this plan and attaches it to the rule that the defect cites.
				The rules, areas and marks of the plan stay the same. A defect with no rule gets a new rule HRn. Later
				tests of this plan may run the stored
				tests.${approval ? ' The stored tests wait for the approval of the plan.' : ''}
			</p>
			<div class="sc-confirm-foot">
				${button({ label: `Store ${plural(count, 'test')}`, keyName: '1', emphasis: 'primary', attrs: { 'data-stop': true, 'data-key-n': '1' } })}
				${button({ label: 'Cancel', keyName: '2', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true, 'data-key-n': '2' } })}
			</div>`
	)
}

export function stopDialog(context: Context, subject: Subject) {
	return shell(
		`stop-${subject.explorationId}`,
		'Stop the test',
		`${subject.explorationId} has ended. Nothing was stopped.`,
		`/explorations/${subject.explorationId}/stop`,
		context,
		html`<p class="sc-note">
				Stop the test of ${subject.planId}, build ${subject.build}?
				${
					subject.session
						? 'The testers run in the session that started the test. Checkmate cannot end them. It records the stop and gives that session no more work. End the testers in the session.'
						: 'The testers end now.'
				}
				The record and the work folder stay.
			</p>
			${dialogField(`act-stop-${subject.explorationId}-reason`, 'Reason (optional)', 'reason', '')}
			<div class="sc-confirm-foot">
				${button({ label: 'Keep testing', keyName: '1', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true, 'data-key-n': '1' } })}
				${button({ label: 'Stop the test', keyName: '2', emphasis: 'primary', attrs: { 'data-stop': true, 'data-key-n': '2' } })}
			</div>`
	)
}

export function stopTesterDialog(context: Context, subject: Subject, explorer: string) {
	return shell(
		`stop-${subject.explorationId}-${explorer}`,
		`Stop tester ${explorer}`,
		`Tester ${explorer} has finished. Nothing was stopped.`,
		`/explorations/${subject.explorationId}/explorers/${explorer}/stop`,
		context,
		html`<p class="sc-note">
				Stop tester ${explorer} of ${subject.planId}, build ${subject.build}? The other testers go on.
			</p>
			${dialogField(`act-stop-${subject.explorationId}-${explorer}-reason`, 'Reason (optional)', 'reason', '')}
			<div class="sc-confirm-foot">
				${button({ label: 'Keep testing', keyName: '1', attrs: { type: 'button', 'data-act-cancel': true, 'data-stop': true, 'data-key-n': '1' } })}
				${button({ label: `Stop tester ${explorer}`, keyName: '2', emphasis: 'primary', attrs: { 'data-stop': true, 'data-key-n': '2' } })}
			</div>`
	)
}

export function actionButton(act: string, label: string, extra: Attrs = {}) {
	return button({ label, attrs: { type: 'button', 'data-act': act, ...extra } })
}

export function testButton(planId: string, label = 'Test build…', values: Partial<TestValues> = {}) {
	return actionButton('test', label, {
		'data-action': `/plans/${planId}/test`,
		'data-title': `Test a build of ${planId}`,
		'data-plan': planId,
		'data-fill': JSON.stringify(values),
	})
}

export function storeButton(planId: string, count: number, view: string) {
	return actionButton('store', `Store ${plural(count, 'defect')} as tests…`, {
		'data-action': `/plans/${planId}/harvest`,
		'data-fill': JSON.stringify({ view }),
	})
}

export function stopButton(explorationId: string, label = 'Stop the test…') {
	return actionButton(`stop-${explorationId}`, label)
}

export function stopOption(explorationId: string, n = 1) {
	return button({
		label: 'Stop…',
		keyName: n,
		keySpoken: false,
		attrs: { type: 'button', 'data-option': true, 'data-act': `stop-${explorationId}`, title: 'Stop the test' },
	})
}

export function testAgainOption(run: Again, n = 1) {
	const values = JSON.stringify({
		build: run.build,
		level: run.level ?? 'normal',
		since: run.since,
		until: run.until,
		repo: run.repo,
		instance: run.instanceId,
	})
	return optionButton({
		n,
		label: 'Test again',
		attrs: {
			type: 'button',
			'data-act': 'test',
			'data-action': `/plans/${run.planId}/test`,
			'data-title': `Test a build of ${run.planId}`,
			'data-plan': run.planId,
			'data-fill': values,
		},
	})
}

export function testerStopOption(explorationId: string, explorer: string, n: number) {
	return optionButton({
		n,
		label: 'Stop',
		name: `Stop tester ${explorer}`,
		attrs: { type: 'button', 'data-act': `stop-${explorationId}-${explorer}` },
	})
}
