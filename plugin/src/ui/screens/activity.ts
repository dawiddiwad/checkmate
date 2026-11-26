import type { Store } from '../../store.ts'
import type { RequestRecord } from '../../requests.ts'
import { allRequests, isEnded } from '../../requests.ts'
import type { Run } from '../activity.ts'
import type { Html } from '../html.ts'
import type { Context, Page } from '../layout.ts'
import type { ListSpec } from '../lists.ts'
import { instanceChoice, stopDialog, stopOption, testAgainOption, testDialog } from '../actions.ts'
import { allRuns } from '../activity.ts'
import { emptyNotice } from '../components/empty-state.ts'
import { groupHeader, listRow, optionsBox } from '../components/list-row.ts'
import { heading } from '../components/page-heading.ts'
import { statusMark } from '../components/status-mark.ts'
import { asList, duration, html, money, plural, time } from '../html.ts'
import { listHref, listState, pageTrail, pager } from '../lists.ts'

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
		body: html`${heading({ title: 'Activity', sub: 'Tests, follow-ups, and chat messages. Open an entry to see its run or chat.' })}
			<div data-region="activity" data-list-region>
				<p class="sc-count" data-list-count role="status">
					${total ? `Showing ${first}–${last} of ${plural(total, 'entry', 'entries')}` : ''}
				</p>
				${
					total
						? html`<div class="sc-list activity" role="list" aria-label="Runs and chat messages" data-list>
									${group('Running now', running)}${group('Earlier', earlier)}
								</div>
								${pager(spec, shown, total)}`
						: emptyNotice({ what: spec.none[0], next: spec.none[1] })
				}
			</div>
			<div data-region="activity-dialogs">${dialogs}</div>`,
	}
}
