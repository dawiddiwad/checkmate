import type { Store } from '../store.ts'
import type { ExplorationEvent } from '../explorations.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { ListSpec } from './lists.ts'
import { all } from '../store.ts'
import { explorationEvents } from '../explorations.ts'
import { explorationPermissions } from '../permissions.ts'
import { explorationState, explorationStatus, startOf } from '../explorers.ts'
import { authenticationHint } from '../sessions.ts'
import { mergedClaims, mergedQuestions } from '../views.ts'
import { duration, glyph, html, pill, plural, time } from './html.ts'
import { emptyNotice, heading } from './layout.ts'
import { listHref, listState, pageTrail, pager } from './lists.ts'
import { stopDialog, stopOption, testDialog, testAgainOption } from './actions.ts'

const liveStates = ['starting', 'testing', 'recording', 'verifying', 'following']

export const phases = ['study', 'test', 'record', 'merge', 'check'] as const
export type Phase = (typeof phases)[number]

export type Failure = { cause: string; next: string; detail: string | null }

export type Run = {
	key: string
	explorationId: string
	follow: boolean
	planId: string
	build: string
	level: string | null
	state: string
	running: boolean
	phase: Phase | null
	actor: string
	startedAt: string
	endedAt: string | null
	costUsd: number | null
	outcome: string
	failure: Failure | null
	stoppable: boolean
	since: string
	until: string
	repo: string
}

export const claudeMissing: Failure = {
	cause: 'Claude Code was not found: no claude program is on PATH.',
	next: 'Install Claude Code, or add the folder of claude to PATH. Then test again.',
	detail: null,
}

export function isRunning(state: string) {
	return liveStates.includes(state)
}

export function phaseOf(events: ExplorationEvent[], state: string): Phase | null {
	if (!isRunning(state) || startOf(events)?.path === 'session') return null
	if (state === 'following') return 'test'
	const launched = events.filter((item) => item.step === 'launch').map((item) => item.explorer)
	const ended = new Set(events.filter((item) => item.step === 'end').map((item) => item.explorer))
	const recorded = new Set(events.filter((item) => item.step === 'record').map((item) => item.explorer))
	if (!launched.length || !launched.every((explorer) => ended.has(explorer)))
		return events.some((item) => item.step === 'turn' && item.detail.turn === 'test') ? 'test' : 'study'
	if (events.some((item) => item.step === 'merge')) return 'check'
	const unrecorded = events.some(
		(item) => item.step === 'end' && item.status === 'completed' && !recorded.has(item.explorer)
	)
	return unrecorded ? 'record' : 'merge'
}

export function costOf(events: ExplorationEvent[]) {
	const costs = events.flatMap((item) => (typeof item.detail.costUsd === 'number' ? [item.detail.costUsd] : []))
	return costs.length ? costs.reduce((total, cost) => total + cost, 0) : null
}

export function money(costUsd: number) {
	return `$${costUsd.toFixed(2)}`
}

export function failureOf(reason: string | null, hint: string | null, events: ExplorationEvent[]): Failure {
	const text = reason ?? ''
	if (/No claude executable/.test(text)) return claudeMissing
	if (hint === authenticationHint || /Host authentication/.test(text))
		return {
			cause: 'Claude Code is not signed in on this computer.',
			next: 'Run claude and log in. Then test again.',
			detail: authenticationHint,
		}
	const slow = events
		.map((item) => /did not end in (\d+) seconds/.exec(String(item.detail.reason ?? '')))
		.find((found) => found)
	if (slow)
		return {
			cause: `A tester did not end in ${slow[1]} seconds. Checkmate stopped it.`,
			next: 'Test again with the level smoke, or run checkmate test with a longer --timeout.',
			detail: null,
		}
	return {
		cause: text ? `The test failed: ${text}` : 'The test failed. No reason is recorded.',
		next: 'Read the log of the run. Then test again.',
		detail: null,
	}
}

function actorOf(store: Store, explorationId: string, step: 'start' | 'follow') {
	const rows = all<{ at: string; actor: string }>(
		store,
		'SELECT e.at, o.actor FROM exploration_events e JOIN operations o ON o.id = e.operation_id WHERE e.exploration_id = ? AND e.step = ? ORDER BY e.rowid',
		explorationId,
		step
	)
	return rows
}

