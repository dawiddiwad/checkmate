import type { Store } from '../store.ts'
import type { Page } from './layout.ts'
import type { Review } from './review.ts'
import type { CellStatus } from '../rulemap.ts'
import { planList } from '../views.ts'
import { html, pill, plural, time } from './html.ts'
import { emptyNotice, heading } from './layout.ts'
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
						return html`<span class="sp-mk ${look}">${symbol}</span>`
					})}`
		)}
	</div>`
}

function nextStep(review: Review) {
	const verdict = verdictLine(review)
	const href = (view: string) => reviewHref(review.planId, view, '&focus=list')
	if (verdict.blocking) return [`Answer ${plural(verdict.blocking, 'blocking question')}`, href('needs')]
	if (verdict.findings) return [`Look at ${plural(verdict.findings, 'finding')}`, href('needs')]
	if (verdict.open) return [`Answer ${plural(verdict.open, 'question')}`, href('needs')]
	if (review.items.some((item) => item.needs)) return ['Decide what waits', href('needs')]
	if (review.running) return ['Watch the testers', `/explorations/${review.running.explorationId}`]
	return ['Open the plan', href('all')]
}

const roleWords: Record<string, string> = {
	planner: 'the planner',
	oracle: 'oracle',
	qa: 'QA',
	factory: 'the factory',
	none: 'nobody',
}

function tile(review: Review, loop: { state: string; waitsOn: string } | undefined, index: number) {
	const verdict = verdictLine(review)
	const handed = review.items.filter((item) => item.kind === 'defect' && item.claim?.handoff).length
	const latest = review.map.builds.at(-1)
	const [label, href] = nextStep(review)
	const nums: Array<[number, string, boolean]> = [
		[verdict.defects, 'defects', false],
		[verdict.findings, 'to look at', verdict.findings > 0],
		[verdict.open, 'questions', verdict.blocking > 0],
		[handed, 'handed over', false],
	]
	return html`<div
		class="sp-ct"
		role="option"
		aria-selected="false"
		tabindex="-1"
		id="plan-${index}"
		data-row
		data-key="plan:${review.planId}"
		data-href="${reviewHref(review.planId, 'needs')}"
		data-label="${review.planId}"
		aria-labelledby="plan-${index}-title"
	>
		<div class="sp-ct-main">
			<div class="sp-ct-head">
				<span class="sp-c-id">${review.planId}</span>
				${
					review.running
						? html`<span class="sp-pill blue"><span class="dot" aria-hidden="true"></span>Testing</span>`
						: loop
							? pill(loop.state)
							: ''
				}
				<span class="sp-ct-when ell"
					>${
						latest
							? html`${buildLabel(review, latest.build)} ${latest.build} · ${time(latest.firstTestedAt)}`
							: review.target
					}${loop ? ` · waits on ${roleWords[loop.waitsOn]}` : ''}</span
				>
			</div>
			<h2 class="sp-ct-title ell" id="plan-${index}-title" title="${review.objective}">${review.objective}</h2>
			<p class="sp-ct-verdict"><b>${verdict.head}</b> ${verdict.tail}</p>
		</div>
		${miniMap(review)}
		<div class="sp-nums">
			${nums.map(
				([value, name, hot]) => html`<div><b class="${hot ? 'att' : ''}">${value}</b><span>${name}</span></div>`
			)}
		</div>
		<div class="sp-ct-opts">
			<a class="sp-btn" href="${href}" data-option><kbd>1</kbd><span>${label}</span></a>
		</div>
	</div>`
}

export function homePage(store: Store): Page {
	const plans = planList(store)
	const reviews = plans.map((plan) => reviewOf(store, plan.planId))
	const blocking = reviews.reduce((sum, review) => sum + verdictLine(review).blocking, 0)
	const body = plans.length
		? html`<div class="sp-home" role="listbox" aria-label="Plans" data-list>
				${reviews.map((review, index) => tile(review, plans[index].loop, index))}
			</div>`
		: emptyNotice(
				'No plan yet.',
				html`Ask Claude Code to test a change, for example <code>/checkmate:test the change in ticket.md</code>.
					Each plan shows here with what waits for you.`
			)
	return {
		title: 'Plans',
		section: 'home',
		subjects: ['inbox', ...plans.map((plan) => `plan:${plan.planId}`)],
		crumbs: [['Plans', null]],
		back: null,
		body: html`<div data-region="home">
			${heading(
				'Plans',
				plans.length
					? `${plural(plans.length, 'plan')}. ${plural(blocking, 'question')} ${blocking === 1 ? 'blocks' : 'block'} testing. Each tile shows the rules of the plan against its last builds.`
					: null
			)}
			${body}
		</div>`,
	}
}
