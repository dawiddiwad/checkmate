import type { Store } from '../../store.ts'
import type { Profile } from '../../types.ts'
import type { EntryPoint, InstanceRecord } from '../../targets.ts'
import { Refusal } from '../../contracts.ts'
import {
	requestEffortText,
	requestModelText,
	testerEffortText,
	testerModelText,
	workspaceUiEnv,
} from '../../settings.ts'
import { testLevels } from '../../levels.ts'
import { liveUi, requireChild } from '../../sessions.ts'
import { selectedHarness } from '../../pi.ts'
import type { Env } from '../../sessions.ts'
import { instanceList, targetHistory, targetList, targetRequest, targetRevision } from '../../targets.ts'
import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import { notice } from '../components/notice.ts'
import { formButton } from '../components/button.ts'
import { dataTable, tableRow } from '../components/data-table.ts'
import { emptyNotice } from '../components/empty-state.ts'
import { field, textArea, textInput } from '../components/field.ts'
import { heading } from '../components/page-heading.ts'
import { statusMark } from '../components/status-mark.ts'
import { jumpLinks, pageTabs } from '../components/tabs.ts'
import { html, join, plural, short, time } from '../html.ts'

export type InstanceForm = { values: Record<string, string>; error: string | null; field?: string | null }
export type RulesForm = { value: string; error: string }
export type RetireState = { instanceId: string; error: string } | null

const settingsPages = [
	{ path: '/settings/targets', label: 'Targets' },
	{ path: '/settings/recipes', label: 'Recipes' },
	{ path: '/settings/harness', label: 'Coding harness' },
]

function settingsNav(current: string) {
	return pageTabs({
		label: 'Settings pages',
		tabs: settingsPages.map((page) => ({ href: page.path, label: page.label })),
		current,
	})
}

export function settingsPage(current: string, title: string, subjects: string[], body: Html, status?: number): Page {
	const parent = settingsPages.find((page) => page.path === current)!
	const detail = title !== parent.label
	return {
		title,
		section: 'settings',
		subjects,
		status,
		crumbs: [
			['Settings', '/settings/targets'],
			...(detail
				? [[parent.label, current] as [string, string], [title, null] as [string, null]]
				: [[title, null] as [string, null]]),
		],
		back: detail ? current : '/',
		body: html`${settingsNav(current)} ${body}`,
	}
}

function none(text = 'none') {
	return html`<span class="muted">${text}</span>`
}

function words(items: string[]) {
	return items.length
		? join(
				items.map((item) => html`<code>${item}</code>`),
				' '
			)
		: none()
}

export function targetsPage(store: Store): Page {
	const targets = targetList(store)
	const rows = targets.map((target) =>
		tableRow({
			cells: [
				html`<a class="mono" href="/settings/targets/${target.targetId}" data-nav-item>${target.targetId}</a>`,
				{
					content: html`${target.revision === null ? none('no profile yet') : `@${target.revision}`}`,
					attrs: { class: 'mono' },
				},
				words(target.capabilities),
				words(target.entryPoints),
				target.activeInstances,
			],
			attrs: { 'data-key': `target:${target.targetId}`, 'data-nav-row': true },
		})
	)
	const body = html`${heading({ title: 'Targets', sub: 'Each target with its latest revision and its active instances.' })}
		<div data-region="targets" data-list>
			${
				targets.length
					? dataTable({
							columns: ['Target', 'Revision', 'Capabilities', 'Entry points', 'Active instances'],
							rows: rows,
							scroll: true,
						})
					: emptyNotice({
							what: 'No target yet.',
							next: html`Record one with <code>checkmate target open</code>.`,
						})
			}
		</div>`
	return settingsPage('/settings/targets', 'Targets', ['*'], body)
}