export function runsOf(store: Store, explorationId: string, counts: Map<string, [number, number]>): Run[] {
	const status = explorationStatus(store, explorationId)
	const events = explorationEvents(store, explorationId)
	const starters = actorOf(store, explorationId, 'start')
	const followers = actorOf(store, explorationId, 'follow')
	const startAt = events.find((item) => item.step === 'start')?.at ?? events[0]?.at ?? ''
	const stop = events.findLast((item) => item.step === 'stop' && item.explorer === null)
	const done = events.find((item) => item.step === 'done')
	const [claims, questions] = counts.get(`${status.planId}:${explorationId}`) ?? [0, 0]
	const waiting = explorationPermissions(store, explorationId).filter((item) => !item.decision).length
	const waits = waiting ? `waits for you: ${plural(waiting, 'permission request')}` : ''
	const failure = status.state === 'failed' ? failureOf(status.reason, status.doneHint, events) : null
	const outcomes: Record<string, string> = {
		completed: `${plural(claims, 'defect')}, ${plural(questions, 'question')}`,
		failed: failure ? `${failure.cause} ${failure.next}` : '',
		stopped: status.reason ?? 'Stopped.',
		interrupted: 'The run was interrupted: the supervisor stopped before the end.',
	}
	const base = {
		explorationId,
		planId: status.planId,
		build: status.build,
		level: status.level,
		since: status.since ?? '',
		until: status.until ?? '',
		repo: (JSON.parse(
			all<{ charter: string }>(
				store,
				'SELECT charter FROM explorations WHERE exploration_id = ?',
				explorationId
			)[0].charter
		).change?.repo ?? '') as string,
	}
	const firstFollow = events.findIndex((item) => item.step === 'follow')
	const testing = isRunning(status.state) && status.state !== 'following'
	const own: Run = {
		...base,
		key: `run:${explorationId}`,
		follow: false,
		state: status.state === 'following' ? 'completed' : status.state,
		running: testing,
		phase: phaseOf(events, status.state === 'following' ? 'completed' : status.state),
		actor: starters[0]?.actor ?? 'unknown',
		startedAt: startAt,
		endedAt: done?.at ?? stop?.at ?? (status.state === 'interrupted' ? (events.at(-1)?.at ?? null) : null),
		costUsd: costOf(firstFollow === -1 ? events : events.slice(0, firstFollow)),
		outcome: testing ? waits : (outcomes[status.state === 'following' ? 'completed' : status.state] ?? ''),
		failure,
		stoppable: testing && status.path !== 'session',
	}
	const indexes = events.flatMap((item, index) => (item.step === 'follow' ? [index] : []))
	const follows = indexes.map((from, number): Run => {
		const later = events.slice(from + 1, indexes[number + 1])
		const ended = later.find((item) => item.step === 'followed')
		const last = number === indexes.length - 1
		const state = ended
			? ended.status === 'completed'
				? 'completed'
				: 'failed'
			: last
				? status.follow === 'running'
					? 'following'
					: (status.follow ?? 'interrupted')
				: 'interrupted'
		const answers = (events[from].detail.answers as unknown[] | undefined)?.length ?? 0
		const trouble =
			state === 'failed'
				? failureOf(String(ended?.detail.reason ?? ''), (ended?.detail.hint as string) ?? null, later)
				: null
		const words: Record<string, string> = {
			completed: `${plural(answers, 'answer')} tested`,
			failed: trouble ? `${trouble.cause} ${trouble.next}` : '',
			stopped: status.followReason ?? 'Stopped.',
			interrupted: 'The run was interrupted: the supervisor stopped before the end.',
			following: waits,
		}
		return {
			...base,
			key: `follow:${explorationId}:${number + 1}`,
			follow: true,
			state,
			running: state === 'following',
			phase: state === 'following' ? 'test' : null,
			actor: followers[number]?.actor ?? 'unknown',
			startedAt: events[from].at,
			endedAt:
				ended?.at ??
				(state === 'stopped' ? (later.findLast((item) => item.step === 'stop')?.at ?? null) : null),
			costUsd: costOf(later),
			outcome: words[state] ?? '',
			failure: trouble,
			stoppable: state === 'following',
		}
	})
	return [own, ...follows]
}

export function allRuns(store: Store): Run[] {
	const counts = new Map<string, [number, number]>()
	const plans = all<{ plan_id: string }>(store, 'SELECT DISTINCT plan_id FROM explorations').map((row) => row.plan_id)
	for (const planId of plans) {
		for (const claim of mergedClaims(store, planId)) {
			const key = `${planId}:${claim.explorationId}`
			const [claims, questions] = counts.get(key) ?? [0, 0]
			counts.set(key, [claims + 1, questions])
		}
		for (const question of mergedQuestions(store, planId)) {
			const key = `${planId}:${question.explorationId}`
			const [claims, questions] = counts.get(key) ?? [0, 0]
			counts.set(key, [claims, questions + 1])
		}
	}
	const ids = all<{ exploration_id: string }>(store, 'SELECT exploration_id FROM explorations ORDER BY rowid').map(
		(row) => row.exploration_id
	)
	const runs = ids.flatMap((id) => runsOf(store, id, counts))
	return [
		...runs.filter((run) => run.running).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
		...runs.filter((run) => !run.running).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
	]
}

export function runningCount(store: Store) {
	return all<{ exploration_id: string }>(store, 'SELECT exploration_id FROM explorations').filter((row) =>
		isRunning(explorationState(explorationEvents(store, row.exploration_id)))
	).length
}

