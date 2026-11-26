import type { Store } from '../../store.ts'
import type { Claim } from '../../journal.ts'
import { explorationReport } from '../../explorers.ts'
import type { Permission } from '../../permissions.ts'
import { explorationEvents } from '../../explorations.ts'
import { explorationPermissions, permissionRules } from '../../permissions.ts'
import { defaultBuild } from '../../modes.ts'
import { claimEvidence, entryEvidence, explorationLive, planExplorations } from '../../views.ts'
import type { InstanceChoice } from '../actions.ts'
import type { Run } from '../activity.ts'
import type { EvidenceFile } from '../evidence.ts'
import type { FormState } from '../forms.ts'
import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import {
	instanceChoice,
	stopButton,
	stopDialog,
	stopOption,
	stopTesterDialog,
	testAgainOption,
	testButton,
	testDialog,
	testerStopOption,
} from '../actions.ts'
import { failureOf, phases, runsOf } from '../activity.ts'
import { formButton } from '../components/button.ts'
import { dataTable, tableRow } from '../components/data-table.ts'
import { emptyLine } from '../components/empty-state.ts'
import { evidenceList, viewLink } from '../components/evidence-viewer.ts'
import { optionsBox } from '../components/list-row.ts'
import { testerCard, timeline } from '../components/tester-card.ts'
import { downloadMenu } from '../components/menu.ts'
import { notice } from '../components/notice.ts'
import { crumbBar, heading } from '../components/page-heading.ts'
import { statusMark, statusWord, wordMark } from '../components/status-mark.ts'
import { shownAsText } from '../evidence.ts'
import { actorField, emptyState, gapPanel, hidden, keptText, messages, rationaleField, recordPanel } from '../forms.ts'
import { ago, asList, costText, duration, html, join, plural, time, words } from '../html.ts'
import {
	askingPill,
	asksFor,
	permissionHistory,
	requestHref,
	rowOptions,
	rulesLines,
	waitsFor,
} from '../permissions.ts'
import { navigator, reviewOf } from '../review.ts'

type Live = ReturnType<typeof explorationLive>
type Question = Live['questions'][number]
type Listed = ReturnType<typeof planExplorations>[number]

function claimRow(planId: string, claim: Claim) {
	const key = encodeURIComponent(`c:${claim.id}`)
	return tableRow({
		cells: [
			html`<a class="sc-mono" href="/plans/${planId}?view=all&amp;item=${key}">${claim.id}</a>`,
			statusMark({ state: claim.state }),
			statusMark({ state: claim.severity }),
			claim.actors.join(', '),
			{
				content: html`${claim.title}${claim.reason ? html`<p class="sc-help">${claim.reason}</p>` : ''}`,
				attrs: { class: 'is-title' },
			},
		],
		attrs: { id: claim.id, 'data-key': `claim:${claim.id}` },
	})
}

export function claimsTable(planId: string, claims: Claim[]) {
	if (!claims.length)
		return html`<p class="sc-empty is-line">No claim. Claims show here when an explorer reports a defect.</p>`
	return dataTable({
		columns: ['Claim', 'State', 'Severity', 'Reporters', 'Title'],
		rows: claims.map((claim) => claimRow(planId, claim)),
		scroll: true,
	})
}

function claimLinks(planId: string, claims: Claim[]) {
	if (!claims.length)
		return html`<p class="sc-empty is-line">No claim. Claims show here when an explorer reports a defect.</p>`
	return html`<ul class="sc-links">
		${claims.map(
			(claim) =>
				html`<li data-key="claim:${claim.id}">
					<a
						class="sc-link-row"
						href="/plans/${planId}?view=all&amp;item=${encodeURIComponent(`c:${claim.id}`)}"
						><span class="sc-c-id">${claim.id}</span
						><span class="sc-c-title"
							>${claim.title}${claim.reason ? html`<span class="sc-help"> ${claim.reason}</span>` : ''}</span
						><span class="sc-link-end"
							>${statusMark({ state: claim.severity })} ${statusMark({ state: claim.state })}</span
						></a
					>
				</li>`
		)}
	</ul>`
}

export function questionsList(planId: string, questions: Question[]) {
	if (!questions.length)
		return html`<p class="sc-empty is-line">No question. Questions show here when an explorer asks one.</p>`
	return html`<ul class="sc-links">
		${questions.map(
			(question) =>
				html`<li data-key="question:${question.id}">
					<a
						class="sc-link-row"
						href="/plans/${planId}?view=all&amp;item=${encodeURIComponent(`q:${question.id}`)}"
						><span class="sc-c-id">${question.id}</span><span class="sc-c-title">${question.question}</span
						><span class="sc-link-end"
							>${question.blocking ? html`${statusMark({ state: 'blocking' })} ` : ''}${statusMark({ state: question.answer === null ? 'open' : 'answered' })}</span
						></a
					>
				</li>`
		)}
	</ul>`
}