function entryPointsTable(entryPoints: EntryPoint[]) {
	return dataTable({
		columns: ['Entry point', 'Kind', 'Purpose'],
		rows: entryPoints.map((entry) =>
			tableRow({
				cells: [
					{ content: entry.name, attrs: { class: 'mono' } },
					{ content: entry.kind, attrs: { class: 'mono' } },
					entry.purpose,
				],
			})
		),
		scroll: true,
	})
}

function toolsTable(profile: Profile) {
	if (!profile.tools.length) return html`<p class="none">No tools.</p>`
	return dataTable({
		columns: ['Tool', 'Kind', 'Version', 'At setup', 'Purpose'],
		rows: profile.tools.map((tool) =>
			tableRow({
				cells: [
					{ content: tool.name, attrs: { class: 'mono' } },
					{ content: tool.kind, attrs: { class: 'mono' } },
					{ content: tool.version ?? '–', attrs: { class: 'mono' } },
					tool.reachable
						? statusMark({ state: 'passed', label: 'reachable' })
						: statusMark({ state: 'failed', label: 'unreachable' }),
					tool.purpose,
				],
			})
		),
		scroll: true,
	})
}

function profileFacts(profile: Profile) {
	const approvals = profile.approvals ?? { plan: 'required', result: 'required' }
	return html`<dl class="facts">
		<dt>Capabilities</dt>
		<dd>${words(profile.capabilities)}</dd>
		<dt>Operations</dt>
		<dd>${words(profile.allowedOperations)}</dd>
		<dt>Authentication</dt>
		<dd><code>${profile.authentication.kind}</code> · references ${words(profile.authentication.references)}</dd>
		<dt>Approvals</dt>
		<dd>plan <code>${approvals.plan}</code> · result <code>${approvals.result}</code></dd>
		<dt>Startup</dt>
		<dd>
			${profile.startup.owner}${profile.startup.command ? html` · <code>${profile.startup.command.join(' && ')}</code>` : ''}
		</dd>
		<dt>Cleanup</dt>
		<dd>${profile.cleanup}</dd>
		${
			profile.reset
				? html`<dt>Reset</dt>
						<dd>
							${profile.reset.owner}${profile.reset.command ? html` · <code>${profile.reset.command.join(' && ')}</code>` : ''}
						</dd>`
				: ''
		}
		<dt>Profile readiness</dt>
		<dd>
			${
				profile.readyForLiveExecution
					? statusMark({ state: 'ready' })
					: html`${statusMark({ state: 'blocked', label: 'not ready' })}
							<p class="help">
								Check the active instances below. Then run
								<code>checkmate delegate setup ${profile.targetId}</code>
								to recheck the prerequisites and save a profile revision.
							</p>`
			}
		</dd>
	</dl>`
}

function historyList(store: Store, targetId: string, shown: number) {
	const revisions = targetHistory(store, targetId).reverse()
	if (!revisions.length) return html`<p class="none">No profile yet.</p>`
	return html`<ol class="history">
		${revisions.map(
			(item) =>
				html`<li class="${item.revision === shown ? 'current' : ''}">
					<div class="record-h">
						<a class="mono rev" href="/settings/targets/${targetId}?revision=${item.revision}"
							>${targetId}@${item.revision}</a
						>
						<span class="muted">by ${item.actor} · ${time(item.at)}</span>
						<code class="muted small" title="${item.sha256}">${short(item.sha256)}</code>
						<span class="muted small"
							>${item.changed.length ? html`changed ${item.changed.join(', ')}` : 'first revision'}</span
						>
					</div>
				</li>`
		)}
	</ol>`
}

function entryList(instance: InstanceRecord) {
	return html`<dl class="entries">
		${Object.entries(instance.entries).map(
			([name, value]) =>
				html`<div>
					<dt class="mono">${name}</dt>
					<dd>
						<code
							>${join(
								value.split(' ').map((word) => html`<span class="word">${word}</span>`),
								' '
							)}</code
						>
					</dd>
				</div>`
		)}
	</dl>`
}

