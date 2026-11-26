import { levelNames } from '../../levels.ts'
import { declaredEntryPoints, recipes } from '../../recipes.ts'
import type { Attrs, Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { testerModels, testerToolHelp } from '../actions.ts'
import { button } from '../components/button.ts'
import { field, textArea, textInput } from '../components/field.ts'
import { key } from '../components/key.ts'
import { heading } from '../components/page-heading.ts'
import { html } from '../html.ts'

export type NewInstance = { id: string; address: string | null; local: boolean }
export type NewTarget = { targetId: string; address: string | null; local: boolean; instances: NewInstance[] }
export type NewChangeDefaults = { build: string; target: string; targets: NewTarget[] }

const levelNotes: Record<string, string> = {
	smoke: '1 tester, no verifier',
	normal: '2 testers and a verifier',
	deep: '3 testers and a verifier',
}

function entryField(id: string, name: string, label: string, help: string, extra: Attrs = {}, value = '') {
	return field({
		id,
		label,
		control: textInput({
			id,
			name,
			value,
			attrs: { maxlength: 400, autocomplete: 'off', 'aria-describedby': `${id}-help`, ...extra },
		}),
		help,
		helpId: `${id}-help`,
	})
}

function choice(name: string, label: string, options: Array<[string, string, string]>, checked: string) {
	return html`<fieldset class="sc-radios" role="radiogroup" data-choice="${name}">
		<legend class="sc-label">${label}</legend>
		${options.map(
			([value, text, note], index) =>
				html`<label class="sc-radio" title="${note}"
					><input
						type="radio"
						name="${name}"
						value="${value}"
						${value === checked ? html`checked` : ''}
					/>${key({ name: index + 1 })}<span>${text}</span></label
				>`
		)}
	</fieldset>`
}

function instanceChoice(target: NewTarget, shown: boolean) {
	return html`<fieldset
		class="sc-radios"
		role="radiogroup"
		data-choice="instance"
		data-instances="${target.targetId}"
		${shown ? '' : html`hidden disabled`}
	>
		<legend class="sc-label">Instance</legend>
		${target.instances.map(
			(instance, index) =>
				html`<label class="sc-radio" title="${instance.id}"
					><input
						type="radio"
						name="instance"
						value="${instance.id}"
						${instance.local ? '' : html`data-nonlocal data-address="${instance.address ?? ''}"`}
					/>${key({ name: index + 1 })}<span>${instance.id}</span></label
				>`
		)}
	</fieldset>`
}

function shell(context: Context, action: string, body: Html, submit: string) {
	return html`<form method="post" action="${action}" class="sc-card narrow start-form" data-act-form data-page-form>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<div data-act-error aria-live="polite"></div>
		${body}
		<div class="sc-row-btns">
			${button({ label: `${submit}`, keyName: 'Enter', emphasis: 'primary' })}
			${button({ label: 'Cancel', href: '/', keyName: 'Esc', attrs: { 'data-page-cancel': true } })}
		</div>
	</form>`
}

const assumedLabels: Record<string, string> = {
	instance: 'Instance',
	'entry point': 'Entry point',
	'entry points': 'Entry points',
	reachability: 'Reachability',
	capabilities: 'Capabilities',
	operations: 'Operations',
	reset: 'Reset',
	authentication: 'Authentication',
}

export function assumedRows(lines: string[]) {
	return lines.map((line) => {
		const at = line.indexOf('=')
		const name = line.slice(0, at)
		return [assumedLabels[name] ?? name, line.slice(at + 1)]
	})
}

// An application that is not a web application has no address. It has the entries that the recipes of its tools declare.
function otherEntryFields(workspace: string, submitted?: Record<string, string>) {
	const others = [...declaredEntryPoints(recipes(workspace)).values()].filter((entry) => entry.name !== 'web')
	if (!others.length) return ''
	return html`<div class="sc-field">
		<details
			class="sc-fold"
			data-more
			${others.some((entry) => submitted?.[`entry.${entry.name}`]) ? html`open` : ''}
		>
			<summary>Not a web application?</summary>
			<p class="sc-help">Give the entries that the tool of the application needs, and leave the address empty.</p>
			${others.map((entry) =>
				entryField(
					`setup-entry-${entry.name}`,
					`entry.${entry.name}`,
					entry.name,
					entry.purpose,
					{ 'data-setup-entry': true },
					submitted?.[`entry.${entry.name}`]
				)
			)}
		</details>
	</div>`
}

export function firstRunPage(
	workspace: string,
	context: Context,
	onHome: boolean,
	back = '/',
	invalidAddress?: Record<string, string>
): Page {
	const body = html`${entryField(
			'setup-url',
			'url',
			'Address of the application',
			'The web address that the testers open, for example http://localhost:3000.',
			{
				required: true,
				autofocus: true,
				inputmode: 'url',
				'data-setup-url': true,
				'data-missing': 'Give the address of the application,\n\t\t\tfor example http://localhost:3000.',
			},
			invalidAddress?.url
		)}
		${invalidAddress ? html`<p class="sc-error" role="alert" data-field="url" data-refusal>Give the address of the application, for example http://localhost:3000.</p>` : ''}
		${otherEntryFields(workspace, invalidAddress)}
		<div
			class="setup-assumed"
			data-assumed
			${invalidAddress?.target || invalidAddress?.environment ? '' : html`hidden`}
		>
			<h2 class="sc-label">What Checkmate will assume</h2>
			<p class="sc-help">
				Checkmate sets up the target from these values. Change the name or the environment here.
			</p>
			${entryField('setup-target', 'target', 'Target name', 'Letters, digits, _ or -.', { 'data-setup-field': true, 'data-touched': invalidAddress?.target ? '1' : null }, invalidAddress?.target)}
			${entryField('setup-environment', 'environment', 'Environment (optional)', 'For example staging. A name that starts with prod is a production instance.', { 'data-setup-field': true }, invalidAddress?.environment)}
			<dl class="sc-facts" data-assumed-list></dl>
		</div>
		${choice(
			'operations',
			'Testers may change data',
			[
				['yes', 'Yes', 'Testers may do any action that the application offers to a test user.'],
				['no', 'No', 'Testers only read.'],
			],
			invalidAddress?.operations ?? ''
		)}
		<p class="sc-help" data-operations-help>Type the address, or the entries, first.</p>
		<input type="hidden" name="confirmed" value="" />`
	return {
		title: 'New target',
		status: invalidAddress ? 422 : 200,
		section: 'home',
		subjects: ['inbox', 'settings'],
		crumbs: onHome
			? [['Plans', null]]
			: [
					['Plans', '/'],
					['New target', null],
				],
		back: onHome ? null : back,
		body: html`<div>
			${heading({ title: onHome ? 'Set up the application' : 'New target', sub: onHome ? 'Checkmate has no target yet. Give the address of the application to test.' : 'Give the address of the application to test.' })}
			${shell(context, '/setup', body, 'Set up the target')}
		</div>`,
	}
}

export function newChangePage(context: Context, defaults: NewChangeDefaults, onHome: boolean): Page {
	const chosen = defaults.targets.find((target) => target.targetId === defaults.target) ?? defaults.targets[0]
	const targets =
		defaults.targets.length > 1
			? html`<div class="sc-field">
					<label class="sc-label" for="change-target">Target</label>
					<select id="change-target" name="target" aria-describedby="change-target-help" data-new-target>
						${defaults.targets.map(
							(target) =>
								html`<option
									value="${target.targetId}"
									${target.targetId === chosen.targetId ? html`selected` : ''}
									${target.address ? html`data-address="${target.address}"` : ''}
									${target.local ? '' : html`data-nonlocal`}
								>
									${target.targetId}
								</option>`
						)}
					</select>
					<p class="sc-help" id="change-target-help">
						The application to test. <a class="tap" href="/setup" data-new-target-link>New target</a>
					</p>
				</div>`
			: html`<input
						type="hidden"
						name="target"
						value="${chosen.targetId}"
						${chosen.local ? '' : html`data-nonlocal data-address="${chosen.address ?? ''}"`}
					/>
					<p class="sc-help" data-new-target-note>
						Target <strong>${chosen.targetId}</strong>.
						<a class="tap" href="/setup" data-new-target-link>New target</a>
					</p>`
	const instances = defaults.targets
		.filter((target) => target.instances.length)
		.map((target) => instanceChoice(target, target.targetId === chosen.targetId))
	const body = html`${targets} ${instances}
		${entryField(
			'change-file',
			'file',
			'Ticket file',
			'The path of a file inside the workspace, for example docs/ticket.md. Or paste the ticket below.',
			{ 'data-ticket-file': true, autofocus: true },
			''
		)}
		${field({
			id: 'change-text',
			label: 'Ticket text',
			control: textArea({
				id: 'change-text',
				name: 'text',
				rows: 6,
				attrs: { 'aria-describedby': 'change-text-help', 'data-ticket-text': true },
			}),
			help: html`Paste the ticket when you have no file. Checkmate keeps it in <code>.checkmate/sources/</code>.`,
			helpId: 'change-text-help',
		})}
		${entryField('change-plan', 'plan', 'Name of the plan', 'Letters, digits, _ or -. Checkmate gives a name from the ticket.', { 'data-plan-name': true })}
		${entryField('change-build', 'build', 'Build', 'The name of the build under test. Checkmate gives the short git commit, or the date and time.', { required: true, 'data-missing': 'Write the build name.' }, defaults.build)}
		${choice(
			'level',
			'Level',
			levelNames.map((level) => [level, level, levelNotes[level]] as [string, string, string]),
			'normal'
		)}
		<input type="hidden" name="harness" value="${context.harness}" />
		${entryField('change-rules', 'rules', 'Testers may use without asking', testerToolHelp(context.harness), {}, context.testerRules)}
		${testerModels(context)}
		<details class="sc-fold" data-more>
			<summary>More</summary>
			${entryField('change-since', 'since', 'Since (git ref)', 'Without it, Checkmate uses the default branch of origin.')}
			${entryField('change-until', 'until', 'Until (git ref)', 'Needs Since.')}
			${entryField('change-repo', 'repo', 'Repository folder', 'A folder inside the workspace. Without it, the workspace.')}
		</details>
		<input type="hidden" name="confirmed" value="" />`
	return {
		title: 'New change',
		section: 'home',
		subjects: ['inbox', 'settings'],
		crumbs: onHome
			? [['Plans', null]]
			: [
					['Plans', '/'],
					['New change', null],
				],
		back: onHome ? null : '/',
		body: html`<div>
			${heading({ title: 'New change', sub: 'Give the ticket of a change. Checkmate makes a plan from it and starts the first test.' })}
			${shell(context, '/new', body, 'Start the test')}
		</div>`,
	}
}
