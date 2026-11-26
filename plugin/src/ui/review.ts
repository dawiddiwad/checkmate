import type { Store } from '../store.ts'
import type { CellStatus, ClaimBuildState } from '../rulemap.ts'
import { claimDetails, ruleMap } from '../rulemap.ts'
import type { Permission } from '../permissions.ts'
import { openPermissions } from '../permissions.ts'
import { planRequest } from '../plans.ts'
import { approvalPolicy } from '../contracts.ts'
import { storableDefects } from '../harvest.ts'
import { oracleStates } from '../journal.ts'
import {
	mergedClaims,
	mergedQuestions,
	needsYou,
	planDetail,
	planExplorations,
	planHasRevision,
	planStatus,
} from '../views.ts'
import { explorationEvents } from '../explorations.ts'
import type { BoardCell } from './components/board.ts'
import type { Html } from './html.ts'
import type { Context } from './layout.ts'
import { phaseOf } from './activity.ts'
import { button, optionButton } from './components/button.ts'
import { listRow, optionsBox } from './components/list-row.ts'
import { navRail, railBuilds, railCells, railCount, railRow } from './components/nav-rail.ts'
import { wordMark } from './components/status-mark.ts'
import { age, glyph, html, plural, words } from './html.ts'
import { askBadge, askTitle, requestHref, requestName, rowOptions, waitsFor } from './permissions.ts'

type Map = ReturnType<typeof ruleMap>
export type Rule = Map['rows'][number]['rule']
type ClaimRow = ReturnType<typeof mergedClaims>[number]
type Detail = ReturnType<typeof claimDetails>[number]
type QuestionRow = ReturnType<typeof mergedQuestions>[number]
type Waiting = ReturnType<typeof needsYou>['items'][number]

export type Kind =
	'permission' | 'finding' | 'defect' | 'rejected' | 'question' | 'answered' | 'deferred' | 'gap' | 'approval'

export type Item = {
	key: string
	kind: Kind
	id: string
	title: string
	rule: string | null
	builds: string[]
	needs: boolean
	blocking: boolean
	severity: string | null
	topic: string | null
	href: string
	meta: string
	claim: ClaimRow | null
	detail: Detail | null
	question: QuestionRow | null
	waiting: Waiting | null
	permission: Permission | null
}

export type Area = { label: string; rules: string[]; cells: CellStatus[] }

export type Review = ReturnType<typeof reviewOf>

export const severityOrder = ['critical', 'high', 'medium', 'low']
const shownBuilds = 3

export const outside = 'outside'

export function areasOf(map: Map): Area[] {
	return map.areas.map((area) => ({
		label: area.label,
		rules: area.ruleIds,
		cells: area.cells.map((cell) => cell.status),
	}))
}

const stateWords: Record<ClaimBuildState, string> = {
	new: 'New',
	still_present: 'Still present',
	fixed: 'Fixed',
	returned: 'Returned',
	disputed: 'Disputed',
	not_retested: 'Not retested',
}

export function latestClaimBuild(detail: Detail | null) {
	return detail?.builds.findLast((on) => on.state !== 'not_retested') ?? detail?.builds.at(-1) ?? null
}

function claimItem(planId: string, claim: ClaimRow, detail: Detail | null, needs: boolean): Item {
	const kind: Kind =
		claim.state === 'rejected' ? 'rejected' : oracleStates.includes(claim.state) ? 'finding' : 'defect'
	const latest = latestClaimBuild(detail)
	const meta =
		kind === 'finding'
			? `${claim.severity} · ${words(claim.state)}`
			: kind === 'rejected'
				? `rejected by ${claim.decision?.actor ?? 'someone'}`
				: [
						latest ? stateWords[latest.state] : null,
						claim.handoff ? `handed over to ${claim.handoff.to}` : null,
						`×${claim.reporters}`,
					]
						.filter(Boolean)
						.join(' · ')
	const builds =
		detail?.builds.filter((on) => ['new', 'still_present', 'returned', 'disputed'].includes(on.state)) ?? []
	return {
		key: `c:${claim.id}`,
		kind,
		id: claim.id,
		title: claim.title,
		rule: claim.rule ?? null,
		builds: builds.map((on) => on.build),
		needs,
		blocking: false,
		severity: claim.severity,
		topic: null,
		href: `/explorations/${claim.explorationId}/claims/${claim.id}`,
		meta,
		claim,
		detail,
		question: null,
		waiting: null,
		permission: null,
	}
}