const spec: ListSpec = {
	path: '/activity',
	region: 'activity',
	noun: 'run',
	search: '',
	columns: [{ label: 'Started', sort: 'started', first: 'desc' }],
	sort: 'started',
	direction: 'desc',
	filters: [],
	none: ['No run yet.', 'Start one with Test build… in a plan.'],
}

function sentence(run: Run) {
	return run.outcome
}

function meta(run: Run, now: number) {
	const end = run.endedAt ? Date.parse(run.endedAt) : now
	const spent = Math.max(0, end - Date.parse(run.startedAt))
	return [
		run.actor,
		time(run.startedAt),
		run.running ? html`<span data-since="${run.startedAt}">${duration(spent)}</span>` : duration(spent),
		run.costUsd === null ? null : money(run.costUsd),
	]
}

function metaText(run: Run, now: number) {
	const end = run.endedAt ? Date.parse(run.endedAt) : now
	return [
		run.actor,
		run.startedAt,
		duration(Math.max(0, end - Date.parse(run.startedAt))),
		run.costUsd === null ? null : money(run.costUsd),
	]
		.filter(Boolean)
		.join(' · ')
}

function options(run: Run) {
	const list: Html[] = []
	if (run.stoppable) list.push(stopOption(run.explorationId))
	if (['failed', 'stopped', 'interrupted'].includes(run.state) && !run.running) list.push(testAgainOption(run))
	return list
}

export function optionsBox(items: Html[]) {
	if (!items.length) return ''
	return html`<div class="sp-c-opts" aria-label="Options" data-fit>
		${items}<span class="sp-c-more" aria-hidden="true">${glyph('→')} ${plural(items.length, 'option')}</span>
	</div>`
}

function row(run: Run, n: number, now: number) {
	const items = options(run)
	const title = `${run.planId} · ${run.follow ? 'Follow-up' : 'Test'} ${run.build}${run.level && !run.follow ? ` · ${run.level}` : ''}${sentence(run) ? ` · ${sentence(run)}` : ''}`
	const label = run.follow ? `${run.explorationId} follow-up` : run.explorationId
	return html`<div
		class="sp-row"
		role="option"
		aria-selected="false"
		tabindex="-1"
		id="run-${n}"
		data-row
		data-key="${run.key}"
		data-href="/explorations/${run.explorationId}"
		data-label="${label}"
	>
		<span class="sp-c-cb"></span>
		<span class="sp-c-tag">${pill(run.state)}</span>
		<span class="sp-c-id" title="${run.explorationId}">${run.explorationId}</span>
		<span class="sp-c-title ell" title="${title}">${title}</span>
		<span class="sp-c-meta ell" title="${metaText(run, now)}">${join(meta(run, now), ' · ')}</span>
		${optionsBox(items)}
	</div>`
}

function join(items: Array<Html | string | null>, separator: string): Html {
	const shown = items.filter((item): item is Html | string => item !== null)
	return html`${shown.map((item, index) => (index ? html`${separator}${item}` : item))}`
}

export function activityPage(
	store: Store,
	context: Context,
	params: URLSearchParams,
	defaults: Record<string, string>
): Page {
	const state = listState(params, spec)
	const runs = allRuns(store)
	const lastPage = Math.max(1, Math.ceil(runs.length / state.size))
	const shown = { ...state, page: Math.min(state.page, lastPage) }
	const page = { rows: runs.slice((shown.page - 1) * shown.size, shown.page * shown.size) }
	const now = Date.now()
	const running = page.rows.filter((run) => run.running)
	const earlier = page.rows.filter((run) => !run.running)
	let n = 0
	const group = (label: string, items: Run[]) =>
		items.length
			? html`<div class="sp-gh" role="presentation">${label} <span>${items.length}</span></div>
					${items.map((run) => row(run, n++, now))}`
			: ''
	const total = runs.length
	const first = total ? (shown.page - 1) * shown.size + 1 : 0
	const last = Math.min(total, shown.page * shown.size)
	const dialogs = html`${testDialog(context, null, { build: '', level: 'normal', since: '', until: '', repo: '' }, defaults.build)}
	${page.rows.filter((run) => run.stoppable).map((run) => stopDialog(context, run))}`
	return {
		title: 'Activity',
		section: 'activity',
		subjects: ['*'],
		address: listHref(spec, shown),
		...pageTrail(spec, shown, total, 'Activity'),
		body: html`${heading('Activity', 'Every test and follow-up of every plan. Open a run to watch it, or test again.')}
			<div data-region="activity" data-list-region>
				<p class="list-count" data-list-count role="status">
					${total ? `Showing ${first}–${last} of ${plural(total, 'run')}` : ''}
				</p>
				${
					total
						? html`<div class="sp-list activity" role="listbox" aria-label="Runs" data-list>
									${group('Running now', running)}${group('Earlier', earlier)}
								</div>
								${pager(spec, shown, total)}`
						: emptyNotice(spec.none[0], spec.none[1])
				}
			</div>
			<div data-region="activity-dialogs">${dialogs}</div>`,
	}
}