function actorInput(context: Context, id: string) {
	if (context.actor) return ''
	return html`${field({ id: id, label: 'Your name', control: textInput({ id: id, name: 'actor', attrs: { required: true, autocomplete: 'name' } }) })}`
}

function retireControl(context: Context, targetId: string, instance: InstanceRecord, retire: RetireState) {
	if (instance.retired) return html`<span class="muted small">retired by ${instance.retired.actor}</span>`
	const failed = retire?.instanceId === instance.instanceId ? retire.error : null
	return html`<details class="retire" ${failed ? html`open` : ''} data-open-key="retire:${instance.instanceId}">
		${formButton({ label: 'Retire', element: 'summary', inline: true, attrs: { 'aria-label': `Retire ${instance.instanceId}` } })}
		<form
			method="post"
			action="/settings/targets/${targetId}/instances/${instance.instanceId}/retire"
			class="confirm-box"
		>
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<input type="hidden" name="confirmed" value="1" />
			<p>Retire <code>${instance.instanceId}</code>? No new run can start on it. Its runs stay as they are.</p>
			${failed ? html`<p class="form-error" role="alert">${failed}</p>` : ''}
			${actorInput(context, `retire-actor-${instance.instanceId}`)}
			<div class="btns">${formButton({ label: 'Confirm retire', emphasis: 'primary' })}</div>
		</form>
	</details>`
}

function instancesTable(context: Context, targetId: string, instances: InstanceRecord[], retire: RetireState) {
	if (!instances.length) return html`<p class="none">No instance yet. Add one to start runs.</p>`
	return dataTable({
		columns: [
			'Instance',
			'Entries',
			'Environment',
			'References',
			'Added',
			'Status',
			html`<span class="sr-only">Actions</span>`,
		],
		rows: instances.map((instance) =>
			tableRow({
				cells: [
					{ content: instance.instanceId, attrs: { class: 'mono' } },
					entryList(instance),
					instance.environment ?? none(),
					words(instance.references),
					html`${instance.addedBy} · ${time(instance.addedAt)}`,
					instance.retired ? statusMark({ state: 'retired' }) : statusMark({ state: 'active' }),
					retireControl(context, targetId, instance, retire),
				],
				attrs: { id: `instance-${instance.instanceId}`, 'data-key': `instance:${instance.instanceId}` },
			})
		),
		scroll: true,
	})
}

function addForm(context: Context, targetId: string, entryPoints: EntryPoint[], form: InstanceForm | null) {
	const value = (name: string) => form?.values[name] ?? ''
	return html`<section
		class="panel decision"
		aria-labelledby="add-instance"
		data-region="instance-form"
		data-stale-message="${targetId} changed. Review it before you add the instance."
	>
		<h2 class="lab" id="add-instance">Add instance</h2>
		<p class="help">
			An instance is one place where the target runs. Adding one needs no new revision and no approval.
		</p>
		<div data-stale-slot>
			${
				form?.error
					? html`<p class="form-error" role="alert" data-field="${form.field ?? ''}">${form.error}</p>`
					: ''
			}
		</div>
		<form method="post" action="/settings/targets/${targetId}/instances" class="decision-form">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			${field({ id: 'instance-id', label: 'Instance ID', control: textInput({ id: 'instance-id', name: 'instanceId', value: value('instanceId'), attrs: { required: true, pattern: '[A-Za-z0-9][A-Za-z0-9_\\-]{0,95}', placeholder: 'staging' } }), help: 'Letters, digits, _ or -. An instance ID is not used again.' })}
			${entryPoints.map((entry) =>
				field({
					id: `entry-${entry.name}`,
					label: html`${entry.name} <span class="req">${entry.kind}</span>`,
					control: textInput({
						id: `entry-${entry.name}`,
						name: `entry.${entry.name}`,
						value: value(`entry.${entry.name}`),
						attrs: { required: true, 'aria-describedby': `entry-${entry.name}-help` },
					}),
					help: entry.purpose,
					helpId: `entry-${entry.name}-help`,
				})
			)}
			${field({ id: 'environment', label: html`Environment <span class="req">optional</span>`, control: textInput({ id: 'environment', name: 'environment', value: value('environment'), attrs: { placeholder: 'UAT sandbox' } }) })}
			${field({ id: 'references', label: html`References <span class="req">optional</span>`, control: textArea({ id: 'references', name: 'references', rows: 2, value: value('references'), attrs: { 'aria-describedby': 'references-help' } }), help: 'One per line, for example an authentication alias. No secrets.', helpId: 'references-help' })}
			${actorInput(context, 'instance-actor')}
			<div class="btns">${formButton({ label: 'Add instance', emphasis: 'primary' })}</div>
		</form>
	</section>`
}