function questionItem(question: QuestionRow, needs: boolean): Item {
	const open = question.answer === null
	return {
		key: `q:${question.id}`,
		kind: open ? 'question' : question.decision === 'defer' ? 'deferred' : 'answered',
		id: question.id,
		title: question.question,
		rule: question.rule ?? null,
		builds: question.builds,
		needs,
		blocking: open && question.blocking,
		severity: null,
		topic: question.label,
		href: `/explorations/${question.explorationId}/questions/${question.id}`,
		meta: [
			open ? 'open' : question.decision === 'defer' ? 'deferred' : 'answered',
			question.members.length > 1 ? `×${question.members.length}` : null,
		]
			.filter(Boolean)
			.join(' · '),
		claim: null,
		detail: null,
		question,
		waiting: null,
		permission: null,
	}
}

function waitingItem(planId: string, waiting: Waiting): Item {
	if (waiting.kind === 'gap')
		return {
			key: `g:${waiting.id}`,
			kind: 'gap',
			id: waiting.id,
			title: waiting.title,
			rule: null,
			builds: [],
			needs: true,
			blocking: waiting.group === 'blocking',
			severity: null,
			topic: null,
			href: `/plans/${planId}@${waiting.revision}/gaps/${waiting.id}`,
			meta: waiting.runId ? `run gap · ${waiting.runId}` : 'plan gap',
			claim: null,
			detail: null,
			question: null,
			waiting,
			permission: null,
		}
	const plan = waiting.kind === 'plan'
	return {
		key: plan ? `p:${waiting.id}` : `r:${waiting.id}`,
		kind: 'approval',
		id: waiting.id,
		title: plan ? `Approve ${waiting.id}: ${waiting.title}` : waiting.title,
		rule: null,
		builds: [],
		needs: true,
		blocking: false,
		severity: null,
		topic: null,
		href: plan ? `/plans/${waiting.id}` : `/runs/${waiting.id}`,
		meta: plan ? `plan · ${waiting.state ?? 'pending'}` : 'run result',
		claim: null,
		detail: null,
		question: null,
		waiting,
		permission: null,
	}
}

function permissionItem(item: Permission): Item {
	return {
		key: `perm:${requestName(item)}`,
		kind: 'permission',
		id: requestName(item),
		title: askTitle(item),
		rule: null,
		builds: [],
		needs: true,
		blocking: false,
		severity: null,
		topic: null,
		href: requestHref(item, null),
		meta: '',
		claim: null,
		detail: null,
		question: null,
		waiting: null,
		permission: item,
	}
}

export function reviewOf(store: Store, planId: string, harness?: Context['harness']) {
	const map = ruleMap(store, planId)
	const details = new Map(claimDetails(store, planId).map((detail) => [detail.id, detail]))
	const waiting = needsYou(store).items.filter((item) => item.planId === planId)
	const waits = new Set(waiting.map((item) => `${item.kind}:${item.id}`))
	const claims = mergedClaims(store, planId).map((claim) =>
		claimItem(planId, claim, details.get(claim.id) ?? null, waits.has(`claim:${claim.id}`))
	)
	const questions = mergedQuestions(store, planId).map((question) =>
		questionItem(question, waits.has(`question:${question.id}`))
	)
	const others = waiting.filter((item) => ['gap', 'plan', 'result'].includes(item.kind))
	const known = new Set(map.rows.map((row) => row.rule.id))
	const items = [
		...openPermissions(store, planId).map(permissionItem),
		...claims,
		...questions,
		...others.map((item) => waitingItem(planId, item)),
	].map((item) => (item.rule !== null && !known.has(item.rule) ? { ...item, rule: outside } : item))
	const { request, target } = planRequest(store, planId)
	const explorations = planExplorations(store, planId)
	const latest = planHasRevision(store, planId) ? planDetail(store, planId) : null
	const running = explorations.find((item) => item.running) ?? null
	const qa = planStatus(store, planId, harness).qa
	const answers = qa.follow.find((item) => item.available) ?? null
	return {
		phase: running ? phaseOf(explorationEvents(store, running.explorationId), running.state) : null,
		answers,
		qa,
		planId,
		objective: request.objective,
		target: `${target.profile.targetId}@${target.revision}`,
		revision: latest?.latestRevision ?? null,
		sha: latest?.sha256 ?? '',
		latestFinalizedRun: latest?.runs.findLast((run) => run.state === 'finalized') ?? null,
		map,
		areas: areasOf(map),
		items,
		explorations,
		running,
		storable: storableDefects(store, planId).reduce((sum, item) => sum + item.claims.length, 0),
		approvalRequired: approvalPolicy(target.profile).plan === 'required',
	}
}

