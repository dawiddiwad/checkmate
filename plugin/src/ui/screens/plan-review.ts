import type { Rule } from '../review.ts'
import type { Store } from '../../store.ts'
import type { CellStatus } from '../../rulemap.ts'
import { planCost } from '../../costs.ts'
import { defaultBuild } from '../../modes.ts'
import type { Context, Page } from '../layout.ts'
import type { Item, Review } from '../review.ts'
import type { Refusal } from './item.ts'
import {
	actionButton,
	copyDialog,
	followDialog,
	instanceChoice,
	ruleDialog,
	storeButton,
	storeDialog,
	testButton,
	testDialog,
} from '../actions.ts'
import { blockingBanner } from '../components/banner.ts'
import { bulkBar } from '../components/bulk-bar.ts'
import { button } from '../components/button.ts'
import { emptyLine } from '../components/empty-state.ts'
import { groupHeader, listRow, optionsBox } from '../components/list-row.ts'
import { crumbBar } from '../components/page-heading.ts'
import { wordMark } from '../components/status-mark.ts'
import { keptText, messages } from '../forms.ts'
import { asList, costText, html, plural } from '../html.ts'
import {
	buildLabel,
	itemRow,
	itemsOf,
	navigator,
	openedHref,
	outside,
	reviewHref,
	reviewOf,
	severityOrder,
	slug,
	verdictLine,
	viewTitle,
	viewsOf,
} from '../review.ts'
import { evidenceViewer, recordDrawer } from './item.ts'

const blockingLabel = 'Questions that block testing'

type Group = { label: string; items: Item[] }

function groupsOf(items: Item[]): Group[] {
	const of = (label: string, chosen: Item[]) => ({ label, items: chosen })
	const open = (item: Item) => item.kind === 'question' || item.kind === 'gap'
	const topics = [...new Set(items.filter((item) => open(item) && !item.blocking).map((item) => item.topic))]
	const bySeverity = (a: Item, b: Item) =>
		severityOrder.indexOf(a.severity ?? '') - severityOrder.indexOf(b.severity ?? '')
	return [
		of(
			'Permission requests',
			items.filter((item) => item.kind === 'permission')
		),
		of(
			blockingLabel,
			items.filter((item) => open(item) && item.blocking)
		),
		of('Is this a defect?', items.filter((item) => item.kind === 'finding').sort(bySeverity)),
		of(
			'Approvals',
			items.filter((item) => item.kind === 'approval')
		),
		...topics
			.sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
			.map((topic) =>
				of(
					topic ? `Questions · ${topic}` : 'Questions',
					items.filter((item) => open(item) && !item.blocking && item.topic === topic)
				)
			),
		...severityOrder.map((severity) =>
			of(
				`${severity} defects`,
				items.filter((item) => item.kind === 'defect' && item.severity === severity)
			)
		),
		of(
			'Answered questions',
			items.filter((item) => item.kind === 'answered')
		),
		of(
			'Deferred questions',
			items.filter((item) => item.kind === 'deferred')
		),
		of(
			'Rejected findings',
			items.filter((item) => item.kind === 'rejected')
		),
	].filter((group) => group.items.length)
}

function ruleGroups(review: Review, view: string, items: Item[]): Group[] {
	const area = review.areas.find((each) => each.label === view.slice(5))
	if (!area) return []
	return area.rules.flatMap((id) => {
		const own = items.filter((item) => item.rule === id)
		const text = review.map.rows.find((row) => row.rule.id === id)?.rule.text ?? ''
		return own.length ? [{ label: `${id} · ${text}`, items: groupsOf(own).flatMap((group) => group.items) }] : []
	})
}

function listOf(context: Context, review: Review, view: string, groups: Group[], label: string) {
	if (!groups.length) return emptyLine({ text: emptyText(view) })
	let n = 0
	return html`<div class="sp-list" role="list" aria-label="${label}" data-list>
		${groups.map(
			(group) =>
				html`${groupHeader({ label: group.label, count: group.items.length })}
				${group.items.map((item) => itemRow(context, review, item, `row-${slug(view)}-${n++}`, view))}`
		)}
	</div>`
}

function blockingOf(review: Review, groups: Group[], view: string) {
	const blocking = groups.find((group) => group.label === blockingLabel)?.items ?? []
	if (!blocking.length) return ''
	return blockingBanner({ count: blocking.length, href: openedHref(review, blocking[0], view) })
}

