import type { Store } from '../store.ts'
import type { ExplorationEvent } from '../explorations.ts'
import { all } from '../store.ts'
import { explorationEvents } from '../explorations.ts'
import { explorationPermissions } from '../permissions.ts'
import { explorationState, explorationStatus, startOf } from '../explorers.ts'
import { authenticationFailed, authenticationHint, piAuthenticationHint } from '../sessions.ts'
import { piErrorText } from '../pi.ts'
import { mergedClaims, mergedQuestions } from '../views.ts'
import { plural } from './html.ts'

const liveStates = ['starting', 'testing', 'recording', 'verifying', 'following']

export const phases = ['study', 'test', 'record', 'merge', 'check'] as const
export type Phase = (typeof phases)[number]

export type Failure = { cause: string; next: string; detail: string | null }

export type Run = {
	key: string
	explorationId: string
	session: boolean
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
	const waits = waiting
		? `waits for you: ${plural(waiting, 'permission request')}`
		: status.path === 'session'
			? 'runs in the session that started the test'
			: ''
	const firstFollow = events.findIndex((item) => item.step === 'follow')
	const firstRun = firstFollow === -1 ? events : events.slice(0, firstFollow)
	const failure = status.state === 'failed' ? failureOf(status.reason, status.doneHint, firstRun) : null
	const outcomes: Record<string, string> = {
		completed: `${plural(claims, 'defect')}, ${plural(questions, 'question')}`,
		failed: failure ? `${failure.cause} ${failure.next}` : '',
		stopped: status.reason ?? 'Stopped.',
		interrupted: 'The run was interrupted: the supervisor stopped before the end.',
	}
	const session = status.path === 'session'
	const base = {
		explorationId,
		session,
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
		stoppable: testing,
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