export function buildLabel(review: Review, build: string) {
	return `B${review.map.builds.findIndex((item) => item.build === build) + 1}`
}

export function itemsOf(review: Review, view: string) {
	const items = review.items.filter((item) => item.kind !== 'permission' || view === 'needs')
	if (view === 'needs') return items.filter((item) => item.needs)
	if (view === 'all') return items
	if (view.startsWith('rule:')) {
		const id = view.slice(5)
		return items.filter((item) => (id === outside ? item.rule === outside || item.rule === null : item.rule === id))
	}
	if (view.startsWith('area:')) {
		const area = review.areas.find((each) => each.label === view.slice(5))
		return items.filter((item) => item.rule !== null && area?.rules.includes(item.rule))
	}
	if (view.startsWith('build:')) return items.filter((item) => item.builds.includes(view.slice(6)))
	return []
}

const tags: Record<string, string> = {
	finding: 'Finding',
	question: 'Question',
	answered: 'Answered',
	deferred: 'Deferred',
	gap: 'Gap',
	approval: 'Approve',
	rejected: 'Rejected',
	critical: 'Critical',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
}

export function itemTag(item: Item) {
	if (item.permission) return askBadge()
	if (item.blocking) return wordMark({ state: 'blocks', label: 'Blocks' })
	const state = item.kind === 'defect' ? (item.severity ?? 'low') : item.kind
	return tags[state] ? wordMark({ state, label: tags[state] }) : wordMark({ state: 'low', label: tags.low })
}

export type Option = { label: string; control: Html }

function hiddenFields(context: Context, item: Item, extra: Array<[string, string]> = []) {
	return html`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="return" value="${context.path}" data-return />
		<input type="hidden" name="item" value="${item.key}" />
		${extra.map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}`
}

function action(item: Item) {
	if (item.claim) return `/explorations/${item.claim.explorationId}/claims/${item.claim.id}`
	if (item.question) return `/explorations/${item.question.explorationId}/questions/${item.question.id}`
	return item.href
}

function optionForm(
	context: Context,
	item: Item,
	n: number,
	label: string,
	fields: Array<[string, string]>,
	name = label
) {
	return html`<form method="post" action="${action(item)}" class="sc-opt-form">
		${hiddenFields(context, item, fields)}${optionButton({ n, label, name })}
	</form>`
}

function reveal(n: number, label: string, field: string, item: Item, name = label) {
	return optionButton({ n, label, name, href: `${item.href}#${field}`, attrs: { 'data-reveal': field } })
}

export function rightAsBuilt(question: { actual: string | null }) {
	return question.actual ? `Right as built: ${question.actual}` : 'Right as built.'
}

export function optionsOf(context: Context, review: Review, item: Item): Html[] {
	if (item.kind === 'finding')
		return [
			optionForm(context, item, 1, 'Yes, a defect', [['verdict', 'approved']], 'Yes, accept as a defect'),
			reveal(2, 'No', 'reject', item, 'No, reject the finding'),
		]
	if (item.kind === 'defect')
		return [
			item.claim?.handoff
				? html`<form method="post" action="/plans/${review.planId}/handoff" class="sc-opt-form">
						${hiddenFields(context, item, [
							['claim', item.id],
							['undo', '1'],
						])}${optionButton({ n: 1, label: 'Undo hand-over', name: 'Undo the hand-over' })}
					</form>`
				: reveal(1, 'Hand over', 'handoff', item, 'Mark as handed over'),
			button({
				label: 'Copy for the developer',
				keyName: 2,
				keySpoken: false,
				attrs: {
					type: 'button',
					'data-option': true,
					'data-copy': item.id,
					'aria-label': '2: Copy for the developer',
					title: 'Copy the defect as text for the developer',
				},
			}),
		]
	if (item.kind === 'question' || item.kind === 'gap' || item.kind === 'deferred') {
		const fields: Array<[string, string]> = item.kind === 'gap' ? [['sha', review.sha]] : []
		const later = optionForm(context, item, 3, 'Later', [...fields, ['kind', 'defer']], 'Decide later')
		return [
			optionForm(
				context,
				item,
				1,
				'Right',
				[
					...fields,
					['kind', 'accept_assumption'],
					['value', rightAsBuilt({ actual: item.question?.actual ?? null })],
				],
				'Right as built'
			),
			reveal(2, 'Different', 'answer', item, 'It should be different'),
			...(item.kind === 'deferred' ? [] : [later]),
		]
	}
	return []
}