function emptyText(view: string) {
	if (view === 'needs') return 'Nothing waits for you in this plan.'
	if (view.startsWith('build:')) return 'No open defect or question was seen on this build.'
	return 'No defect or question here yet.'
}

function canChoose(view: string) {
	return view.startsWith('rule:') || view.startsWith('area:')
}

const cellWords: Record<CellStatus, string> = {
	failed: 'failed',
	question: 'uncertain',
	passed: 'passed',
	not_checked: 'not tested',
}

function viewHead(review: Review, view: string) {
	const verdict = verdictLine(review)
	if (view === 'needs')
		return {
			sub: `${verdict.head} Questions to answer and findings to decide, blocking ones first.`,
			pills: html``,
		}
	if (view === 'all') return { sub: `${verdict.head} ${verdict.tail}`, pills: html`` }
	if (view === 'rules') {
		const origin = review.map.rulesOrigin
		const rows = review.map.rows.filter((row) => row.rule.id !== outside)
		const stored = rows.filter((row) => row.storedTests).length
		const edit =
			origin === 'harvested'
				? `The tester derived these rules from the sources. Edit the rules that have no stored test here, or with checkmate plan edit ${review.planId} --patch. Edit the others in the plan editor.`
				: origin === 'derived' || origin === 'corrected'
					? `The tester derived these rules from the sources${origin === 'corrected' ? ', and they were corrected' : ''}. Edit them here, or with checkmate plan edit ${review.planId} --patch.`
					: origin
						? 'The rules come from the plan. Edit them in the plan editor.'
						: 'This plan has no rules yet.'
		return {
			sub: stored ? `${stored} of ${rows.length} rules have a stored test. ${edit}` : edit,
			pills: html``,
		}
	}
	if (view.startsWith('rule:')) {
		const row = review.map.rows.find((each) => each.rule.id === view.slice(5))
		return {
			sub: row?.rule.text ?? '',
			pills: html`${row?.cells.map((cell) =>
				wordMark({
					state: cellWords[cell.status],
					label: `${buildLabel(review, cell.build)}: ${cellWords[cell.status]}`,
					title: cell.build,
				})
			)}${row?.storedTests ? wordMark({ state: 'stored', label: plural(row.storedTests, 'stored test'), title: storedNote(review, row.rule.id) }) : ''}`,
		}
	}
	if (view.startsWith('area:')) {
		const area = review.areas.find((each) => each.label === view.slice(5))
		return { sub: `${plural(area?.rules.length ?? 0, 'rule')}. The items are grouped by rule.`, pills: html`` }
	}
	if (view.startsWith('build:')) {
		const build = review.map.builds.find((item) => item.build === view.slice(6))
		return { sub: `${build?.build ?? ''}. The defects and questions seen on this build.`, pills: html`` }
	}
	return { sub: '', pills: html`` }
}

function storedNote(review: Review, ruleId: string) {
	return `${ruleId} has a stored test, so it belongs to revision ${review.revision}. Edit it in the plan editor.`
}

function ruleButtons(context: Context, review: Review, rule: Rule, count: number, numbered: boolean) {
	if (review.map.rows.find((row) => row.rule.id === rule.id)?.storedTests)
		return [
			button({
				label: 'Edit in the plan editor',
				href: `/plans/${review.planId}@${review.revision}/edit`,
				keyName: numbered ? 1 : undefined,
				keySpoken: false,
				attrs: {
					'data-option': numbered,
					'aria-label': `${numbered ? '1: ' : ''}Edit ${rule.id} in the plan editor`,
					title: storedNote(review, rule.id),
				},
			}),
		]
	const cited = review.items.filter((item) => item.rule === rule.id).length
	const area = review.areas.find((each) => each.rules.includes(rule.id))?.label ?? ''
	const fill = JSON.stringify({ text: rule.text, area, newArea: '' })
	const ends = cited
		? `${plural(cited, 'item')} ${cited === 1 ? 'cites it. It moves' : 'cite it. They move'} to Outside the rules.`
		: 'No item cites it.'
	return [
		button({
			label: numbered ? 'Edit…' : `Edit ${rule.id}…`,
			keyName: numbered ? 1 : undefined,
			keySpoken: false,
			attrs: {
				type: 'button',
				'data-option': numbered,
				'data-act': 'rule-edit',
				'data-action': `/plans/${review.planId}/rules/${rule.id}`,
				'data-title': `Edit rule ${rule.id}`,
				'data-fill': fill,
				'aria-label': `${numbered ? '1: ' : ''}Edit rule ${rule.id}`,
				title: `Edit the text and the area of ${rule.id}`,
			},
		}),
		html`<form method="post" action="/plans/${review.planId}/rules/${rule.id}/remove" class="sp-opt">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			${button({
				label: numbered ? 'Remove…' : `Remove ${rule.id}…`,
				keyName: numbered ? 2 : undefined,
				keySpoken: false,
				attrs: {
					'data-option': numbered,
					'data-ask-title': `Remove rule ${rule.id}?`,
					'data-ask-text': `${ends} The plan keeps the other ${plural(count - 1, 'rule')}.`,
					'data-ask-yes': `Remove ${rule.id}`,
					'aria-label': `${numbered ? '2: ' : ''}Remove rule ${rule.id}`,
					title: count === 1 ? 'Keep at least one rule.' : `Remove ${rule.id} from the rules of the plan`,
					disabled: count === 1,
				},
			})}
		</form>`,
	]
}

