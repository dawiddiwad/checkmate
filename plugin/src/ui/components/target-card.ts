import { html, plural } from '../html.ts'

export type TargetInstance = { instanceId: string; environment: string | null; address: string | null }

export type TargetCard = {
	targetId: string
	revision: number | null
	capabilities: string[]
	entryPoints: string[]
	activeInstances: number
	instances: TargetInstance[]
}

function chips(items: string[]) {
	return items.length
		? html`<span class="sc-chips">${items.map((item) => html`<span class="sc-chip">${item}</span>`)}</span>`
		: '—'
}

function instanceRow(targetId: string, instance: TargetInstance) {
	return html`<li class="sc-instance">
		<span class="sc-mono">${instance.instanceId}</span>
		<span class="sc-muted">${instance.environment ?? '—'}</span>
		<code class="sc-ell">${instance.address ?? '—'}</code>
		<a href="/settings/targets/${targetId}#instance-${instance.instanceId}">Open</a>
	</li>`
}

export function targetCard(target: TargetCard) {
	return html`<article class="sc-card" data-key="target:${target.targetId}" data-nav-row>
		<div class="sc-card-h">
			<a class="sc-target-name" href="/settings/targets/${target.targetId}" data-nav-item>${target.targetId}</a>
			<span class="sc-muted sc-mono">${target.revision === null ? 'no profile yet' : `@${target.revision}`}</span>
			<span class="sc-card-aside">${plural(target.activeInstances, 'active instance')}</span>
		</div>
		<dl class="sc-facts">
			<dt>Capabilities</dt>
			<dd>${chips(target.capabilities)}</dd>
			<dt>Entry points</dt>
			<dd>${chips(target.entryPoints)}</dd>
		</dl>
		${
			target.instances.length
				? html`<ul class="sc-instances" aria-label="Active instances of ${target.targetId}">
						${target.instances.map((instance) => instanceRow(target.targetId, instance))}
					</ul>`
				: ''
		}
	</article>`
}