export function extraOf(context: Context, review: Review, item: Item) {
	const form = (field: string, label: string, name: string, fields: Array<[string, string]>, url = action(item)) =>
		html`<div class="sc-c-extra" data-extra="${field}" hidden>
			<form method="post" action="${url}" class="sc-form" data-field-form>
				${hiddenFields(context, item, fields)} ${item.kind === 'gap' ? html`<div data-stale-slot></div>` : ''}
				<label for="${field}-${item.key}">${label}</label>
				<textarea id="${field}-${item.key}" name="${name}" rows="2" required></textarea>
				<div class="sc-row-btns">
					${button({ label: 'Send', emphasis: 'primary' })}
					<span class="sc-note">Enter sends. Shift+Enter starts a new line. Esc keeps the draft.</span>
				</div>
			</form>
		</div>`
	if (item.kind === 'finding')
		return form('reject', 'Why is it not a defect?', 'rationale', [['verdict', 'rejected']])
	if (item.kind === 'defect' && !item.claim?.handoff)
		return form('handoff', 'Hand over to whom?', 'to', [['claim', item.id]], `/plans/${review.planId}/handoff`)
	if (item.kind === 'question' || item.kind === 'gap' || item.kind === 'deferred')
		return form('answer', 'How it should be, in one sentence', 'value', [
			...(item.kind === 'gap' ? [['sha', review.sha] as [string, string]] : []),
			['kind', 'clarify'],
		])
	return ''
}

export function openedHref(review: Review, item: Item, view: string) {
	if (item.permission)
		return requestHref(
			item.permission,
			reviewHref(review.planId, view, `&at=${encodeURIComponent(item.key)}&focus=list`)
		)
	return reviewHref(review.planId, view, `&item=${encodeURIComponent(item.key)}`)
}

export function itemRow(context: Context, review: Review, item: Item, id: string, view: string) {
	const asked = item.permission
	const pickable = ['finding', 'question', 'gap', 'defect', 'permission'].includes(item.kind)
	const dim = ['answered', 'deferred', 'rejected'].includes(item.kind)
	const list = reviewHref(review.planId, view, `&at=${encodeURIComponent(item.key)}&focus=list`)
	const opened = openedHref(review, item, view)
	const listed = optionsOf(context, review, item)
	const options = asked ? rowOptions(context, asked, list) : listed.length ? optionsBox(listed) : ''
	const extra = extraOf(context, review, item)
	return listRow({
		id,
		key: item.key,
		href: opened,
		label: item.id,
		settled: dim,
		blocking: item.blocking,
		attrs: {
			'data-builds': JSON.stringify(item.builds),
			'data-needs': item.needs,
			'data-pick': pickable ? pickKey(review, item) : null,
		},
		pickLabel: pickable ? item.id : undefined,
		tag: itemTag(item),
		shownId: item.id,
		idTitle: item.id,
		title: item.title,
		titleText: item.title,
		titleHref: opened,
		meta: asked ? waitsFor(asked) : item.meta,
		metaText: asked ? undefined : item.meta,
		options,
		extra,
	})
}

export function pickKey(review: Review, item: Item) {
	if (item.kind === 'permission') return `permission:${review.planId}:${item.id}`
	if (item.kind === 'finding') return `claim:${review.planId}:${item.id}`
	if (item.kind === 'gap') return `gap:${review.planId}:${item.id}`
	if (item.kind === 'defect') return `defect:${review.planId}:${item.id}`
	return `question:${review.planId}:${item.id}`
}

export function slug(view: string) {
	return view.replace(/[^A-Za-z0-9-]/g, '-')
}

const cellNames: Record<CellStatus, string> = {
	failed: 'wrong',
	question: 'uncertain',
	passed: 'ok',
	not_checked: 'not tested',
}