function ruleEditable(review: Review) {
	return ['derived', 'corrected', 'harvested'].includes(review.map.rulesOrigin ?? '')
}

function ruleMeta(row: Review['map']['rows'][number]) {
	const source = row.rule.source ?? ''
	if (!row.storedTests) return source
	return `${plural(row.storedTests, 'stored test')} · ${source}`
}

function rulesList(context: Context, review: Review) {
	const rows = review.map.rows.filter((row) => row.rule.id !== outside)
	if (!rows.length) return emptyLine({ text: 'This plan has no rules yet.' })
	const editable = ruleEditable(review)
	return html`<div class="sp-list wide-title" role="list" aria-label="Rules of the plan" data-list>
		${groupHeader({ label: 'Rules', count: rows.length })}
		${rows.map((row, index) =>
			listRow({
				id: `row-rules-${index}`,
				key: `rule:${row.rule.id}`,
				href: reviewHref(review.planId, `rule:${row.rule.id}`),
				label: row.rule.id,
				tag: wordMark({ state: 'rule', label: 'Rule' }),
				shownId: row.rule.id,
				title: row.rule.text,
				titleText: row.rule.text,
				meta: ruleMeta(row),
				metaText: ruleMeta(row),
				options: editable ? optionsBox(ruleButtons(context, review, row.rule, rows.length, true)) : '',
			})
		)}
	</div>`
}

function panel(context: Context, review: Review, view: string, current: string, cost: string | null) {
	const head = viewHead(review, view)
	const items = itemsOf(review, view)
	const groups = view.startsWith('area:') ? ruleGroups(review, view, items) : groupsOf(items)
	const title = viewTitle(review, view)
	const edit =
		view === 'rules' && review.revision
			? button({ label: 'Edit the rules', href: `/plans/${review.planId}@${review.revision}/edit` })
			: ''
	const add =
		view === 'rules' && ruleEditable(review)
			? actionButton('rule-add', 'Add a rule…', {
					'data-action': `/plans/${review.planId}/rules`,
					'data-title': `Add a rule to ${review.planId}`,
				})
			: ''
	const rule = view.startsWith('rule:') ? review.map.rows.find((row) => row.rule.id === view.slice(5)) : undefined
	const own =
		rule && rule.rule.id !== outside && ruleEditable(review)
			? ruleButtons(context, review, rule.rule, review.map.rows.length - 1, false)
			: ''
	const store =
		(view === 'all' || view === 'rules') && review.storable ? storeButton(review.planId, review.storable, view) : ''
	const tools = html`${edit}${add}${own}${review.running ? '' : testButton(review.planId)}${
		review.answers ? actionButton('follow', `Test the answers (${review.answers.count})…`) : ''
	}${store}`
	return html`<section
		class="sp-panel"
		data-panel="${view}"
		data-title="${title}"
		aria-labelledby="title-${slug(view)}"
		${view === current ? '' : html`hidden`}
	>
		<div class="sp-ch">
			${crumbBar({
				crumbs: [
					[review.planId, `/plans/${review.planId}`],
					[review.target, null],
				],
			})}
			${
				view === current
					? html`<h1 id="title-${slug(view)}" data-view-title>${title}</h1>`
					: html`<h2 id="title-${slug(view)}" data-view-title>${title}</h2>`
			}
			${head.sub ? html`<p class="sp-sub">${head.sub}</p>` : ''}
			<div class="sp-pills">${head.pills}</div>
			${
				cost === null
					? ''
					: html`<p
							class="sp-sub"
							title="Reported cost across this plan’s explorations, chats, and structured runs"
						>
							Total cost ${cost}
						</p>`
			}
			${canChoose(view) ? html`<p class="sp-sub att" data-build-note></p>` : ''}
		</div>
		<div class="sp-tools" data-actions>${tools}</div>
		${view === 'needs' ? blockingOf(review, groups, view) : ''}
		${view === 'rules' ? rulesList(context, review) : listOf(context, review, view, groups, title)}
	</section>`
}

