import type { Store } from '../store.ts'
import type { Entry, Gap, Issue } from '../journal.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { ListSpec } from './lists.ts'
import { readFileSync, statSync } from 'node:fs'
import { changeGaps, changeList, changeRecord, issueStatus } from '../journal.ts'
import { namedEvidence, pageOf, recordRuns } from '../views.ts'
import { html, join, pill, plural, time, words } from './html.ts'
import { heading } from './layout.ts'
import { distinct, filterBar, listPage, listRegion, listState } from './lists.ts'

export type ChangeForms = {
	answer?: { question: string; answer: string; error: string }
	decide?: { build: string; decision: string; rationale: string; error: string }
}

type Change = ReturnType<typeof changeList>[number]
type ChangeRecord = ReturnType<typeof changeRecord>
type Row = ChangeRecord['entries'][number]
type Evidence = NonNullable<Entry['evidence']>[number]
type OpenItems = { build: string; total: number; gaps: Gap[] }

const maxInlineText = 64 * 1024
const imageTypes: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
}

export function evidenceType(path: string) {
	return imageTypes[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'text/plain; charset=utf-8'
}

function none(text = 'none') {
	return html`<span class="muted">${text}</span>`
}

function tags(items: string[]) {
	return items.length
		? join(
				items.map((item) => html`<span class="tag">${item}</span>`),
				' '
			)
		: none()
}

function changesSpec(changes: Change[]): ListSpec {
	return {
		path: '/changes',
		region: 'changes',
		noun: 'change',
		nouns: 'changes',
		search: 'Search the changes',
		columns: [
			{ label: 'Change', sort: 'change' },
			{ label: 'Target', sort: 'target' },
			{ label: 'Builds', sort: 'builds', first: 'desc' },
			{ label: 'Open issues', sort: 'issues', first: 'desc' },
			{ label: 'Open questions', sort: 'questions', first: 'desc' },
			{ label: 'Decision on latest build', sort: 'decision' },
			{ label: 'Last activity', sort: 'activity', first: 'desc' },
		],
		sort: 'activity',
		direction: 'desc',
		filters: [
			{
				name: 'target',
				label: 'Target',
				choices: [['', 'All targets'], ...distinct(changes.map((change) => change.targetId))],
				strict: false,
			},
			{
				name: 'decision',
				label: 'Decision',
				choices: [
					['', 'All decisions'],
					['accepted', 'accepted'],
					['rejected', 'rejected'],
					['none', 'no decision'],
				],
				strict: true,
			},
		],
	}
}

function changeRow(change: Change) {
	return html`<tr data-key="change:${change.changeId}" data-nav-row>
		<td><a class="mono" href="/changes/${change.changeId}" data-nav-item>${change.changeId}</a></td>
		<td>
			<span class="mono">${change.targetId}</span>
			${change.instanceId ? html`<span class="muted small"> · ${change.instanceId}</span>` : ''}
		</td>
		<td>${tags(change.builds)}</td>
		<td>
			${change.openIssues ? pill('found', String(change.openIssues)) : none('0')}
			${change.latest ? html`<span class="muted small"> on ${change.latest}</span>` : ''}
		</td>
		<td>${change.openQuestions ? pill('open', String(change.openQuestions)) : none('0')}</td>
		<td>${change.decision === 'none' ? none('none') : pill(change.decision)}</td>
		<td class="nowrap">${change.lastAt ? time(change.lastAt) : none()}</td>
	</tr>`
}

export function changesPage(store: Store, params: URLSearchParams): Page {
	const changes = changeList(store)
	const spec = changesSpec(changes)
	const { page, state } = listPage(listState(params, spec), (query) =>
		pageOf(changes, query, {
			columns: {
				change: (change) => change.changeId,
				target: (change) => change.targetId,
				builds: (change) => change.builds.length,
				issues: (change) => change.openIssues,
				questions: (change) => change.openQuestions,
				decision: (change) => change.decision,
				activity: (change) => change.lastAt ?? '',
			},
			sort: spec.sort,
			direction: spec.direction,
			filters: { target: (change) => change.targetId, decision: (change) => change.decision },
			text: (change) => `${change.changeId} ${change.targetId} ${change.instanceId ?? ''}`,
		})
	)
	const body = changes.length
		? html`${filterBar(spec, state)} ${listRegion(spec, state, page.total, page.rows.map(changeRow))}`
		: html`<div class="empty" data-region="changes">
				<p class="empty-title">No change yet.</p>
				<p>Open one with <code>checkmate open &lt;changeId&gt; --target &lt;targetId&gt;</code>.</p>
			</div>`
	return {
		title: 'Changes',
		section: 'changes',
		subjects: ['*'],
		body: html`${heading('Changes', 'Each change with the state of its latest build.')} ${body}`,
	}
}

function issueOn(issue: Issue, builds: string[], build: string, suspected: boolean) {
	const index = builds.indexOf(build)
	const first = builds.indexOf(issue.build)
	if (index < first) return null
	if (index === first) return issue.refuted ? 'refuted' : suspected ? 'suspected' : 'found'
	const on = issue.statuses[build]
	if (!on || on.status === 'no verdict') return 'no_verdict'
	if (on.basis === 'disputed') return 'disputed'
	return on.status
}

function evidenceItem(store: Store, item: Evidence) {
	if ('text' in item) return html`<figure class="ev ev-text"><pre>${item.text}</pre></figure>`
	const href = `/evidence?path=${encodeURIComponent(item.path)}`
	const name = html`<a class="ev-name" href="${href}" target="_blank" rel="noopener">${item.path}</a>`
	const file = namedEvidence(store, item.path)
	if (!file)
		return html`<figure class="ev ev-text">
			<figcaption><span class="ev-name">${item.path}</span> ${none('not in the workspace now')}</figcaption>
		</figure>`
	if (evidenceType(item.path).startsWith('image/'))
		return html`<figure class="ev ev-image">
			<a href="${href}" target="_blank" rel="noopener"><img src="${href}" alt="Evidence ${item.path}" /></a>
			<figcaption>${name}</figcaption>
		</figure>`
	const text = statSync(file).size <= maxInlineText ? readFileSync(file, 'utf8') : null
	return html`<figure class="ev ev-text">
		<figcaption>${name}</figcaption>
		${text === null || text.includes('\u0000') ? '' : html`<pre>${text}</pre>`}
	</figure>`
}

function evidenceList(store: Store, items: Evidence[]) {
	if (!items.length) return none('no evidence')
	return html`<div class="evidence">${items.map((item) => evidenceItem(store, item))}</div>`
}

function stepList(steps: string | string[] | null | undefined) {
	const list = [steps ?? []].flat()
	if (!list.length) return none('no steps')
	return html`<ol class="steps">
		${list.map((step) => html`<li>${step}</li>`)}
	</ol>`
}

const idsIn = (entry: Row) => [...(entry.about ?? '').split(/[\s,;]+/), ...(entry.links ?? []), entry.question ?? '']

function anchors(ids: string[], prefix: string) {
	return ids.length
		? join(
				ids.map((id) => html`<a class="chip" href="#${prefix}-${id}">${id}</a>`),
				' '
			)
		: none()
}

function fact(label: string, value: Html | string) {
	return html`<div>
		<dt>${label}</dt>
		<dd>${value}</dd>
	</div>`
}

function issueHistory(store: Store, record: ChangeRecord, issue: Issue) {
	const names = [issue.id, ...issue.reports]
	const refs = new Map(record.entries.map((entry) => [entry.id, entry.ref]))
	const named = (id: string | undefined) => id !== undefined && names.includes(refs.get(id) ?? id)
	const said = record.entries.filter(
		(entry) =>
			(entry.kind === 'verdict' && named(entry.defect)) ||
			(entry.kind === 'observation' && (named(entry.confirms) || named(entry.refutes)))
	)
	if (!said.length) return none('no verdict and no verify observation yet')
	return html`<ol class="said">
		${said.map((entry) => {
			const what =
				entry.kind === 'verdict'
					? pill(entry.result!, words(entry.result!))
					: entry.confirms
						? pill('confirmed', 'confirms')
						: pill('refuted', 'refutes')
			return html`<li>
				<span class="tag">${entry.build}</span> ${what} <strong>${entry.actor}</strong>
				<span class="mono muted small">${entry.id}</span>
				${entry.saw ? html`<div>${entry.saw}</div>` : ''}
				${entry.evidence?.length ? html`<div>${evidenceList(store, entry.evidence)}</div>` : ''}
			</li>`
		})}
	</ol>`
}

function issueBody(store: Store, record: ChangeRecord, issue: Issue, reports: Row[]) {
	const linked = new Set(reports.flatMap(idsIn))
	const criteria = record.criteria.filter((criterion) => linked.has(criterion.id)).map((criterion) => criterion.id)
	const questions = record.questions.filter((question) => linked.has(question.id)).map((question) => question.id)
	const seen = reports.filter((report) => report.saw)
	const evidence = [
		...new Map(
			reports
				.flatMap((report) => report.evidence ?? [])
				.map((item) => ['path' in item ? item.path : item.text, item])
		).values(),
	]
	return html`<div class="issue-b">
		${issue.note ? html`<p class="lead">${issue.note}</p>` : ''}
		<div class="compare">
			<div><small>Expected</small>${issue.expected}</div>
			<div><small>Actual</small>${issue.actual}</div>
		</div>
		<dl class="facts">
			${fact('Steps', stepList(issue.steps))}
			${
				seen.length
					? fact(
							'Seen',
							join(
								seen.map((report) => html`<div>${report.saw}</div>`),
								''
							)
						)
					: ''
			}
			${fact(
				'Reports',
				join(
					reports.map(
						(report) =>
							html`<span class="tag">${report.id}</span> ${report.actor} on ${report.build},
								${report.severity}${report.suspected ? ', suspected' : ''}`
					),
					html`<br />`
				)
			)}
			${fact('Criteria', anchors(criteria, 'criterion'))} ${fact('Questions', anchors(questions, 'question'))}
			${fact('Evidence', evidenceList(store, evidence))} ${fact('Verdicts', issueHistory(store, record, issue))}
		</dl>
	</div>`
}

function issueRow(store: Store, record: ChangeRecord, issue: Issue) {
	const reports = record.entries.filter((entry) => entry.kind === 'defect' && issue.reports.includes(entry.ref))
	const suspected = reports.length > 0 && reports.every((report) => report.suspected)
	const statuses = record.builds.flatMap((build) => {
		const status = issueOn(issue, record.builds, build, suspected)
		return status ? [html`<span class="on"><span class="tag">${build}</span> ${pill(status)}</span>`] : []
	})
	const status = issueStatus(issue)
	const verified = html`${status === 'unconfirmed' ? none(status) : pill(status)}
	${issue.verified === 'none' ? '' : html`<span class="muted small">by verifier</span>`}`
	return html`<li class="issue" id="issue-${issue.id}" data-key="issue:${issue.id}">
		<details data-open-key="issue:${issue.id}">
			<summary class="issue-row">
				<span class="mono">${issue.id}</span>
				<span class="issue-title">${issue.title}</span>
				<span>${pill(issue.severity)}</span>
				<span class="small">${issue.actors.join(', ')}</span>
				<span class="ons">${statuses}</span>
				<span>${verified}</span>
			</summary>
			${issueBody(store, record, issue, reports)}
		</details>
	</li>`
}

function issuesSection(store: Store, record: ChangeRecord) {
	const merged = record.entries.some((entry) => entry.kind === 'issue')
	return html`<section aria-labelledby="issues" data-region="issues">
		<h2 id="issues">Issues <span class="n">${record.issues.length}</span></h2>
		<p class="help">
			${
				merged
					? 'The issues of the merge. A defect that is in no issue is its own issue.'
					: 'No merge yet. Each defect is its own issue.'
			}
		</p>
		${
			record.issues.length
				? html`<div class="issues">
						<div class="issue-row issue-head" aria-hidden="true">
							<span>ID</span><span>Title</span><span>Severity</span><span>Reporters</span
							><span>Status on each build</span><span>Confirmed</span>
						</div>
						<ul class="issue-list">
							${record.issues.map((issue) => issueRow(store, record, issue))}
						</ul>
					</div>`
				: html`<p class="empty-line">No defect yet.</p>`
		}
	</section>`
}

function cell(counts: { ok: number; wrong: number; seen: number } | undefined) {
	if (!counts || counts.ok + counts.wrong + counts.seen === 0) return none('no observation')
	return join(
		[
			counts.wrong ? pill('failed', `${counts.wrong} wrong`) : null,
			counts.ok ? pill('passed', `${counts.ok} ok`) : null,
			counts.seen ? pill('muted', `${counts.seen} seen`) : null,
		].filter((item) => item !== null),
		' '
	)
}

function criteriaSection(record: ChangeRecord) {
	const criteria = new Map(record.criteria.map((criterion) => [criterion.id, criterion]))
	return html`<section aria-labelledby="criteria" data-region="criteria">
		<h2 id="criteria">Criteria <span class="n">${record.criteria.length}</span></h2>
		${
			record.matrix.length
				? html`<div class="scroll">
						<table class="matrix">
							<thead>
								<tr>
									<th scope="col">Criterion</th>
									<th scope="col">Source</th>
									${record.builds.map((build) => html`<th scope="col">${build}</th>`)}
								</tr>
							</thead>
							<tbody>
								${record.matrix.map((row) => {
									const criterion = criteria.get(row.about)
									return html`<tr id="criterion-${row.about}" data-key="criterion:${row.about}">
										<th scope="row">
											<span class="mono">${row.about === '-' ? 'no subject' : row.about}</span>
											<div class="matrix-text">
												${criterion ? criterion.text : none('not a criterion')}
											</div>
										</th>
										<td class="source">${criterion?.source ?? none('no source')}</td>
										${record.builds.map((build) => html`<td>${cell(row.cells[build])}</td>`)}
									</tr>`
								})}
							</tbody>
						</table>
					</div>`
				: html`<p class="empty-line">No criterion and no observation yet.</p>`
		}
	</section>`
}

function actorField(context: Context, id: string) {
	if (context.actor) return ''
	return html`<div class="field-group">
		<label class="lab" for="${id}">Your name</label>
		<input id="${id}" name="actor" required autocomplete="name" />
	</div>`
}

function answerForm(context: Context, changeId: string, questionId: string, forms: ChangeForms) {
	const failed = forms.answer?.question === questionId ? forms.answer : null
	const field = `answer-${questionId.replace(/[^A-Za-z0-9_-]/g, '-')}`
	return html`<form method="post" action="/changes/${changeId}/answer" class="answer-form">
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="question" value="${questionId}" />
		${failed ? html`<p class="form-error" role="alert">${failed.error}</p>` : ''}
		<label class="lab" for="${field}">Answer as PM</label>
		<textarea id="${field}" name="answer" required rows="2">${failed?.answer ?? ''}</textarea>
		${actorField(context, `${field}-actor`)}
		<div class="btns"><button class="btn primary">Save answer</button></div>
	</form>`
}

function questionsSection(context: Context, record: ChangeRecord, forms: ChangeForms) {
	const byId = new Map(record.entries.map((entry) => [entry.id, entry]))
	const answers = record.entries.filter((entry) => entry.kind === 'answer')
	const open = record.questions.filter((question) => question.status === 'open')
	const elsewhere =
		forms.answer && !open.some((question) => question.id === forms.answer?.question) ? forms.answer.error : null
	return html`<section aria-labelledby="questions" data-region="questions">
		<h2 id="questions">Questions <span class="n">${open.length} open of ${record.questions.length}</span></h2>
		${elsewhere ? html`<p class="form-error" role="alert">${elsewhere}</p>` : ''}
		${
			record.questions.length
				? html`<ul class="records">
						${record.questions.map((question) => {
							const asked = byId.get(question.id)
							const answer = answers.filter((entry) => entry.question === question.id).at(-1)
							return html`<li id="question-${question.id}" data-key="question:${question.id}">
								<div class="record-h">
									<span class="mono">${question.id}</span> ${pill(question.status)}
									<span class="muted small">asked by ${asked?.actor ?? 'unknown'}</span>
									${asked?.about ? html`<span class="muted small">about ${asked.about}</span>` : ''}
								</div>
								<p class="gap-q">${question.question}</p>
								${
									answer
										? html`<p class="answer">
												<strong>Answer by ${answer.actor}:</strong> ${answer.answer}
											</p>`
										: answerForm(context, record.changeId, question.id, forms)
								}
							</li>`
						})}
					</ul>`
				: html`<p class="empty-line">No question yet.</p>`
		}
	</section>`
}

function gapsSection(gaps: OpenItems | null) {
	return html`<section aria-labelledby="open-items" data-region="open-items">
		<h2 id="open-items">
			Open items ${gaps ? html`<span class="n">${plural(gaps.total, 'item')} on ${gaps.build}</span>` : ''}
		</h2>
		${
			!gaps
				? html`<p class="empty-line">No build yet.</p>`
				: gaps.gaps.length
					? html`<ul class="gaps">
							${gaps.gaps.map(
								(gap) =>
									html`<li class="gap" data-key="gap:${gap.kind}:${gap.subject}">
										<div class="gap-h">
											<span class="tag">${words(gap.kind)}</span> ${gap.subject}
										</div>
										<p class="gap-d muted">${gap.idea}</p>
									</li>`
							)}
						</ul>`
					: html`<p class="empty-line">No open item on ${gaps.build}.</p>`
		}
	</section>`
}

function summaryOf(entry: Row) {
	switch (entry.kind) {
		case 'criterion':
		case 'note':
			return entry.text ?? ''
		case 'observation':
			return `${entry.saw ?? ''}${entry.value !== undefined ? ` (value ${entry.value})` : ''}`
		case 'defect':
		case 'issue':
			return entry.title ?? ''
		case 'question':
			return entry.question ?? ''
		case 'verdict':
			return `${entry.defect} ${words(entry.result ?? '')}`
		case 'answer':
			return `${entry.question}: ${entry.answer}`
		case 'decision':
			return `${entry.decision}: ${entry.rationale}`
	}
}

function journalSpec(record: ChangeRecord): ListSpec {
	return {
		path: `/changes/${record.changeId}`,
		region: 'journal',
		noun: 'entry',
		nouns: 'entries',
		search: 'Search the journal',
		columns: [
			{ label: 'Time', sort: 'time' },
			{ label: 'Actor', sort: 'actor' },
			{ label: 'Kind', sort: 'kind' },
			{ label: 'Build', sort: 'build' },
			{ label: 'ID' },
			{ label: 'Entry' },
		],
		sort: 'time',
		direction: 'asc',
		filters: [
			{
				name: 'kind',
				label: 'Kind',
				choices: [['', 'All kinds'], ...distinct(record.entries.map((entry) => entry.kind))],
				strict: false,
			},
			{
				name: 'actor',
				label: 'Actor',
				choices: [['', 'All actors'], ...distinct(record.entries.map((entry) => entry.actor))],
				strict: false,
			},
			{
				name: 'build',
				label: 'Build',
				choices: [['', 'All builds'], ...record.builds.map((build) => [build, build])],
				strict: false,
			},
		],
	}
}

function journalSection(record: ChangeRecord, params: URLSearchParams) {
	const spec = journalSpec(record)
	const { page, state } = listPage(listState(params, spec), (query) =>
		pageOf(record.entries, query, {
			columns: {
				time: (entry) => entry.seq,
				actor: (entry) => entry.actor,
				kind: (entry) => entry.kind,
				build: (entry) => entry.build ?? '',
			},
			sort: spec.sort,
			direction: spec.direction,
			filters: {
				kind: (entry) => entry.kind,
				actor: (entry) => entry.actor,
				build: (entry) => entry.build ?? '',
			},
			text: (entry) => `${entry.id} ${entry.actor} ${entry.kind} ${entry.build ?? ''} ${summaryOf(entry)}`,
		})
	)
	const rows = page.rows.map(
		(entry) =>
			html`<tr data-key="entry:${entry.id}">
				<td class="nowrap">${entry.at ? time(entry.at) : none()}</td>
				<td>${entry.actor}</td>
				<td><span class="tag">${entry.kind}</span></td>
				<td>${entry.build ?? none('–')}</td>
				<td class="mono">${entry.id}</td>
				<td>${summaryOf(entry)}</td>
			</tr>`
	)
	return html`<section aria-labelledby="journal">
		<h2 id="journal">Journal <span class="n">${plural(record.entries.length, 'entry', 'entries')}</span></h2>
		${filterBar(spec, state)} ${listRegion(spec, state, page.total, rows, 'log')}
	</section>`
}

function recordersSection(store: Store, changeId: string) {
	const runs = recordRuns(store, changeId)
	return html`<section aria-labelledby="recorders" data-region="recorders">
		<h2 id="recorders">Recorders <span class="n">${runs.length}</span></h2>
		${
			runs.length
				? html`<div class="scroll">
						<table class="log">
							<thead>
								<tr>
									<th scope="col">Time</th>
									<th scope="col">Actor</th>
									<th scope="col">Build</th>
									<th scope="col">Status</th>
									<th scope="col">Saved</th>
									<th scope="col">Refused</th>
									<th scope="col">Session</th>
								</tr>
							</thead>
							<tbody>
								${runs.map(
									(run) =>
										html`<tr data-key="record:${run.id}">
											<td class="nowrap">${time(run.at)}</td>
											<td>${run.actor}</td>
											<td>${run.build ?? none('–')}</td>
											<td>
												${pill(run.status === 'rejected' ? 'rejected_operation' : run.status, words(run.status))}
												${
													run.status === 'completed'
														? ''
														: html`<div class="reason">${run.reasons.join(' ')}</div>`
												}
											</td>
											<td>${run.saved ?? none('–')}</td>
											<td>${run.refused ?? none('–')}</td>
											<td class="mono muted small">${run.session ?? '–'}</td>
										</tr>`
								)}
							</tbody>
						</table>
					</div>`
				: html`<p class="empty-line">No recorder ran for this change.</p>`
		}
	</section>`
}

function decideForm(context: Context, record: ChangeRecord, forms: ChangeForms) {
	const failed = forms.decide ?? null
	const build = failed?.build || record.builds.at(-1)
	const decision = failed?.decision ?? ''
	return html`<section class="panel decision" aria-labelledby="decide" data-region="decide-form">
		<h2 class="lab" id="decide">Decide on a build</h2>
		<p class="help">
			As the oracle, accept or reject a build. Checkmate records the open items of the build with it.
		</p>
		${failed ? html`<p class="form-error" role="alert">${failed.error}</p>` : ''}
		${
			record.builds.length
				? html`<form method="post" action="/changes/${record.changeId}/decide" class="decision-form">
						<input type="hidden" name="csrf" value="${context.csrf}" />
						<div class="field-group">
							<label class="lab" for="decide-build">Build</label>
							<select id="decide-build" name="build">
								${record.builds.map(
									(item) =>
										html`<option value="${item}" ${item === build ? html`selected` : ''}>
											${item}
										</option>`
								)}
							</select>
						</div>
						<fieldset class="seg-field">
							<legend class="lab">Decision</legend>
							<div class="seg">
								<input
									type="radio"
									id="decide-accepted"
									name="decision"
									value="accepted"
									required
									${decision === 'accepted' ? html`checked` : ''}
								/>
								<label for="decide-accepted">Accept</label>
								<input
									type="radio"
									id="decide-rejected"
									name="decision"
									value="rejected"
									${decision === 'rejected' ? html`checked` : ''}
								/>
								<label for="decide-rejected">Reject</label>
							</div>
						</fieldset>
						<div class="field-group">
							<label class="lab" for="decide-rationale">Rationale</label>
							<textarea id="decide-rationale" name="rationale" required rows="3">
${failed?.rationale ?? ''}</textarea>
						</div>
						${actorField(context, 'decide-actor')}
						<div class="btns"><button class="btn primary">Save decision</button></div>
					</form>`
				: html`<p class="empty-line">No build yet.</p>`
		}
	</section>`
}

function headSection(record: ChangeRecord, gaps: { total: number } | null) {
	const decisions = record.entries.filter((entry) => entry.kind === 'decision')
	const openQuestions = record.questions.filter((question) => question.status === 'open').length
	const testers = new Set(
		record.entries
			.filter((entry) => entry.kind === 'defect' || entry.kind === 'observation')
			.map((entry) => entry.actor)
	)
	return html`<div data-region="change-head">
		<div class="strip">
			<div><small>Issues</small><strong>${record.issues.length}</strong></div>
			<div><small>Criteria</small><strong>${record.criteria.length}</strong></div>
			<div><small>Open questions</small><strong>${openQuestions} of ${record.questions.length}</strong></div>
			<div><small>Open items on ${record.builds.at(-1) ?? '–'}</small><strong>${gaps?.total ?? 0}</strong></div>
			<div><small>Entries</small><strong>${record.entries.length}</strong></div>
			<div><small>Actors who observed</small><strong>${testers.size}</strong></div>
		</div>
		<section aria-labelledby="decisions">
			<h2 id="decisions">Decisions</h2>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Build</th>
							<th scope="col">Decision</th>
							<th scope="col">By</th>
							<th scope="col">Rationale</th>
							<th scope="col">Open items then</th>
						</tr>
					</thead>
					<tbody>
						${record.builds.map((build) => {
							const decision = decisions.filter((entry) => entry.build === build).at(-1)
							return html`<tr data-key="decision:${build}">
								<td class="mono">${build}</td>
								<td>${decision ? pill(decision.decision!) : none()}</td>
								<td>${decision ? html`${decision.actor} · ${time(decision.at)}` : none('–')}</td>
								<td>${decision?.rationale ?? none('–')}</td>
								<td>${decision ? decision.gaps : none('–')}</td>
							</tr>`
						})}
					</tbody>
				</table>
			</div>
		</section>
	</div>`
}

export function changePage(
	store: Store,
	context: Context,
	changeId: string,
	params: URLSearchParams,
	forms: ChangeForms = {}
): Page {
	const record = changeRecord(store, changeId)
	const gaps = record.builds.length ? (changeGaps(store, changeId).data as OpenItems) : null
	const sub = html`Target
		<a class="mono" href="/settings/targets/${record.targetId}">${record.targetId}</a>
		${record.instanceId ? html`· instance <code>${record.instanceId}</code>` : ''} · builds ${tags(record.builds)}`
	const jump = html`<nav class="jump" aria-label="Sections">
		${[
			['issues', 'Issues'],
			['criteria', 'Criteria'],
			['questions', 'Questions'],
			['open-items', 'Open items'],
			['journal', 'Journal'],
			['recorders', 'Recorders'],
		].map(([id, label]) => html`<a href="#${id}">${label}</a>`)}
	</nav>`
	return {
		title: changeId,
		section: 'changes',
		subjects: [`change:${changeId}`],
		status: forms.answer || forms.decide ? 422 : undefined,
		body: html`${heading(html`Change <span class="mono">${changeId}</span>`, sub)} ${jump}
			<div class="split">
				<div class="main-col">
					${headSection(record, gaps)} ${issuesSection(store, record)} ${criteriaSection(record)}
					${questionsSection(context, record, forms)} ${gapsSection(gaps)} ${journalSection(record, params)}
					${recordersSection(store, changeId)}
				</div>
				<aside class="side" aria-label="Decide">
					${decideForm(context, record, forms)}
					<p class="back"><a href="/changes">← All changes</a></p>
				</aside>
			</div>`,
	}
}

export function evidenceBody(store: Store, path: string) {
	const file = namedEvidence(store, path)
	return file ? { type: evidenceType(path), body: readFileSync(file) } : null
}