function cellOf(review: Review, status: CellStatus, build: string): BoardCell {
	const testing = review.running?.build === build && status === 'not_checked'
	return {
		state: testing ? 'running' : status,
		label: `${buildLabel(review, build)} ${testing ? 'under test now' : cellNames[status]}`,
		build,
		buildLabel: buildLabel(review, build),
	}
}

function shown(review: Review) {
	return review.map.builds.slice(-shownBuilds)
}

function marks(review: Review, cells: CellStatus[]) {
	const builds = review.map.builds
	const from = Math.max(0, builds.length - shownBuilds)
	return railCells({
		cells: cells.slice(from).map((status, index) => cellOf(review, status, builds[from + index].build)),
	})
}

export function ruleBoard(review: Review) {
	const builds = shown(review)
	const from = review.map.builds.length - builds.length
	return {
		builds: builds.map((item) => buildLabel(review, item.build)),
		rows: review.map.rows.map((row) => ({
			id: row.rule.id,
			text: row.rule.id === outside ? 'Outside the rules' : row.rule.text,
			storedTests: row.storedTests,
			cells: row.cells.slice(from).map((cell, index) => cellOf(review, cell.status, builds[index].build)),
		})),
	}
}

function navRow(
	review: Review,
	current: string,
	view: string,
	href: string,
	id: string | Html,
	text: string,
	end: Html,
	extra: { level?: number; area?: string; expanded?: boolean; look?: 'link' | 'area' | 'rule'; hidden?: boolean } = {}
) {
	return railRow({
		target: view,
		href,
		id,
		text,
		end,
		current: view === current,
		focusable: view === 'chats',
		kind: extra.look,
		level: extra.level,
		area: extra.area,
		expanded: extra.expanded,
		hidden: extra.hidden,
	})
}

function count(value: number, hot = false) {
	return railCount({ value, waitsOnYou: hot })
}

export function reviewHref(planId: string, view: string, extra = '') {
	return `/plans/${planId}?view=${encodeURIComponent(view)}${extra}`
}

function testersEnd(review: Review, testers: Review['explorations'][number]) {
	const running = review.running
	if (running)
		return railCount({
			value: age(running.startedAt),
			waitsOnYou: Boolean(running.paused),
			title: `${review.phase ?? running.state}, since ${running.startedAt}`,
		})
	return count(testers.explorers ?? 0, false)
}

function testersLabel(review: Review, testers: Review['explorations'][number]) {
	if (review.running) return review.phase ? `Testers now · ${review.phase}` : 'Testers now'
	return ['stopped', 'interrupted', 'failed'].includes(testers.state)
		? `Testers · ${words(testers.state)}`
		: 'Testers'
}