export function claimEvidenceFiles(store: Store, planId: string, claim: Claim): EvidenceFile[] {
	return claim.evidence.map((item, index) => {
		if ('text' in item)
			return { name: 'What the tester saw', mediaType: 'text/plain', size: 0, href: null, text: () => item.text }
		const href = `/explorations/${claim.explorationId}/claims/${claim.id}/evidence/${index}`
		const file = claimEvidence(store, planId, claim.id, index)
		return { ...file, href, text: () => new TextDecoder().decode(file.bytes) }
	})
}

export function claimEvidenceList(store: Store, planId: string, claim: Claim) {
	return evidenceList(claimEvidenceFiles(store, planId, claim), 'The tester gave no evidence.')
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

function endedLine(item: Listed) {
	if (item.state === 'stopped')
		return html`<strong>Exploration ${item.explorationId} was stopped.</strong> ${item.reason ?? ''}`
	if (item.state === 'interrupted')
		return html`<strong
			>The run ${item.explorationId} was interrupted: the supervisor stopped before the end.</strong
		>`
	const failure = failureOf(item.reason, item.hint, [])
	return html`<strong>${failure.cause}</strong> ${failure.next}`
}

export function explorationBanners(explorations: Listed[]) {
	const running = explorations.filter((item) => item.running)
	const last = explorations.at(-1)
	return html`${running.map((item) =>
		notice({
			kind: item.paused ? 'warn' : 'info',
			content: html`<span data-key="running:${item.explorationId}"
				>${item.paused ? html`<strong>Exploration ${item.explorationId} is paused: ${item.paused}</strong> It waits on the oracle in the Claude Code session.` : html`Exploration ${item.explorationId} is running.`}
				<a href="/explorations/${item.explorationId}">Open the live view</a>. Its claims and questions show here
				when it is completed.</span
			>`,
		})
	)}
	${
		last && (last.state === 'failed' || last.state === 'stopped' || last.state === 'interrupted')
			? notice({
					kind: 'fail',
					content: html`<span data-key="failed:${last.explorationId}"
						>${endedLine(last)} ${dataLine('', last.data)}
						<a href="/explorations/${last.explorationId}">Open ${last.explorationId}</a></span
					>`,
				})
			: ''
	}`
}

export function explorationsTable(explorations: Listed[]) {
	if (!explorations.length)
		return html`<p class="sc-empty is-line">No exploration yet. Start one with <code>checkmate test</code>.</p>`
	return dataTable({
		columns: ['Exploration', 'State', 'Build', 'Instance', 'Level', 'Started', 'Cost'],
		rows: [...explorations].reverse().map((item) =>
			tableRow({
				cells: [
					html`<a class="sc-mono" href="/explorations/${item.explorationId}">${item.explorationId}</a>`,
					html`${statusMark({ state: item.state })}
					${item.reason !== null ? html`<p class="sc-help">${dataLine(item.reason, item.data)}</p>` : ''}
					${
						item.follow === 'failed' || item.follow === 'stopped' || item.follow === 'interrupted'
							? html`<p class="sc-help">
									Follow-up ${item.follow}: ${dataLine(item.followReason, item.data)}
								</p>`
							: ''
					}`,
					{ content: item.build, attrs: { class: 'is-mono' } },
					{ content: item.instanceId, attrs: { class: 'is-mono' } },
					html`${item.level ?? html`<span class="sc-muted">none</span>`}${
						item.explorers === null
							? ''
							: html` <span class="sc-muted">· ${plural(item.explorers, 'explorer')}</span>`
					}`,
					{ content: time(item.startedAt), attrs: { class: 'is-muted' } },
					{
						content: costText(item.costUsd, item.costPartial),
						attrs: { class: 'is-num', title: 'Reported exploration cost' },
					},
				],
				attrs: { 'data-key': `exploration:${item.explorationId}` },
			})
		),
		scroll: true,
	})
}

type LiveExplorer = Live['explorers'][number]
type Found = Live['found'][number]

const none = html`<span class="sc-muted">–</span>`

function explorerState(item: LiveExplorer) {
	return item.state ? statusMark({ state: item.state }) : statusMark({ state: 'pending', label: 'not started' })
}

function inState(item: LiveExplorer) {
	if (item.elapsedMs === null) return ''
	if (item.pausedAt)
		return html`<span class="age"
			>paused for
			<span data-since="${item.pausedAt}">${duration(Date.now() - Date.parse(item.pausedAt))}</span></span
		>`
	const live = item.startedAt && (item.state === 'running' || item.state === 'given')
	return live
		? html`<span class="age" data-since="${item.startedAt}">${duration(item.elapsedMs)}</span>`
		: html`<span class="age">${duration(item.elapsedMs)}</span>`
}

function explorationHref(explorationId: string, key: string | null) {
	return key && key !== 'summary'
		? `/explorations/${explorationId}?item=${encodeURIComponent(key)}`
		: `/explorations/${explorationId}`
}

function stoppedLine(store: Store, live: Live) {
	const stop = explorationEvents(store, live.explorationId).findLast(
		(item) => item.step === 'stop' && item.explorer === null
	)
	const reason = typeof stop?.detail.reason === 'string' ? stop.detail.reason : ''
	return html`<strong>Stopped by ${String(stop?.detail.actor ?? 'someone')}</strong
		>${reason ? html`: ${reason}` : ''}`
}

function workNote(live: Live) {
	const folder = live.data.find((path) => path.startsWith('.checkmate/work/'))
	return folder ? html` Reports that were not recorded stay in the work folder <code>${folder}</code>.` : html``
}

function failedLine(run: Run, live: Live) {
	if (!run.failure) return html`<strong>${run.outcome}</strong>`
	return html`<strong>${run.failure.cause}</strong> ${run.failure.next}
		${run.failure.detail ? html`<span class="sc-help">${run.failure.detail}</span>` : ''} ${dataLine('', live.data)}`
}

function strayLines(live: Live) {
	return live.explorers
		.filter((item) => item.stray.length)
		.map(
			(item) =>
				html`<p class="sc-help" data-key="stray-${item.explorer}">
					Workspace entries appeared outside the work folder during tester ${item.explorer}’s turns:
					<code>${item.stray.join(', ')}</code>. Checkmate did not touch them.
				</p>`
		)
}

function stateLine(store: Store, live: Live, run: Run) {
	if (live.stuck.length)
		return notice({
			kind: 'fail',
			content: html`<span data-key="stop-stuck"
				><strong
					>Stopped, but ${live.stuck.length === 1 ? 'process' : 'processes'} ${live.stuck.join(', ')}
					${live.stuck.length === 1 ? 'is' : 'are'} still alive.</strong
				>
				End ${live.stuck.length === 1 ? 'it' : 'them'} by hand.</span
			>`,
		})
	if (live.stopping)
		return notice({
			kind: 'info',
			content: html`<span data-key="stopping"
				><strong>Stopping ${live.explorationId}…</strong> The testers end now. This page shows the result when
				they have ended.</span
			>`,
		})
	if (live.running && live.paused)
		return notice({
			kind: 'warn',
			content: html`<span data-key="paused"
				><strong>Paused: ${live.paused}</strong> It waits for you in the Claude Code session.</span
			>`,
		})
	if (live.running)
		return notice({
			kind: 'info',
			content: html`Exploration ${live.explorationId} is running. Phase: ${run.phase ?? live.phase}. This page
			updates by itself.`,
		})
	if (live.state === 'failed')
		return notice({ kind: 'fail', content: html`<span data-key="run-ended">${failedLine(run, live)}</span>` })
	if (live.state === 'stopped')
		return notice({
			kind: 'fail',
			content: html`<span data-key="run-ended">${stoppedLine(store, live)}.${workNote(live)}</span>`,
		})
	if (live.state === 'interrupted')
		return notice({
			kind: 'fail',
			content: html`<span data-key="run-ended"
				><strong>The run was interrupted: the supervisor stopped before the end.</strong>${workNote(live)}
				${dataLine(
					null,
					live.data.filter((path) => !path.startsWith('.checkmate/work/'))
				)}</span
			>`,
		})
	if (live.follow === 'failed' || live.follow === 'stopped' || live.follow === 'interrupted')
		return notice({
			kind: 'fail',
			content: html`<span data-key="follow-failed"
				><strong
					>The follow-up of ${live.explorationId}
					${live.follow === 'interrupted' ? 'was interrupted' : live.follow}.</strong
				>
				${dataLine(live.followReason, live.data)} The claims and questions of the exploration stay valid.</span
			>`,
		})
	if (live.state === 'open')
		return notice({
			kind: 'info',
			content: html`Exploration ${live.explorationId} is open. Record its sessions, then run
				<code>checkmate explore finish ${live.explorationId}</code>.`,
		})
	return ''
}

function rawCount(live: Live, explorer: string) {
	return live.unmerged.filter((entry) => entry.explorer === explorer).length
}

function testerState(live: Live, item: LiveExplorer) {
	if (live.running && live.paused && (item.state === 'running' || item.state === 'given'))
		return wordMark({ state: 'paused', label: 'Paused' })
	if (!item.state) return wordMark({ state: 'not_started', label: 'Not started' })
	const look: Record<string, string> = {
		given: 'given',
		running: 'running',
		ended: 'finished',
		completed: 'finished',
		failed: 'failed',
		operational_error: 'failed',
	}
	const label: Record<string, string> = {
		given: 'Given to the session',
		running: 'Running',
		ended: 'Finished',
		completed: 'Finished',
		failed: 'Failed',
		operational_error: 'Failed',
		interrupted: 'Interrupted',
		stopping: 'Stopping…',
		stopped: 'Stopped',
	}
	return wordMark({
		state: look[item.state] ?? 'not_running',
		label: label[item.state] ?? item.state,
	})
}

function testerLine(item: LiveExplorer) {
	if (['failed', 'operational_error'].includes(item.state ?? '') && typeof item.reason === 'string')
		return item.reason
	const busy = item.state === 'running' || item.state === 'given'
	if (item.activity && item.activityAt)
		return html`${item.activity} · <span class="age">${ago(item.activityAt)}</span>`
	if (item.activity) return item.activity
	if (!busy) return 'No activity line in the record.'
	if (item.turn === 'study') return 'In its study turn. The first activity line comes when the turn ends.'
	return `In its ${item.turn ?? 'test'} turn. No activity line yet.`
}

function stepAsks(open: Permission[]) {
	return open
		.filter((item) => !item.tester)
		.map(
			(item) =>
				html`<p class="sc-help sc-asks" data-key="step-asks-${item.id}">
					<a href="${requestHref(item, null)}">Step ${item.who} asks to ${asksFor(item)}</a>
				</p>`
		)
}

function historyFrom(explorationId: string, params: URLSearchParams) {
	const page = params.get('requests')
	return page
		? `/explorations/${explorationId}?requests=${encodeURIComponent(page)}`
		: `/explorations/${explorationId}`
}

function stoppableTester(live: Live, item: LiveExplorer) {
	return live.running && live.state !== 'following' && live.path !== 'session' && item.state === 'running'
}

function testerStats(live: Live, item: LiveExplorer) {
	const raw = rawCount(live, item.explorer)
	return [
		inState(item) || '—',
		`cost ${costText(item.costUsd, item.costPartial)}${raw ? ` · ${raw} not merged` : ''}`,
	]
}

function explorationList(context: Context, live: Live, others: Listed[], asking: Map<string, Permission>) {
	const here = `/explorations/${live.explorationId}`
	const explorers = live.explorers.map((item, index) => {
		const asked = asking.get(item.explorer)
		const from = `${here}?at=${encodeURIComponent(`explorer:${item.explorer}`)}`
		return testerCard({
			id: `tester-${index}`,
			key: `explorer:${item.explorer}`,
			href: asked ? requestHref(asked, from) : explorationHref(live.explorationId, `explorer:${item.explorer}`),
			label: item.explorer,
			mark: asked ? askingPill() : testerState(live, item),
			phase: item.turn ?? '',
			line: asked ? html`Asks to ${asksFor(asked)} · ${waitsFor(asked)}` : testerLine(item),
			stats: testerStats(live, item),
			options: asked
				? rowOptions(context, asked, from)
				: stoppableTester(live, item)
					? optionsBox([testerStopOption(live.explorationId, item.explorer, 1)])
					: '',
			done: ['ended', 'completed'].includes(item.state ?? ''),
			attrs: { 'data-ask': asked ? `${asked.askerId}/${asked.id}` : null },
		})
	})
	const phases = timeline({
		label: 'After the testers',
		events: live.phases.map((row, index) => ({
			id: `phase-${index}`,
			key: `phase:${row.phase}`,
			href: explorationHref(live.explorationId, `phase:${row.phase}`),
			label: row.phase,
			mark: statusMark({ state: row.state, label: '' }),
			text: row.reason ?? phaseNote(row.state),
			meta: words(row.state),
		})),
	})
	const sessions = dataTable({
		columns: ['Session', 'State', 'Build and instance', 'Started'],
		rows: others.map((item) =>
			tableRow({
				attrs: {
					'data-row': true,
					'data-key': `exploration:${item.explorationId}`,
					'data-href': `/explorations/${item.explorationId}`,
					'data-label': item.explorationId,
				},
				cells: [
					{
						content: html`<a href="/explorations/${item.explorationId}">${item.explorationId}</a>`,
						attrs: { class: 'is-mono' },
					},
					statusMark({ state: item.running && item.paused ? 'paused' : item.state }),
					{
						content: html`Build <code>${item.build}</code> on
							<code>${item.instanceId}</code>${item.reason ? `: ${item.reason}` : ''}`,
						attrs: { class: 'is-title' },
					},
					{ content: time(item.startedAt), attrs: { class: 'is-muted' } },
				],
			})
		),
		scroll: true,
	})
	return html`<section class="sc-sec" aria-labelledby="testers-h">
			<h2 class="sc-sec-h" id="testers-h">
				${live.running ? 'Testers now' : 'Testers'}<b>${explorers.length}</b>
			</h2>
			<div class="sc-list" role="listbox" aria-label="Testers of ${live.explorationId}" data-list>
				${explorers.length ? explorers : emptyLine({ text: 'No tester has started yet.' })}
			</div>
		</section>
		<section class="sc-sec" aria-labelledby="after-h">
			<h2 class="sc-sec-h" id="after-h">After the testers<b>${live.phases.length}</b></h2>
			${phases}
		</section>
		${
			others.length
				? html`<section class="sc-sec" aria-labelledby="others-h">
						<h2 class="sc-sec-h" id="others-h">Other sessions of ${live.planId}<b>${others.length}</b></h2>
						${sessions}
					</section>`
				: ''
		}`
}

const phaseNotes: Record<string, string> = {
	pending: 'Starts after the explorers.',
	running: 'Runs now.',
	completed: 'Done.',
	skipped: 'Skipped.',
	not_in_level: 'The level of this exploration has no verify step.',
	not_run: 'Did not run.',
}

function phaseNote(state: string) {
	return phaseNotes[state] ?? 'No reason is recorded.'
}

function foundFiles(store: Store, live: Live, entry: Found): EvidenceFile[] {
	return entry.evidence.map((file) => {
		if (file.text !== null) return { ...file, href: null, text: () => file.text! }
		const href = `/explorations/${live.explorationId}/entries/${entry.id}/evidence/${file.index}`
		const text = shownAsText(file.mediaType, file.size)
			? () => new TextDecoder().decode(entryEvidence(store, live.explorationId, entry.id, file.index).bytes)
			: null
		return { ...file, href, text }
	})
}

function foundRow(store: Store, live: Live, entry: Found) {
	const link = entry.claimId
		? html`<a
				class="sc-mono"
				href="/plans/${live.planId}?view=all&amp;item=${encodeURIComponent(`c:${entry.claimId}`)}"
				>${entry.claimId}</a
			>`
		: entry.questionId
			? html`<a
					class="sc-mono"
					href="/plans/${live.planId}?view=all&amp;item=${encodeURIComponent(`q:${entry.questionId}`)}"
					>${entry.questionId}</a
				>`
			: ''
	const marker = entry.merged
		? html`${statusMark({ state: 'completed', label: 'merged' })}${link ? html` into ${link}` : ''}`
		: statusMark({ state: 'pending', label: `${entry.kind}, not merged` })
	return html`<li class="found${entry.merged ? '' : ' raw'}" data-key="${entry.merged ? 'found' : 'raw'}:${entry.id}">
		<div class="found-h">
			<span class="sc-mono">${entry.id}</span>
			${entry.severity ? statusMark({ state: entry.severity }) : entry.blocking ? statusMark({ state: 'blocking' }) : ''}
			${marker}
		</div>
		<p>${entry.text}</p>
		${evidenceList(foundFiles(store, live, entry))}
	</li>`
}

function rawSection(store: Store, live: Live, entries: Found[]) {
	if (!entries.length) return ''
	return html`<section class="raw-box" aria-labelledby="unmerged-title" data-key="unmerged">
		<h3 class="sc-card-h" id="unmerged-title">Not merged yet <span class="sc-count-n">${entries.length}</span></h3>
		<p class="sc-help">
			These are the raw questions and defects of single explorers. They can change before the exploration is
			completed. Needs you and the plan page do not show them.
		</p>
		<ul class="found-list">
			${entries.map((entry) => foundRow(store, live, entry))}
		</ul>
	</section>`
}

function fileOpeners(live: Live, item: LiveExplorer) {
	return item.files.map((file) => {
		const page = `/explorations/${live.explorationId}/explorers/${item.explorer}/${file.phase}/${file.name}`
		return {
			label: `${file.name}${file.phase === 'test' ? '' : ` (${file.phase})`}`,
			opener: { name: `${item.explorer} · ${file.name}`, kind: 'text' as const, page, src: `${page}?download=1` },
		}
	})
}

function savedFiles(store: Store, live: Live, item: LiveExplorer) {
	if (!item.files.length)
		return html`<p class="sc-empty is-line">
			${live.running ? 'The files show when the explorer ends.' : 'The record keeps no file of this explorer.'}
		</p>`
	const texts = explorationReport(store, live.explorationId).files
	return evidenceList(
		item.files.map((file) => {
			const page = `/explorations/${live.explorationId}/explorers/${item.explorer}/${file.phase}/${file.name}`
			const saved = texts.find(
				(entry) => entry.explorer === item.explorer && entry.phase === file.phase && entry.name === file.name
			)
			return {
				name: `${file.name}${file.phase === 'test' ? '' : ` (${file.phase})`}`,
				mediaType: 'text/markdown',
				size: saved?.size ?? 0,
				href: `${page}?download=1`,
				text: () => saved?.text ?? '',
			}
		})
	)
}

function summaryDetail(store: Store, live: Live, crumbs: Html, options: Html | '') {
	const merged = live.state === 'completed' || live.claims.length + live.questions.length > 0
	const files = live.explorers.flatMap((item) =>
		fileOpeners(live, item).map(
			(file) => html`<li>${item.explorer}: ${viewLink(file.opener, file.label, undefined, 'tap')}</li>`
		)
	)
	return html`${crumbs}
		<h2 class="sc-sec-h">Overview</h2>
		${options} ${rawSection(store, live, live.unmerged)}
		<section aria-labelledby="claims-title">
			<h3 class="sc-card-h" id="claims-title">Claims <span class="sc-count-n">${live.claims.length}</span></h3>
			${merged ? claimLinks(live.planId, live.claims) : html`<p class="sc-empty is-line">The claims show when the exploration is completed.</p>`}
		</section>
		<section aria-labelledby="questions-title">
			<h3 class="sc-card-h" id="questions-title">
				Questions <span class="sc-count-n">${live.questions.length}</span>
			</h3>
			${
				merged
					? questionsList(live.planId, live.questions)
					: html`<p class="sc-empty is-line">The merged questions show when the exploration is completed.</p>`
			}
		</section>
		${
			files.length
				? html`<section aria-labelledby="files-title">
						<h3 class="sc-card-h" id="files-title">Saved files</h3>
						<ul class="sc-plain">
							${files}
						</ul>
					</section>`
				: ''
		}
		<div class="sc-row-btns">
			${downloadMenu({ label: 'Download report', base: `/explorations/${live.explorationId}/export`, note: 'The record of this exploration.', formats: ['md', 'json'] })}
		</div>`
}

function explorerDetail(store: Store, live: Live, item: LiveExplorer, crumbs: Html) {
	const found = live.found.filter((entry) => entry.explorer === item.explorer)
	return html`${crumbs}
		<h2 class="sc-sec-h">Explorer ${item.explorer}</h2>
		<p class="sc-h-meta">${explorerState(item)} ${inState(item)}</p>
		${['failed', 'operational_error'].includes(item.state ?? '') && item.reason ? html`<div class="sc-notice is-error" role="alert"><strong>Tester failed.</strong> ${Array.isArray(item.reason) ? item.reason.join(' ') : item.reason} ${item.hint ? html`<p>${item.hint}</p>` : ''}</div>` : ''}
		<dl class="sc-facts">
			${
				item.model
					? html`<div>
							<dt>Model</dt>
							<dd><code>${item.model}</code></dd>
						</div>`
					: ''
			}
			<div>
				<dt>Reported cost</dt>
				<dd>${costText(item.costUsd, item.costPartial)}</dd>
			</div>
			<div>
				<dt>${live.path === 'session' ? 'Step' : 'Turn'}</dt>
				<dd>${item.turn ?? none}</dd>
			</div>
			<div>
				<dt>${live.path === 'session' ? 'Since' : 'Started'}</dt>
				<dd>${item.startedAt ? time(item.startedAt) : none}</dd>
			</div>
			<div>
				<dt>Last activity</dt>
				<dd>${item.activity ?? none}</dd>
			</div>
			<div>
				<dt>Record</dt>
				<dd>
					${item.recorded ? html`${statusMark({ state: item.recorded })} ${plural(item.saved, 'entry', 'entries')}` : none}
				</dd>
			</div>
		</dl>
		${
			stoppableTester(live, item)
				? html`<section aria-labelledby="options-title" data-key="options:${item.explorer}">
						<h3 class="sc-card-h" id="options-title">Options</h3>
						<ul class="sc-ask-list">
							<li>
								${testerStopOption(live.explorationId, item.explorer, 1)}<span class="sc-help"
									>Ends this tester. The other testers go on.</span
								>
							</li>
						</ul>
					</section>`
				: ''
		}
		${rawSection(
			store,
			live,
			found.filter((entry) => !entry.merged)
		)}
		<section aria-labelledby="found-title">
			<h3 class="sc-card-h" id="found-title">
				Merged <span class="sc-count-n">${found.filter((entry) => entry.merged).length}</span>
			</h3>
			${
				found.some((entry) => entry.merged)
					? html`<ul class="found-list">
							${found.filter((entry) => entry.merged).map((entry) => foundRow(store, live, entry))}
						</ul>`
					: html`<p class="sc-empty is-line">No entry of ${item.explorer} is merged yet.</p>`
			}
		</section>
		<section aria-labelledby="saved-title">
			<h3 class="sc-card-h" id="saved-title">Saved files</h3>
			${savedFiles(store, live, item)}
		</section>`
}

function phaseDetail(live: Live, row: Live['phases'][number], crumbs: Html) {
	const failed = row.state === 'failed' || row.state === 'stopped'
	return html`${crumbs}
		<h2 class="sc-sec-h">Phase ${row.phase}</h2>
		<p class="sc-h-meta">${statusMark({ state: row.state })}</p>
		<p>${row.reason ?? phaseNote(row.state)}</p>
		${failed ? html`<p class="sc-help">${dataLine(null, live.data)}</p>` : ''}`
}

function timeLine(live: Live, run: Run) {
	const started = html`started ${ago(run.startedAt)}`
	if (live.running || !run.endedAt) return started
	const took = duration(Date.parse(run.endedAt) - Date.parse(run.startedAt))
	return html`${started}, ended ${ago(run.endedAt)}, took ${took}`
}

function phaseStrip(live: Live, run: Run) {
	const state = live.stopping
		? statusMark({ state: 'stopping', label: 'Stopping…' })
		: statusMark({ state: live.running && live.paused ? 'paused' : live.state })
	const steps =
		live.running && run.phase
			? phases.map((phase) =>
					phase === run.phase
						? html`<li aria-current="step" data-phase="${phase}">
								${statusMark({ state: 'running', label: phase })}
							</li>`
						: html`<li data-phase="${phase}">${statusWord({ state: 'not_started', label: phase })}</li>`
				)
			: live.phases.map(
					(row) =>
						html`<li data-phase="${row.phase}">${statusWord({ state: row.state, label: row.phase })}</li>`
				)
	return html`<div data-region="exploration-state">
		<ol class="sc-phases" aria-label="Phases of ${live.explorationId}">
			<li>${state}</li>
			${steps}
		</ol>
	</div>`
}

function runChoices(live: Live, others: Listed[]) {
	const busy = others.some((item) => item.running) || live.running
	return {
		stoppable: live.running && live.path !== 'session',
		again: !busy && !live.stopping && ['failed', 'stopped', 'interrupted'].includes(live.state),
	}
}

function runOptions(live: Live, run: Run, others: Listed[]) {
	const { stoppable, again } = runChoices(live, others)
	const items: Array<{ option: Html; help: string }> = [
		...(stoppable ? [{ option: stopOption(live.explorationId, 1), help: 'Ends all testers of this test.' }] : []),
		...(again
			? [
					{
						option: testAgainOption({ ...run, planId: live.planId }, stoppable ? 2 : 1),
						help: 'Opens the start dialog with the same build, level, and range.',
					},
				]
			: []),
	]
	if (!items.length) return ''
	return html`<section aria-labelledby="run-options-title" data-key="options:run">
		<h3 class="sc-card-h" id="run-options-title">Options</h3>
		<ul class="sc-ask-list">
			${items.map((item) => html`<li>${item.option}<span class="sc-help">${item.help}</span></li>`)}
		</ul>
	</section>`
}

function runActions(
	context: Context,
	live: Live,
	run: Run,
	others: Listed[],
	workspaceBuild: string,
	choice: InstanceChoice | null
) {
	const { stoppable, again } = runChoices(live, others)
	const testers = live.explorers.filter((item) => stoppableTester(live, item))
	const subject = { explorationId: live.explorationId, planId: live.planId, build: live.build }
	const values = {
		build: run.build,
		level: run.level ?? 'normal',
		since: run.since,
		until: run.until,
		repo: run.repo,
		instance: live.instanceId,
	}
	return {
		buttons: html`<div class="sc-h-act" data-region="exploration-actions">
			<div class="sc-tools" data-actions>
				${stoppable ? stopButton(live.explorationId) : ''}
				${again ? testButton(live.planId, 'Test build… again', values) : ''}
			</div>
		</div>`,
		dialogs: html`<div data-region="exploration-dialogs">
			${stoppable ? stopDialog(context, subject) : ''}
			${testers.map((item) => stopTesterDialog(context, subject, item.explorer))}
			${again ? testDialog(context, live.planId, values, workspaceBuild, asList(choice)) : ''}
		</div>`,
	}
}

export function explorationPage(
	store: Store,
	context: Context,
	explorationId: string,
	params = new URLSearchParams()
): Page {
	const live = explorationLive(store, explorationId)
	const runs = runsOf(store, explorationId, new Map())
	const run = runs.find((item) => item.running) ?? runs[0]
	const asked = params.get('item') ?? 'summary'
	const explorer = live.explorers.find((item) => `explorer:${item.explorer}` === asked)
	const phase = live.phases.find((row) => `phase:${row.phase}` === asked)
	const label = explorer ? explorer.explorer : phase ? phase.phase : null
	const review = reviewOf(store, live.planId)
	const title = live.running ? 'Testers now' : 'Testers'
	const others = review.explorations.filter((item) => item.explorationId !== explorationId).reverse()
	const permissions = explorationPermissions(store, explorationId)
	const open = permissions.filter((item) => !item.decision)
	const asking = new Map(open.flatMap((item) => (item.tester ? [[item.tester, item] as const] : [])))
	const actions = runActions(
		context,
		live,
		run,
		review.explorations.filter((item) => item.explorationId !== explorationId),
		defaultBuild(store.workspace),
		instanceChoice(store, live.planId)
	)
	const detail = explorer
		? explorerDetail(store, live, explorer, html``)
		: phase
			? phaseDetail(live, phase, html``)
			: summaryDetail(store, live, html``, runOptions(live, run, others))
	return {
		viewer: true,
		title: label ? `${explorationId} · ${label}` : `${title} · ${explorationId}`,
		section: 'home',
		subjects: [`exploration:${explorationId}`, `plan:${live.planId}`],
		crumbs: [
			['Plans', '/'],
			[live.planId, `/plans/${live.planId}`],
			[explorationId, label ? `/explorations/${explorationId}` : null],
			...(label ? [[label, null] as [string, null]] : []),
		],
		back: label ? `/explorations/${explorationId}` : `/plans/${live.planId}?nav=testers`,
		nav: navigator(review, 'testers', explorationId),
		body: html`<header class="sc-h">
				<div class="sc-h-text" data-region="exploration-head">
					${crumbBar({
						crumbs: [
							[live.planId, `/plans/${live.planId}`],
							[review.target, null],
						],
					})}
					<h1>${title}</h1>
					<p>
						Session ${explorationId} on build ${live.build} · ${live.instanceId} ·
						${live.level ?? 'no level'} ·
						${timeLine(live, run)}${live.costUsd === null ? '' : ` · total cost ${costText(live.costUsd, live.costPartial)}`}.
						${live.goal}
					</p>
				</div>
				${actions.buttons}
			</header>
			${phaseStrip(live, run)}
			<div data-region="exploration-banner">
				${stateLine(store, live, run)}${strayLines(live)}${stepAsks(open)}${rulesLines(permissionRules(store, explorationId))}
				${live.warnings.map((warning) => notice({ kind: 'warn', content: warning }))}
			</div>
			${actions.dialogs}
			<div class="sc-stack is-loose" data-region="exploration-list">
				${explorationList(context, live, others, asking)}
			</div>
			<div data-region="permission-history">
				${permissionHistory(store, explorationId, params, historyFrom(explorationId, params))}
			</div>
			<section
				class="sc-detail"
				aria-label="${label ?? 'Overview'}"
				data-region="exploration-detail"
				data-key="detail:${label ? asked : 'summary'}"
			>
				<h2 class="sc-sec-h">${label ? (explorer ? `Tester ${label}` : `Phase ${label}`) : 'Overview'}</h2>
				${detail}
			</section>`,
	}
}

export function explorerFile(store: Store, explorationId: string, explorer: string, phase: string, name: string) {
	const file = explorationReport(store, explorationId).files.find(
		(item) => item.explorer === explorer && item.phase === phase && item.name === name
	)
	if (!file) throw new Error(`Unknown file ${name} of ${explorer} in ${explorationId}`)
	return file
}

export function explorerFilePage(
	store: Store,
	explorationId: string,
	explorer: string,
	phase: string,
	name: string
): Page {
	const file = explorerFile(store, explorationId, explorer, phase, name)
	return {
		title: `${explorationId} · ${explorer} · ${name}`,
		section: 'home',
		crumbs: [
			['Plans', '/plans'],
			[explorationId, `/explorations/${explorationId}`],
			[`${explorer} · ${name}`, null],
		],
		subjects: [`exploration:${explorationId}`],
		body: html`${heading({ title: html`${explorationId} · ${explorer} · ${name}`, sub: `Saved in the record after the ${phase} turn.` })}
			<p>
				<a href="/explorations/${explorationId}">Exploration ${explorationId}</a> · ${plural(file.size, 'byte')}
			</p>
			<section class="sc-card" aria-label="${name}"><pre class="report">${file.text}</pre></section>`,
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
		section: 'home',
		crumbs: [
			['Needs you', '/'],
			[report.planId, `/plans/${report.planId}`],
			[explorationId, `/explorations/${explorationId}`],
			[question.id, null],
		],
		subjects: [`exploration:${explorationId}`, 'inbox'],
		body: html`${heading({ title: html`${report.planId} · ${question.id}`, sub: question.question })}
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
				html`<div>${messages(shown)}</div>
					<p class="subj">${statusMark({ state: claim.state })} ${claim.id}</p>
					<p class="sc-help">By ${claim.decision.actor}. Rationale: ${claim.decision.rationale}</p>
					${keptText(shown)}`
			)
		: html`<section class="sc-card decision" id="decide" aria-labelledby="decide-title" data-region="decision">
				<h2 class="sc-card-h" id="decide-title">Decision</h2>
				<p class="subj">Is ${claim.id} a defect?</p>
				<div>${messages(shown)}</div>
				<form method="post" action="/explorations/${explorationId}/claims/${claim.id}" class="sc-form">
					${hidden(context, '')} ${actorField(context, shown)}
					${rationaleField(shown, 'Why do you decide this?')}
					<div class="sc-row-btns">
						${formButton({ label: 'Accept as a defect', emphasis: 'primary', attrs: { name: 'verdict', value: 'approved' } })}
						${formButton({ label: 'Reject', attrs: { name: 'verdict', value: 'rejected' } })}
					</div>
				</form>
			</section>`
	const steps = [claim.steps ?? []].flat()
	return {
		title: `${report.planId} · ${claim.id}`,
		section: 'home',
		crumbs: [
			['Claims', '/claims'],
			[report.planId, `/plans/${report.planId}`],
			[explorationId, `/explorations/${explorationId}`],
			[claim.id, null],
		],
		subjects: [`exploration:${explorationId}`, 'inbox'],
		body: html`${heading({ title: html`${report.planId} · ${claim.id}`, sub: claim.title, meta: html`${statusMark({ state: claim.state })} ${statusMark({ state: claim.severity })}` })}
			<div class="sc-split">
				<section class="sc-card" aria-labelledby="claim-title">
					<h2 class="sc-card-h" id="claim-title">Claim</h2>
					<p>
						<a href="/plans/${report.planId}">Plan ${report.planId}</a> ·
						<a href="/explorations/${explorationId}">Exploration ${explorationId}</a> · build ${claim.build}
					</p>
					<div class="sc-compare">
						<div>
							<span class="sc-kicker">Expected</span>
							<p>${claim.expected}</p>
						</div>
						<div>
							<span class="sc-kicker">Actual</span>
							<p>${claim.actual}</p>
						</div>
					</div>
					${
						steps.length
							? html`<span class="sc-kicker">Steps</span>
									<ol class="sc-steps">
										${steps.map((step) => html`<li>${step}</li>`)}
									</ol>`
							: ''
					}
					<p class="sc-label">Evidence</p>
					${claimEvidenceList(store, report.planId, claim)}
					<p class="sc-help">Reported by ${claim.actors.join(', ')}. ${claim.reason ?? ''}</p>
				</section>
				${panel}
			</div>`,
	}
}
