import type { Store } from '../../store.ts'
import type { PlanListRow } from '../../views.ts'
import { findingList, planList } from '../../views.ts'
import type { Page } from '../layout.ts'
import type { Review } from '../review.ts'
import { board, boardKey } from '../components/board.ts'
import { metrics } from '../components/metric.ts'
import { heading } from '../components/page-heading.ts'
import { newChangeTile, planTile } from '../components/plan-tile.ts'
import { statusMark, wordMark } from '../components/status-mark.ts'
import { costText, duration, html, plural, time, words } from '../html.ts'
import { boardColumns, buildLabel, reviewHref, reviewOf, verdictLine } from '../review.ts'

function planBoard(review: Review) {
	const builds = review.map.builds.slice(-2)
	const from = review.map.builds.length - builds.length
	const cols = boardColumns(review)
	return board({
		label: `Rules against the last ${plural(builds.length, 'build')}`,
		columns: cols.map((column) => ({ label: column.label, title: column.title })),
		builds: builds.map((build, index) => ({
			build: build.build,
			label: buildLabel(review, build.build),
			cells: cols.map((column) => column.cells[from + index]),
		})),
	})
}

function nextStep(review: Review) {
	const verdict = verdictLine(review)
	const href = (view: string) => reviewHref(review.planId, view, '&focus=list')
	if (verdict.blocking)
		return { label: `Answer ${plural(verdict.blocking, 'blocking question')}`, href: href('needs'), unblocks: true }
	if (verdict.findings)
		return { label: `Look at ${plural(verdict.findings, 'finding')}`, href: href('needs'), unblocks: false }
	if (verdict.open)
		return { label: `Answer ${plural(verdict.open, 'question')}`, href: href('needs'), unblocks: false }
	if (review.items.some((item) => item.needs))
		return { label: 'Decide what waits', href: href('needs'), unblocks: false }
	if (review.running)
		return { label: 'Watch the testers', href: `/explorations/${review.running.explorationId}`, unblocks: false }
	return { label: 'Open the plan', href: href('all'), unblocks: false }
}

const roleWords: Record<string, string> = {
	planner: 'the planner',
	oracle: 'oracle',
	qa: 'QA',
	factory: 'the factory',
	none: 'nobody',
}

function tile(review: Review, plan: PlanListRow, runDefects: number, index: number) {
	const { loop, costUsd, costPartial } = plan
	const verdict = verdictLine(review)
	const latest = review.map.builds.at(-1)
	const last = review.explorations.at(-1)
	const ended = !review.running && last && ['stopped', 'interrupted'].includes(last.state) ? last : null
	const status = review.running
		? wordMark({ state: 'testing', label: 'Testing' })
		: ended
			? statusMark({ state: ended.state })
			: loop
				? statusMark({ state: loop.state })
				: ''
	const when = review.running
		? html`${review.phase ?? words(review.running.state)} ·
				<span data-since="${review.running.startedAt}"
					>${duration(Date.now() - Date.parse(review.running.startedAt))}</span
				>`
		: latest
			? html`${buildLabel(review, latest.build)} ${latest.build} · ${time(latest.firstTestedAt)}`
			: review.target
	return planTile({
		index,
		planId: review.planId,
		href: reviewHref(review.planId, 'needs'),
		status,
		when,
		waitsOn: loop && !review.running ? `waits on ${roleWords[loop.waitsOn]}` : null,
		whenTitle: latest ? `${latest.build}, first tested ${latest.firstTestedAt}` : review.target,
		objective: review.objective,
		verdict,
		cost: costUsd === null ? null : costText(costUsd, costPartial),
		board: planBoard(review),
		metrics: metrics({
			items: [
				{ value: verdict.blocking, name: 'block testing', waitsOnYou: verdict.blocking > 0 },
				{ value: verdict.findings, name: 'to look at', waitsOnYou: false },
				{ value: verdict.defects + runDefects, name: 'defects', waitsOnYou: false },
			],
		}),
		next: nextStep(review),
	})
}

export function homePage(store: Store): Page {
	const runDefects = new Map<string, number>()
	for (const { planId } of findingList(store, { open: true }))
		runDefects.set(planId, (runDefects.get(planId) ?? 0) + 1)
	const latest = (review: ReturnType<typeof reviewOf>, since: string) =>
		[since, ...review.explorations.map((item) => item.startedAt)].sort().at(-1)!
	const listed = planList(store).map((plan) => {
		const review = reviewOf(store, plan.planId)
		return { plan, review, needs: review.items.some((item) => item.needs), at: latest(review, plan.since) }
	})
	listed.sort(
		(a, b) =>
			Number(b.needs) - Number(a.needs) || b.at.localeCompare(a.at) || a.plan.planId.localeCompare(b.plan.planId)
	)
	const plans = listed.map((each) => each.plan)
	const reviews = listed.map((each) => each.review)
	const blocking = reviews.reduce((sum, review) => sum + verdictLine(review).blocking, 0)
	const testing = reviews.filter((review) => review.running).length
	const subtitle = html`${plural(plans.length, 'plan')} · ${testing} testing
	now${
		blocking > 0
			? html` ·
					<b class="sc-hot"
						>${plural(blocking, 'question')} ${blocking === 1 ? 'blocks' : 'block'} testing</b
					>`
			: ''
	}`
	const body = html`<div class="sc-plans" role="list" aria-label="Plans" data-list>
		${listed.map(({ plan, review }, index) => tile(review, plan, runDefects.get(plan.planId) ?? 0, index))}${newChangeTile(
			{ index: reviews.length }
		)}
	</div>`
	return {
		title: 'Plans',
		section: 'home',
		subjects: [
			'inbox',
			...plans.map((plan) => `plan:${plan.planId}`),
			...reviews.flatMap((review) => review.explorations.map((item) => `exploration:${item.explorationId}`)),
		],
		crumbs: [['Plans', null]],
		back: null,
		body: html`<div data-region="home">
			${heading({ title: 'Plans', sub: plans.length ? subtitle : null, extra: boardKey })} ${body}
		</div>`,
	}
}