export function navigator(
	review: Review,
	current: string,
	exploration: string | null = null,
	chat = { href: reviewHref(review.planId, current, '&chat=list'), active: false }
) {
	const { planId } = review
	const active = chat.active ? 'chats' : current
	const href = (view: string) => reviewHref(planId, view)
	const needs = itemsOf(review, 'needs')
	const testers = review.explorations.find((item) => item.explorationId === exploration) ?? review.explorations.at(-1)
	const testersRow = testers
		? navRow(
				review,
				active,
				'testers',
				`/explorations/${testers.explorationId}`,
				'',
				testersLabel(review, testers),
				testersEnd(review, testers),
				{ look: 'link' }
			)
		: ''
	const builds = shown(review)
	const outsideRow = review.map.rows.find((row) => row.rule.id === outside)!
	const ruleRows = review.areas.flatMap((area) => {
		const open =
			current === `area:${area.label}` || (current.startsWith('rule:') && area.rules.includes(current.slice(5)))
		return [
			navRow(
				review,
				active,
				`area:${area.label}`,
				href(`area:${area.label}`),
				glyph(open ? '▾' : '▸'),
				area.label,
				marks(review, area.cells),
				{
					expanded: open,
					look: 'area',
				}
			),
			...area.rules.map((id) => {
				const row = review.map.rows.find((each) => each.rule.id === id)!
				return navRow(
					review,
					active,
					`rule:${id}`,
					href(`rule:${id}`),
					id,
					row.rule.text,
					marks(
						review,
						row.cells.map((cell) => cell.status)
					),
					{
						level: 2,
						area: area.label,
						look: 'rule',
						hidden: !open,
					}
				)
			}),
		]
	})
	return navRail({
		planId,
		buildCount: builds.length,
		pinned: html`${review.running ? testersRow : ''}
		${navRow(
			review,
			active,
			'needs',
			href('needs'),
			'',
			'Needs you',
			count(
				needs.length,
				needs.some((item) => item.blocking)
			)
		)}
		${navRow(review, active, 'all', href('all'), '', 'All items', count(review.items.length))}
		${navRow(review, active, 'chats', chat.href, '', 'Plan chats', html``, { look: 'link' })}`,
		board: html`${railBuilds({ builds: builds.map((item) => ({ build: item.build, label: buildLabel(review, item.build) })) })}
		${ruleRows}
		${navRow(
			review,
			active,
			`rule:${outside}`,
			href(`rule:${outside}`),
			'Out',
			'Outside the rules',
			marks(
				review,
				outsideRow.cells.map((cell) => cell.status)
			),
			{
				look: 'rule',
			}
		)}`,
		builds: html`${review.map.builds.map((item) =>
			navRow(
				review,
				active,
				`build:${item.build}`,
				href(`build:${item.build}`),
				buildLabel(review, item.build),
				item.build,
				count(itemsOf(review, `build:${item.build}`).length)
			)
		)}`,
		links: html`${navRow(review, active, 'rules', href('rules'), '', 'Rules of the plan', count(review.map.rows.length - 1))}
		${review.running ? '' : testersRow}
		${navRow(review, active, 'plan', review.revision ? `/plans/${planId}@${review.revision}` : `/plans/${planId}/request`, '', review.revision ? `Plan @${review.revision}` : 'Plan request', html``, { look: 'link' })}`,
	})
}

export function viewTitle(review: Review, view: string) {
	if (view === 'needs') return 'Needs you'
	if (view === 'all') return 'All items'
	if (view === 'rules') return 'Rules of the plan'
	if (view === `rule:${outside}`) return 'Outside the rules'
	if (view.startsWith('rule:')) return view.slice(5)
	if (view.startsWith('area:')) return view.slice(5)
	if (view.startsWith('build:')) return `Build ${buildLabel(review, view.slice(6))}`
	return view
}

function buildHeadline(review: Review, defects: number, critical: number) {
	if (review.running)
		return `Build ${review.qa.activeBuild} is under test now by ${plural(review.running.explorers ?? 0, 'tester')}.`
	const last = review.explorations.at(-1)
	if (last && (last.state === 'stopped' || last.state === 'interrupted'))
		return `The test of build ${last.build} was ${last.state}.`
	const build = review.map.builds.length ? review.qa.build : null
	if (build) return `Build ${build}: ${plural(defects, 'open defect')}${critical ? `, ${critical} critical` : ''}.`
	const run = review.latestFinalizedRun
	if (!run) return 'No build is tested yet.'
	const counts = Object.entries(run.counts).map(([outcome, count]) => `${count} ${words(outcome)}`)
	const outcome =
		run.completion === 'completed' && counts.length ? counts.join(', ') : words(run.completion ?? 'finalized')
	return `Build ${run.build}: ${outcome}.`
}

export function verdictLine(review: Review) {
	const defects = review.items.filter((item) => item.kind === 'defect' && item.claim?.open)
	const critical = defects.filter((item) => item.severity === 'critical').length
	const findings = review.items.filter((item) => item.kind === 'finding').length
	const open = review.items.filter((item) => item.kind === 'question' || item.kind === 'gap')
	const blocking = open.filter((item) => item.blocking).length
	const head = buildHeadline(review, defects.length, critical)
	const tail = [
		findings ? `${plural(findings, 'finding')} ${findings === 1 ? 'needs' : 'need'} your look.` : null,
		open.length
			? `${plural(open.length, 'question')} open${blocking ? `, ${blocking} ${blocking === 1 ? 'blocks' : 'block'} testing` : ''}.`
			: null,
	]
		.filter(Boolean)
		.join(' ')
	return { head, tail, defects: defects.length, critical, findings, open: open.length, blocking }
}

export function viewsOf(review: Review) {
	return [
		'needs',
		'all',
		...review.areas.map((area) => `area:${area.label}`),
		...review.map.rows.map((row) => `rule:${row.rule.id}`),
		...review.map.builds.map((item) => `build:${item.build}`),
		'rules',
	]
}
