import type { Store } from '../store.ts'
import type { Profile } from '../types.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { EntryPoint, InstanceRecord } from '../targets.ts'
import { instanceList, targetHistory, targetList, targetRequest, targetRevision } from '../targets.ts'
import { html, join, pill, plural, short, time } from './html.ts'
import { banner, heading } from './layout.ts'

export type InstanceForm = { values: Record<string, string>; error: string | null }
export type RetireState = { instanceId: string; error: string } | null

const settingsPages = [{ path: '/settings/targets', label: 'Targets' }]

function settingsNav(current: string) {
	return html`<nav class="settings-nav" aria-label="Settings pages">
		<ul class="nav">
			${settingsPages.map(
				(page) =>
					html`<li>
						<a href="${page.path}" ${page.path === current ? html`aria-current="page"` : ''}
							>${page.label}</a
						>
					</li>`
			)}
		</ul>
	</nav>`
}

function settingsPage(current: string, title: string, subjects: string[], body: Html, status?: number): Page {
	return {
		title,
		section: 'settings',
		subjects,
		status,
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
	const rows = targets.map(
		(target) =>
			html`<tr data-key="target:${target.targetId}" data-nav-row>
				<td>
					<a class="mono" href="/settings/targets/${target.targetId}" data-nav-item>${target.targetId}</a>
				</td>
				<td class="mono">${target.revision === null ? none('no profile yet') : `@${target.revision}`}</td>
				<td>${words(target.capabilities)}</td>
				<td>${words(target.entryPoints)}</td>
				<td>${target.activeInstances}</td>
			</tr>`
	)
	const body = html`${heading('Targets', 'Each target with its latest revision and its active instances.')}
		<div data-region="targets" data-list>
			${
				targets.length
					? html`<div class="scroll">
							<table>
								<thead>
									<tr>
										<th scope="col">Target</th>
										<th scope="col">Revision</th>
										<th scope="col">Capabilities</th>
										<th scope="col">Entry points</th>
										<th scope="col">Active instances</th>
									</tr>
								</thead>
								<tbody>
									${rows}
								</tbody>
							</table>
						</div>`
					: html`<div class="empty">
							<p class="empty-title">No target yet.</p>
							<p>Record one with <code>checkmate target open</code>.</p>
						</div>`
			}
		</div>`
	return settingsPage('/settings/targets', 'Targets', ['*'], body)
}

function entryPointsTable(entryPoints: EntryPoint[]) {
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Entry point</th>
					<th scope="col">Kind</th>
					<th scope="col">Purpose</th>
				</tr>
			</thead>
			<tbody>
				${entryPoints.map(
					(entry) =>
						html`<tr>
							<td class="mono">${entry.name}</td>
							<td class="mono">${entry.kind}</td>
							<td>${entry.purpose}</td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function toolsTable(profile: Profile) {
	if (!profile.tools.length) return html`<p class="empty-line">No tools.</p>`
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Tool</th>
					<th scope="col">Kind</th>
					<th scope="col">Version</th>
					<th scope="col">At setup</th>
					<th scope="col">Purpose</th>
				</tr>
			</thead>
			<tbody>
				${profile.tools.map(
					(tool) =>
						html`<tr>
							<td class="mono">${tool.name}</td>
							<td class="mono">${tool.kind}</td>
							<td class="mono">${tool.version ?? '–'}</td>
							<td>${tool.reachable ? pill('passed', 'reachable') : pill('failed', 'unreachable')}</td>
							<td>${tool.purpose}</td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

function profileFacts(profile: Profile) {
	const approvals = profile.approvals ?? { plan: 'required', result: 'required' }
	return html`<dl class="facts">
		<div>
			<dt>Capabilities</dt>
			<dd>${words(profile.capabilities)}</dd>
		</div>
		<div>
			<dt>Operations</dt>
			<dd>${words(profile.allowedOperations)}</dd>
		</div>
		<div>
			<dt>Authentication</dt>
			<dd>
				<code>${profile.authentication.kind}</code> · references ${words(profile.authentication.references)}
			</dd>
		</div>
		<div>
			<dt>Approvals</dt>
			<dd>plan <code>${approvals.plan}</code> · result <code>${approvals.result}</code></dd>
		</div>
		<div>
			<dt>Startup</dt>
			<dd>
				${profile.startup.owner}${profile.startup.command ? html` · <code>${profile.startup.command.join(' ')}</code>` : ''}
			</dd>
		</div>
		<div>
			<dt>Cleanup</dt>
			<dd>${profile.cleanup}</dd>
		</div>
		<div>
			<dt>Ready</dt>
			<dd>${profile.readyForLiveExecution ? pill('ready') : pill('blocked', 'not ready')}</dd>
		</div>
	</dl>`
}

function historyList(store: Store, targetId: string, shown: number) {
	const revisions = targetHistory(store, targetId).reverse()
	if (!revisions.length) return html`<p class="empty-line">No profile yet.</p>`
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
					<dd><code>${value}</code></dd>
				</div>`
		)}
	</dl>`
}

function actorInput(context: Context, id: string) {
	if (context.actor) return ''
	return html`<div class="field-group">
		<label class="lab" for="${id}">Your name</label>
		<input id="${id}" name="actor" required autocomplete="name" />
	</div>`
}

function retireControl(context: Context, targetId: string, instance: InstanceRecord, retire: RetireState) {
	if (instance.retired) return html`<span class="muted small">by ${instance.retired.actor}</span>`
	const failed = retire?.instanceId === instance.instanceId ? retire.error : null
	return html`<details class="retire" ${failed ? html`open` : ''} data-open-key="retire:${instance.instanceId}">
		<summary class="btn small">Retire</summary>
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
			<div class="btns"><button class="btn primary">Confirm retire</button></div>
		</form>
	</details>`
}

function instancesTable(context: Context, targetId: string, instances: InstanceRecord[], retire: RetireState) {
	if (!instances.length) return html`<p class="empty-line">No instance yet. Add one to start runs.</p>`
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Instance</th>
					<th scope="col">Entries</th>
					<th scope="col">Environment</th>
					<th scope="col">References</th>
					<th scope="col">Added</th>
					<th scope="col">Status</th>
					<th scope="col"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				${instances.map(
					(instance) =>
						html`<tr id="instance-${instance.instanceId}" data-key="instance:${instance.instanceId}">
							<td class="mono">${instance.instanceId}</td>
							<td>${entryList(instance)}</td>
							<td>${instance.environment ?? none()}</td>
							<td>${words(instance.references)}</td>
							<td class="nowrap">${instance.addedBy} · ${time(instance.addedAt)}</td>
							<td>${instance.retired ? pill('retired') : pill('active')}</td>
							<td>${retireControl(context, targetId, instance, retire)}</td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
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
		<div data-stale-slot>${form?.error ? html`<p class="form-error" role="alert">${form.error}</p>` : ''}</div>
		<form method="post" action="/settings/targets/${targetId}/instances" class="decision-form">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<div class="field-group">
				<label class="lab" for="instance-id">Instance ID</label>
				<input
					id="instance-id"
					name="instanceId"
					required
					pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,95}"
					value="${value('instanceId')}"
					placeholder="staging"
				/>
				<p class="help">Letters, digits, _ or -. An instance ID is not used again.</p>
			</div>
			${entryPoints.map(
				(entry) =>
					html`<div class="field-group">
						<label class="lab" for="entry-${entry.name}"
							>${entry.name} <span class="req">${entry.kind}</span></label
						>
						<input
							id="entry-${entry.name}"
							name="entry.${entry.name}"
							required
							value="${value(`entry.${entry.name}`)}"
							aria-describedby="entry-${entry.name}-help"
						/>
						<p class="help" id="entry-${entry.name}-help">${entry.purpose}</p>
					</div>`
			)}
			<div class="field-group">
				<label class="lab" for="environment">Environment <span class="req">optional</span></label>
				<input id="environment" name="environment" value="${value('environment')}" placeholder="UAT sandbox" />
			</div>
			<div class="field-group">
				<label class="lab" for="references">References <span class="req">optional</span></label>
				<textarea id="references" name="references" rows="2" aria-describedby="references-help">
${value('references')}</textarea>
				<p class="help" id="references-help">One per line, for example an authentication alias. No secrets.</p>
			</div>
			${actorInput(context, 'instance-actor')}
			<div class="btns"><button class="btn primary">Add instance</button></div>
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
		: banner('info', html`The setup request is recorded. The profile is not saved yet.`)
	const body = html`${heading(
			targetId,
			sub,
			html`<div class="meta">
				${shown ? html`<span class="pill" title="${shown.sha256}">sha256 <span class="mono">${short(shown.sha256)}</span></span>` : ''}
			</div>`
		)}
		<div class="split">
			<div class="main-col">
				<nav class="jump" aria-label="On this page">
					<a href="#entry-points">Entry points</a
					><a href="#instances">Instances</a
					>${shown ? html`<a href="#tools">Tools</a><a href="#profile">Profile</a>` : ''}<a href="#history"
						>History</a
					>
				</nav>
				<section aria-labelledby="entry-points">
					<h2 id="entry-points">Entry points <span class="n">${request.entryPoints.length}</span></h2>
					${entryPointsTable(request.entryPoints)}
				</section>
				<section aria-labelledby="instances" data-region="instances">
					<h2 id="instances">Instances <span class="n">${instances.length}</span></h2>
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
				<p class="back"><a href="/settings/targets">← All targets</a></p>
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
