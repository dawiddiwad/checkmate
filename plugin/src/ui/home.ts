import type { Store } from '../store.ts'
import type { Page } from './layout.ts'
import type { Review } from './review.ts'
import type { CellStatus } from '../rulemap.ts'
import type { PlanListRow } from '../views.ts'
import { findingList, planList } from '../views.ts'
import { costText, duration, glyph, html, pill, plural, time, words } from './html.ts'
import { heading } from './layout.ts'
import { buildLabel, outside, reviewHref, reviewOf, verdictLine } from './review.ts'

const maxColumns = 9
const marks: Record<CellStatus, [string, string]> = {
	failed: ['✗', 'k-fail'],
	question: ['?', 'k-q'],
	passed: ['✓', 'k-pass'],
	not_checked: ['', 'k-none'],
}

function columns(review: Review) {
	const rules = review.map.rows.filter((row) => row.rule.id !== outside)
	const out = review.map.rows.find((row) => row.rule.id === outside)!
	const own =
		rules.length <= maxColumns
			? rules.map((row) => ({
					label: row.rule.id,
					title: row.rule.text,
					cells: row.cells.map((cell) => cell.status),
				}))
			: review.areas.map((area) => ({ label: area.label.slice(0, 2), title: area.label, cells: area.cells }))
	return [...own, { label: 'Out', title: 'Outside the rules', cells: out.cells.map((cell) => cell.status) }]
}

function miniMap(review: Review) {
	const builds = review.map.builds.slice(-2)
	if (!builds.length) return html`<span></span>`
	const from = review.map.builds.length - builds.length
	const cols = columns(review)
	return html`<div
		class="sp-mm"
		data-builds="${builds.length}"
		role="img"
		aria-label="Rules against the last ${plural(builds.length, 'build')}"
	>
		<span></span
		>${builds.map((build) => html`<span class="sp-mm-b" title="${build.build}">${buildLabel(review, build.build)}</span>`)}
		${cols.map(
			(col) =>
				html`<span class="sp-mm-l" title="${col.title}">${col.label}</span>${builds.map((_, index) => {
						const [symbol, look] = marks[col.cells[from + index]]
						return html`<span class="sp-mk ${look}">${glyph(symbol)}</span>`
					})}`
		)}
	</div>`
}

function nextStep(review: Review) {
	const verdict = verdictLine(review)
	const href = (view: string) => reviewHref(review.planId, view, '&focus=list')
	if (verdict.blocking)
		return [`Answer ${plural(verdict.blocking, 'blocking question')}`, href('needs'), true] as const
	if (verdict.findings) return [`Look at ${plural(verdict.findings, 'finding')}`, href('needs'), false] as const
	if (verdict.open) return [`Answer ${plural(verdict.open, 'question')}`, href('needs'), false] as const
	if (review.items.some((item) => item.needs)) return ['Decide what waits', href('needs'), false] as const
	if (review.running) return ['Watch the testers', `/explorations/${review.running.explorationId}`, false] as const
	return ['Open the plan', href('all'), false] as const
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
	const [label, href, blocks] = nextStep(review)
	const last = review.explorations.at(-1)
	const ended = !review.running && last && ['stopped', 'interrupted'].includes(last.state) ? last : null
	const nums: Array<[number, string, boolean]> = [
		[verdict.blocking, 'block testing', verdict.blocking > 0],
		[verdict.findings, 'to look at', false],
		[verdict.defects + runDefects, 'defects', false],
	]
	return html`<div
		class="sp-ct"
		role="listitem"
		tabindex="-1"
		id="plan-${index}"
		data-row
		data-key="plan:${review.planId}"
		data-href="${reviewHref(review.planId, 'needs')}"
		data-label="${review.planId}"
	>
		<div class="sp-ct-main">
			<div class="sp-ct-head">
				<span class="sp-c-id">${review.planId}</span>
				${
					review.running
						? html`<span class="sp-pill run"><span class="dot" aria-hidden="true"></span>Testing</span>`
						: ended
							? pill(ended.state)
							: loop
								? pill(loop.state)
								: ''
				}
				<span
					class="sp-ct-when ell"
					title="${latest ? `${latest.build}, first tested ${latest.firstTestedAt}` : review.target}"
					>${
						review.running
							? html`${review.phase ?? words(review.running.state)} ·
									<span data-since="${review.running.startedAt}"
										>${duration(Date.now() - Date.parse(review.running.startedAt))}</span
									>`
							: latest
								? html`${buildLabel(review, latest.build)} ${latest.build} ·
									${time(latest.firstTestedAt)}`
								: review.target
					}${loop && !review.running ? ` · waits on ${roleWords[loop.waitsOn]}` : ''}</span
				>
			</div>
			<h2 class="sp-ct-title ell" title="${review.objective}">${review.objective}</h2>
			<p class="sp-ct-verdict"><b>${verdict.head}</b> ${verdict.tail}</p>
			${
				costUsd === null
					? ''
					: html`<p
							class="sp-ct-cost"
							title="Reported cost across this plan’s explorations, chats, and structured runs"
						>
							Total cost ${costText(costUsd, costPartial)}
						</p>`
			}
		</div>
		${miniMap(review)}
		<div class="sp-nums">
			${nums.map(
				([value, name, hot]) =>
					html`<div><b class="${hot ? 'att' : value ? '' : 'zero'}">${value}</b><span>${name}</span></div>`
			)}
		</div>
		<div class="sp-ct-opts">
			<a class="sp-btn${blocks ? ' you' : ''}" href="${href}" data-option><kbd>1</kbd><span>${label}</span></a>
		</div>
	</div>`
}

function newChangeRow(index: number) {
	return html`<div
		class="sp-ct sp-ct-new"
		role="listitem"
		tabindex="-1"
		id="plan-${index}"
		data-row
		data-key="new:change"
		data-href="/new"
		data-label="New change"
	>
		<div class="sp-ct-main">
			<h2 class="sp-ct-title ell">New change</h2>
			<p class="sp-ct-verdict">Give a ticket. Checkmate makes a plan and starts the first test.</p>
		</div>
		<div class="sp-ct-opts">
			<a class="sp-btn" href="/new" data-option><kbd>1</kbd><span>New change</span></a>
		</div>
	</div>`
}

const legend = html`<ul class="sp-legend" aria-label="Board key">
	<li><span class="sp-mk k-pass" aria-hidden="true"></span>passed</li>
	<li><span class="sp-mk k-fail" aria-hidden="true">${glyph('✗')}</span>failed</li>
	<li><span class="sp-mk k-run" aria-hidden="true"></span>running</li>
	<li><span class="sp-mk k-q" aria-hidden="true">?</span>needs you</li>
	<li><span class="sp-mk k-none" aria-hidden="true"></span>not run</li>
</ul>`

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
					<span class="att"
						>${plural(blocking, 'question')} ${blocking === 1 ? 'blocks' : 'block'} testing</span
					>`
			: ''
	}`
	const body = html`<div class="sp-home" role="list" aria-label="Plans" data-list>
		${listed.map(({ plan, review }, index) => tile(review, plan, runDefects.get(plan.planId) ?? 0, index))}${newChangeRow(
			reviews.length
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
		body: html`<div data-region="home">${heading('Plans', plans.length ? subtitle : null, legend)} ${body}</div>`,
	}
}
