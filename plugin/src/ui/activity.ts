import type { Store } from '../store.ts'
import type { ExplorationEvent } from '../explorations.ts'
import { all } from '../store.ts'
import { explorationEvents } from '../explorations.ts'
import { explorationPermissions } from '../permissions.ts'
import { explorationState, explorationStatus, startOf } from '../explorers.ts'
import { authenticationFailed, authenticationHint, piAuthenticationHint } from '../sessions.ts'
import { piErrorText } from '../pi.ts'
import { mergedClaims, mergedQuestions } from '../views.ts'
import type { RequestRecord } from '../requests.ts'
import { allRequests, isEnded } from '../requests.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { ListSpec } from './lists.ts'
import { instanceChoice, stopDialog, stopOption, testAgainOption, testDialog } from './actions.ts'
import { emptyNotice } from './components/empty-state.ts'
import { groupHeader, listRow, optionsBox } from './components/list-row.ts'
import { heading } from './components/page-heading.ts'
import { statusMark } from './components/status-mark.ts'
import { asList, duration, html, money, plural, time } from './html.ts'
import { listHref, listState, pageTrail, pager } from './lists.ts'

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
	instanceId: string
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

export { money } from './html.ts'

export function failureOf(reason: string | null, hint: string | null, events: ExplorationEvent[]): Failure {
	const text = reason ?? ''
	if (/No claude executable/.test(text)) return claudeMissing
	if (/No pi executable/.test(text))
		return {
			cause: 'Pi was not found on PATH.',
			next: 'Install Pi or choose Claude Code in Settings.',
			detail: null,
		}

	const testerFailure =
		text === 'No explorer session was recorded.' || text === 'Host authentication: no session could log in.'
	if (testerFailure && startOf(events)?.context?.harness === 'pi') {
		const failed = events.find(
			(item) => item.step === 'end' && item.status === 'operational_error' && item.detail.reason
		)
		const diagnostic = piErrorText(failed?.detail.reason)
		if (diagnostic) {
			const auth = authenticationFailed({ failure: ['operational_error', diagnostic] })
			const guidance = typeof failed?.detail.hint === 'string' ? piErrorText(failed.detail.hint) : ''
			return {
				cause: `Tester ${failed?.explorer ?? ''} failed: ${diagnostic}`,
				next: auth
					? 'Check the provider login in Pi, then test again.'
					: guidance || 'Check the Pi configuration, then test again.',
				detail: null,
			}
		}
	}
	if (
		hint === piAuthenticationHint ||
		(/Host authentication/.test(text) && startOf(events)?.context?.harness === 'pi')
	)
		return {
			cause: 'Pi could not sign in to its provider.',
			next: 'Check the provider login in Pi, then test again.',
			detail: piAuthenticationHint,
		}
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
	const firstFollow = events.findIndex((item) => item.step === 'follow')
	const firstRun = firstFollow === -1 ? events : events.slice(0, firstFollow)
	const failure = status.state === 'failed' ? failureOf(status.reason, status.doneHint, firstRun) : null
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
		instanceId: status.instanceId,
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
	none: ['No run or chat message yet.', 'Start a test with Test build… in a plan, or press / and ask Checkmate.'],
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

function row(run: Run, n: number, now: number) {
	const items = options(run)
	const title = `${run.planId} · ${run.follow ? 'Follow-up' : 'Test'} ${run.build}${run.level && !run.follow ? ` · ${run.level}` : ''}${sentence(run) ? ` · ${sentence(run)}` : ''}`
	const label = run.follow ? `${run.explorationId} follow-up` : run.explorationId
	return listRow({
		id: `run-${n}`,
		key: run.key,
		href: `/explorations/${run.explorationId}`,
		label,
		tag: statusMark({ state: run.state }),
		shownId: run.explorationId,
		idTitle: run.explorationId,
		title,
		titleText: title,
		meta: join(meta(run, now), ' · '),
		metaText: metaText(run, now),
		options: optionsBox(items),
	})
}

function join(items: Array<Html | string | null>, separator: string): Html {
	const shown = items.filter((item): item is Html | string => item !== null)
	return html`${shown.map((item, index) => (index ? html`${separator}${item}` : item))}`
}

function chatRow(turn: RequestRecord, n: number, now: number) {
	const start = Date.parse(turn.startedAt ?? turn.askedAt)
	const end = turn.endedAt ? Date.parse(turn.endedAt) : now
	const spent = isEnded(turn) ? duration(Math.max(0, end - start)) : null
	const meta = [
		turn.asker,
		time(turn.askedAt),
		turn.state === 'running'
			? html`<span data-since="${turn.startedAt}">${duration(Math.max(0, now - start))}</span>`
			: spent,
		turn.costUsd === null ? null : money(turn.costUsd),
	]
	const metaText = [turn.asker, turn.askedAt, spent, turn.costUsd === null ? null : money(turn.costUsd)]
		.filter(Boolean)
		.join(' · ')
	const title = `Chat message · ${turn.text.trim().split('\n')[0]}`
	return listRow({
		id: `chat-row-${n}`,
		key: `request:${turn.id}`,
		href: `/chats/${turn.conversation}`,
		label: turn.id,
		tag: statusMark({ state: turn.state, label: turn.state === 'answered' ? 'Completed' : undefined }),
		shownId: turn.id,
		idTitle: turn.id,
		title,
		titleText: title,
		meta: join(meta, ' · '),
		metaText,
	})
}

type Entry = { at: string; running: boolean; render: (n: number, now: number) => Html; run: Run | null }

export function activityPage(
	store: Store,
	context: Context,
	params: URLSearchParams,
	defaults: Record<string, string>
): Page {
	const state = listState(params, spec)
	const runs = allRuns(store)
	const entries: Entry[] = [
		...runs.map((run): Entry => ({
			at: run.startedAt,
			running: run.running,
			render: (n, now) => row(run, n, now),
			run,
		})),
		...allRequests(store).map((turn): Entry => ({
			at: turn.askedAt,
			running: turn.state === 'running' || turn.state === 'waiting',
			render: (n, now) => chatRow(turn, n, now),
			run: null,
		})),
	].sort((a, b) => Number(b.running) - Number(a.running) || b.at.localeCompare(a.at))
	const lastPage = Math.max(1, Math.ceil(entries.length / state.size))
	const shown = { ...state, page: Math.min(state.page, lastPage) }
	const page = { rows: entries.slice((shown.page - 1) * shown.size, shown.page * shown.size) }
	const now = Date.now()
	const running = page.rows.filter((entry) => entry.running)
	const earlier = page.rows.filter((entry) => !entry.running)
	let n = 0
	const group = (label: string, items: Entry[]) =>
		items.length
			? html`${groupHeader({ label, count: items.length })} ${items.map((entry) => entry.render(n++, now))}`
			: ''
	const total = entries.length
	const first = total ? (shown.page - 1) * shown.size + 1 : 0
	const last = Math.min(total, shown.page * shown.size)
	const planIds = [...new Set(page.rows.flatMap((entry) => (entry.run ? [entry.run.planId] : [])))]
	const choices = planIds.flatMap((planId) => asList(instanceChoice(store, planId)))
	const dialogs = html`${testDialog(context, null, { build: '', level: 'normal', since: '', until: '', repo: '' }, defaults.build, choices)}
	${page.rows.flatMap((entry) => (entry.run?.stoppable ? [stopDialog(context, entry.run)] : []))}`
	return {
		title: 'Activity',
		section: 'activity',
		subjects: ['*'],
		address: listHref(spec, shown),
		...pageTrail(spec, shown, total, 'Activity'),
		body: html`${heading('Activity', 'Tests, follow-ups, and chat messages. Open an entry to see its run or chat.')}
			<div data-region="activity" data-list-region>
				<p class="list-count" data-list-count role="status">
					${total ? `Showing ${first}–${last} of ${plural(total, 'entry', 'entries')}` : ''}
				</p>
				${
					total
						? html`<div class="sp-list activity" role="list" aria-label="Runs and chat messages" data-list>
									${group('Running now', running)}${group('Earlier', earlier)}
								</div>
								${pager(spec, shown, total)}`
						: emptyNotice(spec.none[0], spec.none[1])
				}
			</div>
			<div data-region="activity-dialogs">${dialogs}</div>`,
	}
}
