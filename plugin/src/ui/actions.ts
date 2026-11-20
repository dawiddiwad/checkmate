import type { Html } from './html.ts'
import type { Context } from './layout.ts'
import type { Store } from '../store.ts'
import { one } from '../store.ts'
import { levelNames } from '../levels.ts'
import { planRequest } from '../plans.ts'
import { instanceList } from '../targets.ts'
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

type Subject = { explorationId: string; planId: string; build: string }

type Again = Omit<TestValues, 'level' | 'instance'> & { planId: string; level: string | null; instanceId: string }

const levelNotes: Record<string, string> = {
	smoke: '1 tester, no verifier',
	normal: '2 testers and a verifier',
	deep: '3 testers and a verifier',
}

function shell(id: string, title: string, gone: string, action: string, context: Context, body: Html) {
	return html`<dialog
		class="sp-confirm sp-act"
		data-act-dialog="${id}"
		data-gone="${gone}"
		aria-labelledby="act-${id}-title"
	>
		<div class="sp-dh"><h2 id="act-${id}-title" class="sp-path" data-act-title>${title}</h2></div>
		<form method="post" action="${action}" class="sp-form sp-confirm-b" data-act-form>
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<div data-act-error aria-live="polite"></div>
			${body}
		</form>
	</dialog>`
}

function field(id: string, label: string, name: string, value: string, missing = '') {
	return html`<label for="${id}">${label}</label>
		<input
			id="${id}"
			name="${name}"
			value="${value}"
			maxlength="200"
			autocomplete="off"
			${missing ? html`required data-missing="${missing}"` : ''}
			data-stop
		/>`
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
	return html`<fieldset
		class="sp-seg"
		role="radiogroup"
		aria-label="Instance"
		data-instances="${choice.planId}"
		${shown ? '' : html`hidden disabled`}
	>
		<legend>Instance</legend>
		${choice.instances.map(
			(instance, index) =>
				html`<label class="sp-seg-o" title="${instance}"
					><input
						type="radio"
						name="instance"
						value="${instance}"
						data-stop
						data-key-n="${index + 1}"
						${instance === choice.chosen ? html`checked` : ''}
					/><kbd>${index + 1}</kbd><span>${instance}</span></label
				>`
		)}
	</fieldset>`
}

export function testerToolHelp(harness: Context['harness']) {
	return harness === 'pi'
		? 'List tool names, for example read bash. Pi enables the listed tools for the tester.'
		: 'List tool rules, for example Read Bash. With the rule, a tester does not ask. Without it, each call asks you here.'
}