export function targetPage(
	store: Store,
	context: Context,
	targetId: string,
	revision: number | null,
	form: InstanceForm | null = null,
	retire: RetireState = null
): Page {
	const request = targetRequest(store, targetId)
	const latest = targetHistory(store, targetId).at(-1)?.revision ?? null
	const shown = latest === null ? null : targetRevision(store, targetId, revision ?? latest)
	const instances = instanceList(store, targetId)
	const active = instances.filter((instance) => !instance.retired).length
	const instancesText = plural(active, 'active instance')
	const older = html` · <a href="/settings/targets/${targetId}">latest is ${latest}</a>`
	const revisionText = shown ? `Revision ${shown.revision}` : ''
	const sub = shown
		? html`${revisionText}${shown.revision === latest ? ' (latest)' : older} · ${instancesText}`
		: html`No profile yet. Run <code>checkmate delegate setup ${targetId}</code>. ${instancesText}.`
	const shape = shown
		? html`<section aria-labelledby="tools">
					<h2 id="tools">Tools <span class="n">${shown.profile.tools.length}</span></h2>
					${toolsTable(shown.profile)}
				</section>
				<section aria-labelledby="profile">
					<h2 id="profile">Profile</h2>
					${profileFacts(shown.profile)}
				</section>`
		: notice({ kind: 'info', content: html`The setup request is recorded. The profile is not saved yet.` })
	const body = html`${heading({
			title: targetId,
			sub,
			extra: html`<div class="meta">
				${shown ? html`<span class="pill" title="${shown.sha256}">sha256 <span class="mono">${short(shown.sha256)}</span></span>` : ''}
			</div>`,
		})}
		<div class="split">
			<div class="main-col">
				${jumpLinks({
					links: [
						{ href: '#entry-points', label: 'Entry points' },
						{ href: '#instances', label: 'Instances' },
						...(shown
							? [
									{ href: '#tools', label: 'Tools' },
									{ href: '#profile', label: 'Profile' },
								]
							: []),
						{ href: '#history', label: 'History' },
					],
				})}
				<section aria-labelledby="entry-points">
					<h2 id="entry-points">Entry points <span class="n">${request.entryPoints.length}</span></h2>
					${entryPointsTable(request.entryPoints)}
				</section>
				<section aria-labelledby="instances" data-region="instances">
					<h2 id="instances">Instances <span class="n">${instances.length}</span></h2>
					${
						retire &&
						!instances.some((instance) => instance.instanceId === retire.instanceId && !instance.retired)
							? html`<p class="form-error" role="alert">${retire.error}</p>`
							: ''
					}
					${instancesTable(context, targetId, instances, retire)}
				</section>
				${shape}
				<section aria-labelledby="history" data-region="target-history">
					<h2 id="history">History</h2>
					${historyList(store, targetId, shown?.revision ?? 0)}
				</section>
			</div>
			<aside class="side" aria-label="Add instance">
				${addForm(context, targetId, request.entryPoints, form)}
				<p class="back"><a href="/settings/targets">All targets</a></p>
			</aside>
		</div>`
	return settingsPage(
		'/settings/targets',
		targetId,
		[`target:${targetId}`],
		body,
		form?.error || retire ? 422 : undefined
	)
}

