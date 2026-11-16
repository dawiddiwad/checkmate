import type { Store } from '../store.ts'
import type { Context, Page } from './layout.ts'
import type { FormState } from './forms.ts'
import type { Claim } from '../journal.ts'
import { explorationReport } from '../explorers.ts'
import { actorField, emptyState, gapPanel, hidden, messages, rationaleField, recordPanel } from './forms.ts'
import { downloads, heading } from './layout.ts'
import { html, pill } from './html.ts'

function claimRow(explorationId: string, claim: Claim) {
	return html`<tr id="${claim.id}">
		<td><a class="mono" href="/explorations/${explorationId}/claims/${claim.id}">${claim.id}</a></td>
		<td>${pill(claim.state)}</td>
		<td>${pill(claim.severity)}</td>
		<td>${claim.actors.join(', ')}</td>
		<td>${claim.title}${claim.reason ? html`<p class="help">${claim.reason}</p>` : ''}</td>
	</tr>`
}

export function explorationPage(store: Store, explorationId: string): Page {
	const report = explorationReport(store, explorationId)
	const meta = html`<div class="meta">
		${pill(report.state)} <a class="pill" href="/plans/${report.planId}">${report.planId}</a>
		<span class="pill">build ${report.build}</span>
		<span class="pill"
			>${report.level ?? 'no level'} · ${report.explorerCount ?? 0} explorers · ${report.model ?? '-'}</span
		>
	</div>`
	const body = html`${heading(html`Exploration ${explorationId}`, report.charter.goal, meta)}
		<section class="panel" aria-labelledby="claims-title">
			<h2 class="lab" id="claims-title">Claims</h2>
			${
				report.claims.length
					? html`<table class="table">
							<thead>
								<tr>
									<th>Claim</th>
									<th>State</th>
									<th>Severity</th>
									<th>Reporters</th>
									<th>Title</th>
								</tr>
							</thead>
							<tbody>
								${report.claims.map((claim) => claimRow(explorationId, claim))}
							</tbody>
						</table>`
					: html`<p class="none">No claim.</p>`
			}
		</section>
		<section class="panel" aria-labelledby="questions-title">
			<h2 class="lab" id="questions-title">Questions</h2>
			${
				report.questions.length
					? html`<ul class="items">
							${report.questions.map(
								(question) =>
									html`<li>
										<a
											class="item"
											href="/explorations/${explorationId}/questions/${question.id}#answer"
											><span class="id">${question.id}</span
											><span class="what">${question.question}</span
											><span class="end"
												>${pill(question.answer === null ? 'open' : 'answered')}</span
											></a
										>
									</li>`
							)}
						</ul>`
					: html`<p class="none">No question.</p>`
			}
		</section>
		<section class="panel" aria-labelledby="explorers-title">
			<h2 class="lab" id="explorers-title">Explorers</h2>
			<ul class="items">
				${report.explorers.map(
					(item) =>
						html`<li>
							<span class="id">${item.explorer}</span> ended ${item.ended ?? '-'} · recorded
							${item.recorded ?? '-'} · ${item.saved} entries
						</li>`
				)}
			</ul>
		</section>
		${downloads('Download report', `/explorations/${explorationId}/export`, 'The record of this exploration.', ['md', 'json'])}`
	return { title: `Exploration ${explorationId}`, section: 'plans', subjects: [`exploration:${explorationId}`], body }
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