export function testerModels(context: Context) {
	return html`<details class="sp-more" data-tester-models data-harness="${context.harness}">
		<summary data-stop>Models by tester</summary>
		<p class="help">Choose a model for a tester, or use the workspace tester model.</p>
		<p class="help" role="status" data-tester-count-status></p>
		<p class="help" role="status" data-tester-model-status>Open to load models.</p>
		<button class="btn" type="button" data-stop data-tester-model-refresh>Refresh models</button>
		<label for="tester-model-filter">Filter models</label>
		<input id="tester-model-filter" type="search" autocomplete="off" data-stop data-tester-model-filter />
		${Array.from(
			{ length: 10 },
			(_, index) =>
				html`<div class="field-group" data-tester-model-row="${index + 1}" hidden>
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
			<p class="sp-sub">Start a test of the plan on this computer. The testers run in the background.</p>
			${field('act-test-build', 'Build', 'build', shown.build, 'Write the build name.')}
			${instances.map((choice) => instanceField(choice, choice.planId === planId))}
			<fieldset class="sp-seg" role="radiogroup" aria-label="Level">
				<legend>Level</legend>
				${levelNames.map(
					(level, index) =>
						html`<label class="sp-seg-o" title="${levelNotes[level]}"
							><input
								type="radio"
								name="level"
								value="${level}"
								data-stop
								data-key-n="${index + 1}"
								${level === shown.level ? html`checked` : ''}
							/><kbd>${index + 1}</kbd><span>${level}</span></label
						>`
				)}
			</fieldset>
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
			<p class="help" id="act-test-rules-help">${testerToolHelp(context.harness)}</p>
			<details class="sp-more" data-more>
				<summary data-stop>More</summary>
				${field('act-test-since', 'Since (git ref)', 'since', shown.since)}
				${field('act-test-until', 'Until (git ref)', 'until', shown.until)}
				${field('act-test-repo', 'Repository folder', 'repo', shown.repo)}
			</details>
			${testerModels(context)}
			<div class="btns">
				<button class="sp-btn pri" data-stop><kbd>Enter</kbd><span>Start the test</span></button>
				<button class="sp-btn" type="button" data-act-cancel data-stop>
					<kbd>Esc</kbd><span>Cancel</span>
				</button>
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
			<fieldset class="sp-seg" role="radiogroup" aria-label="Area">
				<legend>Area</legend>
				${areas.map(
					(area, index) =>
						html`<label class="sp-seg-o" title="${area}"
							><input
								type="radio"
								name="area"
								value="${area}"
								data-stop
								data-key-n="${index + 1}"
								${index === 0 ? html`checked` : ''}
							/><kbd>${index + 1}</kbd><span class="ell">${area}</span></label
						>`
				)}
			</fieldset>
			<label for="act-${id}-new">Or a new area</label>
			<input id="act-${id}-new" name="newArea" autocomplete="off" data-stop />
			${
				kind === 'add'
					? html`<label for="act-${id}-source">Source (optional)</label>
							<input id="act-${id}-source" name="source" maxlength="200" autocomplete="off" data-stop />`
					: ''
			}
			<div class="btns">
				<button class="sp-btn pri" data-stop><kbd>Enter</kbd><span>Save the rule</span></button>
				<button class="sp-btn" type="button" data-act-cancel data-stop>
					<kbd>Esc</kbd><span>Cancel</span>
				</button>
			</div>`
	)
}

export function copyDialog() {
	return html`<dialog
		class="sp-confirm sp-act"
		data-act-dialog="copy"
		data-gone="The text is not copied."
		aria-labelledby="act-copy-title"
	>
		<div class="sp-dh"><h2 id="act-copy-title" class="sp-path" data-copy-title>Copy the text</h2></div>
		<div class="sp-form sp-confirm-b">
			<p class="sp-sub">Checkmate cannot use the clipboard here: copy the selected text with Ctrl+C or Cmd+C.</p>
			<label for="act-copy-text">Text for the developer</label>
			<textarea id="act-copy-text" class="sp-copy-text" rows="12" readonly data-stop data-copy-text></textarea>
			<div class="btns">
				<button class="sp-btn pri" type="button" data-act-cancel data-stop>
					<kbd>Esc</kbd><span>Close</span>
				</button>
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
			<p class="sp-sub">
				${planId}, build ${subject.build}: the testers read ${answers} of the product owner and test again.
			</p>
			<div class="btns">
				<button class="sp-btn pri" data-stop data-key-n="1">
					<kbd>1</kbd><span>Test the ${answers}</span>
				</button>
				<button class="sp-btn" type="button" data-act-cancel data-stop data-key-n="2">
					<kbd>2</kbd><span>Cancel</span>
				</button>
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
			<p class="sp-sub">
				Checkmate stores each defect as a test of this plan and attaches it to the rule that the defect cites.
				The rules, areas and marks of the plan stay the same. A defect with no rule gets a new rule HRn. Later
				tests of this plan may run the stored
				tests.${approval ? ' The stored tests wait for the approval of the plan.' : ''}
			</p>
			<div class="btns">
				<button class="sp-btn pri" data-stop data-key-n="1">
					<kbd>1</kbd><span>Store ${plural(count, 'test')}</span>
				</button>
				<button class="sp-btn" type="button" data-act-cancel data-stop data-key-n="2">
					<kbd>2</kbd><span>Cancel</span>
				</button>
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
		html`<p class="sp-sub">
				Stop the test of ${subject.planId}, build ${subject.build}? The testers end now. The record and the work
				folder stay.
			</p>
			${field(`act-stop-${subject.explorationId}-reason`, 'Reason (optional)', 'reason', '')}
			<div class="btns">
				<button class="sp-btn" type="button" data-act-cancel data-stop data-key-n="1">
					<kbd>1</kbd><span>Keep testing</span>
				</button>
				<button class="sp-btn pri" data-stop data-key-n="2"><kbd>2</kbd><span>Stop the test</span></button>
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
		html`<p class="sp-sub">
				Stop tester ${explorer} of ${subject.planId}, build ${subject.build}? The other testers go on.
			</p>
			${field(`act-stop-${subject.explorationId}-${explorer}-reason`, 'Reason (optional)', 'reason', '')}
			<div class="btns">
				<button class="sp-btn" type="button" data-act-cancel data-stop data-key-n="1">
					<kbd>1</kbd><span>Keep testing</span>
				</button>
				<button class="sp-btn pri" data-stop data-key-n="2">
					<kbd>2</kbd><span>Stop tester ${explorer}</span>
				</button>
			</div>`
	)
}

export function actionButton(act: string, label: string, extra: Html | '' = '') {
	return html`<button type="button" class="sp-btn" data-act="${act}" ${extra}><span>${label}</span></button>`
}

export function testButton(planId: string, label = 'Test build…', values: Partial<TestValues> = {}) {
	return actionButton(
		'test',
		label,
		html`data-action="/plans/${planId}/test" data-title="Test a build of ${planId}" data-plan="${planId}"
		data-fill="${JSON.stringify(values)}"`
	)
}

export function storeButton(planId: string, count: number, view: string) {
	return actionButton(
		'store',
		`Store ${plural(count, 'defect')} as tests…`,
		html`data-action="/plans/${planId}/harvest" data-fill="${JSON.stringify({ view })}"`
	)
}

export function stopButton(explorationId: string, label = 'Stop the test…') {
	return actionButton(`stop-${explorationId}`, label)
}

export function stopOption(explorationId: string, n = 1) {
	return html`<button type="button" class="sp-btn" data-option data-act="stop-${explorationId}" title="Stop the test">
		<kbd aria-hidden="true">${n}</kbd><span>Stop…</span>
	</button>`
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
	return html`<button
		type="button"
		class="sp-btn"
		data-option
		data-act="test"
		data-action="/plans/${run.planId}/test"
		data-title="Test a build of ${run.planId}"
		data-plan="${run.planId}"
		data-fill="${values}"
		aria-label="${n}: Test again"
		title="Test again"
	>
		<kbd aria-hidden="true">${n}</kbd><span>Test again</span>
	</button>`
}

export function testerStopOption(explorationId: string, explorer: string, n: number) {
	return html`<button
		type="button"
		class="sp-btn"
		data-option
		data-act="stop-${explorationId}-${explorer}"
		aria-label="${n}: Stop tester ${explorer}"
		title="Stop tester ${explorer}"
	>
		<kbd aria-hidden="true">${n}</kbd><span>Stop</span>
	</button>`
}