export function instanceFromForm(entryPoints: EntryPoint[], form: URLSearchParams) {
	const environment = form.get('environment')?.trim() ?? ''
	const references = (form.get('references') ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
	return {
		entries: Object.fromEntries(
			entryPoints.map((entry) => [entry.name, (form.get(`entry.${entry.name}`) ?? '').trim()])
		),
		...(environment ? { environment } : {}),
		references,
	}
}

function harnessProgram(env: Env) {
	try {
		const program = requireChild(env, selectedHarness(env))
		return html`<code>${program}</code>`
	} catch (error) {
		if (!(error instanceof Refusal)) throw error
		return html`<span class="form-error" role="status">${error.message} ${error.hint ?? ''}</span>`
	}
}

export function harnessPage(
	store: Store,
	context: Context,
	env: Env,
	form: RulesForm | null = null,
	model: RulesForm | null = null,
	testerModel: RulesForm | null = null
): Page {
	const effectiveEnv = workspaceUiEnv(store, env)
	const harness = selectedHarness(effectiveEnv)
	const pi = harness === 'pi'
	const testerValue = testerModel?.value ?? testerModelText(store, harness)
	const requestValue = model?.value ?? requestModelText(store, harness)
	const levelModels = [...new Set(Object.values(testLevels).map((level) => level.model))]
	const testerDefault = !pi && levelModels.length === 1 ? levelModels[0] : ''
	const body = html`${heading({ title: 'Coding harness', sub: null })}
		<div class="panel">
			<form method="post" action="/settings/harness/select" class="decision-form">
				<input type="hidden" name="csrf" value="${context.csrf}" />
				${field({
					id: 'coding-harness',
					label: 'Program for this workspace',
					control: html`<select id="coding-harness" name="harness">
						<option value="claude" ${harness === 'claude' ? html`selected` : ''}>Claude Code</option>
						<option value="pi" ${harness === 'pi' ? html`selected` : ''}>Pi</option>
					</select>`,
					help: 'Applies to new tests and chats in this workspace.',
				})}
				<div class="btns">${formButton({ label: 'Save the program', emphasis: 'primary' })}</div>
			</form>
			<p id="harness-program">Current executable · ${harnessProgram(effectiveEnv)}</p>
		</div>
		<section class="panel" aria-labelledby="claude-rules">
			<h2 class="lab" id="claude-rules">Tool rules of testers</h2>
			<p class="help" data-key="permission-bash">
				${pi ? 'With Bash, testers can run commands. Without it, they cannot use Bash.' : 'With Bash, testers run commands without asking. Without it, each command asks you here. A tester waits up to 10 minutes for an answer.'}
			</p>
			<p class="help" data-region="permission-hook">
				${
					liveUi(context.workspace)
						? 'Testers that start now can ask you in this UI when a tool needs a permission.'
						: 'Testers that start now cannot ask you. The UI of this folder does not run. A tool that needs a permission is denied.'
				}
			</p>
			<form method="post" action="/settings/harness/rules" class="decision-form">
				<input type="hidden" name="csrf" value="${context.csrf}" />
				<input type="hidden" name="harness" value="${harness}" />
				<div class="field-group">
					<label class="lab" for="tester-rules">Default tools for new tests</label>
					<input
						id="tester-rules"
						name="rules"
						maxlength="400"
						autocomplete="off"
						value="${form?.value ?? context.testerRules}"
						aria-describedby="tester-rules-help"
						${form ? html`autofocus` : ''}
					/>
					<p class="help" id="tester-rules-help">
						${pi ? 'Enter tool names separated by spaces, for example read bash.' : 'Enter tool rules separated by spaces, for example Read Bash.'}
					</p>
					${form ? html`<p class="form-error" role="alert" data-field="rules">${form.error}</p>` : ''}
				</div>
				<div class="btns">${formButton({ label: 'Save the rules', emphasis: 'primary' })}</div>
			</form>
		</section>
		<section
			class="panel"
			aria-labelledby="model-settings"
			data-model-catalog="${harness}"
			data-tester-default="${testerDefault}"
		>
			<h2 class="lab" id="model-settings">Models</h2>
			<p class="help">Choose a model for each kind of work. Choose a default or a model from the list.</p>
			<p class="help">
				If the coding harness cannot use a saved model, a delegated worker uses the harness default. The reply
				says so.
			</p>
			<p class="help" role="status" data-model-status>Loading models from ${pi ? 'Pi' : 'Claude Code'}…</p>
			${formButton({ label: 'Refresh models', attrs: { type: 'button', 'data-model-refresh': true } })}
			${field({
				id: 'model-filter',
				label: 'Filter models',
				control: textInput({
					id: 'model-filter',
					attrs: { type: 'search', autocomplete: 'off', placeholder: 'Search available models' },
				}),
			})}
			<form method="post" action="/settings/harness/models" class="decision-form">
				<input type="hidden" name="csrf" value="${context.csrf}" />
				<input type="hidden" name="harness" value="${harness}" />
				<div class="field-group">
					<label class="lab" for="tester-model">Model for testers</label>
					<select id="tester-model" name="testerModel" aria-describedby="tester-model-help" data-model-select>
						<option value="">${pi ? 'Pi default' : 'Test level default'}</option>
						${testerValue ? html`<option value="${testerValue}" selected>${testerValue}</option>` : ''}
					</select>
					<p class="help" id="tester-model-help">
						${pi ? 'The Pi default is the model configured in Pi.' : 'The test level selects its default model.'}
						Delegated execute workers also use this model${pi ? '' : ', or the Claude Code default'}.
					</p>
					<p class="help" data-model-unavailable="tester-model" hidden></p>
					<div hidden>
						<label class="lab" for="tester-effort">Reasoning effort for testers</label>
						<select
							id="tester-effort"
							name="testerEffort"
							data-effort-for="tester-model"
							data-saved-effort="${testerEffortText(store, harness)}"
							disabled
						></select>
					</div>
					${testerModel?.error ? html`<p class="form-error" role="alert" data-field="model">${testerModel.error}</p>` : ''}
				</div>

				<div class="field-group">
					<label class="lab" for="request-model">Model for chats</label>
					<select
						id="request-model"
						name="requestModel"
						aria-describedby="request-model-help"
						data-model-select
					>
						<option value="">${pi ? 'Pi default' : 'Claude Code default'}</option>
						${requestValue ? html`<option value="${requestValue}" selected>${requestValue}</option>` : ''}
					</select>
					<p class="help" id="request-model-help">
						The default is the model configured in ${pi ? 'Pi' : 'Claude Code'}. Delegated setup, plan, and
						revise workers also use this model.
					</p>
					<p class="help" data-model-unavailable="request-model" hidden></p>
					<div hidden>
						<label class="lab" for="request-effort">Reasoning effort for chats</label>
						<select
							id="request-effort"
							name="requestEffort"
							data-effort-for="request-model"
							data-saved-effort="${requestEffortText(store, harness)}"
							disabled
						></select>
					</div>
					${model?.error ? html`<p class="form-error" role="alert" data-field="model">${model.error}</p>` : ''}
				</div>
				<div class="btns">${formButton({ label: 'Save models', emphasis: 'primary' })}</div>
			</form>
		</section>
		<section class="panel" aria-labelledby="chat-settings">
			<h2 class="lab" id="chat-settings">Chats</h2>

			<p class="help">
				New chats use ${pi ? 'Pi' : 'Claude Code'} and your chat model by default. Change the harness, model, or
				effort for the next message in the chat.
			</p>
			<div class="btns">${formButton({ label: 'Open Chats', href: '/chats' })}</div>
		</section>`
	return settingsPage('/settings/harness', 'Coding harness', ['*'], body)
}
