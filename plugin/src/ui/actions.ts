import type { Html } from './html.ts'
import type { Context } from './layout.ts'
import { levelNames } from '../levels.ts'
import { html, plural } from './html.ts'

export type TestValues = { build: string; level: string; since: string; until: string; repo: string }

type Subject = { explorationId: string; planId: string; build: string }

type Again = Omit<TestValues, 'level'> & { planId: string; level: string | null }

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

function field(id: string, label: string, name: string, value: string, required = false) {
	return html`<label for="${id}">${label}</label>
		<input
			id="${id}"
			name="${name}"
			value="${value}"
			maxlength="200"
			autocomplete="off"
			${required ? html`required` : ''}
			data-stop
		/>`
}

export function testDialog(context: Context, planId: string | null, values: TestValues, fallbackBuild = '') {
	const build = values.build || fallbackBuild
	const shown = { ...values, build }
	return shell(
		'test',
		planId ? `Test a build of ${planId}` : 'Test a build',
		planId ? `A test of ${planId} is in progress now. Nothing was started here.` : 'Nothing was started.',
		planId ? `/plans/${planId}/test` : '/activity',
		context,
		html`<p class="sp-sub">Start a test of the plan on this computer. The testers run in the background.</p>
			${field('act-test-build', 'Build', 'build', shown.build, true)}
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
			<p class="help" id="act-test-rules-help">
				One tool rule for each word, as in <code>--allow</code>, for example <code>Read Bash</code>. A tester
				cannot answer a permission prompt.
			</p>
			<details class="sp-more" data-more>
				<summary data-stop>More</summary>
				${field('act-test-since', 'Since (git ref)', 'since', shown.since)}
				${field('act-test-until', 'Until (git ref)', 'until', shown.until)}
				${field('act-test-repo', 'Repository folder', 'repo', shown.repo)}
			</details>
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
			<input id="act-${id}-text" name="text" maxlength="400" autocomplete="off" required data-stop />
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
			<input id="act-${id}-new" name="newArea" maxlength="40" autocomplete="off" data-stop />
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
		html`data-action="/plans/${planId}/test" data-title="Test a build of ${planId}"
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
	return html`<button
		type="button"
		class="sp-btn"
		data-option
		data-act="stop-${explorationId}"
		aria-label="${n}: Stop the test"
		title="Stop the test"
	>
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
	})
	return html`<button
		type="button"
		class="sp-btn"
		data-option
		data-act="test"
		data-action="/plans/${run.planId}/test"
		data-title="Test a build of ${run.planId}"
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