export function reviewPage(
	store: Store,
	context: Context,
	planId: string,
	params: URLSearchParams,
	refusal: Refusal | null = null,
	notice: string | null = null
): Page {
	const review = reviewOf(store, planId, context.harness)
	const views = viewsOf(review)
	const asked = params.get('view') ?? 'needs'
	const current = views.includes(asked) ? asked : 'needs'
	const chatting = params.has('chat') || params.get('newChat') === '1'
	const title = viewTitle(review, current)
	const key = refusal?.key ?? params.get('item')
	const item =
		key && !(refusal?.subject && refusal.state.stale)
			? (review.items.find((each) => each.key === key && each.kind !== 'permission') ?? null)
			: null
	const refusedAnswer =
		refusal?.subject && !item
			? html`<section aria-labelledby="refused-answer">
					<h2 id="refused-answer">Answer for ${refusal.subject}</h2>
					${messages(refusal.state)}${keptText(refusal.state)}
				</section>`
			: ''
	const file = params.get('file')
	const record = item
		? file !== null && /^[0-9]{1,3}$/.test(file) && item.claim
			? evidenceViewer(store, review, item, current, Number(file))
			: recordDrawer(store, context, review, item, current, refusal)
		: ''
	const cost = planCost(store, planId)
	const panels = views.map((view) =>
		panel(context, review, view, current, cost.costUsd === null ? null : costText(cost.costUsd, cost.costPartial))
	)
	return {
		title: `${item ? `${item.id} · ` : ''}${title} · ${planId}`,
		section: 'home',
		subjects: [
			`plan:${planId}`,
			'inbox',
			...review.explorations.map((each) => `exploration:${each.explorationId}`),
		],
		status: refusal || notice ? 422 : 200,
		crumbs: [
			['Plans', '/'],
			[planId, `/plans/${planId}`],
			[title, item ? reviewHref(planId, current) : null],
			...(item ? [[item.id, null] as [string, null]] : []),
		],
		back: item
			? reviewHref(planId, current, `&at=${encodeURIComponent(item.key)}&focus=list`)
			: `/?at=${encodeURIComponent(`plan:${planId}`)}`,
		drawer: Boolean(item),
		nav: navigator(review, current, null, { href: reviewHref(planId, current, '&chat=list'), active: chatting }),
		body: html`${notice ? html`<p class="form-error" role="alert" data-notice>${notice}</p>` : ''}${refusedAnswer}
			<div
				class="sp-review"
				data-review
				data-plan="${planId}"
				data-qa-status="${JSON.stringify(review.qa)}"
				data-region="review"
				${item ? html`data-open="${item.key}"` : ''}
			>
				${panels}
			</div>
			${record}
			<div data-region="plan-actions">
				${review.running ? '' : testDialog(context, planId, { build: '', level: 'normal', since: '', until: '', repo: '' }, defaultBuild(store.workspace), asList(instanceChoice(store, planId)))}
				${review.answers ? followDialog(context, planId, { ...review.answers, planId }, review.answers.count) : ''}
				${
					ruleEditable(review)
						? html`${ruleDialog(
								'edit',
								context,
								planId,
								review.areas.map((area) => area.label)
							)}${ruleDialog(
								'add',
								context,
								planId,
								review.areas.map((area) => area.label)
							)}`
						: ''
				}
				${review.storable ? storeDialog(context, planId, review.storable, review.approvalRequired) : ''}
				${review.items.some((item) => item.kind === 'defect') ? copyDialog() : ''}
			</div>
			${bulkBar({ planId, csrf: context.csrf })}`,
	}
}
