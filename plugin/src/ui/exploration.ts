import type { Store } from '../store.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import type { Claim } from '../journal.ts'
import { explorationReport } from '../explorers.ts'
import { explorationLive, mergedClaims, mergedQuestions, planExplorations } from '../views.ts'
import { actorField, emptyState, gapPanel, hidden, messages, rationaleField, recordPanel } from './forms.ts'
import { banner, downloads, heading } from './layout.ts'
import { clock, duration, html, join, pill, plural, time } from './html.ts'

type Live = ReturnType<typeof explorationLive>
type Question = Live['questions'][number]
type Listed = ReturnType<typeof planExplorations>[number]

function claimRow(claim: Claim) {
	return html`<tr id="${claim.id}" data-key="claim:${claim.id}">
		<td>
			<a
				class="mono"
				href="/explorations/${claim.explorationId}/claims/${claim.id}${claim.decision ? '' : '#decide'}"
				>${claim.id}</a
			>
		</td>
		<td>${pill(claim.state)}</td>
		<td>${pill(claim.severity)}</td>
		<td>${claim.actors.join(', ')}</td>
		<td>${claim.title}${claim.reason ? html`<p class="help">${claim.reason}</p>` : ''}</td>
	</tr>`
}

export function claimsTable(claims: Claim[]) {
	if (!claims.length) return html`<p class="empty-line">No claim.</p>`
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Claim</th>
					<th scope="col">State</th>
					<th scope="col">Severity</th>
					<th scope="col">Reporters</th>
					<th scope="col">Title</th>
				</tr>
			</thead>
			<tbody>
				${claims.map(claimRow)}
			</tbody>
		</table>
	</div>`
}

export function questionsList(questions: Question[]) {
	if (!questions.length) return html`<p class="empty-line">No question.</p>`
	return html`<ul class="items">
		${questions.map(
			(question) =>
				html`<li data-key="question:${question.id}">
					<a
						class="item"
						href="/explorations/${question.explorationId}/questions/${question.id}${question.answer === null ? '#answer' : ''}"
						><span class="id">${question.id}</span><span class="what">${question.question}</span
						><span class="end"
							>${question.blocking ? html`${pill('blocking')} ` : ''}${pill(
								question.answer === null ? 'open' : 'answered'
							)}</span
						></a
					>
				</li>`
		)}
	</ul>`
}

function dataLine(reason: string | null, data: string[]) {
	return html`${reason ?? 'No reason is recorded.'}
	${
		data.length
			? html` Its data:
				${join(
					data.map((path) => html`<code>${path}</code>`),
					', '
				)}.`
			: ''
	}`
}

export function explorationBanners(explorations: Listed[]) {
	const running = explorations.filter((item) => item.running)
	const last = explorations.at(-1)
	return html`${running.map((item) =>
		banner(
			item.paused ? 'warn' : 'info',
			html`<span data-key="running:${item.explorationId}"
				>${item.paused ? html`<strong>Exploration ${item.explorationId} is paused: ${item.paused}</strong> It waits on the oracle in the Claude Code session.` : html`Exploration ${item.explorationId} is running.`}
				<a href="/explorations/${item.explorationId}">Open the live view</a>. Its claims and questions show here
				when it is completed.</span
			>`
		)
	)}
	${
		last && (last.state === 'failed' || last.state === 'stopped')
			? banner(
					'fail',
					html`<span data-key="failed:${last.explorationId}"
						><strong>Exploration ${last.explorationId} ${last.state}.</strong>
						${dataLine(last.reason, last.data)}
						<a href="/explorations/${last.explorationId}">Open ${last.explorationId}</a></span
					>`
				)
			: ''
	}`
}

export function explorationsTable(explorations: Listed[]) {
	if (!explorations.length)
		return html`<p class="empty-line">No exploration yet. Start one with <code>checkmate test</code>.</p>`
	return html`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Exploration</th>
					<th scope="col">State</th>
					<th scope="col">Build</th>
					<th scope="col">Instance</th>
					<th scope="col">Level</th>
					<th scope="col">Started</th>
				</tr>
			</thead>
			<tbody>
				${[...explorations].reverse().map(
					(item) =>
						html`<tr data-key="exploration:${item.explorationId}">
							<td>
								<a class="mono" href="/explorations/${item.explorationId}">${item.explorationId}</a>
							</td>
							<td>
								${pill(item.state)}
								${item.reason !== null ? html`<p class="help">${dataLine(item.reason, item.data)}</p>` : ''}
								${
									item.follow === 'failed' || item.follow === 'stopped'
										? html`<p class="help">
												Follow-up ${item.follow}: ${dataLine(item.followReason, item.data)}
											</p>`
										: ''
								}
							</td>
							<td class="mono">${item.build}</td>
							<td class="mono">${item.instanceId}</td>
							<td>
								${item.level ?? html`<span class="muted">none</span>`}${
									item.explorers === null
										? ''
										: html` <span class="muted">· ${plural(item.explorers, 'explorer')}</span>`
								}
							</td>
							<td class="nowrap">${time(item.startedAt)}</td>
						</tr>`
				)}
			</tbody>
		</table>
	</div>`
}

export function explorationSections(store: Store, planId: string) {
	const explorations = planExplorations(store, planId)
	const claims = mergedClaims(store, planId)
	const questions = mergedQuestions(store, planId)
	return html`<section aria-labelledby="explorations" data-region="explorations">
			<h2 id="explorations">Explorations <span class="n">${explorations.length}</span></h2>
			${explorationsTable(explorations)}
		</section>
		<section aria-labelledby="claims" data-region="claims">
			<h2 id="claims">Claims <span class="n">${claims.length}</span></h2>
			<p class="help">The merged claims of completed explorations.</p>
			${claimsTable(claims)}
		</section>
		<section aria-labelledby="questions" data-region="questions">
			<h2 id="questions">Questions <span class="n">${questions.length}</span></h2>
			<p class="help">The merged questions of completed explorations.</p>
			${questionsList(questions)}
		</section>`
}

function explorerRow(live: Live, item: Live['explorers'][number]) {
	const none = html`<span class="muted">–</span>`
	return html`<tr data-key="explorer:${item.explorer}">
		<td class="mono">${item.explorer}</td>
		<td>${item.turn ?? none}</td>
		<td>${item.state ? pill(item.state, item.state === 'given' ? 'given to the session' : undefined) : none}</td>
		<td class="nowrap">${item.startedAt ? time(item.startedAt, clock(item.startedAt)) : none}</td>
		<td class="nowrap">
			${
				item.elapsedMs === null
					? none
					: item.startedAt && (item.state === 'running' || item.state === 'given')
						? html`<span data-since="${item.startedAt}">${duration(item.elapsedMs)}</span>`
						: duration(item.elapsedMs)
			}
		</td>
		<td>${item.activity ?? ''}</td>
		<td>
			${item.recorded ? html`${pill(item.recorded)} <span class="muted small">${plural(item.saved, 'entry', 'entries')}</span>` : none}
		</td>
		<td>
			${
				item.files.length
					? join(
							item.files.map(
								(file) =>
									html`<a
										href="/explorations/${live.explorationId}/explorers/${item.explorer}/${file.phase}/${file.name}"
										>${file.name}${file.phase === 'test' ? '' : ` (${file.phase})`}</a
									>`
							),
							html`<br />`
						)
					: none
			}
		</td>
	</tr>`
}

function stateBanner(live: Live) {
	if (live.running && live.paused)
		return banner(
			'warn',
			html`<span data-key="paused"
				><strong>Paused: ${live.paused}</strong> It waits on the oracle: answer the operator in the Claude Code
				session.</span
			>`
		)
	if (live.running)
		return banner(
			'info',
			html`Exploration ${live.explorationId} is running. Phase: ${live.phase}. This page updates by itself.`
		)
	if (live.state === 'failed' || live.state === 'stopped')
		return banner(
			'fail',
			html`<strong>Exploration ${live.explorationId} ${live.state}.</strong> ${dataLine(live.reason, live.data)}`
		)
	if (live.follow === 'failed' || live.follow === 'stopped')
		return banner(
			'fail',
			html`<span data-key="follow-failed"
				><strong>The follow-up of ${live.explorationId} ${live.follow}.</strong>
				${dataLine(live.followReason, live.data)} The claims and questions of the exploration stay valid.</span
			>`
		)
	if (live.state === 'open')
		return banner(
			'info',
			html`Exploration ${live.explorationId} is open. Record its sessions, then run
				<code>checkmate explore finish ${live.explorationId}</code>.`
		)
	return ''
}

function unmergedSection(live: Live) {
	if (!live.unmerged.length) return ''
	return html`<section class="panel" aria-labelledby="unmerged-title" data-key="unmerged">
		<h2 class="lab" id="unmerged-title">Not merged yet <span class="n">${live.unmerged.length}</span></h2>
		<p class="help">
			These are the raw questions and defects of single explorers. They are not merged yet. They are not in the
			inbox and not on the plan page. They can change before the exploration is completed.
		</p>
		<ul class="items">
			${live.unmerged.map(
				(item) =>
					html`<li data-key="raw:${item.id}">
						<div class="item">
							<span class="id">${item.id}</span>
							<span class="what">${item.text}</span>
							<span class="end"
								>${pill('pending', `${item.kind}, not merged`)}
								${item.severity ? pill(item.severity) : item.blocking ? pill('blocking') : ''}</span
							>
						</div>
					</li>`
			)}
		</ul>
	</section>`
}

export function explorationPage(store: Store, explorationId: string): Page {
	const live = explorationLive(store, explorationId)
	const meta = html`<div class="meta">
		<span data-region="exploration-state">${pill(live.state)}</span>
		<a class="pill" href="/plans/${live.planId}">${live.planId}</a>
		<span class="pill">build ${live.build}</span>
		<span class="pill">instance ${live.instanceId}</span>
		<span class="pill"
			>${live.level ?? 'no level'} · ${plural(live.explorerCount ?? 0, 'explorer')} · ${live.model ?? '-'}</span
		>
		<span class="pill">started ${time(live.startedAt, clock(live.startedAt))}</span>
	</div>`
	const merged = live.state === 'completed' || live.claims.length + live.questions.length > 0
	const body = html`${heading(html`Exploration ${explorationId}`, live.goal, meta)}
		<div class="stack" data-region="exploration-live">
			${stateBanner(live)}
			<section class="panel" aria-labelledby="explorers-title">
				<h2 class="lab" id="explorers-title">Explorers</h2>
				${
					live.explorers.length
						? html`<div class="scroll">
								<table>
									<thead>
										<tr>
											<th scope="col">Explorer</th>
											<th scope="col">${live.path === 'session' ? 'Step' : 'Turn'}</th>
											<th scope="col">State</th>
											<th scope="col">${live.path === 'session' ? 'Since' : 'Started'}</th>
											<th scope="col">${live.path === 'session' ? 'In state' : 'Elapsed'}</th>
											<th scope="col">Last activity</th>
											<th scope="col">Record</th>
											<th scope="col">Files</th>
										</tr>
									</thead>
									<tbody>
										${live.explorers.map((item) => explorerRow(live, item))}
									</tbody>
								</table>
							</div>`
						: html`<p class="none">No explorer has started yet.</p>`
				}
			</section>
			<section class="panel" aria-labelledby="phases-title">
				<h2 class="lab" id="phases-title">Phases</h2>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">Phase</th>
								<th scope="col">State</th>
								<th scope="col">Reason</th>
							</tr>
						</thead>
						<tbody>
							${live.phases.map(
								(row) =>
									html`<tr data-key="phase:${row.phase}">
										<td>${row.phase}</td>
										<td>${pill(row.state)}</td>
										<td>${row.reason ?? ''}</td>
									</tr>`
							)}
						</tbody>
					</table>
				</div>
			</section>
			${unmergedSection(live)}
			<section class="panel" aria-labelledby="claims-title">
				<h2 class="lab" id="claims-title">Claims</h2>
				${merged ? claimsTable(live.claims) : html`<p class="none">The claims show when the exploration is completed.</p>`}
			</section>
			<section class="panel" aria-labelledby="questions-title">
				<h2 class="lab" id="questions-title">Questions</h2>
				${
					merged
						? questionsList(live.questions)
						: html`<p class="none">The merged questions show when the exploration is completed.</p>`
				}
			</section>
		</div>
		<div class="actions">
			${downloads('Download report', `/explorations/${explorationId}/export`, 'The record of this exploration.', ['md', 'json'])}
		</div>`
	return {
		title: `Exploration ${explorationId}`,
		section: 'plans',
		subjects: [`exploration:${explorationId}`, `plan:${live.planId}`],
		body,
	}
}

export function explorerFilePage(
	store: Store,
	explorationId: string,
	explorer: string,
	phase: string,
	name: string
): Page {
	const file = explorationReport(store, explorationId).files.find(
		(item) => item.explorer === explorer && item.phase === phase && item.name === name
	)
	if (!file) throw new Error(`Unknown file ${name} of ${explorer} in ${explorationId}`)
	return {
		title: `${explorationId} · ${explorer} · ${name}`,
		section: 'plans',
		subjects: [`exploration:${explorationId}`],
		body: html`${heading(html`${explorationId} · ${explorer} · ${name}`, `Saved in the record after the ${phase} turn.`)}
			<p>
				<a href="/explorations/${explorationId}">Exploration ${explorationId}</a> · ${plural(file.size, 'byte')}
			</p>
			<section class="panel" aria-label="${name}"><pre class="report">${file.text}</pre></section>`,
	}
}

export function questionPage(
	store: Store,
	context: Context,
	explorationId: string,
	questionId: string,
	state: FormState | null = null
): Page {
	const report = explorationReport(store, explorationId)
	const question = report.questions.find((item) => item.id === questionId)
	if (!question) throw new Error(`Unknown question ${questionId} in ${explorationId}`)
	const panel =
		question.answer === null || state
			? gapPanel(
					context,
					{
						action: `/explorations/${explorationId}/questions/${question.id}`,
						cancel: `/explorations/${explorationId}`,
						sha256: '',
						title: html`${report.planId} · ${question.id}`,
						question: question.question,
						staleMessage: `${explorationId} changed. Review it before you answer.`,
					},
					state ?? emptyState()
				)
			: recordPanel('Answer', html`<blockquote>${question.answer}</blockquote>`)
	return {
		title: `${report.planId} · ${question.id}`,
		section: 'inbox',
		subjects: [`exploration:${explorationId}`, 'inbox'],
		body: html`${heading(html`${report.planId} · ${question.id}`, question.question)}
			<p>
				<a href="/plans/${report.planId}">Plan ${report.planId}</a> ·
				<a href="/explorations/${explorationId}">Exploration ${explorationId}</a>${
					question.members.length > 1 ? html` · asked as ${question.members.join(', ')}` : ''
				}
			</p>
			${panel}`,
	}
}

export function claimPage(
	store: Store,
	context: Context,
	explorationId: string,
	claimId: string,
	state: FormState | null = null
): Page {
	const report = explorationReport(store, explorationId)
	const claim = report.claims.find((item) => item.id === claimId)
	if (!claim) throw new Error(`Unknown claim ${claimId} in ${explorationId}`)
	const shown = state ?? emptyState()
	const panel = claim.decision
		? recordPanel(
				'Decision',
				html`<p class="subj">${pill(claim.state)} ${claim.id}</p>
					<p class="help">By ${claim.decision.actor}. Rationale: ${claim.decision.rationale}</p>`
			)
		: html`<section class="panel decision" id="decide" aria-labelledby="decide-title" data-region="decision">
				<h2 class="lab" id="decide-title">Decision</h2>
				<p class="subj">Is ${claim.id} a defect?</p>
				<div>${messages(shown)}</div>
				<form method="post" action="/explorations/${explorationId}/claims/${claim.id}" class="decision-form">
					${hidden(context, '')} ${actorField(context, shown)}
					${rationaleField(shown, 'Why do you decide this?')}
					<div class="btns">
						<button class="btn primary" name="verdict" value="approved">Accept as a defect</button>
						<button class="btn" name="verdict" value="rejected">Reject</button>
					</div>
				</form>
			</section>`
	const steps = [claim.steps ?? []].flat()
	return {
		title: `${report.planId} · ${claim.id}`,
		section: 'inbox',
		subjects: [`exploration:${explorationId}`, 'inbox'],
		body: html`${heading(html`${report.planId} · ${claim.id}`, claim.title, html`<div class="meta">${pill(claim.state)} ${pill(claim.severity)}</div>`)}
			<div class="split">
				<section class="panel" aria-labelledby="claim-title">
					<h2 class="lab" id="claim-title">Claim</h2>
					<p>
						<a href="/plans/${report.planId}">Plan ${report.planId}</a> ·
						<a href="/explorations/${explorationId}">Exploration ${explorationId}</a> · build ${claim.build}
					</p>
					<p class="lab">Expected</p>
					<p>${claim.expected}</p>
					<p class="lab">Actual</p>
					<p>${claim.actual}</p>
					${
						steps.length
							? html`<p class="lab">Steps</p>
									<ol>
										${steps.map((step) => html`<li>${step}</li>`)}
									</ol>`
							: ''
					}
					<p class="help">Reported by ${claim.actors.join(', ')}. ${claim.reason ?? ''}</p>
				</section>
				${panel}
			</div>`,
	}
}
